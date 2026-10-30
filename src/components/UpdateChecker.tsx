import { isDesktop } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { fetchDesktopUpdate, installDesktopUpdate } from "@/lib/desktop-update";
import { restartDesktopApp } from "@/lib/desktop-restart";
import { clog } from "@/lib/console-logger";
import { useCallback, useEffect, useRef, useState } from "react";

const log = clog("UpdateChecker");

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
 * Headless component that checks for app updates in the background, 10 s
 * after launch and every 30 minutes. The launch itself never waits on it:
 * StandaloneUpdater only installs an update it hears about within a short
 * budget. When an update is found, it shows a toast-style notification with
 * download + restart controls.
 */
export function UpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const updateAvailableRef = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (!isDesktop()) return;

    try {
      setStatus("checking");
      const update = await fetchDesktopUpdate();

      if (update) {
        updateAvailableRef.current = true;
        setUpdateInfo({
          version: update.version,
          body: update.notes,
          date: null,
        });
        setStatus("available");
        setDismissed(false);
      } else {
        updateAvailableRef.current = false;
        setStatus("idle");
      }
    } catch (e) {
      updateAvailableRef.current = false;
      log.warn("Check failed:", e);
      setStatus("idle"); // Silent fail — don't nag the user
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!updateAvailableRef.current) return;

    try {
      setStatus("downloading");
      setProgress(0);

      let downloaded = 0;
      let contentLength = 0;

      await installDesktopUpdate((event) => {
        switch (event.event) {
          case "started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(
                Math.min(100, Math.round((downloaded / contentLength) * 100)),
              );
            }
            break;
          case "finished":
            setProgress(100);
            break;
        }
      });

      setStatus("ready");

      // Auto-relaunch after a brief moment
      setTimeout(async () => {
        try {
          await restartDesktopApp();
        } catch {
          // If relaunch fails, user can still manually restart
        }
      }, 2000);
    } catch (e) {
      log.error("Download failed:", e);
      setStatus("error");
    }
  }, []);

  // Check on mount + every 30 minutes
  useEffect(() => {
    if (!isDesktop()) return;

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
    <div className="fixed right-6 bottom-6 z-100 w-full max-w-[360px] rounded-lg border border-line bg-ply-3 p-4 shadow-float animate-in fade-in slide-in-from-bottom-2 duration-200">
      {status === "available" && (
        <>
          <div className="flex flex-col gap-1.5">
            <p className="text-ui-sm font-semibold text-ink-1">
              Update available — v{updateInfo?.version}
            </p>
            {updateInfo?.body && (
              <p className="text-ui-xs text-ink-3 leading-relaxed line-clamp-3">
                {updateInfo.body}
              </p>
            )}
          </div>
          <div className="flex gap-2 mt-2.5">
            <Button onClick={downloadAndInstall}>Update now</Button>
            <Button variant="secondary" onClick={() => setDismissed(true)}>
              Later
            </Button>
          </div>
        </>
      )}

      {status === "downloading" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-ui-sm font-semibold text-ink-1">
            Downloading update…
          </p>
          <div
            role="progressbar"
            aria-label="Update download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="mt-1 h-1 overflow-hidden rounded-full bg-tint-2"
          >
            <div
              className="h-full origin-left rounded-full bg-accent-ink transition-transform duration-200"
              style={{ transform: `scaleX(${progress / 100})` }}
            />
          </div>
          <p className="text-num-xs text-ink-3">{progress}%</p>
        </div>
      )}

      {status === "ready" && (
        <div className="flex flex-col gap-1">
          <p className="text-ui-sm font-semibold text-ink-1">
            Update installed
          </p>
          <p className="text-ui-xs text-ink-3">Restarting…</p>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-ui-sm font-semibold text-danger-ink">
            Unable to update
          </p>
          <p className="text-ui-xs text-ink-2">
            Check your connection and try again.
          </p>
          <div className="mt-1 flex gap-2">
            <Button onClick={checkForUpdate}>Try again</Button>
            <Button variant="secondary" onClick={() => setDismissed(true)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
