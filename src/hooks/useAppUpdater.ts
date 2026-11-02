/**
 * useAppUpdater
 *
 * The Settings view of the shared update client (src/lib/app-updates.ts).
 * Checks once on mount so Settings shows a fresh status, and lets the user
 * check again or install. The update toast and the updater window use the
 * same client, so they never race each other for Rust's pending update.
 *
 * Usage:
 *   const { status, updateMeta, checkForUpdate, applyUpdate } = useAppUpdater();
 */

import { useCallback, useEffect } from "react";
import { appUpdates, useAppUpdateState } from "@/lib/app-updates";
import type { UpdateMetadata } from "@/lib/host";

type UpdaterStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface AppUpdaterState {
  /** Current updater lifecycle status */
  status: UpdaterStatus;
  /** Metadata for the available update, or null if none / not yet checked */
  updateMeta: UpdateMetadata | null;
  /** Download progress 0–1, or null when not downloading */
  downloadProgress: number | null;
  /** Human-readable error message, or null */
  error: string | null;
  /** Manually trigger an update check */
  checkForUpdate: () => Promise<void>;
  /**
   * Download and install the pending update.
   * On Windows the process exits once the installer launches — the caller
   * should display a "Restarting…" message and not await further IPC.
   */
  applyUpdate: () => Promise<void>;
}

const CHECK_ERROR =
  "Unable to check for updates. Check your connection and try again.";
const INSTALL_ERROR = "Unable to install the update. Try again in a moment.";

export function useAppUpdater(): AppUpdaterState {
  const { phase, pending, progress, failed } = useAppUpdateState();

  const checkForUpdate = useCallback(async () => {
    await appUpdates.check().catch((err: unknown) => {
      console.error("[useAppUpdater] check failed:", err);
    });
  }, []);

  const applyUpdate = useCallback(async () => {
    if (appUpdates.getState().phase !== "available") return;
    await appUpdates.install().catch((err: unknown) => {
      console.error("[useAppUpdater] install failed:", err);
    });
  }, []);

  // Run once on mount so the Settings page immediately reflects current status
  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  // Once installed the process exits on Windows; elsewhere, back to idle.
  const installed = phase === "installed";
  return {
    status: installed ? "idle" : phase,
    updateMeta: pending,
    downloadProgress: installed ? null : progress,
    error:
      phase !== "error"
        ? null
        : failed === "install"
          ? INSTALL_ERROR
          : CHECK_ERROR,
    checkForUpdate,
    applyUpdate,
  };
}
