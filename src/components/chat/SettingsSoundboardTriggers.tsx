import InlineEmojiText from "@/components/chat/InlineEmojiText";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { getAuthAssetUrl } from "@/lib/platform";
import { previewSoundboardTriggerSelection } from "@/lib/voice/auto-soundboard";
import {
  ALL_SERVERS_SOUND_SCOPE,
  resolveSoundboardTriggerConfig,
  type SoundboardTriggerConfig,
  type SoundboardTriggerMap,
} from "@/lib/voice/soundboard-trigger";
import {
  toSoundboardTriggerSelection,
  type SoundboardCatalogSound,
} from "@/lib/voice/soundboard-catalog";
import type { Server } from "@/lib/types";
import { setSoundboardMasterVolume } from "@/lib/voice/soundboard";
import { Globe2, Pencil, Play, Trash2, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";
import EmojiToken from "./EmojiToken";
import SoundboardPicker from "./SoundboardPicker";

type TriggerKey = "voiceJoinSoundboard" | "voiceLeaveSoundboard";

interface Props {
  userId: string | null;
  servers: Server[];
}

function ServerIcon({ server }: { server?: Server }) {
  if (!server) return <Globe2 className="h-4 w-4" />;
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
    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-rm-bg-hover text-ui-2xs font-bold text-rm-text-muted">
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
  label,
  actionLabel,
  config,
  inherited,
  onToggle,
  onChange,
  onPreview,
  onClear,
  changeButtonRef,
}: {
  label: string;
  actionLabel: string;
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
    <div className="flex items-center gap-3 border-b border-rm-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-ui-sm font-bold text-rm-text">{label}</h4>
          {inherited && (
            <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
              Inherited
            </span>
          )}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-xs text-rm-text-muted">
          {sound?.emoji && (
            <EmojiToken
              value={sound.emoji}
              className="h-5 w-5 shrink-0"
              fallbackClassName="shrink-0 text-base leading-none"
            />
          )}
          <InlineEmojiText
            text={sound?.name ?? "No sound selected"}
            className="truncate"
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={`Preview ${actionLabel} sound`}
          onClick={onPreview}
          disabled={!sound}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Play size={15} />
        </button>
        <button
          ref={changeButtonRef}
          type="button"
          aria-label={`Change ${actionLabel} sound`}
          onClick={onChange}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          aria-label={`Clear ${actionLabel} sound`}
          onClick={onClear}
          disabled={!sound}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-rm-text-muted transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Trash2 size={15} />
        </button>
        <SettingsSwitch
          checked={config.enabled}
          onChange={onToggle}
          ariaLabel={`Toggle ${actionLabel} sound`}
        />
      </div>
    </div>
  );
}

export function SettingsSoundboardTriggers({ userId, servers }: Props) {
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
  const scopeOptions = [
    {
      value: ALL_SERVERS_SOUND_SCOPE,
      label: "All Servers",
      icon: <ServerIcon />,
    },
    ...servers.map((server) => ({
      value: server.id,
      label: server.name,
      icon: <ServerIcon server={server} />,
    })),
  ];

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

  const getRow = (key: TriggerKey, label: string) => {
    const map = settings[key];
    const hasOverride = selectedScope in map;
    return {
      key,
      label,
      config: hasOverride
        ? map[selectedScope]
        : resolveSoundboardTriggerConfig(map, selectedScope),
      inherited: selectedScope !== ALL_SERVERS_SOUND_SCOPE && !hasOverride,
    };
  };

  const rows = [
    getRow("voiceJoinSoundboard", "Entrance / Join"),
    getRow("voiceLeaveSoundboard", "Exit / Leave"),
  ];

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2">
        <Volume2 size={16} className="text-rm-accent" />
        <h3 className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
          Soundboard Triggers
        </h3>
      </div>

      <div className="space-y-3 rounded-xl border border-rm-border bg-rm-bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-ui-xs font-bold text-rm-text">
              Soundboard volume
            </div>
            <div className="text-ui-2xs text-rm-text-muted">
              Local playback volume for automatic sounds
            </div>
          </div>
          <span className="text-sm font-bold tabular-nums text-rm-accent">
            {volumeDraft}%
          </span>
        </div>
        <input
          aria-label="Soundboard volume"
          type="range"
          min="0"
          max="100"
          value={volumeDraft}
          onChange={(event) => {
            const nextVolume = Number(event.currentTarget.value);
            setVolumeOverride(nextVolume);
            setSoundboardMasterVolume(nextVolume / 100);
            if (userId) scheduleVolumePersistence(nextVolume);
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-rm-bg-elevated accent-rm-accent"
        />
      </div>

      <div className="space-y-3">
        <label className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
          Server scope
        </label>
        <Select
          value={selectedScope}
          onValueChange={(value) => {
            setSelectedScope(value);
            setActiveTrigger(null);
          }}
        >
          <SelectTrigger
            aria-label="Soundboard server scope"
            className="w-full rounded-lg border-rm-border bg-rm-bg-elevated/50 px-4 py-2.5 text-rm-text hover:bg-rm-bg-elevated"
          >
            <SelectValue placeholder="Select server scope" />
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            className="rounded-lg border-rm-border bg-rm-bg-floating p-1.5 text-rm-text shadow-2xl"
          >
            {scopeOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                textValue={option.label}
                className="text-rm-text-secondary hover:bg-rm-bg-elevated hover:text-rm-text focus:bg-rm-bg-elevated focus:text-rm-text"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {option.icon}
                  <InlineEmojiText text={option.label} />
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface">
        {rows.map((row) => (
          <TriggerRow
            key={row.key}
            label={row.label}
            actionLabel={row.key === "voiceJoinSoundboard" ? "Join" : "Leave"}
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
      </div>

      {selectedServer && (
        <div className="flex items-center gap-2 text-ui-2xs text-rm-text-muted">
          <ServerIcon server={selectedServer} />
          <InlineEmojiText
            text={`${selectedServer.name} overrides inherit from All Servers.`}
          />
        </div>
      )}

      <p className="text-xs text-rm-text-muted">
        Entrance and exit sounds are added to the existing connection tones.
      </p>

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
    </section>
  );
}
