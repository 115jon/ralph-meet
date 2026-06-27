import { BaseModal } from "@/components/ui/BaseModal";
import { SettingsToggleRow } from "@/components/ui/SettingsToggleRow";
import { isDesktop } from "@/lib/platform";
import { APP_THEMES, type AppTheme } from "@/lib/theme-preferences";
import { cn } from "@/lib/utils";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { Cpu, Eye, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clog } from "@/lib/console-logger";
import { HomeDarkSvg, HomeLightSvg } from "./home-svgs";
import { useAppearanceTheme } from "./useAppearanceTheme";

const log = clog("Settings");

type ThemeChoice = {
  id: AppTheme;
  label: string;
  previewClass: string;
  badge?: string;
};

const CLASSIC_THEMES: ThemeChoice[] = [
  { id: "light", label: "Light", previewClass: "bg-[#f2f3f5]" },
  { id: "dark", label: "Midnight", previewClass: "bg-[#0f0f11]" },
  { id: "system", label: "System", previewClass: "bg-gradient-to-br from-[#0f0f11] to-[#f2f3f5]" },
];

const COLLAB_THEMES: Array<{
  title: string;
  eyebrow: string;
  description: string;
  borderClass: string;
  backgroundClass: string;
  glowPrimary: string;
  glowSecondary: string;
  themes: ThemeChoice[];
}> = [
  {
    title: "Hatsune Miku",
    eyebrow: "Special Collab",
    description: "High-contrast pastel and dark themes featuring Miku artwork.",
    borderClass: "border-[#f872a5]/30",
    backgroundClass: "bg-gradient-to-br from-[#f872a5]/5 via-[#39c5bb]/5 to-transparent",
    glowPrimary: "bg-[#39c5bb]/10",
    glowSecondary: "bg-[#f872a5]/10",
    themes: [
      { id: "miku-light", label: "Light", previewClass: "bg-gradient-to-br from-[#ffffff] via-[#e8f4fd] to-[#f872a5]", badge: "01" },
      { id: "miku-dark", label: "Dark", previewClass: "bg-gradient-to-br from-[#13111f] via-[#0f0d19] to-[#f872a5]", badge: "01" },
    ],
  },
  {
    title: "Spider-Man",
    eyebrow: "Special Edition",
    description: "Sleek red and dark navy themes featuring custom web vector grids.",
    borderClass: "border-[#E50914]/30",
    backgroundClass: "bg-gradient-to-br from-[#E50914]/5 via-[#1a73e8]/5 to-transparent",
    glowPrimary: "bg-[#E50914]/15",
    glowSecondary: "bg-[#1a73e8]/10",
    themes: [
      { id: "spiderman-light", label: "Light", previewClass: "bg-gradient-to-br from-[#ffffff] via-[#eef0f6] to-[#E50914]", badge: "WEB" },
      { id: "spiderman-dark", label: "Dark", previewClass: "bg-gradient-to-br from-[#06050a] via-[#0b0a10] to-[#E50914]", badge: "WEB" },
    ],
  },
];

