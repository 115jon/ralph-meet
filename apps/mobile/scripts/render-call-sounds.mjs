// Renders the call's short sounds to assets/sounds/*.wav, from the same
// oscillator recipes the web synthesizes with WebAudio: the join and leave
// tones (src/lib/sound-synth.ts voiceJoin / voiceLeave) and the soundboard's
// four default sounds (src/lib/voice/soundboard.ts). The phone plays them as
// files on the call's audio route (ralph-call's playSound).
//
//   node apps/mobile/scripts/render-call-sounds.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 22_050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../assets/sounds");

/** The web plays tones at 0.12 on a desktop; a phone's call stream is quieter. */
const TONE_LEVEL = 0.25;
/** Soundboard defaults at full scale; the event's volume scales playback. */
const DEFAULT_LEVEL = 0.9;

function wave(type, phase) {
  if (type === "triangle") {
    const t = phase - Math.floor(phase);
    return 4 * Math.abs(t - 0.5) - 1;
  }
  return Math.sin(2 * Math.PI * phase);
}

/** WebAudio's exponentialRampToValueAtTime between (t0, v0) and (t1, v1). */
function expRamp(t, t0, v0, t1, v1) {
  if (t <= t0) return v0;
  if (t >= t1) return v1;
  return v0 * (v1 / v0) ** ((t - t0) / (t1 - t0));
}

/** sound-synth.ts tone(): 10 ms attack, exponential decay to 0.001. */
function tone(samples, freq, duration, level, delay) {
  const start = Math.round(delay * RATE);
  const length = Math.round((duration + 0.05) * RATE);
  for (let i = 0; i < length && start + i < samples.length; i++) {
    const t = i / RATE;
    const gain =
      t < 0.01
        ? (t / 0.01) * level
        : expRamp(t, 0.01, level, duration, 0.001 * (level / 0.12));
    samples[start + i] += gain * wave("sine", freq * t);
  }
}

/** soundboard.ts playDefaultSound(): one oscillator, decaying from the start. */
function single(samples, freq, duration, type) {
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    if (t > duration) break;
    const gain = expRamp(t, 0, DEFAULT_LEVEL, duration, 0.001);
    samples[i] += gain * wave(type, freq * t);
  }
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => {
    const clamped = Math.max(-1, Math.min(1, value));
    data.writeInt16LE(Math.round(clamped * 32_767), i * 2);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function render(name, seconds, draw) {
  const samples = new Float64Array(Math.ceil(seconds * RATE));
  draw(samples);
  writeFileSync(join(OUT, `${name}.wav`), wav(samples));
}

mkdirSync(OUT, { recursive: true });

// twoTone(f1, f2, dur 0.08, gap 0.06, vol 0.12)
render("voice-join", 0.32, (s) => {
  tone(s, 880, 0.08, TONE_LEVEL, 0);
  tone(s, 1175, 0.08, TONE_LEVEL, 0.14);
});
render("voice-leave", 0.32, (s) => {
  tone(s, 1175, 0.08, TONE_LEVEL, 0);
  tone(s, 880, 0.08, TONE_LEVEL, 0.14);
});

for (const [id, freq, duration, type] of [
  ["ping", 880, 0.18, "sine"],
  ["pop", 520, 0.14, "triangle"],
  ["chime", 660, 0.32, "sine"],
  ["tada", 740, 0.42, "sine"],
]) {
  render(`soundboard-${id}`, duration + 0.02, (s) =>
    single(s, freq, duration, type),
  );
}
