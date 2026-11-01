// ============================================================================
// Sound Effects Engine — Web Audio API
//
// Every UI sound goes through `SoundEngine.play`, the single gate: the master
// switch and the sound's category toggle, the volume setting, a per-group rate
// limit and voice cap. Output runs through one master gain (the volume) and a
// gentle limiter before the speakers.
//
// Sounds are small pre-rendered files (see scripts/sounds/render.mjs) fetched
// and decoded once into AudioBuffers. Until a buffer is ready the engine falls
// back to the oscillator versions in `sound-synth.ts`. Rings loop a buffer on
// the AudioContext clock, so background-tab timer throttling can't stutter
// them.
// ============================================================================

import {
  SOUND_IDS,
  SOUND_SPECS,
  type SoundId,
  type SoundSpec,
} from "@/lib/sound-catalog";
import { playSynth, renderSynthLoop } from "@/lib/sound-synth";
import {
  useSoundSettingsStore,
  type SoundSettings,
} from "@/stores/useSoundSettingsStore";

export type { SoundId } from "@/lib/sound-catalog";

export type SoundFormat = "webm" | "mp3";

type LoopId = "ring" | "outgoingRing";

export interface SoundEngineOptions {
  /** URL of the rendered file for a sound, or null to always use the synth. */
  resolveUrl: (id: SoundId, format: SoundFormat) => string | null;
  getSettings: (userId?: string) => SoundSettings;
  createContext?: () => AudioContext;
  fetch?: (url: string) => Promise<Response>;
  /** Milliseconds, for the rate limit. */
  now?: () => number;
  random?: () => number;
  canPlayType?: (mime: string) => string;
}

export interface PlayOptions {
  /** Settings owner when it isn't the store's current user (room guests). */
  userId?: string;
  /** Skip the on/off toggles but keep the volume (settings "Play" buttons). */
  bypassToggles?: boolean;
}

interface Voice {
  gain: GainNode;
  source: AudioScheduledSourceNode | null;
  endsAt: number;
}

/** Fade applied when a voice is stolen or a ring stops (seconds). */
const RELEASE = 0.06;

/** Perceptual taper for the 0-100 volume setting. */
export function volumeToGain(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  const v = Math.max(0, Math.min(100, volume)) / 100;
  return v * v;
}

function defaultCreateContext(): AudioContext {
  return new AudioContext({ latencyHint: "interactive" });
}

