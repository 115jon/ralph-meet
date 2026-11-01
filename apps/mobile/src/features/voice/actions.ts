import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
  PermissionsAndroid,
  Platform,
} from "react-native";

import { useSession } from "@/features/auth/session";
import {
  askNotificationPermission,
  prepareScreenCapture,
  releaseScreenCapture,
  startCallService,
  stopCallService,
} from "@/features/call-service/service";
import {
  speakingLevel,
  useCallPreferences,
} from "@/features/preferences/call-preferences";
import { showToast } from "@/ui";

import type { CameraFacing } from "./local-media";
import { voiceRoomSlug } from "./protocol";
import type { VoiceSession } from "./session";
import { NO_LOCAL_MEDIA, useVoiceStore } from "./store";

// Starting and ending calls. The WebRTC engine (react-native-webrtc,
// PartyTracks) is imported on the first join, so the app starts without it.

let session: VoiceSession | null = null;
/** Bumped by every join and leave; a join that finds it moved gives up. */
let generation = 0;
/** The call screen is up with the app in front: pull remote video. */
let watchingVideo = false;
/** A camera or screen start is in flight; taps meanwhile are ignored. */
let cameraStarting = false;
let screenStarting = false;
/**
 * The camera was on when the app went behind. Android gives the camera only
 * to the app in front (a background camera needs a camera-type foreground
 * service, which we do not run), so it is turned off and comes back here.
 */
let resumeCamera: CameraFacing | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

export interface JoinTarget {
  readonly serverId: string;
  readonly channelId: string;
  readonly channelName: string;
}

