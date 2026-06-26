// ============================================================================
// useNativeShareStats — live native screen-share stats for the desktop shell
//
// Architecture: poll-first.
//
// A single `setInterval` polls `get_native_screen_share_stats` at
// `NATIVE_SHARE_STATS_POLL_MS` (1s). `"native-screen-share-status"` events
// still trigger an immediate poll for mode/availability changes.
//
// This keeps stats refreshes off the background capture threads entirely.
// ============================================================================
import { isDesktop } from "@/lib/platform";
import { clog } from "@/lib/console-logger";
import type { NativeShareStatsSnapshot } from "@/types/native-share-stats";
import { useEffect, useState } from "react";

const log = clog("useNativeShareStats");

/** Fallback poll interval for `get_native_screen_share_stats`. <= 2s per Req 8.8. */
export const NATIVE_SHARE_STATS_POLL_MS = 1000;

/** Public state surfaced by {@link useNativeShareStats}. */
export interface NativeShareStatsState {
  /** Most recent good snapshot, or `null` before the first success. */
  data: NativeShareStatsSnapshot | null;
  /** `true` when the displayed `data` is from a failed/empty refresh (Req 8.10). */
  stale: boolean;
  /** `true` only inside the Tauri desktop shell (Req 8.9, 13.3). */
  isDesktop: boolean;
  /** `true` when the active capture mode is the zero-copy game-capture hook. */
  isHookActive: boolean;
}

/**
 * A single poll outcome fed to {@link reduceStatsState}:
 * - `{ type: "ok", data }` — the command returned a usable snapshot.
 * - `{ type: "empty" }`    — the command returned no data (e.g. `null`).
 * - `{ type: "error" }`    — the command threw / rejected.
 */
export type StatsPollEvent =
  | { type: "ok"; data: NativeShareStatsSnapshot }
  | { type: "empty" }
  | { type: "error" };

/** Reducer state: the carried data plus its staleness flag. */
export interface StatsReducerState {
  data: NativeShareStatsSnapshot | null;
  stale: boolean;
}

/** The initial reducer state before any poll has resolved. */
export const initialStatsReducerState: StatsReducerState = {
  data: null,
  stale: false,
};

/**
 * Pure staleness reducer (Req 8.10).
 *
 * - A successful poll replaces `data` and clears `stale`.
 * - A failed or empty poll keeps the last good `data` and sets `stale = true`.
 *   (When there is no prior `data`, `data` stays `null` but the result is still
 *   flagged stale so the UI can indicate the refresh failed.)
 *
 * Extracted from the hook so the "preserve last good stats, flag staleness on
 * failure" behavior can be property-tested without React or Tauri.
 */
export function reduceStatsState(
  prev: StatsReducerState,
  event: StatsPollEvent,
): StatsReducerState {
  switch (event.type) {
    case "ok":
      return { data: event.data, stale: false };
    case "empty":
    case "error":
      // Keep the last good data; flag it stale (Req 8.10).
      return { data: prev.data, stale: true };
  }
}

/**
 * Live native screen-share stats for the desktop shell.
 *
 * @returns `{ data, stale, isDesktop }`. Off-desktop, always
 *   `{ data: null, stale: false, isDesktop: false }`.
 */
export function useNativeShareStats(): NativeShareStatsState {
  const desktop = isDesktop();
  const [state, setState] = useState<StatsReducerState>(
    initialStatsReducerState,
  );

  useEffect(() => {
    if (!desktop) {
      // Off-desktop: never poll, never subscribe (Req 8.9, 13.3).
      return;
    }

    let cancelled = false;
    const unlistenFns: Array<() => void> = [];

    const apply = (event: StatsPollEvent) => {
      if (cancelled) return;
      setState((prev) => reduceStatsState(prev, event));
    };

    // ── Resolve the Tauri API imports once per effect mount ───────────────────
    // Caching prevents repeated ES module registry lookups on every IPC call.
    let invokeFn: (<T>(cmd: string) => Promise<T>) | null = null;
    const resolveInvoke = async () => {
      if (!invokeFn) {
        const mod = await import("@tauri-apps/api/core");
        invokeFn = mod.invoke as <T>(cmd: string) => Promise<T>;
      }
      return invokeFn;
    };

    let loggedFirstOk = false;
    let loggedError = false;

    // ── Fallback: IPC poll ────────────────────────────────────────────────────
    const poll = async () => {
      try {
        const invoke = await resolveInvoke();
        const result = await invoke<NativeShareStatsSnapshot | null>(
          "get_native_screen_share_stats",
        );
        if (result == null) {
          apply({ type: "empty" });
        } else {
          if (!loggedFirstOk) {
            loggedFirstOk = true;
            log.debug("polling get_native_screen_share_stats →", {
              capture_mode: result.capture_mode,
              capture_unavailable: result.capture_unavailable,
              captured_frames: result.captured_frames,
            });
          }
          apply({ type: "ok", data: result });
        }
      } catch (err) {
        if (!loggedError) {
          loggedError = true;
          log.warn("get_native_screen_share_stats failed:", err);
        }
        apply({ type: "error" });
      }
    };

    // Poll immediately so the UI is not blank during startup, then keep a
    // steady low-rate refresh running for the session.
    void poll();
    const pollIntervalId = setInterval(() => void poll(), NATIVE_SHARE_STATS_POLL_MS);

    // ── Status-triggered refreshes ────────────────────────────────────────────
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        // "native-screen-share-status" — mode/availability change → immediate poll
        // for instantaneous status updates (Req 5.6).
        const disposeStatus = await listen("native-screen-share-status", () => {
          void poll();
        });
        if (cancelled) disposeStatus(); else unlistenFns.push(disposeStatus);
      } catch {
        // Event subscription unavailable — polling still drives refreshes.
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(pollIntervalId);
      unlistenFns.forEach((fn) => fn());
    };
  }, [desktop]);

  if (!desktop) {
    return { data: null, stale: false, isDesktop: false, isHookActive: false };
  }

  return {
    data: state.data,
    stale: state.stale,
    isDesktop: true,
    isHookActive: state.data?.capture_mode === "hook",
  };
}
