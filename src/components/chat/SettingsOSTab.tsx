import { SettingsToggleRow } from "@/components/ui/SettingsToggleRow";
import { getOSName, useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { Monitor, Power, X } from "lucide-react";

export default function SettingsOSTab() {
  const osName = getOSName();
  const desktopSettings = useDesktopSettingsStore();

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
    </div>
  );
}
