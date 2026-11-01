import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { CUSTOM_SOUND_ACCEPT, type CustomSoundMeta } from "@/lib/custom-sounds";
import {
  SOUND_IDS,
  SOUND_LABELS,
  soundFileStem,
  type SoundId,
} from "@/lib/sound-catalog";
import { playSound, soundEngine } from "@/lib/sounds";
import {
  useCustomSoundsStore,
  type BulkImportResult,
} from "@/stores/useCustomSoundsStore";
import {
  useSoundSettingsStore,
  type SoundSettings,
} from "@/stores/useSoundSettingsStore";
import { useEffect, useRef, useState } from "react";
import {
  ConfirmStrip,
  RowError,
  SettingsCard,
  SettingsRow,
  useConfirm,
} from "./primitives";

function seconds(duration: number) {
  return `${duration.toFixed(duration < 10 ? 1 : 0)} s`;
}

/** Hidden file input opened by a button; resets so the same file re-picks. */
function useFilePicker(onFiles: (files: File[]) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (multiple: boolean) => (
    <input
      ref={ref}
      type="file"
      accept={CUSTOM_SOUND_ACCEPT}
      multiple={multiple}
      hidden
      tabIndex={-1}
      onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (files.length > 0) onFiles(files);
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}

function CustomSoundRow({
  id,
  sound,
  onImported,
}: {
  id: SoundId;
  sound: CustomSoundMeta | undefined;
  onImported: () => void;
}) {
  const importFile = useCustomSoundsStore((s) => s.importFile);
  const reset = useCustomSoundsStore((s) => s.reset);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = SOUND_LABELS[id];
  const picker = useFilePicker(async ([file]) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await importFile(id, file);
    setBusy(false);
    if ("ok" in result) onImported();
    else setError(result.message);
  });

  return (
    <SettingsRow
      id={`custom-sound-${soundFileStem(id)}`}
      label={label}
      layout="inline"
      description={
        sound ? (
          <span className="flex min-w-0 gap-1.5">
            <span className="truncate">{sound.name}</span>
            <span className="shrink-0">· {seconds(sound.duration)}</span>
          </span>
        ) : (
          <span>
            Built-in ·{" "}
            <span className="font-mono text-ui-xs">{soundFileStem(id)}</span>
          </span>
        )
      }
      footer={error ? <RowError>{error}</RowError> : null}
    >
      {() => (
        <>
          {picker.input(false)}
          <IconButton
            type="button"
            aria-label={`Preview ${label} sound`}
            icon="play"
            variant="ghost"
            onClick={async () => {
              await soundEngine().customSoundsReady();
              playSound(id, {
                bypassToggles: true,
                source: sound ? "custom" : "builtin",
                once: true,
              });
            }}
          />
          <IconButton
            type="button"
            aria-label={`Import a file for ${label}`}
            icon="upload"
            variant="ghost"
            disabled={busy}
            onClick={picker.open}
          />
          <IconButton
            type="button"
            aria-label={`Reset ${label} to the built-in sound`}
            icon="trash"
            variant="destructive"
            disabled={!sound || busy}
            onClick={() => {
              setError(null);
              void reset(id);
            }}
          />
        </>
      )}
    </SettingsRow>
  );
}

function BulkSummary({ result }: { result: BulkImportResult }) {
  const count = result.imported.length;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p role="status" className="text-ui-sm text-ink-2">
        {count === 0
          ? "No sounds imported."
          : `Imported ${count} ${count === 1 ? "sound" : "sounds"}.`}
      </p>
      {result.failed.length > 0 ? (
        <RowError className="mt-0">
          <ul className="flex flex-col gap-1">
            {result.failed.map((failure) => (
              <li key={failure.name}>{failure.message}</li>
            ))}
          </ul>
        </RowError>
      ) : null}
    </div>
  );
}

/** Settings → Notifications: the experimental custom-sounds card. */
export function CustomSoundsCard({
  settingsUserId,
  soundSettings,
}: {
  settingsUserId: string | null;
  soundSettings: SoundSettings;
}) {
  const updateSoundSettings = useSoundSettingsStore((s) => s.updateSettings);
  const sounds = useCustomSoundsStore((s) => s.sounds);
  const load = useCustomSoundsStore((s) => s.load);
  const importFiles = useCustomSoundsStore((s) => s.importFiles);
  const resetAll = useCustomSoundsStore((s) => s.resetAll);
  const [bulk, setBulk] = useState<BulkImportResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const confirm = useConfirm();
  const soundsOn = soundSettings.soundsEnabled;
  const enabled = soundSettings.customSounds;
  const hasAny = Object.keys(sounds).length > 0;

  useEffect(() => {
    void load();
  }, [load]);

  const setEnabled = (next: boolean) =>
    updateSoundSettings({ customSounds: next }, settingsUserId ?? undefined);
  // Importing a file is a clear sign the person wants to hear it.
  const onImported = () => {
    if (!enabled) setEnabled(true);
  };

  const bulkPicker = useFilePicker(async (files) => {
    setBulkBusy(true);
    const result = await importFiles(files);
    setBulkBusy(false);
    setBulk(result);
    if (result.imported.length > 0) onImported();
  });

  return (
    <SettingsCard id="custom-sounds">
      <SettingsRow
        id="custom-sounds-enabled"
        layout="inline"
        disabled={!soundsOn}
      >
        {(ids) => (
          <SettingsSwitch
            checked={enabled}
            disabled={!soundsOn}
            onChange={() => setEnabled(!enabled)}
            labelledBy={ids.labelId}
            describedBy={ids.descId}
          />
        )}
      </SettingsRow>
      <SettingsRow
        id="custom-sounds-import"
        layout="stack"
        footer={bulk ? <BulkSummary result={bulk} /> : null}
      >
        {() => (
          <>
            {bulkPicker.input(true)}
            <Button
              type="button"
              variant="secondary"
              loading={bulkBusy}
              onClick={bulkPicker.open}
            >
              Choose files
            </Button>
          </>
        )}
      </SettingsRow>
      {SOUND_IDS.map((id) => (
        <CustomSoundRow
          key={id}
          id={id}
          sound={sounds[id]}
          onImported={onImported}
        />
      ))}
      <SettingsRow
        id="custom-sounds-reset"
        layout="inline"
        footer={
          confirm.armed ? (
            <ConfirmStrip
              consequence="Every imported file is deleted from this device. All sounds go back to the built-in ones."
              confirmLabel="Reset all"
              onCancel={confirm.cancel}
              onConfirm={() => {
                void resetAll();
                setBulk(null);
                confirm.done();
              }}
            />
          ) : null
        }
      >
        {() => (
          <Button
            ref={confirm.triggerRef}
            type="button"
            variant="destructive"
            aria-expanded={confirm.armed}
            disabled={!hasAny || confirm.armed}
            onClick={confirm.arm}
          >
            Reset all
          </Button>
        )}
      </SettingsRow>
    </SettingsCard>
  );
}
