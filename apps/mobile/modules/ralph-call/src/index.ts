import { type EventSubscription, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// The Android call: a foreground service with a CallStyle notification and a
// self-managed Telecom call that owns audio routing. Elsewhere (iOS for now)
// every function is a safe no-op.

export interface CallOptions {
  readonly channelName: string;
  readonly serverName: string;
  readonly muted: boolean;
  readonly deafened: boolean;
  /** Deep link the notification opens, e.g. ralphmeet://call. */
  readonly openUrl?: string;
  /**
   * Start on the speaker (default) rather than the earpiece when no headset
   * is connected. Read when the call starts.
   */
  readonly speakerFirst?: boolean;
  /** The screen is being shared; the notification says so. */
  readonly sharing?: boolean;
}

export type AudioRouteType =
  | "speaker"
  | "earpiece"
  | "bluetooth"
  | "wired"
  | "unknown";

export interface AudioRoute {
  readonly id: string;
  readonly type: AudioRouteType;
  /** The device's own name for Bluetooth; the type otherwise. */
  readonly name: string;
  readonly active: boolean;
}

export type CallAction = "mute" | "unmute" | "hangup";

type RalphCallEvents = {
  onAction: (event: { action: CallAction }) => void;
  onAudioRoutesChanged: (event: { routes: AudioRoute[] }) => void;
  onCallEndedBySystem: (event: { reason: string }) => void;
};

interface RalphCallNative {
  startCall(options: CallOptions): Promise<void>;
  updateCall(options: CallOptions): Promise<void>;
  endCall(): Promise<void>;
  setAudioRoute(id: string): Promise<boolean>;
  getAudioRoutes(): Promise<AudioRoute[]>;
  startScreenShare(): Promise<boolean>;
  stopScreenShare(): Promise<void>;
  addListener<E extends keyof RalphCallEvents>(
    event: E,
    listener: RalphCallEvents[E],
  ): EventSubscription;
}

/** The headless task that keeps JS timers alive during a call. */
export const KEEP_ALIVE_TASK = "RalphCallKeepAlive";

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<RalphCallNative>("RalphCall")
    : null;

const NO_SUBSCRIPTION: EventSubscription = { remove: () => {} };

/** True when calls run natively (an Android build with the module linked). */
export const isAvailable = native !== null;

export function startCall(options: CallOptions): Promise<void> {
  return native?.startCall(options) ?? Promise.resolve();
}

export function updateCall(options: CallOptions): Promise<void> {
  return native?.updateCall(options) ?? Promise.resolve();
}

export function endCall(): Promise<void> {
  return native?.endCall() ?? Promise.resolve();
}

export function setAudioRoute(id: string): Promise<boolean> {
  return native?.setAudioRoute(id) ?? Promise.resolve(false);
}

export function getAudioRoutes(): Promise<AudioRoute[]> {
  return native?.getAudioRoutes() ?? Promise.resolve([]);
}

/**
 * Call right before getDisplayMedia(): the next activity result (the system's
 * capture dialog) adds the mediaProjection type to the call's foreground
 * service if the user accepts, before WebRTC takes the projection. False when
 * no call service runs; then a capture must not be asked for.
 */
export function startScreenShare(): Promise<boolean> {
  return native?.startScreenShare() ?? Promise.resolve(false);
}

/** After the screen track stopped: drops the mediaProjection type. */
export function stopScreenShare(): Promise<void> {
  return native?.stopScreenShare() ?? Promise.resolve();
}

export function onAction(
  listener: (action: CallAction) => void,
): EventSubscription {
  return (
    native?.addListener("onAction", (event) => listener(event.action)) ??
    NO_SUBSCRIPTION
  );
}

export function onAudioRoutesChanged(
  listener: (routes: AudioRoute[]) => void,
): EventSubscription {
  return (
    native?.addListener("onAudioRoutesChanged", (event) =>
      listener(event.routes),
    ) ?? NO_SUBSCRIPTION
  );
}

export function onCallEndedBySystem(
  listener: (reason: string) => void,
): EventSubscription {
  return (
    native?.addListener("onCallEndedBySystem", (event) =>
      listener(event.reason),
    ) ?? NO_SUBSCRIPTION
  );
}
