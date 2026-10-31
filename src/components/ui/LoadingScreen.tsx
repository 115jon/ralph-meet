/**
 * Timing for the loading surfaces (splash, first-connect overlay, desktop
 * updater): the loader animates for `LOADER_SETTLE_MS`, then settles into a
 * still frame so nothing keeps running behind a game.
 */

import { useEffect, useState } from "react";

/** How long the loader animates before it settles into a still frame. */
export const LOADER_SETTLE_MS = 10_000;

/** True once `ms` have passed since mount (one timeout, no ticking). */
export function useElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return elapsed;
}
