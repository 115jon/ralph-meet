// ============================================================================
// Built-in UI sounds
//
// The oscillator recipes Ralph Meet has always played, unchanged in timbre,
// pitch and timing. The only difference from the original code is where they
// are scheduled: every note starts from `when` on the AudioContext clock (no
// timers) and plays into `out` (the engine's master bus) instead of straight
// to the speakers. `sound-synth.test.ts` pins every parameter.
// ============================================================================

import type { SoundId } from "./sound-catalog";

type Synth = (a: BaseAudioContext, out: AudioNode, when: number) => void;

/** Play a tone burst: freq (Hz), duration (s), volume 0-1, type */
function tone(
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
  freq: number,
  duration: number,
  volume = 0.15,
  type: OscillatorType = "sine",
  delay = 0,
) {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when + delay);

  const g = a.createGain();
  g.gain.setValueAtTime(0, when + delay);
  // Quick attack
  g.gain.linearRampToValueAtTime(volume, when + delay + 0.01);
  // Smooth decay
  g.gain.exponentialRampToValueAtTime(0.001, when + delay + duration);

  osc.connect(g).connect(out);
  osc.start(when + delay);
  osc.stop(when + delay + duration + 0.05);
}

/** Play two tones in sequence (ascending = join-like, descending = leave-like) */
function twoTone(
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
  f1: number,
  f2: number,
  dur = 0.1,
  gap = 0.08,
  volume = 0.12,
) {
  tone(a, out, when, f1, dur, volume, "sine", 0);
  tone(a, out, when, f2, dur, volume, "sine", dur + gap);
}

/** Short click/pop for mute/unmute */
function clickPop(
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
  freq: number,
  volume = 0.1,
) {
  const osc = a.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, when + 0.06);

  const g = a.createGain();
  g.gain.setValueAtTime(volume, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);

  osc.connect(g).connect(out);
  osc.start(when);
  osc.stop(when + 0.08);
}

/** Soft chime for notifications (richer timbre using harmonics) */
function chime(
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
  baseFreq: number,
  duration = 0.4,
  volume = 0.08,
) {
  // Fundamental
  const osc1 = a.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = baseFreq;

  // Octave harmonic (soft)
  const osc2 = a.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = baseFreq * 2;

  // Fifth harmonic (very soft)
  const osc3 = a.createOscillator();
  osc3.type = "sine";
  osc3.frequency.value = baseFreq * 1.5;

  const master = a.createGain();
  master.gain.setValueAtTime(volume, when);
  master.gain.exponentialRampToValueAtTime(0.001, when + duration);

  const g1 = a.createGain();
  g1.gain.value = 1.0;
  const g2 = a.createGain();
  g2.gain.value = 0.3;
  const g3 = a.createGain();
  g3.gain.value = 0.15;

  osc1.connect(g1).connect(master);
  osc2.connect(g2).connect(master);
  osc3.connect(g3).connect(master);
  master.connect(out);

  osc1.start(when);
  osc2.start(when);
  osc3.start(when);
  osc1.stop(when + duration + 0.05);
  osc2.stop(when + duration + 0.05);
  osc3.stop(when + duration + 0.05);
}

/** A sine glide with an instant attack (message knock, disconnect). */
function glide(
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
  from: number,
  to: number,
  glideEnd: number,
  volume: number,
  decayEnd: number,
  stopAt: number,
) {
  const osc = a.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, when);
  osc.frequency.exponentialRampToValueAtTime(to, when + glideEnd);

  const g = a.createGain();
  g.gain.setValueAtTime(volume, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + decayEnd);

  osc.connect(g).connect(out);
  osc.start(when);
  osc.stop(when + stopAt);
}

