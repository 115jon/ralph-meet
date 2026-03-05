import { getOSName, useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { Monitor, Power, X } from "lucide-react";
import { SettingsSwitch } from "./SettingsSwitch";

export default function SettingsOSTab() {
  const osName = getOSName();
  const desktopSettings = useDesktopSettingsStore();

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="text-2xl font-bold text-rm-text mb-2">
        {osName} Settings
      </h1>
      <p className="text-sm text-rm-text-muted mb-8">
        Configure how Ralph Meet behaves on your system.
      </p>

      <div className="space-y-3">
        {/* Open on Startup */}
        <div className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg border flex items-center justify-center bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
              <Power size={18} />
            </div>
            <div>
              <h4 className="text-[14px] font-bold text-rm-text">Open Ralph Meet on Startup</h4>
              <p className="text-[12px] text-rm-text-muted">
                Save yourself a few clicks and let Ralph Meet greet you when your computer starts.
              </p>
            </div>
          </div>
          <SettingsSwitch
            checked={desktopSettings.openOnStartup}
            onChange={() => desktopSettings.updateSettings({ openOnStartup: !desktopSettings.openOnStartup })}
          />
        </div>

        {/* Start Minimized */}
        <div className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg border flex items-center justify-center bg-violet-500/10 border-violet-500/20 text-violet-400">
              <Monitor size={18} />
            </div>
            <div>
              <h4 className="text-[14px] font-bold text-rm-text">Start Minimized</h4>
              <p className="text-[12px] text-rm-text-muted">
                When launched on startup, Ralph Meet runs in the background so it stays out of your way.
              </p>
            </div>
          </div>
          <SettingsSwitch
            checked={desktopSettings.startMinimized}
            onChange={() => desktopSettings.updateSettings({ startMinimized: !desktopSettings.startMinimized })}
          />
        </div>

        {/* Close Button Minimizes to Tray */}
        <div className="group flex items-center justify-between p-4 rounded-xl bg-rm-bg-elevated/50 border border-rm-border hover:bg-rm-bg-hover transition-all">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg border flex items-center justify-center bg-sky-500/10 border-sky-500/20 text-sky-400">
              <X size={18} />
            </div>
            <div>
              <h4 className="text-[14px] font-bold text-rm-text">Close Button Minimizes to Tray</h4>
              <p className="text-[12px] text-rm-text-muted">
                Hitting ✕ will make Ralph Meet sit back and relax in your system tray when you close the app.
              </p>
            </div>
          </div>
          <SettingsSwitch
            checked={desktopSettings.closeToTray}
            onChange={() => desktopSettings.updateSettings({ closeToTray: !desktopSettings.closeToTray })}
          />
        </div>
      </div>
    </div>
  );
}
