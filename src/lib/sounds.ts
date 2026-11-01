// ============================================================================
// Sound Effects Engine — Web Audio API
//
// Every UI sound goes through `SoundEngine.play`, the single gate: the master
// switch and the sound's category toggle, the volume setting, a per-group rate
// limit and voice cap. The volume setting is one gain stage. Built-in sounds
// go from it straight to the speakers, so at 100% they are the same signal
// they always were; imported custom files also pass a peak limiter.
//
// The built-in sounds are the oscillator recipes in `sound-synth.ts`. With the
// experimental custom-sounds setting on, files imported on this device
// (`custom-sounds.ts`) are decoded once into AudioBuffers and play instead;
// any sound without one keeps its built-in version. Rings loop a buffer on the
// AudioContext clock, so background-tab timer throttling can't stutter them.
// ============================================================================

import { isLoopSound, SOUND_SPECS, type SoundId } from "@/lib/sound-catalog";
import { playSynth, renderSynthLoop } from "@/lib/sound-synth";
import {
  createIdbCustomSoundStorage,
  type CustomSoundStorage,
} from "@/lib/custom-sounds";
import {
  useSoundSettingsStore,
  type SoundSettings,
} from "@/stores/useSoundSettingsStore";

export type { SoundId } from "@/lib/sound-catalog";

type LoopId = "ring" | "outgoingRing";

export interface SoundEngineOptions {
  getSettings: (userId?: string) => SoundSettings;
  /** Imported files to decode once the AudioContext exists. */
  loadCustomSounds?: () => Promise<Array<{ id: SoundId; bytes: ArrayBuffer }>>;
  createContext?: () => AudioContext;
  /** Milliseconds, for the rate limit. */
  now?: () => number;
  /** Renders one cycle of a built-in ring for looping. */
  renderLoop?: (
    id: LoopId,
    period: number,
    sampleRate: number,
  ) => Promise<AudioBuffer>;
}

export interface PlayOptions {
  /** Settings owner when it isn't the store's current user (room guests). */
  userId?: string;
  /** Skip the on/off toggles but keep the volume (settings "Play" buttons). */
  bypassToggles?: boolean;
  /**
   * Which version to play. "auto" (default) follows the custom-sounds
   * setting; previews pick one explicitly. A missing custom file always
   * falls back to the built-in sound.
   */
  source?: "auto" | "builtin" | "custom";
  /** Play a ring's cycle once instead of looping (previews). */
  once?: boolean;
}

/** A ring buffer, where its loop ends, and which output stage it takes. */
interface Loop {
  buffer: AudioBuffer;
  end: number;
  custom: boolean;
}

interface Voice {
  gain: GainNode;
  source: AudioScheduledSourceNode | null;
  endsAt: number;
}

/** Fade applied when a voice is stolen or a ring stops (seconds). */
const RELEASE = 0.06;

/** Longest built-in one-shot including its tail (notification). */
const SYNTH_LENGTH = 0.6;

/**
 * A fresh DynamicsCompressor attenuates audio for its first ~100 ms (measured
 * in Chromium: -11 dB on a sound at t=0, 0 dB from 0.1 s). Custom files start
 * no earlier than this on a new context.
 */
const LIMITER_WARMUP = 0.12;

/**
 * Peak limiter for custom files, which can be mastered at any level. The
 * built-in sounds peak near -18 dBFS and skip it. Measured in Chromium with
 * the trim below: a 0 dBFS file comes out at -1.8 dBFS, a +6 dB pile-up at
 * -1.3, and anything under the threshold at unity.
 */
export const LIMITER = {
  threshold: -2,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.1,
} as const;

/**
 * Web Audio's compressor applies automatic makeup gain of
 * (1 / fullRangeGain)^0.6, which would lift every file by about 1.1 dB. A
 * trim after it cancels that, so audio below the threshold passes at unity.
 */
export function limiterMakeupTrim(): number {
  const fullRangeDb = LIMITER.threshold - LIMITER.threshold / LIMITER.ratio;
  return Math.pow(10, (0.6 * fullRangeDb) / 20);
}

/** Perceptual taper for the 0-100 volume setting; 100 is unity gain. */
export function volumeToGain(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  const v = Math.max(0, Math.min(100, volume)) / 100;
  return v * v;
}

