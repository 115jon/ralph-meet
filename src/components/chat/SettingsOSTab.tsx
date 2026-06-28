import { useState, useEffect } from "react";
import { SettingsToggleRow } from "@/components/ui/SettingsToggleRow";
import { getOSName, useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { Monitor, Power, X, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAppUpdater } from "@/hooks/useAppUpdater";

export default function SettingsOSTab() {
  const osName = getOSName();
  const desktopSettings = useDesktopSettingsStore();
  const { status, updateMeta, downloadProgress, error, checkForUpdate, applyUpdate } = useAppUpdater();
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/app").then(({ getVersion }) => {
        getVersion().then(setAppVersion).catch(console.error);
      });
    }
  }, []);

  const toggles = [
    {
      label: "Open Ralph Meet on Startup",
      description: "Save yourself a few clicks and let Ralph Meet greet you when your computer starts.",
      icon: <Power size={18} />,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10 border-emerald-500/20",
      checked: desktopSettings.openOnStartup,
      onChange: () => desktopSettings.updateSettings({ openOnStartup: !desktopSettings.openOnStartup }),
    },
    {
      label: "Start Minimized",
      description: "When launched on startup, Ralph Meet runs in the background so it stays out of your way.",
      icon: <Monitor size={18} />,
      color: "text-violet-400",
      bgColor: "bg-violet-500/10 border-violet-500/20",
      checked: desktopSettings.startMinimized,
      onChange: () => desktopSettings.updateSettings({ startMinimized: !desktopSettings.startMinimized }),
    },
    {
      label: "Close Button Minimizes to Tray",
      description: "Hitting ✕ will make Ralph Meet sit back and relax in your system tray when you close the app.",
      icon: <X size={18} />,
      color: "text-sky-400",
      bgColor: "bg-sky-500/10 border-sky-500/20",
      checked: desktopSettings.closeToTray,
      onChange: () => desktopSettings.updateSettings({ closeToTray: !desktopSettings.closeToTray }),
    },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="text-2xl font-bold text-rm-text mb-2">
        {osName} Settings
      </h1>
      <p className="text-sm text-rm-text-muted mb-8">
        Configure how Ralph Meet behaves on your system.
      </p>

      <div className="space-y-3">
        {toggles.map((t) => (
          <div key={t.label} className="rounded-xl bg-rm-bg-elevated/50 border border-rm-border">
            <SettingsToggleRow
              icon={<div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${t.bgColor} ${t.color}`}>{t.icon}</div>}
              rawIcon
              label={t.label}
              description={t.description}
              checked={t.checked}
              onChange={t.onChange}
            />
          </div>
        ))}
      </div>

      <div className="mt-8 border-t border-rm-border/40 pt-6">
        <h2 className="text-lg font-bold text-rm-text mb-2">
          App Updates
        </h2>
        <p className="text-xs text-rm-text-muted mb-4">
          Check for and install updates for the Ralph Meet desktop client.
        </p>

        <div className="rounded-xl bg-rm-bg-elevated/30 border border-rm-border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg border border-rm-accent/20 bg-rm-accent-dim flex items-center justify-center text-rm-accent shrink-0">
              {status === "error" ? (
                <AlertTriangle size={18} className="text-rose-400" />
              ) : status === "up-to-date" ? (
                <CheckCircle2 size={18} className="text-emerald-400" />
              ) : (
                <RefreshCw size={18} className={status === "checking" || status === "downloading" || status === "installing" ? "animate-spin" : ""} />
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-rm-text">
                Current Version: <span className="text-rm-accent font-mono">v{appVersion || "1.0.0"}</span>
              </span>
              <span className="text-xs text-rm-text-muted mt-0.5">
                {status === "idle" && "Click check to see if a new version is available."}
                {status === "checking" && "Checking the release server for updates..."}
                {status === "up-to-date" && "You are running the latest version of Ralph Meet."}
                {status === "available" && `Update available: v${updateMeta?.version}`}
                {status === "downloading" && `Downloading update... ${downloadProgress !== null ? Math.round(downloadProgress * 100) : 0}%`}
                {status === "installing" && "Installing update... Relaunching soon."}
                {status === "error" && `Error: ${error || "Failed to update"}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
            {status === "available" ? (
              <button
                onClick={applyUpdate}
                className="rounded-lg bg-rm-accent px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-rm-accent-hover active:scale-[0.97]"
              >
                Install Update
              </button>
            ) : (
              <button
                onClick={checkForUpdate}
                disabled={status === "checking" || status === "downloading" || status === "installing"}
                className="rounded-lg bg-rm-bg-hover px-4 py-2 text-[13px] font-semibold text-rm-text-secondary transition-colors hover:bg-rm-bg-active disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "checking" ? "Checking..." : "Check for Updates"}
              </button>
            )}
          </div>
        </div>

        {/* Display release notes if available */}
        {status === "available" && updateMeta?.notes && (
          <div className="mt-3 rounded-lg bg-rm-bg-elevated/20 border border-rm-border/60 p-3.5 animate-in fade-in duration-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-rm-text-muted mb-1.5">Release Notes</h4>
            <p className="text-xs text-rm-text-secondary leading-relaxed whitespace-pre-line max-h-32 overflow-y-auto custom-scrollbar">
              {updateMeta.notes}
            </p>
          </div>
        )}

        {/* Progress bar during download */}
        {(status === "downloading" || status === "installing") && (
          <div className="mt-3.5 flex flex-col gap-1.5">
            <div className="h-1 w-full rounded-full bg-rm-bg-hover overflow-hidden">
              <div
                className="h-full rounded-full bg-rm-accent transition-[width] duration-300"
                style={{ width: `${downloadProgress !== null ? Math.round(downloadProgress * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
