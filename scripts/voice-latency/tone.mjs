// Writes the fake-microphone WAV: 12 s of speech-like sound, mono 48 kHz.
// A voiced buzz (f0 gliding 110-230 Hz, harmonics at 1/n) under a syllable
// envelope (about 4 per second, never fully silent). A steady tone would be
// learned as background noise by the app's noise gate within seconds and
// gated to silence; this keeps the gate open like a talking person, so
// "first audible" on the other side is well defined. Chromium loops it.
import fs from "node:fs";

export const TONE_FILE_NAME = "ralph-voice-bench-speech-v1.wav";

export function writeToneWav(
  file,
  { seconds = 12, rate = 48_000, gain = 0.3 } = {},
) {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const f0 =
      170 +
      60 * Math.sin(2 * Math.PI * 0.7 * t) +
      15 * Math.sin(2 * Math.PI * 3.1 * t);
    phase += (2 * Math.PI * f0) / rate;
    let voiced = 0;
    for (let n = 1; n <= 12; n++) voiced += Math.sin(n * phase) / n;
    const syllable =
      0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 2.1 * t + Math.sin(t)));
    const value = Math.max(-1, Math.min(1, (voiced / 2) * syllable * gain));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buffer);
}
