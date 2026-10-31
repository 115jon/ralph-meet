import { PermissionsAndroid, Platform } from "react-native";

import { useSession } from "@/features/auth/session";
import {
  askNotificationPermission,
  startCallService,
  stopCallService,
} from "@/features/call-service/service";
import { showToast } from "@/ui";

import { voiceRoomSlug } from "./protocol";
import type { VoiceSession } from "./session";
import { useVoiceStore } from "./store";

// Starting and ending calls. The WebRTC engine (react-native-webrtc,
// PartyTracks) is imported on the first join, so the app starts without it.

let session: VoiceSession | null = null;
/** Bumped by every join and leave; a join that finds it moved gives up. */
let generation = 0;

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
  useVoiceStore.setState({
    call: {
      serverId: target.serverId,
      channelId: target.channelId,
      channelName: target.channelName,
      status: "joining",
      muted: false,
      deafened: false,
      selfId: null,
      participants: {},
      speaking: {},
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
    muted: false,
    deafened: false,
    onEnd: (end) => {
      engine.stopCallAudio();
      if (session === next) stopCallService();
      if (session === next) session = null;
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
  // While the app is still in front: Android only starts the microphone
  // foreground service from a visible app.
  startCallService({ toggleMute, leave: leaveCall });
}

/** Leaves the call (or abandons a join in progress). */
export function leaveCall(): void {
  generation += 1;
  const ending = session;
  session = null;
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

/** The app is in front again. */
export function wakeCall(): void {
  session?.wake();
}
