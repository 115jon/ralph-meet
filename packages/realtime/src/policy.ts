// ── Reconnect policy ────────────────────────────────────────────────────────
// One schedule shape for every realtime socket, with per-socket numbers:
//
//   delay(n) = min(baseMs · 2ⁿ, maxMs) · (1 − scaleJitter · r₁) + addJitterMs · r₂
//
// n counts retries since the last successful identify (Ready, Resumed,
// VoiceReady); r₁ and r₂ are uniform in [0, 1).
//
// | socket          | baseMs | maxMs  | jitter         | 401s to stop | then         |
// | --------------- | ------ | ------ | -------------- | ------------ | ------------ |
// | chat (/gateway) | 1000   | 30000  | +0–500 ms      | 2 in a row   | retry 1/min  |
// | room, voice     | 500    | 10000  | ×0.5–1         | 2 in a row   | wait for wake|
//
// The numbers are the ones each socket had before it shared this module. The
// chat socket backs off further because it is one per tab and long-lived; the
// call sockets carry a live call, so they come back faster. One 401 can be a
// race with a session refresh, so the first retries on the normal schedule;
// the second means the session is gone. The chat socket keeps a slow retry so
// "Signed out" clears by itself once the session is back; the call sockets
// stop and wait for a wake (tab visible, back online) or a new join, and the
// chat socket's "Signed out" is what the user sees.
//
// Every step of an attempt has a deadline (CONNECT_TIMEOUTS): ticket, open,
// Hello, Ready. A step that runs out drops the attempt and retries on the
// schedule above, as a close would.

export interface BackoffPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
  /** Fraction of the capped delay that random jitter may take off (0–1). */
  readonly scaleJitter: number;
  /** Random milliseconds added on top of the scaled delay. */
  readonly addJitterMs: number;
}

/**
 * How long each step of a connection attempt may take before the attempt is
 * dropped and retried on the backoff schedule. Without these an attempt
 * whose request or socket goes down a dead connection waits forever: a
 * phone's HTTP client has no timeouts of its own.
 */
export interface ConnectTimeouts {
  /** The ticket request (aborted through its signal when it runs out). */
  readonly ticketMs: number;
  /** Ticket in hand to the socket's open event. */
  readonly openMs: number;
  /** Open to the server's Hello. */
  readonly helloMs: number;
  /**
   * The gateway's Identify or Resume (its first frame after Hello) to
   * markReady() (Ready, Resumed, VoiceReady).
   */
  readonly readyMs: number;
}

export interface RealtimeSocketPolicy {
  readonly backoff: BackoffPolicy;
  readonly timeouts: ConnectTimeouts;
  /** Ticket refusals (401) in a row before the socket reports "auth". */
  readonly refusalsToFail: number;
  /** In the auth-failed state, how often to try again; null: only on wake. */
  readonly authRetryMs: number | null;
  /**
   * After a wake, how long an open socket has to answer the probe. A ticket
   * request older than this is also dropped and asked again on a wake.
   */
  readonly probeMs: number;
}

/**
 * The same for every socket. A ticket is one small POST and the gateway
 * answers Hello at once; Ready can wait on the server loading state, so it
 * gets longer.
 */
export const CONNECT_TIMEOUTS: ConnectTimeouts = {
  ticketMs: 10_000,
  openMs: 10_000,
  helloMs: 10_000,
  readyMs: 20_000,
};

/** The delay before retry `attempt` (0 for the first retry). */
export function backoffDelay(
  policy: BackoffPolicy,
  attempt: number,
  random: () => number,
): number {
  const capped = Math.min(policy.baseMs * 2 ** attempt, policy.maxMs);
  const scaled =
    policy.scaleJitter > 0
      ? capped * (1 - policy.scaleJitter * random())
      : capped;
  return policy.addJitterMs > 0
    ? scaled + policy.addJitterMs * random()
    : scaled;
}

/** The chat store's socket to the main gateway (/api/gateway). */
export const CHAT_SOCKET_POLICY: RealtimeSocketPolicy = {
  backoff: { baseMs: 1000, maxMs: 30_000, scaleJitter: 0, addJitterMs: 500 },
  timeouts: CONNECT_TIMEOUTS,
  refusalsToFail: 2,
  authRetryMs: 60_000,
  probeMs: 5000,
};

/** RoomGateway and VoiceGateway: the two sockets of a voice call. */
export const CALL_SOCKET_POLICY: RealtimeSocketPolicy = {
  backoff: { baseMs: 500, maxMs: 10_000, scaleJitter: 0.5, addJitterMs: 0 },
  timeouts: CONNECT_TIMEOUTS,
  refusalsToFail: 2,
  authRetryMs: null,
  probeMs: 5000,
};
