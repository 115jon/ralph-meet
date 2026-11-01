import { type EventSubscription, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

// The Android call: a foreground service with a CallStyle notification and a
// self-managed Telecom call that owns audio routing, and incoming DM calls:
// the ring (a full-screen screen on the lock screen, a CallStyle heads-up
// over other apps, an event for the app's own sheet while it is in front),
// the ringtone and the incoming Telecom call. Elsewhere (iOS for now) every
// function is a safe no-op.

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
  /**
   * The DM call this is, answered on this phone: the ringing Telecom call
   * carries on as this call (a car or headset sees one call throughout).
   */
  readonly answeredCallId?: string;
}

/** A DM call ringing this phone (the gateway's CALL_RING or a push). */
export interface IncomingCall {
  readonly callId: string;
  readonly channelId: string;
  readonly callerId: string;
  readonly callerName: string;
  /** As stored: may be an API-relative /api/... path. */
  readonly callerAvatar: string | null;
  /** How long it may ring; the server stops it sooner. */
  readonly ringSeconds?: number;
}

export interface IncomingCallEnd {
  readonly callId: string;
  /** The gateway's CALL_RING_STOP reason, or "declined" / "answered" here. */
  readonly reason: string;
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

/** What the PiP window holds: its shape, and the Mute action's state. */
export interface PipParams {
  readonly aspectWidth: number;
  readonly aspectHeight: number;
  readonly muted: boolean;
}

export interface SoundEnd {
  readonly id: string;
  /** Set when the clip could not be played. */
  readonly error: string | null;
}

type RalphCallEvents = {
  onAction: (event: { action: CallAction }) => void;
  onAudioRoutesChanged: (event: { routes: AudioRoute[] }) => void;
  onCallEndedBySystem: (event: { reason: string }) => void;
  onIncomingCall: (event: IncomingCall) => void;
  onIncomingCallEnded: (event: IncomingCallEnd) => void;
  onIncomingCallAnswered: (event: IncomingCall) => void;
  onPipModeChanged: (event: { active: boolean }) => void;
  onSoundEnded: (event: SoundEnd) => void;
};

interface RalphCallNative {
  startCall(options: CallOptions): Promise<void>;
  updateCall(options: CallOptions): Promise<void>;
  endCall(): Promise<void>;
  setAudioRoute(id: string): Promise<boolean>;
  getAudioRoutes(): Promise<AudioRoute[]>;
  startScreenShare(): Promise<boolean>;
  stopScreenShare(): Promise<void>;
  ringIncoming(call: IncomingCall): Promise<void>;
  stopIncoming(callId: string, reason: string): Promise<void>;
  answerIncoming(callId: string): Promise<void>;
  declineIncoming(callId: string): Promise<void>;
  takeAnsweredCall(): Promise<IncomingCall | null>;
  setRingback(on: boolean): Promise<void>;
  canUseFullScreenIntent(): Promise<boolean>;
  openFullScreenIntentSettings(): Promise<void>;
  setPip(params: PipParams | null): Promise<void>;
  enterPip(): Promise<boolean>;
  closePip(): Promise<void>;
  isInPip(): boolean;
  setRotationUnlocked(unlocked: boolean): Promise<void>;
  playSound(
    id: string,
    uri: string,
    headers: Readonly<Record<string, string>> | null,
    volume: number,
  ): Promise<void>;
  stopSound(id: string): Promise<void>;
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

// ── Incoming DM calls ───────────────────────────────────────────────────

/**
 * Rings this phone for `call`, once per call id (a push and the gateway
 * may both deliver it). In front, the module only plays the ringtone and
 * raises onIncomingCall for the app's sheet; otherwise it shows the call.
 */
export function ringIncoming(call: IncomingCall): Promise<void> {
  return native?.ringIncoming(call) ?? Promise.resolve();
}

/** The ring stopped elsewhere (CALL_RING_STOP); a missed one leaves a notification. */
export function stopIncoming(callId: string, reason: string): Promise<void> {
  return native?.stopIncoming(callId, reason) ?? Promise.resolve();
}

/** Answered in the app: the ring stops; the app accepts and joins. */
export function answerIncoming(callId: string): Promise<void> {
  return native?.answerIncoming(callId) ?? Promise.resolve();
}

/** Declined in the app: the ring stops and the module tells the server. */
export function declineIncoming(callId: string): Promise<void> {
  return native?.declineIncoming(callId) ?? Promise.resolve();
}

/** A call answered from the notification or lock screen before JS ran. */
export function takeAnsweredCall(): Promise<IncomingCall | null> {
  return native?.takeAnsweredCall() ?? Promise.resolve(null);
}

/** The ringback tone the caller hears while the other phone rings. */
export function setRingback(on: boolean): Promise<void> {
  return native?.setRingback(on) ?? Promise.resolve();
}

/**
 * Android 14+ lets an app show a call over the lock screen only once the
 * user allows full-screen notifications; true below 14 and off Android.
 */
export function canUseFullScreenIntent(): Promise<boolean> {
  return native?.canUseFullScreenIntent() ?? Promise.resolve(true);
}

/** Opens the system page where the user allows it. */
export function openFullScreenIntentSettings(): Promise<void> {
  return native?.openFullScreenIntentSettings() ?? Promise.resolve();
}

// ── Picture-in-picture and rotation ─────────────────────────────────────

/**
 * Arms picture-in-picture: leaving the app (home, a gesture) shrinks it into
 * the system's PiP window with Mute and Leave. Null disarms it.
 */
export function setPip(params: PipParams | null): Promise<void> {
  return native?.setPip(params) ?? Promise.resolve();
}

/** Enters PiP now (when armed and supported). */
export function enterPip(): Promise<boolean> {
  return native?.enterPip() ?? Promise.resolve(false);
}

/** Closes the PiP window, as its own close key does; the call goes on. */
export function closePip(): Promise<void> {
  return native?.closePip() ?? Promise.resolve();
}

export function isInPip(): boolean {
  return native?.isInPip() ?? false;
}

export function onPipModeChanged(
  listener: (active: boolean) => void,
): EventSubscription {
  return (
    native?.addListener("onPipModeChanged", (event) =>
      listener(event.active),
    ) ?? NO_SUBSCRIPTION
  );
}

/** The call screen may rotate with the phone; false puts portrait back. */
export function setRotationUnlocked(unlocked: boolean): Promise<void> {
  return native?.setRotationUnlocked(unlocked) ?? Promise.resolve();
}

// ── Call sounds ─────────────────────────────────────────────────────────

/**
 * Plays a short clip on the call's audio route (a file:// or https URL),
 * replacing any clip with the same id. `volume` is 0..1.
 */
export function playSound(
  id: string,
  uri: string,
  headers: Readonly<Record<string, string>> | null,
  volume: number,
): Promise<void> {
  return native?.playSound(id, uri, headers, volume) ?? Promise.resolve();
}

export function stopSound(id: string): Promise<void> {
  return native?.stopSound(id) ?? Promise.resolve();
}

/** A clip ended, was stopped or failed. */
export function onSoundEnded(
  listener: (end: SoundEnd) => void,
): EventSubscription {
  return native?.addListener("onSoundEnded", listener) ?? NO_SUBSCRIPTION;
}

export function onIncomingCall(
  listener: (call: IncomingCall) => void,
): EventSubscription {
  return native?.addListener("onIncomingCall", listener) ?? NO_SUBSCRIPTION;
}

export function onIncomingCallEnded(
  listener: (end: IncomingCallEnd) => void,
): EventSubscription {
  return (
    native?.addListener("onIncomingCallEnded", listener) ?? NO_SUBSCRIPTION
  );
}

/** Answered outside the app (notification, lock screen, a headset). */
export function onIncomingCallAnswered(
  listener: (call: IncomingCall) => void,
): EventSubscription {
  return (
    native?.addListener("onIncomingCallAnswered", listener) ?? NO_SUBSCRIPTION
  );
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