function defaultCreateContext(): AudioContext {
  return new AudioContext({ latencyHint: "interactive" });
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  /** Volume stage for built-in sounds, straight to the speakers. */
  private master: GainNode | null = null;
  /** Volume stage for custom files, through the limiter. */
  private limited: GainNode | null = null;
  private readonly custom = new Map<SoundId, AudioBuffer>();
  /** Ids set or cleared since the stored files started loading. */
  private readonly customTouched = new Set<SoundId>();
  private customLoad: Promise<void> = Promise.resolve();
  private readonly builtinLoops = new Map<
    LoopId,
    Promise<AudioBuffer | null>
  >();
  private readonly lastStart = new Map<string, number>();
  private readonly voices = new Map<string, Voice[]>();
  private readonly loops = new Map<LoopId, Voice>();
  /** Rings waiting for their buffer, by start token. */
  private readonly pendingLoops = new Map<LoopId, number>();
  private loopToken = 0;
  private interactionCallback: (() => void) | null = null;
  private readonly opts: Required<SoundEngineOptions>;

  constructor(options: SoundEngineOptions) {
    this.opts = {
      createContext: defaultCreateContext,
      now: () => Date.now(),
      loadCustomSounds: async () => [],
      renderLoop: renderSynthLoop,
      ...options,
    };
  }

  onInteractionNeeded(cb: (() => void) | null) {
    this.interactionCallback = cb;
  }

  isSuspended(): boolean {
    return this.ctx?.state === "suspended";
  }

  /** Resume after a user gesture. */
  resume(): Promise<void> {
    const a = this.context(false);
    if (!a) return Promise.resolve();
    return a.resume();
  }

  /** Resolves once the stored custom files have been decoded (or failed). */
  customSoundsReady(): Promise<void> {
    this.context(false);
    return this.customLoad;
  }

  /** Decode an audio file with this engine's context. */
  decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const a = this.context(false);
    if (!a) return Promise.reject(new Error("Web Audio unavailable"));
    return a.decodeAudioData(bytes.slice(0));
  }

  /** Use (or, with null, stop using) an imported file for `id`. */
  async setCustomSound(id: SoundId, bytes: ArrayBuffer | null): Promise<void> {
    this.customTouched.add(id);
    if (!bytes) {
      this.custom.delete(id);
      return;
    }
    this.custom.set(id, await this.decode(bytes));
  }

  clearCustomSounds() {
    for (const id of this.custom.keys()) this.customTouched.add(id);
    this.custom.clear();
  }

  hasCustomSound(id: SoundId): boolean {
    return this.custom.has(id);
  }

  /**
   * Play a sound if its settings allow it. Returns whether it started (or, for
   * rings, is now ringing).
   */
  play(id: SoundId, options: PlayOptions = {}): boolean {
    const spec = SOUND_SPECS[id];
    const settings = this.opts.getSettings(options.userId);
    if (
      !options.bypassToggles &&
      !(settings.soundsEnabled && settings[spec.category])
    ) {
      return false;
    }
    const volume = volumeToGain(settings.soundVolume);
    if (volume <= 0) return false;
    const custom =
      options.source === "custom" ||
      ((options.source ?? "auto") === "auto" && settings.customSounds);

    if (isLoopSound(id) && !options.once) {
      return this.ring(id, volume, custom);
    }

    const group = options.once ? `preview:${spec.group}` : spec.group;
    const now = this.opts.now();
    const last = this.lastStart.get(group);
    if (last !== undefined && now - last < spec.minIntervalMs) return false;

    const a = this.context(true);
    if (!a || !this.master) return false;
    this.lastStart.set(group, now);
    this.setMasterGain(volume);

    const pool = (this.voices.get(group) ?? []).filter(
      (v) => v.endsAt > a.currentTime,
    );
    while (pool.length >= spec.maxVoices) {
      const oldest = pool.shift();
      if (oldest) this.release(oldest, a.currentTime);
    }
    pool.push(this.startVoice(a, id, custom));
    this.voices.set(group, pool);
    return true;
  }

  /** Stop a ring with a short fade. Never gated. */
  stop(id: LoopId) {
    this.pendingLoops.delete(id);
    const voice = this.loops.get(id);
    if (!voice || !this.ctx) return;
    this.loops.delete(id);
    this.release(voice, this.ctx.currentTime);
  }

  isRinging(id: LoopId): boolean {
    return this.loops.has(id) || this.pendingLoops.has(id);
  }

  /** Apply a volume change to sounds already playing (rings). */
  syncVolume(userId?: string) {
    if (!this.master) return;
    this.setMasterGain(volumeToGain(this.opts.getSettings(userId).soundVolume));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private context(notify: boolean): AudioContext | null {
    if (!this.ctx || this.ctx.state === "closed") {
      try {
        this.ctx = this.opts.createContext();
      } catch {
        return null;
      }
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = LIMITER.threshold;
      limiter.knee.value = LIMITER.knee;
      limiter.ratio.value = LIMITER.ratio;
      limiter.attack.value = LIMITER.attack;
      limiter.release.value = LIMITER.release;
      const trim = this.ctx.createGain();
      trim.gain.value = limiterMakeupTrim();
      limiter.connect(trim).connect(this.ctx.destination);
      this.limited = this.ctx.createGain();
      this.limited.connect(limiter);
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.custom.clear();
      this.customTouched.clear();
      this.builtinLoops.clear();
      this.voices.clear();
      this.loops.clear();
      this.customLoad = this.loadCustom(this.ctx);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
      if (notify) this.interactionCallback?.();
    }
    return this.ctx;
  }

  private async loadCustom(a: AudioContext): Promise<void> {
    let stored: Array<{ id: SoundId; bytes: ArrayBuffer }>;
    try {
      stored = await this.opts.loadCustomSounds();
    } catch {
      return;
    }
    await Promise.all(
      stored.map(async ({ id, bytes }) => {
        try {
          const buffer = await a.decodeAudioData(bytes.slice(0));
          if (!this.customTouched.has(id)) this.custom.set(id, buffer);
        } catch {
          // Undecodable here: the built-in sound plays instead.
        }
      }),
    );
  }

  private setMasterGain(volume: number) {
    if (!this.ctx) return;
    for (const stage of [this.master, this.limited]) {
      if (!stage) continue;
      stage.gain.cancelScheduledValues(this.ctx.currentTime);
      stage.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01);
    }
  }

  private startVoice(a: AudioContext, id: SoundId, custom: boolean): Voice {
    const gain = a.createGain();
    const buffer = custom ? this.custom.get(id) : undefined;
    if (!buffer) {
      const when = a.currentTime;
      gain.connect(this.master as GainNode);
      playSynth(id, a, gain, when);
      return { gain, source: null, endsAt: when + SYNTH_LENGTH };
    }
    const when = Math.max(a.currentTime, LIMITER_WARMUP);
    gain.connect(this.limited as GainNode);
    const source = a.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(when);
    source.onended = () => gain.disconnect();
    return { gain, source, endsAt: when + buffer.duration };
  }

  private ring(id: LoopId, volume: number, custom: boolean): boolean {
    if (this.isRinging(id)) return true;
    const a = this.context(true);
    if (!a) return false;
    this.setMasterGain(volume);
    const token = ++this.loopToken;
    this.pendingLoops.set(id, token);
    void this.loopBuffer(a, id, custom).then((loop) => {
      if (this.pendingLoops.get(id) !== token || this.ctx !== a) return;
      this.pendingLoops.delete(id);
      if (loop) this.startLoop(a, id, loop);
    });
    return true;
  }

  private async loopBuffer(
    a: AudioContext,
    id: LoopId,
    custom: boolean,
  ): Promise<Loop | null> {
    if (custom) {
      await this.customLoad;
      const file = this.custom.get(id);
      // A custom ring loops the whole file.
      if (file) return { buffer: file, end: file.duration, custom: true };
    }
    const period = SOUND_SPECS[id].loopSeconds ?? 0;
    let render = this.builtinLoops.get(id);
    if (!render) {
      render = this.opts.renderLoop(id, period, a.sampleRate).catch(() => null);
      this.builtinLoops.set(id, render);
    }
    const buffer = await render;
    return buffer ? { buffer, end: period, custom: false } : null;
  }

  private startLoop(a: AudioContext, id: LoopId, loop: Loop) {
    const stage = loop.custom ? this.limited : this.master;
    if (!stage) return;
    const gain = a.createGain();
    gain.connect(stage);
    const source = a.createBufferSource();
    source.buffer = loop.buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = Math.min(loop.end, loop.buffer.duration);
    source.connect(gain);
    source.start(
      loop.custom ? Math.max(a.currentTime, LIMITER_WARMUP) : a.currentTime,
    );
    source.onended = () => gain.disconnect();
    this.loops.set(id, { gain, source, endsAt: Number.POSITIVE_INFINITY });
  }

  private release(voice: Voice, at: number) {
    const param = voice.gain.gain;
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
    param.linearRampToValueAtTime(0, at + RELEASE);
    voice.source?.stop(at + RELEASE + 0.01);
    voice.endsAt = at;
  }
}

