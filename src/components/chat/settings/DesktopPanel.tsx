import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { clog } from "@/lib/console-logger";
import { restartDesktopApp } from "@/lib/desktop-restart";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { useEffect, useState } from "react";
import { SettingsCard, SettingsRow, ValueText } from "./primitives";
import { RestartAppDialog } from "./RestartAppDialog";

const log = clog("Settings");

function HardwareAccelerationRow() {
  const hardwareAcceleration = useDesktopSettingsStore(
    (s) => s.hardwareAcceleration,
  );
  const updateDesktopSettings = useDesktopSettingsStore(
    (s) => s.updateSettings,
  );
  const [pendingHardwareAcceleration, setPendingHardwareAcceleration] =
    useState<boolean | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<boolean>("get_hardware_acceleration"))
      .then((enabled) => {
        if (
          !cancelled &&
          typeof enabled === "boolean" &&
          enabled !== hardwareAcceleration
        ) {
          updateDesktopSettings({ hardwareAcceleration: enabled });
        }
      })
      .catch((error) =>
        log.warn("Failed to read hardware acceleration setting:", error),
      );
    return () => {
      cancelled = true;
    };
  }, [hardwareAcceleration, updateDesktopSettings]);

  const confirmHardwareAccelerationChange = async () => {
    if (pendingHardwareAcceleration === null) return;
    const previous = hardwareAcceleration;
    setRestarting(true);
    setRestartError(null);
    updateDesktopSettings({
      hardwareAcceleration: pendingHardwareAcceleration,
    });
    let saved = false;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_hardware_acceleration", {
        enabled: pendingHardwareAcceleration,
      });
      saved = true;
      await restartDesktopApp();
    } catch (error) {
      log.error("Failed to change hardware acceleration:", error);
      // Keep the confirm open with the reason.
      if (saved) {
        setRestartError(
          "Saved, but Ralph Meet couldn't restart. Quit and reopen the app to apply it.",
        );
      } else {
        updateDesktopSettings({ hardwareAcceleration: previous });
        setRestartError(
          "Unable to change hardware acceleration. Try again, or restart the app first.",
        );
      }
      setRestarting(false);
    }
  };

  return (
    <SettingsRow id="hardware-acceleration" layout="inline">
      {(ids) => (
        <>
          <SettingsSwitch
            checked={hardwareAcceleration}
            onChange={() =>
              setPendingHardwareAcceleration(!hardwareAcceleration)
            }
            labelledBy={ids.labelId}
            describedBy={ids.descId}
          />
          <RestartAppDialog
            open={pendingHardwareAcceleration !== null}
            onOpenChange={(open) => {
              if (open || restarting) return;
              setPendingHardwareAcceleration(null);
              setRestartError(null);
            }}
            onConfirm={confirmHardwareAccelerationChange}
            restarting={restarting}
            error={restartError}
            title={
              pendingHardwareAcceleration
                ? "Turn on hardware acceleration?"
                : "Turn off hardware acceleration?"
            }
          />
        </>
      )}
    </SettingsRow>
  );
}

function UpdatesRow() {
  const {
    status,
    updateMeta,
    downloadProgress,
    error,
    checkForUpdate,
    applyUpdate,
  } = useAppUpdater();
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/app").then(({ getVersion }) => {
        getVersion().then(setAppVersion).catch(console.error);
      });
    }
  }, []);

  const progress =
    downloadProgress !== null ? Math.round(downloadProgress * 100) : 0;
  const busy =
    status === "checking" ||
    status === "downloading" ||
    status === "installing";
  const statusText =
    status === "checking"
      ? "Checking for updates…"
      : status === "up-to-date"
        ? "You're on the latest version."
        : status === "available"
          ? `Version ${updateMeta?.version} is ready to install.`
          : status === "downloading"
            ? `Downloading the update… ${progress}%`
            : status === "installing"
              ? "Installing. Ralph Meet will restart in a moment."
              : status === "error"
                ? `Couldn't update: ${error || "unknown error"}. Try again.`
                : "Check for a newer version of Ralph Meet.";

  return (
    <SettingsRow
      id="app-version"
      layout="stack"
      description={
        <span
          role="status"
          className={status === "error" ? "text-danger-ink" : undefined}
        >
          {statusText}
        </span>
      }
      footer={
        <>
          {status === "available" && updateMeta?.notes ? (
            <div className="mt-3 rounded-[2px] border border-line-strong p-3">
              <p className="text-ui-xs font-medium text-ink-1">What's new</p>
              <p className="rm-settings-scroll mt-1 max-h-32 overflow-y-auto whitespace-pre-line text-ui-xs text-ink-2">
                {updateMeta.notes}
              </p>
            </div>
          ) : null}
          {status === "downloading" || status === "installing" ? (
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-[1px] bg-tint-3"
              role="progressbar"
              aria-label="Update progress"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full origin-left bg-primary-fill transition-transform duration-(--dur-3) ease-out"
                style={{ transform: `scaleX(${progress / 100})` }}
              />
            </div>
          ) : null}
        </>
      }
    >
      {() => (
        <>
          <ValueText>
            <Num size="sm" className="text-ink-2">
              v{appVersion || "1.0.0"}
            </Num>
          </ValueText>
          {status === "available" ? (
            <Button type="button" onClick={applyUpdate}>
              Install update
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={checkForUpdate}
              loading={status === "checking"}
              disabled={busy && status !== "checking"}
            >
              Check for updates
            </Button>
          )}
        </>
      )}
    </SettingsRow>
  );
}

export default function DesktopPanel() {
  const desktopSettings = useDesktopSettingsStore();

  const toggles: Array<{
    rowId: string;
    key: "openOnStartup" | "startMinimized" | "closeToTray";
  }> = [
    { rowId: "open-on-startup", key: "openOnStartup" },
    { rowId: "start-minimized", key: "startMinimized" },
    { rowId: "close-to-tray", key: "closeToTray" },
  ];

  return (
    <>
      <SettingsCard id="startup">
        {toggles.map(({ rowId, key }) => (
          <SettingsRow key={rowId} id={rowId} layout="inline">
            {(ids) => (
              <SettingsSwitch
                checked={desktopSettings[key]}
                onChange={() =>
                  desktopSettings.updateSettings({
                    [key]: !desktopSettings[key],
                  })
                }
                labelledBy={ids.labelId}
                describedBy={ids.descId}
              />
            )}
          </SettingsRow>
        ))}
      </SettingsCard>
      <SettingsCard id="performance">
        <HardwareAccelerationRow />
      </SettingsCard>
      <SettingsCard id="updates">
        <UpdatesRow />
      </SettingsCard>
    </>
  );
}
