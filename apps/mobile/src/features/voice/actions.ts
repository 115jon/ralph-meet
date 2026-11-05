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
import {
  handleSoundboardEvent,
  handleSoundboardRejected,
  resetSoundboard,
} from "@/features/soundboard/playback";
import { showToast } from "@/ui";

import type { CameraFacing } from "./local-media";
import { peerGain, peerSettings, usePeerSettingsStore } from "./peer-settings";
import { inPip, usePipStore } from "./pip";
import { dmCallRoomSlug, voiceRoomSlug } from "./protocol";
import type { AudioSource, CallSession } from "./session";
import { type DmCall, NO_LOCAL_MEDIA, useVoiceStore } from "./store";
import { startJoinLeaveTones } from "./tones";

// Starting and ending calls. The WebRTC engine (react-native-webrtc,
// PartyTracks) is imported on the first join, so the app starts without it.

let session: CallSession | null = null;
/** Bumped by every join and leave; a join that finds it moved gives up. */
let generation = 0;
/** The call screen is up with the app in front: pull remote video. */
let watchingVideo = false;
/** A camera start is in flight; taps meanwhile are ignored. */
let cameraStarting = false;
/**
 * The camera was on when the app went behind. Android gives the camera only
 * to the app in front (a background camera needs a camera-type foreground
 * service, which we do not run), so it is turned off and comes back here.
 */
let resumeCamera: CameraFacing | null = null;
let appStateSubscription: NativeEventSubscription | null = null;
/** What follows the session while it lives: tones, gains, PiP. */
let stopCallWatchers: (() => void) | null = null;

export interface JoinTarget {
  /** Empty for a DM call. */
  readonly serverId: string;
  readonly channelId: string;
  /** The voice channel, or the other person in a DM call. */
  readonly channelName: string;
  /** A DM call: its room is `dm-call-<a>-<b>`, not a server voice room. */
  readonly dm?: DmCall;
}

async function microphoneAllowed(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** A participant's voice or share gain, from their user's settings here. */
function audioGain(participantId: string, source: AudioSource): number {
  const participant =
    useVoiceStore.getState().call?.participants[participantId];
  return peerGain(peerSettings(participant?.userId ?? null), source);
}

/**
 * Tones on others joining and leaving, gains re-read when a person's
 * settings or the roster change, and the camera's background rule when the
 * PiP window closes behind other apps.
 */
function watchCall(current: CallSession): () => void {
  const stopTones = startJoinLeaveTones();
  const stopSettings = usePeerSettingsStore.subscribe(() =>
    current.refreshAudioGains(),
  );
  const stopRoster = useVoiceStore.subscribe((state, previous) => {
    if (state.call?.participants !== previous.call?.participants) {
      current.refreshAudioGains();
    }
  });
  const stopPip = usePipStore.subscribe((state, previous) => {
    if (
      previous.active &&
      !state.active &&
      AppState.currentState !== "active"
    ) {
      onAppStateChange("background");
    }
  });
  return () => {
    stopTones();
    stopSettings();
    stopRoster();
    stopPip();
  };
}

function stopWatchingCall(): void {
  stopCallWatchers?.();
  stopCallWatchers = null;
  resetSoundboard();
}

/** The call service could not take the mediaProjection type. */
class ScreenCaptureUnavailable extends Error {
  constructor() {
    super("Screen capture is unavailable");
  }
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
      dm: target.dm,
      status: "joining",
      muted: joinMuted,
      deafened: false,
      selfId: null,
      participants: {},
      speaking: {},
      videos: {},
      cameraFlows: {},
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
  const next = new engine.CallSession({
    target: {
      serverId: target.serverId,
      channelId: target.channelId,
      roomSlug: target.dm
        ? dmCallRoomSlug(user.id, target.dm.peerId)
        : voiceRoomSlug(target.serverId, target.channelId),
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
    isCall: target.dm !== undefined,
    speakingLevel,
    audioGain,
    screenCapture: {
      capture: async () => {
        if (!(await prepareScreenCapture())) {
          throw new ScreenCaptureUnavailable();
        }
        try {
          return await engine.captureScreen();
        } catch (error) {
          releaseScreenCapture();
          throw error;
        }
      },
      release: (stream) => {
        engine.stopStream(stream);
        releaseScreenCapture();
      },
    },
    onScreenShareFailed: (error) => {
      if (session !== next) return;
      if (error instanceof ScreenCaptureUnavailable) {
        callToast("Screen sharing can't start right now");
      } else if (engine.isPermissionRefusal(error)) {
        callToast("Screen sharing was cancelled");
      } else {
        console.warn("[Voice] Could not share the screen", error);
        callToast("Screen sharing did not start");
      }
    },
    onAppEvent: handleSoundboardEvent,
    onAppEventRejected: handleSoundboardRejected,
    onEnd: (end) => {
      engine.stopCallAudio();
      if (session === next) {
        stopCallService();
        stopWatchingAppState();
        stopWatchingCall();
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
  next.start();
  // After start: a session that is not live yet ignores it, and the call
  // screen (open since the tap that joined) does not say it again.
  next.setWatchingVideo(watchingVideo);
  watchAppState();
  stopCallWatchers = watchCall(next);
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
  stopWatchingCall();
  // The session stops the camera and screen tracks; ending the call service
  // drops its mediaProjection type with it.
  ending?.leave();
  stopCallService();
  useVoiceStore.setState({ call: null });
}

/** A voice-session app event (the soundboard's play) to everyone in the call. */
export function sendVoiceAppEvent(d: Readonly<Record<string, unknown>>): void {
  session?.sendAppEvent(d);
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
 * service takes the mediaProjection type between their yes and the capture
 * (the session's screenCapture). The session's ScreenShare serializes taps
 * and Android's own Stop.
 */
export function toggleScreenShare(): void {
  if (Platform.OS !== "android" && !session?.sharingScreen) return;
  session?.toggleScreenShare();
}

export function stopScreenShare(): void {
  session?.stopScreenShare();
}

function onAppStateChange(state: AppStateStatus): void {
  const current = session;
  if (!current) return;
  // In PiP the call is still on screen: the camera and remote video stay.
  if (state === "background" && !inPip()) {
    current.setInBackground(true);
    if (current.cameraOn) {
      resumeCamera = current.facing;
      current.setCamera(null);
    }
  } else if (state === "active") {
    current.setInBackground(false);
    if (resumeCamera) {
      const facing = resumeCamera;
      resumeCamera = null;
      void startCamera(facing);
    }
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

/** The app is in front again, or the network came back (`networkChanged`). */
export function wakeCall(
  options: { readonly networkChanged?: boolean } = {},
): void {
  session?.wake(options);
}