// ── App singleton ───────────────────────────────────────────────────────────

let storage: CustomSoundStorage | null = null;

/** This device's imported custom-sound files (IndexedDB). */
export function customSoundStorage(): CustomSoundStorage {
  storage ??= createIdbCustomSoundStorage();
  return storage;
}

const engine = new SoundEngine({
  getSettings: (userId) => useSoundSettingsStore.getState().getSettings(userId),
  loadCustomSounds: () => customSoundStorage().list(),
});

useSoundSettingsStore.subscribe(() => engine.syncVolume());

/** The app's sound engine (settings import and previews use it directly). */
export function soundEngine(): SoundEngine {
  return engine;
}

/** Play any UI sound through the settings gate. */
export function playSound(id: SoundId, options?: PlayOptions): boolean {
  return engine.play(id, options);
}

/** Check if the sound AudioContext is suspended (needs user interaction) */
export function isSoundContextSuspended(): boolean {
  return engine.isSuspended();
}

/** Resume the sound AudioContext after a user gesture */
export function resumeSoundContext(): Promise<void> {
  return engine.resume();
}

/**
 * Register a callback fired when a sound tries to play but the AudioContext
 * is suspended. Use this to show an "Interaction Required" popup.
 */
export function onSoundInteractionNeeded(cb: (() => void) | null) {
  engine.onInteractionNeeded(cb);
}

