import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Button } from "@/components/ui/button";
import { fetchDesktopUpdate, installDesktopUpdate } from "@/lib/desktop-update";
import { restartDesktopApp } from "@/lib/desktop-restart";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type StandaloneUpdaterStatus =
  | "checking"
  | "downloading"
  | "installing"
  | "starting"
  | "error";

const STARTING_HANDOFF_DELAY_MS = 700;
const HANDOFF_RETRY_COUNT = 3;
const HANDOFF_RETRY_DELAY_MS = 250;
const HANDOFF_TIMEOUT_MS = 5_000;

export function getStandaloneUpdaterStatusText(
  status: StandaloneUpdaterStatus,
  progress: number,
) {
  switch (status) {
    case "checking":
      return "Checking for updates...";
    case "downloading":
      return `Downloading update... ${progress}%`;
    case "installing":
      return "Installing update...";
    case "starting":
      return "Starting Ralph Meet...";
    case "error":
      return "Update check failed (Debug mode active)";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(message)),
      HANDOFF_TIMEOUT_MS,
    );
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

export function StandaloneUpdater() {
  const [status, setStatus] = useState<StandaloneUpdaterStatus>("checking");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    console.info("[StandaloneUpdater] useEffect mounted");
    let mounted = true;

    async function runUpdateCheck() {
      console.info("[StandaloneUpdater] runUpdateCheck called");
      try {
        const update = await fetchDesktopUpdate();
        if (update && mounted) {
          setStatus("downloading");
          let downloaded = 0;
          let contentLength = 0;

          await installDesktopUpdate((event) => {
            switch (event.event) {
              case "started":
                contentLength = event.data.contentLength ?? 0;
                break;
              case "progress":
                downloaded += event.data.chunkLength;
                if (contentLength > 0 && mounted) {
                  setProgress(
                    Math.min(
                      100,
                      Math.round((downloaded / contentLength) * 100),
                    ),
                  );
                }
                break;
              case "finished":
                if (mounted) setStatus("installing");
                break;
            }
          });

          // Fallback auto-relaunch if the installer doesn't do it
          setTimeout(async () => {
            try {
              await restartDesktopApp();
            } catch (e) {
              console.error("Relaunch failed", e);
            }
          }, 3000);
        } else {
          // No update, switch to main window
          if (mounted) showStartingThenSwitch();
        }
      } catch (e: unknown) {
        console.error("Update check failed:", e);
        // On error, fallback to main window
        if (mounted) showStartingThenSwitch();
      }
    }

    async function showStartingThenSwitch() {
      setStatus("starting");
      await sleep(STARTING_HANDOFF_DELAY_MS);
      if (mounted) await switchToMain();
    }

    async function switchToMain() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      let handedOff = false;

      try {
        // Resolve and show the main window in Rust. Window.getByLabel() first
        // enumerates every window through CEF, which can deadlock while the
        // hidden main window is still completing startup.
        await withTimeout(
          useDesktopSettingsStore.getState().syncToBackend(),
          "desktop settings sync timed out",
        ).catch((error: unknown) => {
          console.error("Failed to sync desktop settings:", error);
        });
        let lastError: unknown = null;
        for (let attempt = 0; attempt < HANDOFF_RETRY_COUNT; attempt++) {
          try {
            await withTimeout(
              invoke("show_main_window"),
              "main window handoff timed out",
            );
            handedOff = true;
            break;
          } catch (error: unknown) {
            lastError = error;
            if (attempt + 1 < HANDOFF_RETRY_COUNT) {
              await sleep(HANDOFF_RETRY_DELAY_MS);
            }
          }
        }
        if (!handedOff) {
          throw lastError ?? new Error("main window handoff failed");
        }
      } catch (e) {
        console.error("Failed to show main window:", e);
        if (mounted) setStatus("error");
      } finally {
        if (handedOff) {
          let updaterClosed = false;
          for (let attempt = 0; attempt < HANDOFF_RETRY_COUNT; attempt++) {
            try {
              await withTimeout(
                getCurrentWindow().close(),
                "updater window close timed out",
              );
              updaterClosed = true;
              break;
            } catch (closeErr) {
              if (attempt + 1 === HANDOFF_RETRY_COUNT) {
                console.error("Failed to close updater window:", closeErr);
              } else {
                await sleep(HANDOFF_RETRY_DELAY_MS);
              }
            }
          }
          if (!updaterClosed) {
            try {
              await withTimeout(
                invoke("close_updater_window"),
                "native updater close timed out",
              );
            } catch (closeErr: unknown) {
              console.error("Native updater close failed:", closeErr);
            }
            if (mounted) setStatus("error");
          }
        }
      }
    }

    // Delay so the window has time to paint and acts as a nice splash screen
    const timer = setTimeout(runUpdateCheck, 2500);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  const indeterminate = status === "checking" || status === "installing";

  return (
    <LoadingScreen
      className="h-dvh w-full"
      style={{ WebkitAppRegion: "drag" } as any}
      progress={indeterminate ? undefined : progress}
    >
      <p className="text-ui-sm font-medium text-rm-text-secondary">
        {getStandaloneUpdaterStatusText(status, progress)}
      </p>
      {status === "error" && (
        <Button
          className="mt-4"
          style={{ WebkitAppRegion: "no-drag" } as any}
          onClick={() => window.location.reload()}
        >
          Retry startup
        </Button>
      )}
    </LoadingScreen>
  );
}
