import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import type { Server } from "@/lib/types";
import { getAuthAssetUrl } from "@/lib/platform";
import { previewSoundboardTriggerSelection } from "@/lib/voice/auto-soundboard";
import { setSoundboardMasterVolume } from "@/lib/voice/soundboard";
import {
  toSoundboardTriggerSelection,
  type SoundboardCatalogSound,
} from "@/lib/voice/soundboard-catalog";
import {
  ALL_SERVERS_SOUND_SCOPE,
  resolveSoundboardTriggerConfig,
  type SoundboardTriggerConfig,
  type SoundboardTriggerMap,
} from "@/lib/voice/soundboard-trigger";
import { useChatStore } from "@/stores/chat-store";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import { useUser } from "@kova/react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import EmojiToken from "../EmojiToken";
import SoundboardPicker from "../SoundboardPicker";
import {
  RangeControl,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
} from "./primitives";

type TriggerKey = "voiceJoinSoundboard" | "voiceLeaveSoundboard";

function ServerIcon({ server }: { server?: Server }) {
  if (!server) return <Icon name="globe" size="sm" />;
  if (server.icon_url) {
    return (
      <img
        src={getAuthAssetUrl(server.icon_url)}
        alt=""
        className="h-5 w-5 rounded-md object-cover"
      />
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-rm-tint-2 text-ui-2xs font-bold text-rm-text-secondary">
      {server.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function withScope(
  map: SoundboardTriggerMap,
  scope: string,
  config: SoundboardTriggerConfig,
): SoundboardTriggerMap {
  return { ...map, [scope]: config };
}

function withoutScope(map: SoundboardTriggerMap, scope: string) {
  const next = { ...map };
  delete next[scope];
  return next;
}

function TriggerRow({
  rowId,
  actionLabel,
  config,
  inherited,
  onToggle,
  onChange,
  onPreview,
  onClear,
  changeButtonRef,
}: {
  rowId: string;
  actionLabel: "join" | "leave";
  config: SoundboardTriggerConfig;
  inherited: boolean;
  onToggle: () => void;
  onChange: () => void;
  onPreview: () => void;
  onClear: () => void;
  changeButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const sound = config.sound;
  return (
    <SettingsRow
      id={rowId}
      layout="inline"
      description={
        <span className="flex min-w-0 items-center gap-1.5">
          {sound?.emoji ? (
            <EmojiToken
              value={sound.emoji}
              className="h-4 w-4 shrink-0"
              fallbackClassName="shrink-0 text-ui-sm leading-none"
            />
          ) : null}
          <InlineEmojiText
            text={sound?.name ?? "No sound chosen"}
            className="truncate"
          />
          {inherited ? (
            <span className="shrink-0 text-rm-text-secondary">
              · From All servers
            </span>
          ) : null}
        </span>
      }
    >
      {(ids) => (
        <>
          <IconButton
            type="button"
            aria-label={`Preview ${actionLabel} sound`}
            icon="play"
            variant="ghost"
            iconSize="sm"
            onClick={onPreview}
            disabled={!sound}
          />
          <IconButton
            ref={changeButtonRef}
            type="button"
            aria-label={`Change ${actionLabel} sound`}
            icon="edit"
            variant="ghost"
            iconSize="sm"
            onClick={onChange}
          />
          <IconButton
            type="button"
            aria-label={`Clear ${actionLabel} sound`}
            icon="trash"
            variant="destructive"
            iconSize="sm"
            onClick={onClear}
            disabled={!sound}
          />
          <span className="ml-1 flex">
            <SettingsSwitch
              checked={config.enabled}
              onChange={onToggle}
              labelledBy={ids.labelId}
              describedBy={ids.descId}
            />
          </span>
        </>
      )}
    </SettingsRow>
  );
}

/**
 * Soundboard volume plus the join/leave triggers. Rendered standalone by
 * tests with an explicit user and server list; the panel reads both.
 */
export function SoundboardSettings({
  userId,
  servers,
}: {
  userId: string | null;
  servers: Server[];
}) {
  const settings = useSoundSettingsStore(
    useShallow((state) => state.getSettings(userId)),
  );
  const updateSettings = useSoundSettingsStore((state) => state.updateSettings);
  const [selectedScope, setSelectedScope] = useState(ALL_SERVERS_SOUND_SCOPE);
  const [activeTrigger, setActiveTrigger] = useState<TriggerKey | null>(null);
  const joinChangeButtonRef = useRef<HTMLButtonElement | null>(null);
  const leaveChangeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [volumeOverride, setVolumeOverride] = useState<number | null>(null);
  const volumePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingVolumeRef = useRef<number | null>(null);

  useEffect(() => {
    setSoundboardMasterVolume(settings.soundboardVolume / 100);
  }, [settings.soundboardVolume]);

  const volumeDraft = volumeOverride ?? settings.soundboardVolume;

  const scheduleVolumePersistence = (volume: number) => {
    pendingVolumeRef.current = volume;
    if (volumePersistTimerRef.current) {
      clearTimeout(volumePersistTimerRef.current);
    }
    volumePersistTimerRef.current = setTimeout(() => {
      volumePersistTimerRef.current = null;
      const pendingVolume = pendingVolumeRef.current;
      pendingVolumeRef.current = null;
      if (userId && pendingVolume !== null) {
        updateSettings({ soundboardVolume: pendingVolume }, userId);
      }
      setVolumeOverride(null);
    }, 250);
  };

  useEffect(
    () => () => {
      if (volumePersistTimerRef.current) {
        clearTimeout(volumePersistTimerRef.current);
      }
      const pendingVolume = pendingVolumeRef.current;
      if (userId && pendingVolume !== null) {
        updateSettings({ soundboardVolume: pendingVolume }, userId);
      }
    },
    [updateSettings, userId],
  );

  const selectedServer = servers.find((server) => server.id === selectedScope);

  const updateTrigger = (key: TriggerKey, config: SoundboardTriggerConfig) => {
    if (!userId) return;
    const map = settings[key];
    updateSettings({ [key]: withScope(map, selectedScope, config) }, userId);
  };

  const selectSound = (sound: SoundboardCatalogSound) => {
    if (!activeTrigger || !userId) return;
    updateTrigger(activeTrigger, {
      enabled: true,
      sound: toSoundboardTriggerSelection(sound),
    });
    setActiveTrigger(null);
  };

  const getRow = (key: TriggerKey) => {
    const map = settings[key];
    const hasOverride = selectedScope in map;
    return {
      key,
      config: hasOverride
        ? map[selectedScope]
        : resolveSoundboardTriggerConfig(map, selectedScope),
      inherited: selectedScope !== ALL_SERVERS_SOUND_SCOPE && !hasOverride,
    };
  };

  const rows = [getRow("voiceJoinSoundboard"), getRow("voiceLeaveSoundboard")];

  return (
    <>
      <SettingsCard id="soundboard-playback">
        <SettingsRow id="soundboard-volume">
          {(ids) => (
            <RangeControl
              ids={ids}
              value={volumeDraft}
              onChange={(nextVolume) => {
                setVolumeOverride(nextVolume);
                setSoundboardMasterVolume(nextVolume / 100);
                if (userId) scheduleVolumePersistence(nextVolume);
              }}
            />
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard id="join-leave-sounds">
        <SettingsRow
          id="sound-scope"
          description={
            selectedServer ? (
              <span className="flex items-center gap-1.5">
                <InlineEmojiText
                  text={`${selectedServer.name} uses your All servers sounds until you change them here.`}
                />
              </span>
            ) : undefined
          }
        >
          {(ids) => (
            <SettingsSelect
              ids={ids}
              value={selectedScope}
              options={[
                { value: ALL_SERVERS_SOUND_SCOPE, label: "All servers" },
                ...servers.map((server) => ({
                  value: server.id,
                  label: server.name,
                })),
              ]}
              renderLabel={(option) => (
                <span className="flex min-w-0 items-center gap-2">
                  <ServerIcon
                    server={servers.find(
                      (server) => server.id === option.value,
                    )}
                  />
                  <InlineEmojiText text={option.label} />
                </span>
              )}
              onValueChange={(value) => {
                setSelectedScope(value);
                setActiveTrigger(null);
              }}
            />
          )}
        </SettingsRow>
        {rows.map((row) => (
          <TriggerRow
            key={row.key}
            rowId={
              row.key === "voiceJoinSoundboard" ? "join-sound" : "leave-sound"
            }
            actionLabel={row.key === "voiceJoinSoundboard" ? "join" : "leave"}
            config={row.config}
            inherited={row.inherited}
            changeButtonRef={
              row.key === "voiceJoinSoundboard"
                ? joinChangeButtonRef
                : leaveChangeButtonRef
            }
            onToggle={() =>
              updateTrigger(row.key, {
                ...row.config,
                enabled: !row.config.enabled,
              })
            }
            onChange={() => setActiveTrigger(row.key)}
            onPreview={() => {
              if (row.config.sound) {
                void previewSoundboardTriggerSelection(
                  row.config.sound,
                  userId ?? undefined,
                );
              }
            }}
            onClear={() => {
              if (selectedScope === ALL_SERVERS_SOUND_SCOPE) {
                updateTrigger(row.key, { ...row.config, sound: null });
                return;
              }
              if (userId) {
                updateSettings(
                  { [row.key]: withoutScope(settings[row.key], selectedScope) },
                  userId,
                );
              }
            }}
          />
        ))}
      </SettingsCard>

      {activeTrigger && (
        <SoundboardPicker
          onClose={() => setActiveTrigger(null)}
          sfu={null}
          selectionMode
          compact
          markerRef={
            activeTrigger === "voiceJoinSoundboard"
              ? joinChangeButtonRef
              : leaveChangeButtonRef
          }
          onSelect={selectSound}
          serverIds={
            selectedScope === ALL_SERVERS_SOUND_SCOPE
              ? servers.map((server) => server.id)
              : [selectedScope]
          }
          localUserId={userId}
          initialView="soundboard"
        />
      )}
    </>
  );
}

export default function SoundboardPanel() {
  const { user } = useUser();
  const servers = useChatStore((state) => state.servers);
  return <SoundboardSettings userId={user?.id ?? null} servers={servers} />;
}
