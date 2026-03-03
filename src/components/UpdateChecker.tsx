import { isTauri } from "@/lib/platform";
import { useCallback, useEffect, useRef, useState } from "react";

interface UpdateInfo {
  version: string;
  body: string | null;
  date: string | null;
}

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

/**
 * Headless component that checks for app updates on startup
 * and every 30 minutes. When an update is found, it shows
 * a toast-style notification with download + restart controls.
 */
export function UpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<any>(null);

  const checkForUpdate = useCallback(async () => {
    if (!isTauri()) return;

    try {
      setStatus("checking");
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (update) {
        updateRef.current = update;
        setUpdateInfo({
          version: update.version,
          body: update.body,
          date: update.date,
        });
        setStatus("available");
        setDismissed(false);
      } else {
        setStatus("idle");
      }
    } catch (e) {
      console.warn("[UpdateChecker] Check failed:", e);
      setStatus("idle"); // Silent fail — don't nag the user
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    try {
      setStatus("downloading");
      setProgress(0);

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event: any) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });

      setStatus("ready");

      // Auto-relaunch after a brief moment
      setTimeout(async () => {
        try {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        } catch {
          // If relaunch fails, user can still manually restart
        }
      }, 2000);
    } catch (e) {
      console.error("[UpdateChecker] Download failed:", e);
      setStatus("error");
    }
  }, []);

  // Check on mount + every 30 minutes
  useEffect(() => {
    if (!isTauri()) return;

    // Delay initial check by 10 seconds to let the app settle
    const initialDelay = setTimeout(checkForUpdate, 10_000);
    const interval = setInterval(checkForUpdate, 30 * 60 * 1000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  // Don't render if no update or dismissed
  if (status === "idle" || status === "checking" || dismissed) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9998] w-full max-w-[360px] rounded-xl bg-rm-bg-elevated p-4 shadow-2xl ring-1 ring-rm-border animate-[update-slide-in_0.3s_ease-out]">
      {status === "available" && (
        <>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-rm-text">
              Update available — v{updateInfo?.version}
            </p>
            {updateInfo?.body && (
              <p className="text-xs text-rm-text-muted leading-relaxed line-clamp-3">
                {updateInfo.body}
              </p>
            )}
          </div>
          <div className="flex gap-2 mt-2.5">
            <button
              className="rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
              onClick={downloadAndInstall}
            >
              Update now
            </button>
            <button
              className="rounded-lg bg-rm-bg-hover px-3.5 py-1.5 text-[13px] font-semibold text-rm-text-secondary transition-colors hover:bg-rm-bg-active"
              onClick={() => setDismissed(true)}
            >
              Later
            </button>
          </div>
        </>
      )}

      {status === "downloading" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-rm-text">
            Downloading update...
          </p>
          <div className="h-1 rounded-full bg-rm-bg-active overflow-hidden mt-1">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-rm-text-muted">{progress}%</p>
        </div>
      )}

      {status === "ready" && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-rm-text">Update installed!</p>
          <p className="text-xs text-rm-text-muted">Restarting...</p>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-rm-text">Update failed</p>
          <div className="flex gap-2 mt-1">
            <button
              className="rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
              onClick={checkForUpdate}
            >
              Retry
            </button>
            <button
              className="rounded-lg bg-rm-bg-hover px-3.5 py-1.5 text-[13px] font-semibold text-rm-text-secondary transition-colors hover:bg-rm-bg-active"
              onClick={() => setDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
