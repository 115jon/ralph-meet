/**
 * useAppUpdater
 *
 * Manages in-app update checks via the Tauri updater plugin.
 *
 * Auto-checks once on mount (for the Settings UI to display a fresh status).
 * The silent *background* check that runs at startup and auto-installs is
 * handled entirely on the Rust side (app_updates::check_and_install), so this
 * hook is purely for the Settings UI that wants to show status / let the user
 * manually trigger a check.
 *
 * Usage:
 *   const { status, updateMeta, checkForUpdate, applyUpdate } = useAppUpdater();
 */

import { invoke, Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Types mirroring app_updates.rs ───────────────────────────────────────

interface UpdateMetadata {
  version: string;
  currentVersion: string;
  notes: string | null;
}

type DownloadEventPayload =
  | { event: "Started"; data: { contentLength: number | null } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished"; data: Record<string, never> };

// ── Hook status ───────────────────────────────────────────────────────────

export type UpdaterStatus =
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

// ── Hook implementation ───────────────────────────────────────────────────

export function useAppUpdater(): AppUpdaterState {
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [updateMeta, setUpdateMeta] = useState<UpdateMetadata | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prevent concurrent checks
  const checkingRef = useRef(false);

  const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const checkForUpdate = useCallback(async () => {
    if (!isDesktop || checkingRef.current) return;

    checkingRef.current = true;
    setStatus("checking");
    setError(null);

    try {
      const meta = await invoke<UpdateMetadata | null>("fetch_update");
      if (meta) {
        setUpdateMeta(meta);
        setStatus("available");
      } else {
        setUpdateMeta(null);
        setStatus("up-to-date");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      console.error("[useAppUpdater] check failed:", err);
    } finally {
      checkingRef.current = false;
    }
  }, [isDesktop]);

  const applyUpdate = useCallback(async () => {
    if (!isDesktop || status !== "available") return;

    setStatus("downloading");
    setDownloadProgress(0);
    setError(null);

    try {
      const channel = new Channel<DownloadEventPayload>();
      let totalBytes: number | null = null;
      let downloadedBytes = 0;

      channel.onmessage = (payload) => {
        if (payload.event === "Started") {
          totalBytes = payload.data.contentLength;
        } else if (payload.event === "Progress") {
          downloadedBytes += payload.data.chunkLength;
          if (totalBytes && totalBytes > 0) {
            setDownloadProgress(downloadedBytes / totalBytes);
          }
        } else if (payload.event === "Finished") {
          setDownloadProgress(1);
          setStatus("installing");
        }
      };

      await invoke("install_update", { onEvent: channel });

      // On Windows the process exits here — this line is never reached.
      // On other platforms, reset state after install.
      setStatus("idle");
      setDownloadProgress(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      setDownloadProgress(null);
      console.error("[useAppUpdater] install failed:", err);
    }
  }, [isDesktop, status]);

  // Run once on mount so the Settings page immediately reflects current status
  useEffect(() => {
    void checkForUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    updateMeta,
    downloadProgress,
    error,
    checkForUpdate,
    applyUpdate,
  };
}
