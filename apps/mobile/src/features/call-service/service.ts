import * as Linking from "expo-linking";
import { AppRegistry, PermissionsAndroid, Platform } from "react-native";
import { create } from "zustand";

import { useCallPreferences } from "@/features/preferences/call-preferences";
import { useServersStore } from "@/features/servers/store";
import { type ActiveCall, useVoiceStore } from "@/features/voice/store";

import * as RalphCall from "../../../modules/ralph-call/src";

// The voice call as an Android call: the ralph-call module's foreground
// service, CallStyle notification and Telecom call follow the voice store.
// Off Android every call below is a no-op.

export type {
  AudioRoute,
  AudioRouteType,
} from "../../../modules/ralph-call/src";

/** What the notification's buttons and the system can ask of the call. */
export interface CallControls {
  readonly toggleMute: () => void;
  readonly leave: () => void;
}

interface AudioRoutesState {
  readonly routes: readonly RalphCall.AudioRoute[];
}

/** The call's audio routes; empty when there is no native call. */
export const useAudioRoutes = create<AudioRoutesState>()(() => ({
  routes: [],
}));

// While a call runs, the module keeps this task open so React Native keeps
// firing JS timers (socket heartbeats) behind other apps. It never settles;
// the module finishes it natively when the call ends.
AppRegistry.registerHeadlessTask(
  RalphCall.KEEP_ALIVE_TASK,
  () => () => new Promise<void>(() => {}),
);

let stopCurrent: (() => void) | null = null;
let notificationsAsked = false;

function warn(what: string) {
  return (error: unknown) => console.warn(`[Call] ${what}`, error);
}

function optionsFor(call: ActiveCall): RalphCall.CallOptions {
  const server = useServersStore
    .getState()
    .servers.find((s) => s.id === call.serverId);
  return {
    channelName: call.channelName,
    serverName: call.dm ? "Voice call" : (server?.name ?? ""),
    answeredCallId: call.dm?.answeredCallId,
    muted: call.muted,
    deafened: call.deafened,
    openUrl: Linking.createURL("/call"),
    speakerFirst: useCallPreferences.getState().audioRoute === "speaker",
    sharing: call.local.sharing,
  };
}

/**
 * Asks once per run for the notification permission (Android 13+). A denial
 * is fine: the foreground service still runs, only without a visible card.
 */
export async function askNotificationPermission(): Promise<void> {
  if (
    Platform.OS !== "android" ||
    Platform.Version < 33 ||
    notificationsAsked
  ) {
    return;
  }
  notificationsAsked = true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return;
  await PermissionsAndroid.request(permission);
}

/**
 * Bluetooth headsets need BLUETOOTH_CONNECT on Android 12+ before Telecom
 * can switch to them; asked when the route picker opens.
 */
export async function askBluetoothPermission(): Promise<void> {
  if (Platform.OS !== "android" || Platform.Version < 31) return;
  const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (await PermissionsAndroid.check(permission)) return;
  await PermissionsAndroid.request(permission);
}

/** Starts the native call for the call in the voice store. */
export function startCallService(controls: CallControls): void {
  stopCallService();
  const call = useVoiceStore.getState().call;
  if (!call || !RalphCall.isAvailable) return;

  RalphCall.startCall(optionsFor(call)).catch(warn("Could not start"));

  const unsubscribe = useVoiceStore.subscribe((state, previous) => {
    const next = state.call;
    const prev = previous.call;
    if (!next || !prev) return;
    if (
      next.muted === prev.muted &&
      next.deafened === prev.deafened &&
      next.channelName === prev.channelName &&
      next.local.sharing === prev.local.sharing
    ) {
      return;
    }
    RalphCall.updateCall(optionsFor(next)).catch(warn("Could not update"));
  });

  const action = RalphCall.onAction((name) => {
    const muted = useVoiceStore.getState().call?.muted ?? false;
    if (name === "hangup") controls.leave();
    else if ((name === "mute") !== muted) controls.toggleMute();
  });
  const ended = RalphCall.onCallEndedBySystem((reason) => {
    console.info("[Call] Ended by the system:", reason);
    controls.leave();
  });
  const routes = RalphCall.onAudioRoutesChanged((next) =>
    useAudioRoutes.setState({ routes: next }),
  );
  RalphCall.getAudioRoutes()
    .then((next) => {
      if (stopCurrent === stop) useAudioRoutes.setState({ routes: next });
    })
    .catch(warn("Could not read audio routes"));

  function stop() {
    unsubscribe();
    action.remove();
    ended.remove();
    routes.remove();
  }
  stopCurrent = stop;
}

/** Ends the native call; safe to call when none is running. */
export function stopCallService(): void {
  if (!stopCurrent) return;
  stopCurrent();
  stopCurrent = null;
  useAudioRoutes.setState({ routes: [] });
  RalphCall.endCall().catch(warn("Could not end"));
}

/**
 * Readies the call service for a screen capture (see ralph-call
 * startScreenShare). False off Android or with no call service running.
 */
export function prepareScreenCapture(): Promise<boolean> {
  return RalphCall.startScreenShare().catch((error: unknown) => {
    warn("Could not prepare screen sharing")(error);
    return false;
  });
}

/** The screen capture ended: the service drops its mediaProjection type. */
export function releaseScreenCapture(): void {
  RalphCall.stopScreenShare().catch(warn("Could not end screen sharing"));
}

export function selectAudioRoute(id: string): void {
  RalphCall.setAudioRoute(id).catch(warn("Could not switch audio"));
}
