/**
 * `/ui-fixtures?surface=sounds`: audition the UI sounds. Each sound plays in
 * its built-in version and, when a file has been imported on this device, the
 * custom one, through the real engine (volume taper, rate limits, limiter).
 * "Speech" loops a voice-like signal underneath to judge masking during
 * calls. Files imported here land in the same device storage the app reads
 * (Settings → Notifications → Custom sounds); the app picks them up on reload.
 */
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { CUSTOM_SOUND_ACCEPT } from "@/lib/custom-sounds";
import {
  isLoopSound,
  SOUND_IDS,
  SOUND_LABELS,
  soundFileStem,
  type SoundId,
} from "@/lib/sound-catalog";
import { customSoundStorage, SoundEngine } from "@/lib/sounds";
import { createCustomSoundsStore } from "@/stores/useCustomSoundsStore";
import type { SoundSettings } from "@/stores/useSoundSettingsStore";

const ALL_ON: SoundSettings = {
  soundsEnabled: true,
  voiceJoinLeave: true,
  muteDeafen: true,
  notifications: true,
  selfConnectDisconnect: true,
  screenShare: true,
  streamWatcherActivity: true,
  messageReceived: true,
  calls: true,
  customSounds: true,
  soundVolume: 100,
  soundboardVolume: 100,
  voiceJoinSoundboard: {},
  voiceLeaveSoundboard: {},
};

type Column = "builtin" | "custom";

/**
 * A voice-like masker: a glottal pulse train with drifting pitch plus breath
 * noise, chopped into 3-6 Hz syllables, through three formant band-passes.
 */
function startSpeech(a: AudioContext, out: AudioNode): () => void {
  const seconds = 6;
  const rate = a.sampleRate;
  const buffer = a.createBuffer(1, seconds * rate, rate);
  const data = buffer.getChannelData(0);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let phase = 0;
  let syllableEnd = 0;
  let syllableStart = 0;
  let voiced = true;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    if (t >= syllableEnd) {
      syllableStart = t;
      syllableEnd = t + 0.15 + rand() * 0.18 + (rand() < 0.15 ? 0.25 : 0);
      voiced = rand() > 0.2;
    }
    const f0 = 125 + 35 * Math.sin(t * 1.7) + 15 * Math.sin(t * 5.3);
    phase = (phase + f0 / rate) % 1;
    const span = syllableEnd - syllableStart;
    const p = (t - syllableStart) / span;
    const env = p < 0.8 ? Math.sin((Math.PI * p) / 0.8) : 0;
    const pulse = voiced ? 1 - 2 * phase : 0;
    data[i] = env * (0.7 * pulse + 0.25 * (rand() * 2 - 1));
  }
  const source = a.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const bus = a.createGain();
  bus.gain.value = 0.35;
  for (const [freq, q, level] of [
    [600, 4, 1],
    [1300, 6, 0.6],
    [2600, 8, 0.35],
  ] as const) {
    const band = a.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = q;
    const g = a.createGain();
    g.gain.value = level;
    source.connect(band).connect(g).connect(bus);
  }
  bus.connect(out);
  source.start();
  return () => {
    source.stop();
    bus.disconnect();
  };
}

const speechGainFor = (level: number) => (level / 100) ** 2;

