// ============================================================================
// useNativeShareStats — live native screen-share stats for the desktop shell
//
// Architecture: push-first, poll-fallback.
//
// Primary path (hook active):
//   Rust emits `"native-share-stats"` from `maybe_log_hook_stats!` at the
//   STATS_LOG_INTERVAL cadence (~2s). The JS listener receives it and applies
//   the snapshot directly — zero IPC round-trip, zero tokio worker overhead.
//
// Fallback path (no push within PUSH_STALE_MS = 3s):
//   A single `setInterval` polls `get_native_screen_share_stats` at
//   NATIVE_SHARE_STATS_POLL_MS (1s). This activates on the WGC path (which has
//   no `maybe_log_hook_stats!`) and during session startup before the first push.
//
// Both paths share the `apply()` + `reduceStatsState` reducer so staleness
// semantics (Req 8.10) are identical regardless of which path fires.
//
// Additionally, `"native-screen-share-status"` events (mode/availability
// changes) still trigger an immediate poll for instantaneous status updates.
// ============================================================================
import { isDesktop } from "@/lib/platform";
import { clog } from "@/lib/console-logger";
import type { NativeShareStatsSnapshot } from "@/types/native-share-stats";
import { useEffect, useRef, useState } from "react";

const log = clog("useNativeShareStats");

/** Fallback poll interval for `get_native_screen_share_stats`. <= 2s per Req 8.8. */
export const NATIVE_SHARE_STATS_POLL_MS = 1000;

/**
 * How long to wait for a push event before activating the fallback poller.
 * Set to just over the Rust `STATS_LOG_INTERVAL` so the poller only fires on
 * the WGC path (which never emits push events) or during session startup.
 */
const PUSH_STALE_MS = 3000;

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
    // Fallback poller interval handle — only active when no push events arrive.
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;
    // Timer that arms the fallback poller after PUSH_STALE_MS with no push.
    let pushStaleTimer: ReturnType<typeof setTimeout> | null = null;
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

    // ── Arm the fallback poller after PUSH_STALE_MS ───────────────────────────
    // If the hook path is active, Rust will push events and this timer resets
    // on every push, so the poller never fires. On the WGC path (no push), the
    // timer expires once and the poller activates.
    const armPushStaleTimer = () => {
      if (pushStaleTimer !== null) clearTimeout(pushStaleTimer);
      pushStaleTimer = setTimeout(() => {
        if (cancelled) return;
        if (pollIntervalId === null) {
          // No push events — start the fallback poller.
          log.debug("no push events in", PUSH_STALE_MS, "ms — activating fallback poller");
          void poll();
          pollIntervalId = setInterval(() => void poll(), NATIVE_SHARE_STATS_POLL_MS);
        }
      }, PUSH_STALE_MS);
    };

    // Arm immediately — if no push arrives within 3s, the poller activates.
    // Also do one immediate poll so the UI is not blank during startup.
    void poll();
    armPushStaleTimer();

    // ── Primary path: listen for Rust push events ─────────────────────────────
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        // "native-share-stats" — full snapshot pushed by Rust at the stats cadence.
        // Receiving this means the hook path is active; disable the fallback poller.
        const disposeStats = await listen<NativeShareStatsSnapshot>(
          "native-share-stats",
          (ev) => {
            if (cancelled) return;
            // A push arrived — reset the stale timer and stop the fallback poller.
            if (pollIntervalId !== null) {
              clearInterval(pollIntervalId);
              pollIntervalId = null;
            }
            armPushStaleTimer();
            const data = ev.payload;
            if (data == null) {
              apply({ type: "empty" });
            } else {
              apply({ type: "ok", data });
            }
          },
        );
        if (cancelled) disposeStats(); else unlistenFns.push(disposeStats);

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
      if (pollIntervalId !== null) clearInterval(pollIntervalId);
      if (pushStaleTimer !== null) clearTimeout(pushStaleTimer);
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
