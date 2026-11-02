import { isDesktop } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import {
  appUpdates,
  progressPercent,
  useAppUpdateState,
  type UpdateState,
} from "@/lib/app-updates";
import { getHost } from "@/lib/host";
import { clog } from "@/lib/console-logger";
import { useCallback, useEffect, useState } from "react";

const log = clog("UpdateChecker");

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

/** The toast's view of the shared update state. Check failures stay silent. */
function toastStatus({ phase, pending, failed }: UpdateState): UpdateStatus {
  switch (phase) {
    case "available":
      return "available";
    // A re-check (Settings opened) keeps showing what was found.
    case "checking":
      return pending ? "available" : "checking";
    case "downloading":
    case "installing":
      return "downloading";
    case "installed":
      return "ready";
    case "error":
      return failed === "install" ? "error" : "idle";
    default:
      return "idle";
  }
}

/**
 * Headless component that checks for app updates in the background, 10 s
 * after launch and every 30 minutes. The launch itself never waits on it:
 * StandaloneUpdater only installs an update it hears about within a short
 * budget. When an update is found, it shows a toast-style notification with
 * download + restart controls.
 */
export function UpdateChecker() {
  const updateState = useAppUpdateState();
  const status = toastStatus(updateState);
  const updateInfo = updateState.pending;
  const progress = progressPercent(updateState.progress);
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    if (!isDesktop()) return;

    try {
      const update = await appUpdates.check();
      if (update) setDismissed(false);
    } catch (e) {
      log.warn("Check failed:", e); // Silent fail — don't nag the user
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    try {
      await appUpdates.install();
    } catch (e) {
      log.error("Download failed:", e);
      return;
    }

    // Auto-relaunch after a brief moment
    setTimeout(async () => {
      try {
        await getHost().window.restart();
      } catch {
        // If relaunch fails, user can still manually restart
      }
    }, 2000);
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
            {updateInfo?.notes && (
              <p className="text-ui-xs text-ink-3 leading-relaxed line-clamp-3">
                {updateInfo.notes}
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
