// The voice session lifecycle as data: phases, the events that move between
// them, and what a teardown does for each way a session can end. Pure: no
// timers, no sockets, no media. STATE_MACHINE.md is the prose version of
// this file; keep the two in step.

/**
 * Where a voice session is.
 *
 * - `idle`: no session. Nothing is held.
 * - `standby`: a pre-connected session for an occupied channel is *held*
 *   (borrowed, not owned): its room socket connected with `standby: true`
 *   and its voice socket is open but unidentified. Whoever created it (the
 *   standby pool) disconnects it; this session only drops its reference.
 * - `connecting`: this session owns a client that has not joined yet (no
 *   room `Ready`, or a promoted standby whose snapshot has not replayed).
 * - `joined`: the room said `Ready` for this participant.
 * - `reconnecting`: joined, but the transport is recovering (a socket or the
 *   peer connection dropped). Roster and media are kept.
 * - `leaving`: a teardown ran; the client is waiting out the leave send
 *   window before its sockets close. It is no longer the session's client.
 */
export type VoicePhase =
  | "idle"
  | "standby"
  | "connecting"
  | "joined"
  | "reconnecting"
  | "leaving";

/** Why a session ended. Each one has its own {@link TeardownPlan}. */
export type VoiceEndReason =
  | "user-leave"
  | "forced-disconnect"
  | "component-unmount";

/** Everything that can move a session between phases. */
export type VoiceSessionEvent =
  /** A pre-connected standby client is held for this session. */
  | { readonly type: "hold-standby" }
  /** The held standby client is let go (its owner may dispose it). */
  | { readonly type: "release-standby" }
  /** A join: a new client, or the held/claimed standby client, is adopted. */
  | { readonly type: "start" }
  /** The room said `Ready` (or a promoted standby replayed its snapshot). */
  | { readonly type: "joined" }
  /** A socket or the peer connection of a joined session dropped. */
  | { readonly type: "connection-lost" }
  /** The transport of a reconnecting session is back. */
  | { readonly type: "connection-restored" }
  /** A teardown starts. */
  | { readonly type: "end"; readonly reason: VoiceEndReason }
  /** The leave send window is over and the client disconnected. */
  | { readonly type: "drained" };

export type VoiceSessionEventType = VoiceSessionEvent["type"];

/** The phases that own a client and count as "there is a session". */
export function isLivePhase(phase: VoicePhase): boolean {
  return (
    phase === "connecting" || phase === "joined" || phase === "reconnecting"
  );
}

/** Joined from the user's point of view: `joined` or `reconnecting`. */
export function isJoinedPhase(phase: VoicePhase): boolean {
  return phase === "joined" || phase === "reconnecting";
}

/**
 * The phase `event` leads to from `phase`, or `null` when the event does not
 * apply there (the caller ignores it; nothing changes). This is the whole
 * transition table; see STATE_MACHINE.md for the same table in prose.
 */
export function nextPhase(
  phase: VoicePhase,
  event: VoiceSessionEvent,
): VoicePhase | null {
  switch (event.type) {
    case "hold-standby":
      // A leave's send window does not block a new hold.
      return phase === "idle" || phase === "leaving" ? "standby" : null;
    case "release-standby":
      return phase === "standby" ? "idle" : null;
    case "start":
      // Refused while a session is live: one session at a time. A leave's
      // send window does not block a new join.
      return phase === "idle" || phase === "standby" || phase === "leaving"
        ? "connecting"
        : null;
    case "joined":
      return isLivePhase(phase) ? "joined" : null;
    case "connection-lost":
      return isJoinedPhase(phase) ? "reconnecting" : null;
    case "connection-restored":
      return phase === "reconnecting" ? "joined" : null;
    case "end":
      if (isLivePhase(phase)) return "leaving";
      if (phase === "standby") {
        // Leaving or unmounting only lets the borrowed client go. A forced
        // disconnect tears it down like an unjoined session (its owner has
        // already disposed it; disconnecting again is a no-op).
        return event.reason === "forced-disconnect" ? "leaving" : "idle";
      }
      return null;
    case "drained":
      return phase === "leaving" ? "idle" : null;
  }
}

/** How long a leave keeps the sockets open for the leave trigger to go out. */
export const LEAVE_SEND_WINDOW_MS = 100;

/**
 * What one teardown does. Derived only from why the session ended, whether
 * it had joined, and whether it is a call; see {@link planTeardown}.
 */
export interface TeardownPlan {
  readonly reason: VoiceEndReason;
  /** The session was `joined` or `reconnecting` when the teardown started. */
  readonly wasJoined: boolean;
  /** Play the local "disconnected" sound. */
  readonly leaveSound: boolean;
  /**
   * Send the automatic leave trigger (soundboard leave sound) on the voice
   * socket, which is why the sockets stay open for {@link sendWindowMs}.
   */
  readonly leaveTrigger: boolean;
  /** Milliseconds between the teardown and the client's disconnect. */
  readonly sendWindowMs: number;
  /**
   * When the platform stops exposing the client (React state, stats
   * consumers): at once, or only after it disconnected.
   */
  readonly releaseClient: "now" | "after-disconnect";
  /** Report the leave to the app (`onLeft`) once the client disconnected. */
  readonly notifyLeft: boolean;
  /** Tell the chat gateway the user left the channel's presence. */
  readonly clearPresence: boolean;
}

export interface TeardownOptions {
  /** A 1:1 call: the call gateway plays its own end sound and owns `left`. */
  readonly isCall: boolean;
}

/**
 * The teardown for `reason`. The table (J = was joined):
 *
 * | reason            | J | sound    | trigger | window | release   | left     | presence |
 * | ----------------- | - | -------- | ------- | ------ | --------- | -------- | -------- |
 * | user-leave        | 1 | !isCall  | yes     | 100 ms | after     | !isCall  | yes      |
 * | user-leave        | 0 | no       | no      | 0      | now       | no       | no       |
 * | forced-disconnect | 1 | !isCall  | yes     | 100 ms | after     | yes      | yes      |
 * | forced-disconnect | 0 | no       | no      | 100 ms | after     | yes      | no       |
 * | component-unmount | 1 | no       | yes     | 100 ms | now       | no       | yes      |
 * | component-unmount | 0 | no       | no      | 0      | now       | no       | no       |
 */
export function planTeardown(
  reason: VoiceEndReason,
  wasJoined: boolean,
  options: TeardownOptions,
): TeardownPlan {
  switch (reason) {
    case "user-leave":
      return {
        reason,
        wasJoined,
        leaveSound: wasJoined && !options.isCall,
        leaveTrigger: wasJoined,
        sendWindowMs: wasJoined ? LEAVE_SEND_WINDOW_MS : 0,
        releaseClient: wasJoined ? "after-disconnect" : "now",
        notifyLeft: wasJoined && !options.isCall,
        clearPresence: wasJoined,
      };
    case "forced-disconnect":
      return {
        reason,
        wasJoined,
        leaveSound: wasJoined && !options.isCall,
        leaveTrigger: wasJoined,
        sendWindowMs: LEAVE_SEND_WINDOW_MS,
        releaseClient: "after-disconnect",
        notifyLeft: true,
        clearPresence: wasJoined,
      };
    case "component-unmount":
      return {
        reason,
        wasJoined,
        leaveSound: false,
        leaveTrigger: wasJoined,
        sendWindowMs: wasJoined ? LEAVE_SEND_WINDOW_MS : 0,
        releaseClient: "now",
        notifyLeft: false,
        clearPresence: wasJoined,
      };
  }
}
