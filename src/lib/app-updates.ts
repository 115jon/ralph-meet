// ── App update client ───────────────────────────────────────────────────────
// The one client for the host's updates capability. Rust keeps one pending
// update (app_updates.rs `PendingUpdate`): every `fetch_update` replaces it
// and `install_update` takes it. So this page keeps one state too, shared by
// every surface (the updater window, the update toast, Settings): one check
// in flight at a time, no check while installing, install only what the
// last check found. Each surface maps the state to its own copy.

import { useSyncExternalStore } from "react";
import { getHost } from "@/lib/host";
import type { UpdateDownloadEvent, UpdateMetadata } from "@/lib/host";

/** How long a check may take; Rust gives up at 10 s too. */
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

export type UpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "installed"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  /** What the last check found; Rust holds the matching pending update. */
  pending: UpdateMetadata | null;
  /** Download progress 0–1, or null when not downloading. */
  progress: number | null;
  /** Which step failed, when phase is "error". */
  failed: "check" | "install" | null;
}

const INITIAL: UpdateState = {
  phase: "idle",
  pending: null,
  progress: null,
  failed: null,
};

/** Reject with `message` when `promise` takes longer than `timeoutMs`. */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Whole percent 0–100 for a 0–1 progress (null: 0). */
export function progressPercent(progress: number | null): number {
  return progress === null ? 0 : Math.round(progress * 100);
}

/**
 * Folds `install_update` events into a 0–1 progress. Returns null until the
 * size is known; "finished" is 1.
 */
export function createProgressTracker() {
  let total = 0;
  let downloaded = 0;
  return (event: UpdateDownloadEvent): number | null => {
    switch (event.event) {
      case "started":
        total = event.data.contentLength ?? 0;
        downloaded = 0;
        return total > 0 ? 0 : null;
      case "progress":
        downloaded += event.data.chunkLength;
        return total > 0 ? Math.min(1, downloaded / total) : null;
      case "finished":
        return 1;
    }
  };
}

let state: UpdateState = INITIAL;
let inFlightCheck: Promise<UpdateMetadata | null> | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function isInstalling(phase: UpdatePhase) {
  return phase === "downloading" || phase === "installing";
}

export const appUpdates = {
  getState(): UpdateState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Ask the host for an update. Callers at the same time share one check;
   * while an install runs, answers what is being installed. Rejects when the
   * check fails or times out (the state says "error", failed "check").
   */
  check(): Promise<UpdateMetadata | null> {
    const host = getHost();
    if (host.kind !== "desktop") return Promise.resolve(null);
    if (isInstalling(state.phase)) return Promise.resolve(state.pending);
    if (inFlightCheck) return inFlightCheck;

    setState({ phase: "checking", failed: null });
    const check = withTimeout(
      host.updates.check(),
      UPDATE_CHECK_TIMEOUT_MS,
      "Desktop update check timed out",
    ).then(
      (update) => {
        setState({
          phase: update ? "available" : "up-to-date",
          pending: update,
        });
        return update;
      },
      (error: unknown) => {
        setState({ phase: "error", failed: "check", pending: null });
        throw error;
      },
    );
    inFlightCheck = check.finally(() => {
      inFlightCheck = null;
    });
    return inFlightCheck;
  },

  /**
   * Download and install the pending update. Resolves once the installer
   * runs (on Windows the process exits around then); rejects when there is
   * nothing pending or the install fails.
   */
  async install(): Promise<void> {
    if (state.phase !== "available" || !state.pending) {
      throw new Error("No pending update to install");
    }
    const track = createProgressTracker();
    setState({ phase: "downloading", progress: 0, failed: null });
    try {
      await getHost().updates.install((event) => {
        const progress = track(event);
        if (event.event === "finished") {
          setState({ phase: "installing", progress: 1 });
        } else if (progress !== null) {
          setState({ progress });
        }
      });
      setState({ phase: "installed" });
    } catch (error) {
      // Rust took the pending update when the install started.
      setState({
        phase: "error",
        failed: "install",
        pending: null,
        progress: null,
      });
      throw error;
    }
  },
};

/** The shared update state, re-rendering on change. */
export function useAppUpdateState(): UpdateState {
  return useSyncExternalStore(
    appUpdates.subscribe,
    appUpdates.getState,
    () => INITIAL,
  );
}

/** Test-only: back to idle with nothing pending. */
export function resetAppUpdatesForTests() {
  state = INITIAL;
  inFlightCheck = null;
  listeners.clear();
}
