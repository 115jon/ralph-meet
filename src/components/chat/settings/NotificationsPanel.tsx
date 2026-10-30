import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { playNotification } from "@/lib/sounds";
import { useDesktopSettingsStore } from "@/stores/useDesktopSettingsStore";
import {
  useSoundSettingsStore,
  type SoundSettings,
} from "@/stores/useSoundSettingsStore";
import { useUser } from "@kova/react";
import { useEffect } from "react";
import { useShallow } from "zustand/shallow";
import { RangeControl, SettingsCard, SettingsRow } from "./primitives";

type SoundToggleKey = keyof Pick<
  SoundSettings,
  | "notifications"
  | "voiceJoinLeave"
  | "selfConnectDisconnect"
  | "muteDeafen"
  | "screenShare"
  | "streamWatcherActivity"
>;

const SOUND_TOGGLES: Array<{ rowId: string; key: SoundToggleKey }> = [
  { rowId: "sound-notifications", key: "notifications" },
  { rowId: "sound-voice-join-leave", key: "voiceJoinLeave" },
  { rowId: "sound-connect", key: "selfConnectDisconnect" },
  { rowId: "sound-mute", key: "muteDeafen" },
  { rowId: "sound-screen-share", key: "screenShare" },
  { rowId: "sound-stream-viewers", key: "streamWatcherActivity" },
];

/** Sound settings for the signed-in user. Shared with the preview rail. */
export function useSoundSettingsForSettings() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const soundSettings = useSoundSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const setSoundCurrentUser = useSoundSettingsStore((s) => s.setCurrentUser);

  useEffect(() => {
    if (settingsUserId) setSoundCurrentUser(settingsUserId);
  }, [settingsUserId, setSoundCurrentUser]);

  return { settingsUserId, soundSettings };
}

export default function NotificationsPanel() {
  const { settingsUserId, soundSettings } = useSoundSettingsForSettings();
  const updateSoundSettings = useSoundSettingsStore((s) => s.updateSettings);
  const desktopNotifications = useDesktopSettingsStore(
    (s) => s.desktopNotifications,
  );
  const updateDesktopSettings = useDesktopSettingsStore(
    (s) => s.updateSettings,
  );
  const soundsOn = soundSettings.soundsEnabled;

  return (
    <>
      <SettingsCard id="desktop-alerts">
        <SettingsRow id="desktop-notifications" layout="inline">
          {(ids) => (
            <SettingsSwitch
              checked={desktopNotifications}
              onChange={() =>
                updateDesktopSettings({
                  desktopNotifications: !desktopNotifications,
                })
              }
              labelledBy={ids.labelId}
              describedBy={ids.descId}
            />
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard id="sounds">
        <SettingsRow id="sounds-enabled" layout="inline">
          {(ids) => (
            <SettingsSwitch
              checked={soundsOn}
              onChange={() =>
                updateSoundSettings(
                  { soundsEnabled: !soundsOn },
                  settingsUserId ?? undefined,
                )
              }
              labelledBy={ids.labelId}
              describedBy={ids.descId}
            />
          )}
        </SettingsRow>
        <SettingsRow id="sound-volume" layout="block" disabled={!soundsOn}>
          {(ids) => (
            <RangeControl
              ids={ids}
              value={soundSettings.soundVolume}
              disabled={!soundsOn}
              onChange={(value) =>
                updateSoundSettings(
                  { soundVolume: value },
                  settingsUserId ?? undefined,
                )
              }
            />
          )}
        </SettingsRow>
        {SOUND_TOGGLES.map(({ rowId, key }) => (
          <SettingsRow
            key={rowId}
            id={rowId}
            layout="inline"
            disabled={!soundsOn}
          >
            {(ids) => (
              <SettingsSwitch
                checked={soundSettings[key]}
                disabled={!soundsOn}
                onChange={() =>
                  updateSoundSettings(
                    { [key]: !soundSettings[key] },
                    settingsUserId ?? undefined,
                  )
                }
                labelledBy={ids.labelId}
                describedBy={ids.descId}
              />
            )}
          </SettingsRow>
        ))}
        <SettingsRow id="test-sound" layout="inline">
          {() => (
            <Button
              type="button"
              variant="secondary"
              aria-label="Play test notification sound"
              onClick={() => playNotification()}
            >
              <Icon name="play" size="sm" />
              Play
            </Button>
          )}
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