function ThemeSwatch({
  choice,
  active,
  onClick,
}: {
  choice: ThemeChoice;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Switch to ${choice.label} theme`}
      className={cn(
        "relative h-20 w-[60px] shrink-0 overflow-hidden rounded-2xl transition-all",
        active
          ? "ring-2 ring-primary ring-offset-2 ring-offset-[var(--rm-bg-primary)]"
          : "border-2 border-rm-border/30 hover:border-rm-border/60",
      )}
    >
      <div className={cn("absolute inset-0", choice.previewClass)} />
      {choice.id === "system" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-white/55 backdrop-blur-[2px]">
          <RefreshCw size={24} strokeWidth={2.5} />
        </div>
      )}
      {(choice.id === "miku-light" || choice.id === "miku-dark") && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div
            className={cn(
              "relative flex h-8 w-8 items-center justify-center [&>svg]:h-full [&>svg]:w-full",
              choice.id === "miku-light" ? "text-[#1b2240]" : "text-white",
            )}
          >
            {choice.id === "miku-light" ? <HomeLightSvg /> : <HomeDarkSvg />}
            <img
              src="/themes/miku/miku-wig.svg"
              alt=""
              className="absolute left-1/2 top-[-10px] h-14 w-14 max-w-none -translate-x-1/2 select-none drop-shadow-md"
            />
          </div>
          <div className="absolute bottom-1 right-1 rounded-full bg-black/40 px-1.5 py-0.5 text-[9px] font-black text-white backdrop-blur-xs">
            {choice.badge}
          </div>
        </div>
      )}
      {(choice.id === "spiderman-light" || choice.id === "spiderman-dark") && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <img
            src="/themes/spiderman/spiderman-mask.svg"
            alt=""
            className="h-8 w-8 select-none drop-shadow-md"
          />
          <div className="absolute bottom-1 right-1 rounded-full bg-red-600 px-1 py-0.5 text-[8px] font-black text-white">
            {choice.badge}
          </div>
        </div>
      )}
    </button>
  );
}

interface SettingsAppearanceTabProps {
  onOpenPreview?: () => void;
}

export default function SettingsAppearanceTab({ onOpenPreview }: SettingsAppearanceTabProps) {
  const { theme, preferences, setAppearanceTheme, setThemeSyncEnabled } = useAppearanceTheme();
  const isDesktopApp = isDesktop();
  const hardwareAcceleration = useDesktopSettingsStore((s) => s.hardwareAcceleration);
  const updateDesktopSettings = useDesktopSettingsStore((s) => s.updateSettings);
  const [pendingHardwareAcceleration, setPendingHardwareAcceleration] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isDesktopApp) return;
    let cancelled = false;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<boolean>("get_hardware_acceleration"))
      .then((enabled) => {
        if (!cancelled && typeof enabled === "boolean" && enabled !== hardwareAcceleration) {
          updateDesktopSettings({ hardwareAcceleration: enabled });
        }
      })
      .catch((error) => log.warn("Failed to read hardware acceleration setting:", error));
    return () => {
      cancelled = true;
    };
  }, [hardwareAcceleration, isDesktopApp, updateDesktopSettings]);

  const confirmHardwareAccelerationChange = async () => {
    if (pendingHardwareAcceleration === null) return;
    updateDesktopSettings({ hardwareAcceleration: pendingHardwareAcceleration });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_hardware_acceleration", { enabled: pendingHardwareAcceleration });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      log.error("Failed to change hardware acceleration:", error);
      setPendingHardwareAcceleration(null);
    }
  };

  const visibleTheme = useMemo<AppTheme>(() => {
    if (theme && APP_THEMES.includes(theme as AppTheme)) {
      return theme as AppTheme;
    }
    return preferences.themePreference ?? "dark";
  }, [preferences.themePreference, theme]);

  return (
    <div className="animate-in slide-in-from-right-4 fade-in duration-300">
      <h1 className="hidden w-full text-2xl font-bold text-rm-text md:block">Appearance</h1>
      <p className="mb-6 hidden w-full text-sm text-rm-text-muted md:block">
        Customize how Ralph Meet looks across this device and, if you want, across your other devices too.
      </p>

      <div className="mx-auto w-full max-w-[720px] space-y-8">
        <section className="space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-2xl border border-rm-border bg-rm-bg-surface p-4 md:p-5">
            <div>
              <h2 className="text-lg font-bold text-rm-text">Theme</h2>
              <p className="mt-1 text-sm text-rm-text-muted">
                Pick a theme, then preview it against your current chat layout before you commit to browsing with it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenPreview?.();
              }}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-rm-border bg-rm-bg-elevated px-3.5 py-2 text-sm font-bold text-rm-text transition-colors hover:bg-rm-bg-hover"
            >
              <Eye size={16} />
              Preview Theme
            </button>
          </div>

          <div>
            <h3 className="mb-3 px-1 text-[11px] font-bold uppercase tracking-widest text-rm-text-muted">
              Default Themes
            </h3>
            <div className="flex flex-wrap gap-4 px-1">
              {CLASSIC_THEMES.map((choice) => (
                <div key={choice.id} className="flex flex-col items-center">
                  <ThemeSwatch
                    choice={choice}
                    active={visibleTheme === choice.id}
                    onClick={() => void setAppearanceTheme(choice.id)}
                  />
                  <span className="mt-1.5 text-[11px] font-semibold text-rm-text-muted">{choice.label}</span>
                </div>
              ))}
            </div>
          </div>

          {COLLAB_THEMES.map((group) => (
            <div
              key={group.title}
              className={cn(
                "relative overflow-hidden rounded-2xl border p-4 shadow-md",
                group.borderClass,
                group.backgroundClass,
              )}
            >
              <div className={cn("pointer-events-none absolute right-0 top-0 -mr-16 -mt-16 h-32 w-32 rounded-full blur-2xl", group.glowPrimary)} />
              <div className={cn("pointer-events-none absolute bottom-0 right-12 -mb-16 -mr-12 h-32 w-32 rounded-full blur-2xl", group.glowSecondary)} />
              <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <span className="mb-1.5 inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rm-text-muted">
                    {group.eyebrow}
                  </span>
                  <h3 className="text-[14px] font-extrabold tracking-wide text-rm-text">{group.title}</h3>
                  <p className="mt-0.5 max-w-[260px] text-[11px] leading-relaxed text-rm-text-muted">
                    {group.description}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {group.themes.map((choice) => (
                    <div key={choice.id} className="flex flex-col items-center">
                      <ThemeSwatch
                        choice={choice}
                        active={visibleTheme === choice.id}
                        onClick={() => void setAppearanceTheme(choice.id)}
                      />
                      <span className="mt-1.5 text-[11px] font-semibold text-rm-text-muted">{choice.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface">
          <SettingsToggleRow
            icon={<RefreshCw size={20} />}
            label="Sync theme across my devices"
            description="Store your chosen theme on your account and apply it when you sign in on another device."
            checked={preferences.themeSyncEnabled}
            onChange={() => void setThemeSyncEnabled(!preferences.themeSyncEnabled)}
          />
        </section>

        {isDesktopApp && (
          <section className="border-t border-rm-border pt-6">
            <h2 className="px-1 text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">Advanced</h2>
            <div className="mt-3 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface">
              <SettingsToggleRow
                icon={<Cpu size={20} />}
                label="Enable hardware acceleration"
                description="Uses your GPU to make Ralph Meet run more smoothly. Turn this off if you're experiencing visual glitches or poor performance."
                checked={hardwareAcceleration}
                onChange={() => setPendingHardwareAcceleration(!hardwareAcceleration)}
              />
            </div>
          </section>
        )}
      </div>

      {pendingHardwareAcceleration !== null && (
        <BaseModal onClose={() => setPendingHardwareAcceleration(null)}>
          <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 px-4">
            <div
              className="w-full max-w-[420px] rounded-xl border border-rm-border bg-rm-bg-primary p-5 shadow-2xl"
              role="dialog"
              aria-labelledby="hardware-acceleration-title"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="hardware-acceleration-title" className="text-lg font-bold text-rm-text">
                Change Hardware Acceleration
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-rm-text-muted">
                Changing this setting will relaunch Ralph Meet.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingHardwareAcceleration(null)}
                  className="rounded-lg px-4 py-2 text-sm font-bold text-rm-text-muted transition-colors hover:bg-rm-bg-elevated hover:text-rm-text"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmHardwareAccelerationChange}
                  className="rounded-lg bg-red-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-red-400"
                >
                  Change and Restart
                </button>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </div>
  );
}