const SYNTHS: Record<SoundId, Synth> = {
  // Discord-style ascending two-tone: someone joined voice
  voiceJoin: (a, o, t) => twoTone(a, o, t, 880, 1175, 0.08, 0.06, 0.12),
  // Descending two-tone: someone left voice
  voiceLeave: (a, o, t) => twoTone(a, o, t, 1175, 880, 0.08, 0.06, 0.12),
  mute: (a, o, t) => clickPop(a, o, t, 400, 0.12),
  unmute: (a, o, t) => clickPop(a, o, t, 600, 0.12),
  deafen: (a, o, t) => clickPop(a, o, t, 300, 0.14),
  undeafen: (a, o, t) => clickPop(a, o, t, 700, 0.12),
  notification: (a, o, t) => {
    chime(a, o, t, 1047, 0.35, 0.1); // C6
    chime(a, o, t + 0.12, 1319, 0.3, 0.07); // E6
  },
  // Subtle knock: new message in current channel
  message: (a, o, t) => glide(a, o, t, 800, 600, 0.05, 0.06, 0.08, 0.1),
  // Three-tone connection chime
  connect: (a, o, t) => {
    tone(a, o, t, 523, 0.1, 0.1, "sine", 0); // C5
    tone(a, o, t, 659, 0.1, 0.1, "sine", 0.1); // E5
    tone(a, o, t, 784, 0.15, 0.1, "sine", 0.2); // G5
  },
  // Warm disconnect tone, C5 down to E4
  disconnect: (a, o, t) => glide(a, o, t, 523, 330, 0.2, 0.12, 0.25, 0.3),
  // One cycle of the incoming ring (repeats every 2.5 s)
  ring: (a, o, t) => {
    chime(a, o, t, 880, 0.2, 0.08);
    chime(a, o, t + 0.2, 1047, 0.2, 0.08);
    chime(a, o, t + 0.4, 880, 0.2, 0.06);
  },
  // One cycle of the outgoing double-beep (repeats every 3 s)
  outgoingRing: (a, o, t) => {
    tone(a, o, t, 440, 0.3, 0.06, "sine", 0);
    tone(a, o, t, 440, 0.3, 0.06, "sine", 0.5);
  },
  callConnect: (a, o, t) => {
    tone(a, o, t, 523, 0.08, 0.1, "sine", 0); // C5
    tone(a, o, t, 659, 0.08, 0.1, "sine", 0.09); // E5
    tone(a, o, t, 880, 0.15, 0.1, "sine", 0.18); // A5
  },
  callEnd: (a, o, t) => {
    tone(a, o, t, 660, 0.12, 0.1, "sine", 0);
    tone(a, o, t, 440, 0.18, 0.1, "sine", 0.14);
  },
  screenShareStart: (a, o, t) => {
    tone(a, o, t, 660, 0.08, 0.08, "sine", 0);
    tone(a, o, t, 880, 0.12, 0.08, "sine", 0.1);
  },
  screenShareStop: (a, o, t) => {
    tone(a, o, t, 880, 0.08, 0.08, "sine", 0);
    tone(a, o, t, 660, 0.12, 0.08, "sine", 0.1);
  },
  streamWatcherStart: (a, o, t) => {
    tone(a, o, t, 740, 0.07, 0.07, "triangle", 0);
    tone(a, o, t, 988, 0.09, 0.06, "sine", 0.06);
    tone(a, o, t, 1245, 0.12, 0.05, "triangle", 0.14);
  },
  streamWatcherStop: (a, o, t) => {
    tone(a, o, t, 1245, 0.08, 0.06, "triangle", 0);
    tone(a, o, t, 880, 0.08, 0.05, "sine", 0.07);
    tone(a, o, t, 659, 0.12, 0.05, "triangle", 0.14);
  },
};

/** Schedule the built-in version of `id` into `out`, starting at `when`. */
export function playSynth(
  id: SoundId,
  a: BaseAudioContext,
  out: AudioNode,
  when: number,
): void {
  SYNTHS[id](a, out, when);
}

/**
 * Render one cycle of a built-in ring (`period` seconds, silence after the
 * notes) with the same recipe, so the engine can loop it on the audio clock.
 */
export function renderSynthLoop(
  id: "ring" | "outgoingRing",
  period: number,
  sampleRate: number,
): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(
    1,
    Math.round(period * sampleRate),
    sampleRate,
  );
  playSynth(id, offline, offline.destination, 0);
  return offline.startRendering();
}
