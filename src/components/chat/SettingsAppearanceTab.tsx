import { BaseModal } from "@/components/ui/BaseModal";
import { SettingsToggleRow } from "@/components/ui/SettingsToggleRow";
import { isDesktop } from "@/lib/platform";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { cn } from "@/lib/utils";
import { Cpu, RefreshCw } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

function ThemeSwatch({
  id,
  active,
  onClick,
  previewClass,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  previewClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 w-[60px] h-20 rounded-2xl transition-all relative overflow-hidden",
        active
          ? "ring-2 ring-primary ring-offset-2 ring-offset-[var(--rm-bg-primary)] border-transparent"
          : "border-2 border-rm-border/30 hover:border-rm-border/60"
      )}
    >
      <div className={cn("absolute inset-0", previewClass)} />
      {id === 'system' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 text-white/50 backdrop-blur-[2px]">
          <RefreshCw size={24} strokeWidth={2.5} />
        </div>
      )}
    </button>
  );
}

export default function SettingsAppearanceTab() {
  const { theme, setTheme } = useTheme();
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
      .catch((error) => console.warn("[Settings] Failed to read hardware acceleration setting:", error));
    return () => { cancelled = true; };
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
      console.error("[Settings] Failed to change hardware acceleration:", error);
      setPendingHardwareAcceleration(null);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col items-center">
      <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block w-full">
        Appearance
      </h1>
      <p className="text-sm text-rm-text-muted mb-6 md:mb-8 hidden md:block w-full">
        Customize how Ralph Meet looks. Choose between dark, light, or
        sync with your system.
      </p>

      <div className="w-full max-w-[400px]">
        <section className="flex flex-col">
          {/* Unified Mobile/Desktop Mockup View */}
          <div className="w-full rounded-[20px] bg-rm-bg-surface border border-rm-border p-4 md:p-5 shadow-lg overflow-hidden flex flex-col pointer-events-none select-none mb-6">
            <h3 className="font-bold text-rm-text mb-4 text-[15px] px-1">Messages</h3>

            <div className="flex items-center gap-3 mb-5 overflow-hidden">
              <div className="h-[46px] w-[130px] rounded-[14px] bg-rm-bg-elevated shrink-0" />
              <div className="h-[46px] w-[180px] rounded-[14px] bg-rm-bg-elevated shrink-0" />
              <div className="h-[46px] w-[90px] rounded-[14px] bg-rm-bg-elevated shrink-0" />
            </div>

            <div className="flex flex-col gap-[22px] px-1">
              {[
                { c: "bg-emerald-500", name: "24m", w: "w-[60px]", w2: "w-[180px]" },
                { c: "bg-blue-500", name: "32m", w: "w-[90px]", w2: "w-[220px]" },
                { c: "bg-indigo-500", name: "1h", w: "w-[40px]", w2: "w-[130px]" },
                { c: "bg-rose-500", name: "2h", w: "w-[70px]", w2: "w-[160px]" },
                { c: "bg-amber-500", name: "4h", w: "w-[80px]", w2: "w-[140px]" }
              ].map((m) => (
                <div key={m.name} className="flex items-start gap-4">
                  <div className={`w-[36px] h-[36px] rounded-full ${m.c}/20 flex shrink-0 border border-rm-border`} />
                  <div className="flex-1 pt-[2px]">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`h-[8px] ${m.w} bg-rm-text rounded-full`} />
                      <div className="text-[10px] text-rm-text-muted font-medium pr-1">{m.name}</div>
                    </div>
                    <div className={`h-[6px] ${m.w2} bg-rm-text-muted/60 rounded-full`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Current theme label */}
          <div className="text-center font-bold text-[14px] tracking-wide text-rm-text mb-3">
            {theme === 'system' ? 'Sync with Computer' : theme === 'light' ? 'Light' : 'Midnight'}
          </div>

          {/* Theme swatches row */}
          <div className="flex px-2 pb-2 items-center justify-center gap-[14px]">
            <ThemeSwatch id="light" active={theme === 'light'} onClick={() => setTheme('light')} previewClass="bg-[#f2f3f5]" />
            <ThemeSwatch id="dark" active={theme === 'dark'} onClick={() => setTheme('dark')} previewClass="bg-[#0f0f11]" />
            <ThemeSwatch id="system" active={theme === 'system'} onClick={() => setTheme('system')} previewClass="bg-gradient-to-br from-[#0f0f11] to-[#f2f3f5]" />
          </div>

          <p className="text-center text-[12px] text-rm-text-muted mt-[18px] font-semibold">
            This will change the theme across all your devices.
          </p>
        </section>

        {isDesktopApp && (
          <section className="mt-8 border-t border-rm-border pt-6">
            <h2 className="px-1 text-[12px] font-bold uppercase tracking-wider text-rm-text-muted">
              Advanced
            </h2>
            <div className="mt-3 overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface">
              <SettingsToggleRow
                icon={<Cpu size={20} />}
                label="Enable hardware acceleration"
                description="Uses your GPU to make Ralph Meet run more smoothly. Turn this off if you're experiencing visual glitches like frame drops in games or performance problems."
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
              aria-modal="true"
              aria-labelledby="hardware-acceleration-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="hardware-acceleration-title" className="text-lg font-bold text-rm-text">
                Change Hardware Acceleration
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-rm-text-muted">
                Enabling hardware acceleration setting will improve system performance. Changing this setting will relaunch Ralph Meet.
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
                  Change & Restart
                </button>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </div>
  );
}
