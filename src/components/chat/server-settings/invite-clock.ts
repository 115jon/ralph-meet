/**
 * One shared 1s ticker for every invite countdown (overlays audit §5,
 * "Invite countdown"). It runs only while at least one countdown is
 * mounted, and each row subscribes to its own label string, so a row
 * re-renders only when its text changes: once a minute above an hour,
 * once a second below.
 */

import { useCallback, useSyncExternalStore } from "react";

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Remaining time, or null once expired:
 *   2d 3h  ·  19h 59m  ·  24m 09s  ·  9s
 */
export function remainingLabel(expiresAt: string, at: number): string | null {
  const diff = new Date(expiresAt).getTime() - at;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/** The countdown label for one invite, from the shared ticker. */
export function useRemaining(expiresAt: string): string | null {
  const getSnapshot = useCallback(
    // Before the first subscriber the shared clock is stale; read the wall.
    () => remainingLabel(expiresAt, timer === null ? Date.now() : now),
    [expiresAt],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