async function microphoneAllowed(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function failJoin(label: string, text: string): void {
  useVoiceStore.setState({ call: null });
  showToast({ label, text, led: "danger" });
}

/** Joins `target`, leaving any other call first. A join in progress wins. */
export async function joinVoiceChannel(target: JoinTarget): Promise<void> {
  const current = useVoiceStore.getState().call;
  if (current?.channelId === target.channelId) return;
  leaveCall();

  const user = useSession.getState().user;
  if (!user) return;
  const mine = ++generation;
  // Read at launch (app/_layout); set synchronously so the call screen,
  // opened right after this call, finds the call already in the store.
  const { joinMuted } = useCallPreferences.getState();
  useVoiceStore.setState({
    call: {
      serverId: target.serverId,
      channelId: target.channelId,
      channelName: target.channelName,
      status: "joining",
      muted: joinMuted,
      deafened: false,
      selfId: null,
      participants: {},
      speaking: {},
      videos: {},
      local: NO_LOCAL_MEDIA,
    },
  });

  if (!(await microphoneAllowed())) {
    if (mine === generation) {
      failJoin(target.channelName, "Allow the microphone to join voice");
    }
    return;
  }
  // The ongoing-call notification; the call goes ahead either way.
  await askNotificationPermission();
  if (mine !== generation) return;

  let microphone: MediaStream;
  let engine: typeof import("./engine");
  try {
    engine = await import("./engine");
    microphone = await engine.captureMicrophone();
  } catch (error) {
    console.warn("[Voice] Could not start the microphone", error);
    if (mine === generation) {
      failJoin(target.channelName, "The microphone did not start");
    }
    return;
  }
  if (mine !== generation) {
    engine.releaseMicrophone(microphone);
    return;
  }

  engine.startCallAudio();
  const next = new engine.VoiceSession({
    target: {
      serverId: target.serverId,
      channelId: target.channelId,
      roomSlug: voiceRoomSlug(target.serverId, target.channelId),
    },
    identity: {
      userId: user.id,
      name: user.display_name ?? user.username,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    },
    microphone,
    muted: joinMuted,
    deafened: false,
    speakingLevel,
    onEnd: (end) => {
      engine.stopCallAudio();
      if (session === next) {
        stopCallService();
        stopWatchingAppState();
        session = null;
      }
      const call = useVoiceStore.getState().call;
      if (call?.channelId === target.channelId) {
        useVoiceStore.setState({ call: null });
      }
      if (end.reason === "failed") {
        showToast({
          label: target.channelName,
          text: end.message ?? "The call ended",
          led: "danger",
        });
      }
    },
  });
  session = next;
  next.setWatchingVideo(watchingVideo);
  next.start();
  watchAppState();
  // While the app is still in front: Android only starts the microphone
  // foreground service from a visible app.
  startCallService({ toggleMute, leave: leaveCall });
}

/** Leaves the call (or abandons a join in progress). */
export function leaveCall(): void {
  generation += 1;
  const ending = session;
  session = null;
  stopWatchingAppState();
  // The session stops the camera and screen tracks; ending the call service
  // drops its mediaProjection type with it.
  ending?.leave();
  stopCallService();
  useVoiceStore.setState({ call: null });
}

export function toggleMute(): void {
  session?.toggleMute();
}

export function toggleDeafen(): void {
  session?.toggleDeafen();
}

function callToast(text: string): void {
  const label = useVoiceStore.getState().call?.channelName ?? "Voice";
  showToast({ label, text, led: "danger" });
}

async function cameraAllowed(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Captures the camera and hands it to the session that asked. */
async function startCamera(facing: CameraFacing): Promise<void> {
  const current = session;
  if (!current) return;
  const engine = await import("./engine");
  let stream: MediaStream;
  try {
    stream = await engine.captureCamera(facing);
  } catch (error) {
    console.warn("[Voice] Could not start the camera", error);
    if (session === current) callToast("The camera did not start");
    return;
  }
  if (session !== current) {
    engine.stopStream(stream);
    return;
  }
  current.setCamera(stream);
}

/** Turns the camera on (front first) or off. */
export async function toggleCamera(): Promise<void> {
  const current = session;
  if (!current || cameraStarting) return;
  if (current.cameraOn) {
    resumeCamera = null;
    current.setCamera(null);
    return;
  }
  cameraStarting = true;
  try {
    if (!(await cameraAllowed())) {
      callToast("Allow the camera to turn it on");
      return;
    }
    await startCamera("front");
  } finally {
    cameraStarting = false;
  }
}

/** Front camera to back and back. */
export function flipCamera(): void {
  const current = session;
  current?.flipCamera().catch((error: unknown) => {
    console.warn("[Voice] Could not switch the camera", error);
    if (session === current) callToast("There's no other camera to switch to");
  });
}

/**
 * Shares the screen, or stops sharing. Android asks the user first; the call
 * service takes the mediaProjection type between their yes and the capture.
 */
export async function toggleScreenShare(): Promise<void> {
  const current = session;
  if (!current || screenStarting) return;
  if (current.sharingScreen) {
    stopScreenShare();
    return;
  }
  if (Platform.OS !== "android") return;
  screenStarting = true;
  try {
    if (!(await prepareScreenCapture())) {
      callToast("Screen sharing can't start right now");
      return;
    }
    const engine = await import("./engine");
    let stream: MediaStream;
    try {
      stream = await engine.captureScreen();
    } catch (error) {
      releaseScreenCapture();
      if (engine.isPermissionRefusal(error)) {
        if (session === current) callToast("Screen sharing was cancelled");
      } else {
        console.warn("[Voice] Could not share the screen", error);
        if (session === current) callToast("Screen sharing did not start");
      }
      return;
    }
    if (session !== current) {
      engine.stopStream(stream);
      releaseScreenCapture();
      return;
    }
    // Android's own Stop (the status bar chip, the cast tile) ends the track.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (session === current && current.isScreen(stream)) stopScreenShare();
    });
    current.setScreen(stream);
  } finally {
    screenStarting = false;
  }
}

export function stopScreenShare(): void {
  if (!session?.sharingScreen) return;
  session.setScreen(null);
  releaseScreenCapture();
}

function onAppStateChange(state: AppStateStatus): void {
  const current = session;
  if (!current) return;
  if (state === "background" && current.cameraOn) {
    resumeCamera = current.facing;
    current.setCamera(null);
  } else if (state === "active" && resumeCamera) {
    const facing = resumeCamera;
    resumeCamera = null;
    void startCamera(facing);
  }
}

function watchAppState(): void {
  appStateSubscription?.remove();
  appStateSubscription = AppState.addEventListener("change", onAppStateChange);
}

function stopWatchingAppState(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
  resumeCamera = null;
}

/**
 * Whether the call screen is showing (and the app is in front), so remote
 * camera and screen video is worth pulling. Audio is pulled regardless.
 */
export function setWatchingVideo(watching: boolean): void {
  watchingVideo = watching;
  session?.setWatchingVideo(watching);
}

/** The app is in front again. */
export function wakeCall(): void {
  session?.wake();
}
