// ============================================================================
// useNativeShareStats — live native screen-share stats for the desktop shell
//
// Inside the Tauri desktop shell this hook polls `get_native_screen_share_stats`
// on an interval <= 2s (Req 8.8) and subscribes to the `native-screen-share-status`
// event (so a mode/availability change is reflected within 2s — Req 5.6). It
// returns `{ data, stale, isDesktop }`.
//
// On a command error or empty result while active it keeps the last good `data`
// and sets `stale = true` (Req 8.10). Outside the desktop shell it short-circuits
// to `{ data: null, stale: false, isDesktop: false }` (Req 8.9, 13.3).
//
// The staleness decision is extracted into the pure `reduceStatsState` reducer
// below so it is testable in isolation (property test, task 10.2 / Property 8).
// ============================================================================
import { isDesktop } from "@/lib/platform";
import { clog } from "@/lib/console-logger";
import type { NativeShareStatsSnapshot } from "@/types/native-share-stats";
import { useEffect, useRef, useState } from "react";

const log = clog("useNativeShareStats");

/** Poll interval for `get_native_screen_share_stats`. <= 2s per Req 8.8. */
export const NATIVE_SHARE_STATS_POLL_MS = 1000;

/** Public state surfaced by {@link useNativeShareStats}. */
export interface NativeShareStatsState {
  /** Most recent good snapshot, or `null` before the first success. */
  data: NativeShareStatsSnapshot | null;
  /** `true` when the displayed `data` is from a failed/empty refresh (Req 8.10). */
  stale: boolean;
  /** `true` only inside the Tauri desktop shell (Req 8.9, 13.3). */
  isDesktop: boolean;
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
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let unlisten: (() => void) | null = null;

    const apply = (event: StatsPollEvent) => {
      if (cancelled) return;
      setState((prev) => reduceStatsState(prev, event));
    };

    let loggedFirstOk = false;
    let loggedError = false;
    const poll = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<NativeShareStatsSnapshot | null>(
          "get_native_screen_share_stats",
        );
        if (result == null) {
          apply({ type: "empty" });
        } else {
          // One-time diagnostic so it's verifiable in the console that the hook
          // is polling and what the backend reports (mode / forwarded frames).
          if (!loggedFirstOk) {
            loggedFirstOk = true;
            log.debug(
              "polling get_native_screen_share_stats →",
              {
                capture_mode: result.capture_mode,
                capture_unavailable: result.capture_unavailable,
                captured_frames: result.captured_frames,
              },
            );
          }
          apply({ type: "ok", data: result });
        }
      } catch (err) {
        // Command errored while active: keep last good data, flag stale.
        // Surface the first error once — otherwise a missing/renamed command
        // (e.g. a stale bundle) is silently swallowed and the panel just shows
        // the connection-state fallback forever.
        if (!loggedError) {
          loggedError = true;
          log.warn(
            "get_native_screen_share_stats failed:",
            err,
          );
        }
        apply({ type: "error" });
      }
    };

    // Poll immediately, then on the <=2s interval (Req 8.8).
    void poll();
    intervalId = setInterval(() => void poll(), NATIVE_SHARE_STATS_POLL_MS);

    // Subscribe to status changes so a mode/availability change refreshes
    // within 2s of the change (Req 5.6).
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const dispose = await listen("native-screen-share-status", () => {
          void poll();
        });
        if (cancelled) {
          dispose();
        } else {
          unlisten = dispose;
        }
      } catch {
        // Event subscription unavailable — polling still drives refreshes.
      }
    })();

    return () => {
      cancelled = true;
      if (intervalId !== null) clearInterval(intervalId);
      if (unlisten) unlisten();
    };
  }, [desktop]);

  if (!desktop) {
    return { data: null, stale: false, isDesktop: false };
  }

  return { data: state.data, stale: state.stale, isDesktop: true };
}
