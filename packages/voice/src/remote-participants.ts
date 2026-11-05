// Rules for remote participants that every client applies the same way.
// See STATE_MACHINE.md, "Remote participants".

import type { VoiceTimers } from "./voice-session";

/**
 * How long a remote participant's roster row and audio outlive a voice
 * `ClientDisconnect` (op 11) for them. VoiceRoom sends one whenever their
 * voice socket reconnects, before their tracks are offered again, so the
 * drop is cancelled if the same participant id offers tracks within it.
 */
export const REMOTE_RECONNECT_GRACE_MS = 3_000;

export interface RemoteReconnectGraceOptions {
  readonly timers: VoiceTimers;
  /** Defaults to {@link REMOTE_RECONNECT_GRACE_MS}. */
  readonly graceMs?: number;
  /**
   * The grace for `participantId` ran out. `reoffered` holds the track
   * names they offered again during it: when it is empty they did not come
   * back and everything of theirs is dropped; otherwise only their tracks
   * that are not in it are.
   */
  readonly expire: (
    participantId: string,
    reoffered: ReadonlySet<string>,
  ) => void;
}

interface PendingGrace {
  readonly timer: unknown;
  readonly reoffered: Set<string>;
}

/**
 * Holds remote participants' media through a voice-socket reconnect.
 *
 * - `disconnected(id)`: a voice `ClientDisconnect` arrived. Keep their
 *   media; start (or restart) the grace.
 * - `offered(id, track)`: they offered a track. During a grace it is
 *   recorded as offered again; it is kept when the grace runs out.
 * - `left(id)`: the room socket says they left. The grace is cancelled;
 *   the caller drops them at once.
 *
 * Speaking is not held: clear it at once on `ClientDisconnect`.
 */
export class RemoteReconnectGrace {
  private readonly timers: VoiceTimers;
  private readonly graceMs: number;
  private readonly expire: RemoteReconnectGraceOptions["expire"];
  private readonly pending = new Map<string, PendingGrace>();

  constructor(options: RemoteReconnectGraceOptions) {
    this.timers = options.timers;
    this.graceMs = options.graceMs ?? REMOTE_RECONNECT_GRACE_MS;
    this.expire = options.expire;
  }

  /** Participants inside their grace. */
  get size(): number {
    return this.pending.size;
  }

  has(participantId: string): boolean {
    return this.pending.has(participantId);
  }

  disconnected(participantId: string): void {
    this.cancel(participantId);
    const grace: PendingGrace = {
      reoffered: new Set(),
      timer: this.timers.setTimeout(() => {
        if (this.pending.get(participantId) !== grace) return;
        this.pending.delete(participantId);
        this.expire(participantId, grace.reoffered);
      }, this.graceMs),
    };
    this.pending.set(participantId, grace);
  }

  /** True when `participantId` is inside a grace (the offer is recorded). */
  offered(participantId: string, trackName: string): boolean {
    const grace = this.pending.get(participantId);
    if (!grace) return false;
    grace.reoffered.add(trackName);
    return true;
  }

  /** Cancels their grace without dropping anything. True if there was one. */
  left(participantId: string): boolean {
    return this.cancel(participantId);
  }

  /** Cancels every grace without dropping anything (the session ended). */
  dispose(): void {
    for (const participantId of [...this.pending.keys()]) {
      this.cancel(participantId);
    }
  }

  private cancel(participantId: string): boolean {
    const grace = this.pending.get(participantId);
    if (!grace) return false;
    this.timers.clearTimeout(grace.timer);
    this.pending.delete(participantId);
    return true;
  }
}