// ── Public Sound Effects ────────────────────────────────────────────────────
// Each is gated by its settings toggle; callers don't check settings.

/** Someone joined the voice channel you're in */
export const playVoiceJoin = (o?: PlayOptions) =>
  void playSound("voiceJoin", o);
/** Someone left the voice channel you're in */
export const playVoiceLeave = (o?: PlayOptions) =>
  void playSound("voiceLeave", o);
/** Microphone muted */
export const playMute = (o?: PlayOptions) => void playSound("mute", o);
/** Microphone unmuted */
export const playUnmute = (o?: PlayOptions) => void playSound("unmute", o);
/** Deafened */
export const playDeafen = (o?: PlayOptions) => void playSound("deafen", o);
/** Undeafened */
export const playUndeafen = (o?: PlayOptions) => void playSound("undeafen", o);
/** New notification (mention, reply, DM) */
export const playNotification = (o?: PlayOptions) =>
  void playSound("notification", o);
/** New message in the current channel */
export const playMessageReceived = (o?: PlayOptions) =>
  void playSound("message", o);
/** You connected to voice */
export const playConnected = (o?: PlayOptions) => void playSound("connect", o);
/** You disconnected from voice */
export const playDisconnect = (o?: PlayOptions) =>
  void playSound("disconnect", o);
/** Screen share started */
export const playScreenShareStart = (o?: PlayOptions) =>
  void playSound("screenShareStart", o);
/** Screen share stopped */
export const playScreenShareStop = (o?: PlayOptions) =>
  void playSound("screenShareStop", o);
/** A viewer started watching your stream */
export const playStreamWatcherStart = (o?: PlayOptions) =>
  void playSound("streamWatcherStart", o);
/** A viewer stopped watching your stream */
export const playStreamWatcherStop = (o?: PlayOptions) =>
  void playSound("streamWatcherStop", o);
/** Call connected */
export const playCallConnect = (o?: PlayOptions) =>
  void playSound("callConnect", o);
/** Call ended */
export const playCallEnd = (o?: PlayOptions) => void playSound("callEnd", o);

// ── Rings ───────────────────────────────────────────────────────────────────

/** Incoming call ring; loops until playRingStop. */
export function playRingStart() {
  playSound("ring");
}

export function playRingStop() {
  engine.stop("ring");
}

/** Outgoing ring the caller hears while waiting; loops until stopped. */
export function playOutgoingRingStart() {
  playSound("outgoingRing");
}

export function playOutgoingRingStop() {
  engine.stop("outgoingRing");
}
