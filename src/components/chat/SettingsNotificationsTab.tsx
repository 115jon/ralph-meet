import { SettingsToggleRow } from "@/components/ui/SettingsToggleRow";
import { playNotification } from "@/lib/sounds";
import { isDesktop } from "@/lib/platform";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import { useUser } from "@kova/react";
import { Bell, BellRing, Headphones, Laptop, Mic, MonitorUp, Volume2, VolumeX, Zap } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { SettingsSwitch } from "./SettingsSwitch";

export default function SettingsNotificationsTab() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const soundSettings = useSoundSettingsStore(useShallow((s) => s.getSettings(settingsUserId)));
  const updateSoundSettings = useSoundSettingsStore((s) => s.updateSettings);
  const setSoundCurrentUser = useSoundSettingsStore((s) => s.setCurrentUser);
  const desktopNotifications = useDesktopSettingsStore((s) => s.desktopNotifications);
  const updateDesktopSettings = useDesktopSettingsStore((s) => s.updateSettings);
  const isDesktopApp = isDesktop();

  useEffect(() => {
    const initUser = () => {
      if (settingsUserId) {
        setSoundCurrentUser(settingsUserId);
      }
    };
    initUser();
  }, [settingsUserId, setSoundCurrentUser]);

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="text-2xl font-bold text-rm-text mb-2 hidden md:block">
        Notifications & Sounds
      </h1>
      <p className="text-sm text-rm-text-muted mb-6 md:mb-10">
        Configure notification preferences and sound effects.
      </p>

      <div className="space-y-12">
        {isDesktopApp && (
          <section className="space-y-6">
            <div className="flex items-center gap-2">
              <Laptop size={16} className="text-sky-400" />
              <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
                Desktop Notifications
              </h3>
            </div>

            <div className="rounded-xl overflow-hidden bg-rm-bg-surface border border-rm-border">
              <SettingsToggleRow
                icon={<div className="w-10 h-10 shrink-0 rounded-xl border border-sky-500/20 bg-sky-500/10 flex items-center justify-center text-sky-400"><BellRing size={18} /></div>}
                rawIcon
                label="Enable Desktop Notifications"
                description="Show native notifications for mentions, replies, direct messages, and unread activity while Ralph Meet runs on your desktop."
                checked={desktopNotifications}
                onChange={() => updateDesktopSettings({ desktopNotifications: !desktopNotifications })}
                className="bg-sky-500/5"
              />
            </div>
          </section>
        )}

        {/* Master Sound Toggle */}
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Volume2 size={16} className="text-rm-accent" />
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
              Sound Effects
            </h3>
          </div>

          <div className="flex flex-col bg-rm-bg-surface border border-rm-border rounded-xl p-0 overflow-hidden divide-y divide-rm-border">
            <div className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-rm-bg-elevated/40 transition-all gap-4 sm:gap-6 bg-rm-accent/5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-rm-accent flex items-center justify-center text-white shadow-md shadow-rm-accent/20">
                  {soundSettings.soundsEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </div>
                <div>
                  <h4 className="text-[14px] font-bold text-rm-text">Enable Sound Effects</h4>
                  <p className="text-[12px] text-rm-text-muted opacity-80">Master switch for all in-app sounds</p>
                </div>
              </div>
              <div className="flex justify-end w-full sm:w-auto">
                <SettingsSwitch
                  checked={soundSettings.soundsEnabled}
                  onChange={() => updateSoundSettings({ soundsEnabled: !soundSettings.soundsEnabled }, settingsUserId ?? undefined)}
                />
              </div>
            </div>

            {soundSettings.soundsEnabled && (
              <div className="p-4 space-y-4 bg-transparent fade-in animate-in">
                <div className="flex justify-between items-end">
                  <label htmlFor="sound-volume" className="text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
                    Master Volume
                  </label>
                  <span className="text-sm font-black text-rm-accent tabular-nums">
                    {soundSettings.soundVolume}%
                  </span>
                </div>
                <input
                  id="sound-volume"
                  type="range"
                  min="0"
                  max="100"
                  value={soundSettings.soundVolume}
                  onChange={(e) => updateSoundSettings({ soundVolume: parseInt(e.target.value) }, settingsUserId ?? undefined)}
                  className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-rm-accent transition-all"
                />
              </div>
            )}
          </div>

          {soundSettings.soundsEnabled && (
            <div className="flex flex-col rounded-xl overflow-hidden bg-rm-bg-surface border border-rm-border divide-y divide-rm-border fade-in slide-in-from-top-4 animate-in">
              {[
                {
                  id: "notifications" as const,
                  label: "Notification Sounds",
                  desc: "Play a chime when you receive a mention, reply, or DM",
                  icon: <BellRing size={18} />,
                  color: "text-rose-400",
                  bgColor: "bg-rose-500/10 border-rose-500/20",
                },
                {
                  id: "voiceJoinLeave" as const,
                  label: "Voice Join / Leave",
                  desc: "Play a tone when someone joins or leaves your voice channel",
                  icon: <Headphones size={18} />,
                  color: "text-emerald-400",
                  bgColor: "bg-emerald-500/10 border-emerald-500/20",
                },
                {
                  id: "selfConnectDisconnect" as const,
                  label: "Connect / Disconnect",
                  desc: "Play a chime when you join or leave a voice channel",
                  icon: <Zap size={18} />,
                  color: "text-amber-600 dark:text-amber-400",
                  bgColor: "bg-amber-500/10 border-amber-500/20",
                },
                {
                  id: "muteDeafen" as const,
                  label: "Mute / Deafen",
                  desc: "Play a click when you toggle mute or deafen",
                  icon: <Mic size={18} />,
                  color: "text-rm-accent",
                  bgColor: "bg-rm-accent/10 border-rm-accent/20",
                },
                {
                  id: "screenShare" as const,
                  label: "Screen Share",
                  desc: "Play a tone when starting or stopping a screen share",
                  icon: <MonitorUp size={18} />,
                  color: "text-sky-400",
                  bgColor: "bg-sky-500/10 border-sky-500/20",
                },
              ].map((opt) => (
                <SettingsToggleRow
                  key={opt.id}
                  icon={<div className={`w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center ${opt.bgColor} ${opt.color}`}>{opt.icon}</div>}
                  rawIcon
                  label={opt.label}
                  description={opt.desc}
                  checked={soundSettings[opt.id]}
                  onChange={() => updateSoundSettings({ [opt.id]: !soundSettings[opt.id] }, settingsUserId ?? undefined)}
                />
              ))}
            </div>
          )}

          {/* Test Sound Button */}
          <div className="flex justify-end mt-4">
            <button
              onClick={() => playNotification()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-rm-bg-elevated border border-rm-border text-rm-text-secondary hover:bg-rm-bg-hover hover:text-rm-text transition-all"
            >
              <Bell size={14} />
              Test Notification Sound
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