function defaultCanPlayType(mime: string): string {
  if (typeof document === "undefined") return "";
  return document.createElement("audio").canPlayType(mime);
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundId, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private loaded = false;
  private readonly lastStart = new Map<string, number>();
  private readonly voices = new Map<string, Voice[]>();
  private readonly loops = new Map<LoopId, Voice>();
  private readonly pendingLoops = new Set<LoopId>();
  private interactionCallback: (() => void) | null = null;
  private readonly opts: Required<SoundEngineOptions>;

  constructor(options: SoundEngineOptions) {
    this.opts = {
      createContext: defaultCreateContext,
      fetch: (url) => fetch(url),
      now: () => Date.now(),
      random: Math.random,
      canPlayType: defaultCanPlayType,
      ...options,
    };
  }

  onInteractionNeeded(cb: (() => void) | null) {
    this.interactionCallback = cb;
  }

  isSuspended(): boolean {
    return this.ctx?.state === "suspended";
  }

  /** Resume after a user gesture; also starts loading the sound files. */
  resume(): Promise<void> {
    const a = this.context(false);
    if (!a) return Promise.resolve();
    return a.resume();
  }

  /** Fetch and decode every sound file once. Safe to call repeatedly. */
  preload(): Promise<void> {
    const a = this.context(false);
    if (!a) return Promise.resolve();
    if (this.loading) return this.loading;
    const format: SoundFormat = this.opts.canPlayType(
      'audio/webm; codecs="opus"',
    )
      ? "webm"
      : "mp3";
    this.loading = Promise.all(
      SOUND_IDS.map(async (id) => {
        const url = this.opts.resolveUrl(id, format);
        if (!url) return;
        try {
          const res = await this.opts.fetch(url);
          if (!res.ok) return;
          const buffer = await a.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(id, buffer);
          if (id === "ring" || id === "outgoingRing") this.startLoop(id);
        } catch {
          // Keep the synth fallback for this sound.
        }
      }),
    ).then(() => {
      this.loaded = true;
      // Rings whose file never arrived loop the synth version instead.
      for (const id of this.pendingLoops) this.startLoop(id, true);
    });
    return this.loading;
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

    if (spec.loopSeconds !== undefined) {
      return this.ring(id as LoopId, volume);
    }

    const now = this.opts.now();
    const last = this.lastStart.get(spec.group);
    if (last !== undefined && now - last < spec.minIntervalMs) return false;

    const a = this.context(true);
    if (!a || !this.master) return false;
    this.lastStart.set(spec.group, now);
    this.setMasterGain(volume);
    this.claimVoice(a, spec);

    const voice = this.startVoice(a, id, spec);
    const pool = this.voices.get(spec.group) ?? [];
    pool.push(voice);
    this.voices.set(spec.group, pool);
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
      // A gentle peak limiter, not a compressor: our files peak at -1 dBTP and
      // sit far below the threshold, so this only catches overlapping sounds.
      // Web Audio adds automatic makeup gain (~+1.7 dB with these numbers), so
      // the effective ceiling lands near -1 dBFS.
      limiter.threshold.value = -3;
      limiter.knee.value = 1;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      limiter.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.connect(limiter);
      this.buffers.clear();
      this.loading = null;
      this.loaded = false;
      this.voices.clear();
      this.loops.clear();
      void this.preload();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
      if (notify) this.interactionCallback?.();
    }
    return this.ctx;
  }

  private setMasterGain(volume: number) {
    if (!this.master || !this.ctx) return;
    const param = this.master.gain;
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setTargetAtTime(volume, this.ctx.currentTime, 0.01);
  }

  private claimVoice(a: AudioContext, spec: SoundSpec) {
    const pool = (this.voices.get(spec.group) ?? []).filter(
      (v) => v.endsAt > a.currentTime,
    );
    while (pool.length >= spec.maxVoices) {
      const oldest = pool.shift();
      if (oldest) this.release(oldest, a.currentTime);
    }
    this.voices.set(spec.group, pool);
  }

  private startVoice(a: AudioContext, id: SoundId, spec: SoundSpec): Voice {
    const gain = a.createGain();
    gain.connect(this.master as GainNode);
    const when = a.currentTime;
    const buffer = this.buffers.get(id);
    let level = 1;
    if (spec.variance) {
      level = Math.pow(10, (this.spread() * spec.variance.db) / 20);
    }
    gain.gain.value = level;

    if (!buffer) {
      playSynth(id, a, gain, when);
      return { gain, source: null, endsAt: when + 0.6 };
    }
    const source = a.createBufferSource();
    source.buffer = buffer;
    if (spec.variance)
      source.detune.value = this.spread() * spec.variance.cents;
    source.connect(gain);
    source.start(when);
    source.onended = () => gain.disconnect();
    return { gain, source, endsAt: when + buffer.duration };
  }

  private ring(id: LoopId, volume: number): boolean {
    if (this.isRinging(id)) return true;
    const a = this.context(true);
    if (!a) return false;
    this.setMasterGain(volume);
    this.pendingLoops.add(id);
    if (this.buffers.has(id)) this.startLoop(id);
    else if (this.loaded) this.startLoop(id, true);
    else void this.preload();
    return true;
  }

  private startLoop(id: LoopId, synth = false) {
    const a = this.ctx;
    if (!a || !this.master || !this.pendingLoops.has(id)) return;
    this.pendingLoops.delete(id);
    const buffer = synth ? renderSynthLoop(id, a) : this.buffers.get(id);
    if (!buffer) return;
    const period = SOUND_SPECS[id].loopSeconds ?? buffer.duration;
    const gain = a.createGain();
    gain.connect(this.master);
    const source = a.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = Math.min(period, buffer.duration);
    source.connect(gain);
    source.start(a.currentTime);
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

  /** Uniform in [-1, 1]. */
  private spread(): number {
    return this.opts.random() * 2 - 1;
  }
}

// ── App singleton ───────────────────────────────────────────────────────────

const engine = new SoundEngine({
  resolveUrl: () => null,
  getSettings: (userId) => useSoundSettingsStore.getState().getSettings(userId),
});

useSoundSettingsStore.subscribe(() => engine.syncVolume());

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