export function SoundFixture() {
  const [volume, setVolume] = React.useState(100);
  const [speechLevel, setSpeechLevel] = React.useState(60);
  const [speech, setSpeech] = React.useState(false);
  const [ringing, setRinging] = React.useState<Record<string, boolean>>({});
  const [imported, setImported] = React.useState<string | null>(null);
  const volumeRef = React.useRef(volume);
  volumeRef.current = volume;
  const speechLevelRef = React.useRef(speechLevel);
  speechLevelRef.current = speechLevel;

  const audio = React.useMemo(() => {
    let ctx: AudioContext | null = null;
    const context = () => {
      ctx ??= new AudioContext({ latencyHint: "interactive" });
      return ctx;
    };
    const getSettings = () => ({ ...ALL_ON, soundVolume: volumeRef.current });
    const engines: Record<Column, SoundEngine> = {
      builtin: new SoundEngine({ getSettings, createContext: context }),
      custom: new SoundEngine({
        getSettings,
        createContext: context,
        loadCustomSounds: () => customSoundStorage().list(),
      }),
    };
    const store = createCustomSoundsStore({
      storage: customSoundStorage,
      engine: () => engines.custom,
    });
    return { engines, context, store };
  }, []);

  const custom = audio.store((s) => s.sounds);
  const hasCustom = Object.keys(custom).length > 0;
  React.useEffect(() => {
    void audio.store.getState().load();
  }, [audio]);

  React.useEffect(() => {
    for (const engine of Object.values(audio.engines)) engine.syncVolume();
  }, [audio, volume]);

  const speechGain = React.useRef<GainNode | null>(null);
  React.useEffect(() => {
    if (!speech) return;
    const a = audio.context();
    void a.resume();
    const gain = a.createGain();
    gain.gain.value = speechGainFor(speechLevelRef.current);
    gain.connect(a.destination);
    speechGain.current = gain;
    const stop = startSpeech(a, gain);
    return () => {
      stop();
      gain.disconnect();
      speechGain.current = null;
    };
  }, [audio, speech]);
  React.useEffect(() => {
    if (speechGain.current) {
      speechGain.current.gain.value = speechGainFor(speechLevel);
    }
  }, [speechLevel]);

  React.useEffect(
    () => () => {
      for (const engine of Object.values(audio.engines)) {
        engine.stop("ring");
        engine.stop("outgoingRing");
      }
    },
    [audio],
  );

  const play = async (column: Column, id: SoundId) => {
    const engine = audio.engines[column];
    await engine.customSoundsReady();
    void engine.resume();
    if (!isLoopSound(id)) {
      engine.play(id, { source: column });
      return;
    }
    if (engine.isRinging(id)) engine.stop(id);
    else engine.play(id, { source: column });
    setRinging((prev) => ({
      ...prev,
      [`${column}:${id}`]: engine.isRinging(id),
    }));
  };

  const playAll = (column: Column) => {
    SOUND_IDS.filter((id) => !isLoopSound(id)).forEach((id, i) => {
      window.setTimeout(() => void play(column, id), i * 900);
    });
  };

  const fileInput = React.useRef<HTMLInputElement>(null);
  const columns: Array<{ key: Column; label: string }> = hasCustom
    ? [
        { key: "builtin", label: "Built-in" },
        { key: "custom", label: "Custom" },
      ]
    : [{ key: "builtin", label: "Built-in" }];

  return (
    <div className="min-h-screen bg-ply-0 p-8 text-ink-1">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">UI sounds</h1>
          <p className="text-sm text-ink-2">
            Built-in sounds and, when imported on this device, custom files.
            Same engine as the app: volume taper, rate limits and the limiter
            all apply.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            <span>Sound volume · {volume}%</span>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[volume]}
              aria-label="Sound volume"
              onValueChange={([next]) => {
                if (next !== undefined) setVolume(next);
              }}
            />
          </label>
          <div className="flex flex-col gap-2 text-sm">
            <span>Simulated speech · {speechLevel}%</span>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant={speech ? "primary" : "secondary"}
                aria-pressed={speech}
                onClick={() => setSpeech((on) => !on)}
              >
                {speech ? "Stop speech" : "Play during speech"}
              </Button>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[speechLevel]}
                aria-label="Speech level"
                className="flex-1"
                onValueChange={([next]) => {
                  if (next !== undefined) setSpeechLevel(next);
                }}
              />
            </div>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-3 text-sm">
          <input
            ref={fileInput}
            type="file"
            accept={CUSTOM_SOUND_ACCEPT}
            multiple
            hidden
            onChange={async (event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              const result = await audio.store.getState().importFiles(files);
              setImported(
                [
                  `Imported ${result.imported.length}.`,
                  ...result.failed.map((f) => f.message),
                ].join(" "),
              );
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
          >
            Import custom files
          </Button>
          {hasCustom ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void audio.store.getState().resetAll()}
            >
              Reset all
            </Button>
          ) : null}
          <span role="status" className="text-ink-2">
            {imported}
          </span>
        </section>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-ink-2">
              <th className="py-2 font-medium">Sound</th>
              <th className="py-2 font-medium">File name</th>
              {columns.map((c) => (
                <th key={c.key} className="py-2 font-medium">
                  <div className="flex items-center gap-2">
                    {c.label}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => playAll(c.key)}
                    >
                      Play all
                    </Button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SOUND_IDS.map((id) => (
              <tr key={id} className="border-t border-line">
                <td className="py-2 pr-4">{SOUND_LABELS[id]}</td>
                <td className="py-2 pr-4 font-mono text-xs text-ink-3">
                  {soundFileStem(id)}
                </td>
                {columns.map((c) => {
                  const looping = ringing[`${c.key}:${id}`] ?? false;
                  if (c.key === "custom" && !custom[id]) {
                    return (
                      <td key={c.key} className="py-2 text-ink-3">
                        none
                      </td>
                    );
                  }
                  return (
                    <td key={c.key} className="py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={looping ? "primary" : "secondary"}
                        aria-pressed={isLoopSound(id) ? looping : undefined}
                        onClick={() => void play(c.key, id)}
                      >
                        {isLoopSound(id) ? (looping ? "Stop" : "Ring") : "Play"}
                      </Button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
