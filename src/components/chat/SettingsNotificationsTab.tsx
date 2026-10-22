import { Button } from "@/components/ui/button";
import { SettingsToggleRow } from "@/components/ui/SettingsToggleRow";
import { playNotification } from "@/lib/sounds";
import { isDesktop } from "@/lib/platform";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import { useUser } from "@kova/react";
import { Icon } from "@/components/ui/icon";
import { useEffect, useId } from "react";
import { useShallow } from "zustand/shallow";
import { SettingsSwitch } from "./SettingsSwitch";

export default function SettingsNotificationsTab() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const soundSettings = useSoundSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const updateSoundSettings = useSoundSettingsStore((s) => s.updateSettings);
  const setSoundCurrentUser = useSoundSettingsStore((s) => s.setCurrentUser);
  const desktopNotifications = useDesktopSettingsStore(
    (s) => s.desktopNotifications,
  );
  const updateDesktopSettings = useDesktopSettingsStore(
    (s) => s.updateSettings,
  );
  const isDesktopApp = isDesktop();
  const soundsTitleId = useId();
  const soundsDescriptionId = useId();

  useEffect(() => {
    const initUser = () => {
      if (settingsUserId) {
        setSoundCurrentUser(settingsUserId);
      }
    };
    initUser();
  }, [settingsUserId, setSoundCurrentUser]);

  return (
    <div className="animate-in fade-in duration-150">
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
              <Icon name="laptop" size="sm" className="text-sky-400" />
              <h3 className="text-ui-xs font-medium text-rm-text-muted">
                Desktop Notifications
              </h3>
            </div>

            <div className="rounded-xl overflow-hidden bg-rm-bg-surface border border-rm-border">
              <SettingsToggleRow
                icon={
                  <div className="w-10 h-10 shrink-0 rounded-xl border border-sky-500/20 bg-sky-500/10 flex items-center justify-center text-sky-400">
                    <Icon name="bellRinging" size="md" />
                  </div>
                }
                rawIcon
                label="Enable Desktop Notifications"
                description="Show native notifications for mentions, replies, direct messages, and unread activity while Ralph Meet runs on your desktop."
                checked={desktopNotifications}
                onChange={() =>
                  updateDesktopSettings({
                    desktopNotifications: !desktopNotifications,
                  })
                }
                className="bg-sky-500/5"
              />
            </div>
          </section>
        )}

        {/* Master Sound Toggle */}
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Icon
              name="voiceChannel"
              size="sm"
              className="text-rm-accent-ink"
            />
            <h3 className="text-ui-xs font-medium text-rm-text-muted">
              Sound Effects
            </h3>
          </div>

          <div className="flex flex-col bg-rm-bg-surface border border-rm-border rounded-xl p-0 overflow-hidden divide-y divide-rm-border">
            <div className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-rm-bg-elevated/40 transition-ui gap-4 sm:gap-6 bg-rm-accent/5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-rm-accent-tint flex items-center justify-center text-rm-accent-ink">
                  {soundSettings.soundsEnabled ? (
                    <Icon name="voiceChannel" size="lg" />
                  ) : (
                    <Icon name="speakerOff" size="lg" />
                  )}
                </div>
                <div>
                  <h4
                    id={soundsTitleId}
                    className="text-[14px] font-semibold text-rm-text"
                  >
                    Enable Sound Effects
                  </h4>
                  <p
                    id={soundsDescriptionId}
                    className="text-ui-xs text-rm-text-muted"
                  >
                    Master switch for all in-app sounds
                  </p>
                </div>
              </div>
              <div className="flex justify-end w-full sm:w-auto">
                <SettingsSwitch
                  ariaLabel="Enable Sound Effects"
                  labelledBy={soundsTitleId}
                  describedBy={soundsDescriptionId}
                  checked={soundSettings.soundsEnabled}
                  onChange={() =>
                    updateSoundSettings(
                      { soundsEnabled: !soundSettings.soundsEnabled },
                      settingsUserId ?? undefined,
                    )
                  }
                />
              </div>
            </div>

            {soundSettings.soundsEnabled && (
              <div className="p-4 space-y-4 bg-transparent fade-in animate-in">
                <div className="flex justify-between items-end">
                  <label
                    htmlFor="sound-volume"
                    className="text-ui-xs font-medium text-rm-text-muted"
                  >
                    Master Volume
                  </label>
                  <span className="text-sm font-semibold text-rm-accent-ink tabular-nums">
                    {soundSettings.soundVolume}%
                  </span>
                </div>
                <input
                  id="sound-volume"
                  type="range"
                  min="0"
                  max="100"
                  value={soundSettings.soundVolume}
                  onChange={(e) =>
                    updateSoundSettings(
                      { soundVolume: parseInt(e.target.value) },
                      settingsUserId ?? undefined,
                    )
                  }
                  className="w-full h-1.5 bg-rm-bg-elevated rounded-full appearance-none cursor-pointer accent-rm-accent transition-ui"
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
                  icon: <Icon name="bellRinging" size="md" />,
                  color: "text-destructive",
                  bgColor: "bg-destructive/10 border-destructive/20",
                },
                {
                  id: "voiceJoinLeave" as const,
                  label: "Voice Join / Leave",
                  desc: "Play a tone when someone joins or leaves your voice channel",
                  icon: <Icon name="headphones" size="md" />,
                  color: "text-emerald-400",
                  bgColor: "bg-emerald-500/10 border-emerald-500/20",
                },
                {
                  id: "selfConnectDisconnect" as const,
                  label: "Connect / Disconnect",
                  desc: "Play a chime when you join or leave a voice channel",
                  icon: <Icon name="zap" size="md" />,
                  color: "text-amber-600 dark:text-amber-400",
                  bgColor: "bg-amber-500/10 border-amber-500/20",
                },
                {
                  id: "muteDeafen" as const,
                  label: "Mute / Deafen",
                  desc: "Play a click when you toggle mute or deafen",
                  icon: <Icon name="mic" size="md" />,
                  color: "text-rm-accent",
                  bgColor: "bg-rm-accent/10 border-rm-accent/20",
                },
                {
                  id: "screenShare" as const,
                  label: "Screen Share",
                  desc: "Play a tone when starting or stopping a screen share",
                  icon: <Icon name="screenShare" size="md" />,
                  color: "text-sky-400",
                  bgColor: "bg-sky-500/10 border-sky-500/20",
                },
                {
                  id: "streamWatcherActivity" as const,
                  label: "Stream Viewer Activity",
                  desc: "Play unique sounds when someone starts or stops watching your stream",
                  icon: <Icon name="bell" size="md" />,
                  color: "text-fuchsia-400",
                  bgColor: "bg-fuchsia-500/10 border-fuchsia-500/20",
                },
              ].map((opt) => (
                <SettingsToggleRow
                  key={opt.id}
                  icon={
                    <div
                      className={`w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center ${opt.bgColor} ${opt.color}`}
                    >
                      {opt.icon}
                    </div>
                  }
                  rawIcon
                  label={opt.label}
                  description={opt.desc}
                  checked={soundSettings[opt.id]}
                  onChange={() =>
                    updateSoundSettings(
                      { [opt.id]: !soundSettings[opt.id] },
                      settingsUserId ?? undefined,
                    )
                  }
                />
              ))}
            </div>
          )}

          {/* Test Sound Button */}
          <div className="flex justify-end mt-4">
            <Button variant="secondary" onClick={() => playNotification()}>
              <Icon name="bell" size="sm" />
              Test Notification Sound
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
