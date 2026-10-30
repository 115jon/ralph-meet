/**
 * Cloudflare Realtime SFU garbage-collects a pushed track that receives no
 * media packets for 30 s (Realtime SFU limits, "inactivity timeout"). After
 * that the publication cannot simply resume: its SFU track is gone, every
 * pull of it gets `not_found_track_error`, and nobody hears it until it is
 * pushed again. This module owns that rule for a publication whose source
 * can stop producing media (the paused warm-standby silence).
 */
export const SFU_TRACK_INACTIVITY_GC_MS = 30_000;

/**
 * How long a publication may sit without sending media before it is treated
 * as gone. Under the SFU's 30 s with room for the time media takes to start
 * flowing again after a claim. The clock starts when the source pauses,
 * before the SFU has even created the track, so it errs early.
 */
export const PUBLICATION_STALE_AFTER_MS = 25_000;

export interface PublicationLiveness {
  /** The source stopped producing media: no RTP reaches the SFU from now. */
  markIdle(): void;
  /** Media flows again; the SFU keeps a track that is still alive. */
  markFlowing(): void;
  /** How long the publication has been without media (0 while flowing). */
  idleMs(): number;
  /**
   * Whether the SFU may already have dropped the track, so it has to be
   * pushed again before anyone is told to pull it.
   */
  isStale(): boolean;
}

export function createPublicationLiveness(
  now: () => number = () => performance.now(),
  staleAfterMs: number = PUBLICATION_STALE_AFTER_MS,
): PublicationLiveness {
  let idleSince: number | null = null;
  const idleMs = () =>
    idleSince === null ? 0 : Math.max(0, now() - idleSince);
  return {
    markIdle: () => {
      idleSince ??= now();
    },
    markFlowing: () => {
      idleSince = null;
    },
    idleMs,
    isStale: () => idleSince !== null && idleMs() >= staleAfterMs,
  };
}
