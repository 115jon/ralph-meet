// ============================================================================
// Oscillator fallback for UI sounds
//
// The original live-synthesised sounds, kept as the fallback the engine plays
// while the designed buffers are still loading (or failed to load), and as the
// "old" column of the dev sound preview. Every note is scheduled on the
// AudioContext clock from `when`, so nothing here uses timers.
// ============================================================================

import type { SoundId } from "./sound-catalog";

type Synth = (a: BaseAudioContext, out: AudioNode, when: number) => void;

function tone(
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
  freq: number,
  duration: number,
  volume = 0.15,
  type: OscillatorType = "sine",
) {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  const g = a.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(volume, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, when + duration);
  osc.connect(g).connect(out);
  osc.start(when);
  osc.stop(when + duration + 0.05);
}

function glide(
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
  from: number,
  to: number,
  duration: number,
  volume: number,
) {
  const osc = a.createOscillator();
  osc.frequency.setValueAtTime(from, when);
  osc.frequency.exponentialRampToValueAtTime(to, when + duration * 0.8);
  const g = a.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(volume, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, when + duration);
  osc.connect(g).connect(out);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

function chime(
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
  freq: number,
  duration: number,
  volume: number,
) {
  for (const [ratio, level] of [
    [1, 1],
    [2, 0.3],
    [1.5, 0.15],
  ] as const) {
    tone(a, out, when, freq * ratio, duration, volume * level);
  }
}

const SYNTHS: Record<SoundId, Synth> = {
  voiceJoin: (a, o, t) => {
    tone(a, o, t, 880, 0.08, 0.12);
    tone(a, o, t + 0.14, 1175, 0.08, 0.12);
  },
  voiceLeave: (a, o, t) => {
    tone(a, o, t, 1175, 0.08, 0.12);
    tone(a, o, t + 0.14, 880, 0.08, 0.12);
  },
  mute: (a, o, t) => glide(a, o, t, 400, 200, 0.06, 0.12),
  unmute: (a, o, t) => glide(a, o, t, 600, 300, 0.06, 0.12),
  deafen: (a, o, t) => glide(a, o, t, 300, 150, 0.06, 0.14),
  undeafen: (a, o, t) => glide(a, o, t, 700, 350, 0.06, 0.12),
  notification: (a, o, t) => {
    chime(a, o, t, 1047, 0.35, 0.1);
    chime(a, o, t + 0.12, 1319, 0.3, 0.07);
  },
  message: (a, o, t) => glide(a, o, t, 800, 600, 0.08, 0.06),
  connect: (a, o, t) => {
    tone(a, o, t, 523, 0.1, 0.1);
    tone(a, o, t + 0.1, 659, 0.1, 0.1);
    tone(a, o, t + 0.2, 784, 0.15, 0.1);
  },
  disconnect: (a, o, t) => glide(a, o, t, 523, 330, 0.25, 0.12),
  ring: (a, o, t) => {
    chime(a, o, t, 880, 0.2, 0.08);
    chime(a, o, t + 0.2, 1047, 0.2, 0.08);
    chime(a, o, t + 0.4, 880, 0.2, 0.06);
  },
  outgoingRing: (a, o, t) => {
    tone(a, o, t, 440, 0.3, 0.06);
    tone(a, o, t + 0.5, 440, 0.3, 0.06);
  },
  callConnect: (a, o, t) => {
    tone(a, o, t, 523, 0.08, 0.1);
    tone(a, o, t + 0.09, 659, 0.08, 0.1);
    tone(a, o, t + 0.18, 880, 0.15, 0.1);
  },
  callEnd: (a, o, t) => {
    tone(a, o, t, 660, 0.12, 0.1);
    tone(a, o, t + 0.14, 440, 0.18, 0.1);
  },
  screenShareStart: (a, o, t) => {
    tone(a, o, t, 660, 0.08, 0.08);
    tone(a, o, t + 0.1, 880, 0.12, 0.08);
  },
  screenShareStop: (a, o, t) => {
    tone(a, o, t, 880, 0.08, 0.08);
    tone(a, o, t + 0.1, 660, 0.12, 0.08);
  },
  streamWatcherStart: (a, o, t) => {
    tone(a, o, t, 740, 0.07, 0.07, "triangle");
    tone(a, o, t + 0.06, 988, 0.09, 0.06);
    tone(a, o, t + 0.14, 1245, 0.12, 0.05, "triangle");
  },
  streamWatcherStop: (a, o, t) => {
    tone(a, o, t, 1245, 0.08, 0.06, "triangle");
    tone(a, o, t + 0.07, 880, 0.08, 0.05);
    tone(a, o, t + 0.14, 659, 0.12, 0.05, "triangle");
  },
};

type Note = [time: number, freq: number, duration: number, volume: number];

/** One ring cycle as plain sine chimes: [start, Hz, decay, level]. */
const LOOPS = {
  ring: {
    period: 2.5,
    notes: [
      [0, 880, 0.2, 0.08],
      [0.2, 1047, 0.2, 0.08],
      [0.4, 880, 0.2, 0.06],
    ],
    partials: [
      [1, 1],
      [2, 0.3],
      [1.5, 0.15],
    ],
  },
  outgoingRing: {
    period: 3,
    notes: [
      [0, 440, 0.3, 0.06],
      [0.5, 440, 0.3, 0.06],
    ],
    partials: [[1, 1]],
  },
} satisfies Record<
  "ring" | "outgoingRing",
  { period: number; notes: Note[]; partials: [number, number][] }
>;

/**
 * Render one cycle of a synth ring into a buffer that loops seamlessly, so
 * the fallback ring runs on the audio clock like the designed one.
 */
export function renderSynthLoop(
  id: keyof typeof LOOPS,
  a: BaseAudioContext,
): AudioBuffer {
  const { period, notes, partials } = LOOPS[id];
  const rate = a.sampleRate;
  const buffer = a.createBuffer(1, Math.round(period * rate), rate);
  const data = buffer.getChannelData(0);
  for (const [start, freq, duration, volume] of notes) {
    const first = Math.round(start * rate);
    const length = Math.round((duration + 0.05) * rate);
    for (let i = 0; i < length && first + i < data.length; i++) {
      const t = i / rate;
      const attack = Math.min(1, t / 0.01);
      const env = volume * attack * Math.pow(0.001, t / duration);
      let sum = 0;
      for (const [ratio, level] of partials) {
        sum += level * Math.sin(2 * Math.PI * freq * ratio * t);
      }
      data[first + i] += env * sum;
    }
  }
  return buffer;
}

/** Schedule the oscillator version of `id` into `out`, starting at `when`. */
export function playSynth(
  id: SoundId,
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
): void {
  SYNTHS[id](a, out, when);
}
