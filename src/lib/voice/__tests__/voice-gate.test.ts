import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATE_ATTACK_MS,
  GATE_LOOKAHEAD_MS,
  VAD_SILENCE_DELAY_MS,
  VAD_TICK_MS,
  VAD_WINDOW_SAMPLES,
  VadCore,
  VoiceGateCore,
  windowRms,
} from "../vad-processor.worklet.js";

const RATE = 48_000;
const BLOCK = 128;
const ms = (value: number) => Math.round((value * RATE) / 1000);
const LOOKAHEAD = ms(GATE_LOOKAHEAD_MS);

/**
 * The latency bench's burst: near-silent floor, then a voiced burst with a
 * 6 ms attack (speech onset), then the floor again.
 */
function speechBurst(options: {
  silenceBeforeMs: number;
  speechMs: number;
  silenceAfterMs: number;
}) {
  const onset = ms(options.silenceBeforeMs);
  const end = onset + ms(options.speechMs);
  const total = end + ms(options.silenceAfterMs);
  const signal = new Float32Array(total);
  let seed = 12345;
  const rand = () =>
    ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < total; i++) {
    let value = rand() * 0.0004;
    if (i >= onset && i < end) {
      const t = (i - onset) / RATE;
      const phase = 2 * Math.PI * 135 * t;
      let voiced = 0;
      for (let n = 1; n <= 12; n++) voiced += Math.sin(n * phase) / n;
      const attack = Math.min(1, (i - onset) / ms(6));
      value += (voiced / 2) * attack * 0.35;
    }
    signal[i] = value;
  }
  return { signal, onset, end };
}

function runGate(
  core: VoiceGateCore,
  signal: Float32Array,
  onBlock?: (startFrame: number) => void,
) {
  const output = new Float32Array(signal.length);
  const events: Array<{ type: string; value: boolean; frame: number }> = [];
  for (let start = 0; start < signal.length; start += BLOCK) {
    onBlock?.(start);
    const frames = Math.min(BLOCK, signal.length - start);
    const out = new Float32Array(frames);
    for (const event of core.process(
      [signal.subarray(start, start + frames)],
      [out],
      frames,
      start,
    )) {
      events.push({ type: event.type, value: event.value, frame: start });
    }
    output.set(out, start);
  }
  return { output, events };
}

function energy(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = Math.max(0, from); i < Math.min(data.length, to); i++) {
    sum += data[i]! * data[i]!;
  }
  return sum;
}

function newGate(
  overrides: Partial<ConstructorParameters<typeof VoiceGateCore>[0]> = {},
) {
  return new VoiceGateCore({ sampleRate: RATE, threshold: 3, ...overrides });
}

describe("VoiceGateCore (in-graph outbound gate)", () => {
  it("passes a word's onset intact, delayed by exactly the lookahead", () => {
    const { signal, onset, end } = speechBurst({
      silenceBeforeMs: 1000,
      speechMs: 400,
      silenceAfterMs: 1000,
    });
    const { output } = runGate(newGate(), signal);

    // Silence before the word: closed.
    expect(energy(output, 0, onset)).toBe(0);
    // From the onset on, the output is the input LOOKAHEAD samples later at
    // full gain: nothing of the first 25 / 50 / 100 ms is lost.
    for (let i = onset; i < end; i++) {
      expect(output[i + LOOKAHEAD]).toBe(signal[i]);
    }
    for (const windowMs of [25, 50, 100]) {
      const kept =
        energy(output, onset + LOOKAHEAD, onset + LOOKAHEAD + ms(windowMs)) /
        energy(signal, onset, onset + ms(windowMs));
      expect(kept).toBe(1);
    }
  });

  it("opens with a short attack ramp that finishes before the onset plays", () => {
    const { signal, onset } = speechBurst({
      silenceBeforeMs: 1000,
      speechMs: 200,
      silenceAfterMs: 100,
    });
    const { output } = runGate(newGate(), signal);

    const firstOpen = output.findIndex((sample) => sample !== 0);
    const onsetAtOutput = onset + LOOKAHEAD;
    // The gate starts opening during the pre-roll (before the onset reaches
    // the output) ...
    expect(firstOpen).toBeGreaterThan(0);
    expect(firstOpen).toBeLessThan(onsetAtOutput);
    // ... and ramps up within the attack time, not in one step.
    const rampEnd = firstOpen + ms(GATE_ATTACK_MS);
    expect(rampEnd).toBeLessThanOrEqual(onsetAtOutput);
    const midRamp = firstOpen + Math.floor(ms(GATE_ATTACK_MS) / 2);
    const gainMidRamp = output[midRamp]! / signal[midRamp - LOOKAHEAD]!;
    expect(gainMidRamp).toBeGreaterThan(0.2);
    expect(gainMidRamp).toBeLessThan(0.8);
  });

  it("holds 300 ms past the word on the output, then releases to silence", () => {
    const { signal, end } = speechBurst({
      silenceBeforeMs: 500,
      speechMs: 300,
      silenceAfterMs: 1000,
    });
    const { output, events } = runGate(newGate(), signal);

    // The hangover: everything up to 300 ms after the word still passes.
    for (let i = end; i < end + ms(VAD_SILENCE_DELAY_MS); i++) {
      expect(output[i + LOOKAHEAD]).toBe(signal[i]);
    }
    // Closed once the hangover, the window, one evaluation step and the
    // release fade have passed.
    const closedBy =
      end +
      LOOKAHEAD +
      ms(VAD_SILENCE_DELAY_MS) +
      VAD_WINDOW_SAMPLES +
      BLOCK +
      ms(10) +
      1;
    expect(energy(output, closedBy, output.length)).toBe(0);
    expect(events.map(({ type, value }) => [type, value])).toEqual([
      ["speaking", true],
      ["speaking", false],
    ]);
  });

  it("decides every render quantum, without any message from the main thread", () => {
    const { signal, onset } = speechBurst({
      silenceBeforeMs: 300,
      speechMs: 100,
      silenceAfterMs: 50,
    });
    const { events } = runGate(newGate(), signal);
    const speakingAt = events.find((e) => e.type === "speaking")!.frame;
    // Detected within one window plus one quantum of the onset.
    expect(speakingAt - onset).toBeLessThanOrEqual(VAD_WINDOW_SAMPLES + BLOCK);
  });

  it("closes for mute and opens fully when gating is off", () => {
    const { signal, onset, end } = speechBurst({
      silenceBeforeMs: 200,
      speechMs: 200,
      silenceAfterMs: 50,
    });
    const muted = runGate(newGate({ mode: "closed" }), signal);
    expect(energy(muted.output, 0, muted.output.length)).toBe(0);
    // Detection keeps running while muted (speaking indicator stays honest).
    expect(muted.events[0]).toMatchObject({ type: "speaking", value: true });

    const open = runGate(newGate({ mode: "open" }), signal);
    for (let i = 0; i < end; i++) {
      expect(open.output[i + LOOKAHEAD]).toBe(signal[i]);
    }
    expect(energy(open.output, LOOKAHEAD, onset + LOOKAHEAD)).toBeGreaterThan(
      0,
    );
  });

  it("adds no delay without lookahead and follows threshold changes", () => {
    const gate = newGate({ lookaheadMs: 0, mode: "open" });
    expect(gate.latencySamples).toBe(0);
    const { signal } = speechBurst({
      silenceBeforeMs: 10,
      speechMs: 10,
      silenceAfterMs: 0,
    });
    const { output } = runGate(gate, signal);
    expect(output).toEqual(signal);

    const deaf = newGate({ threshold: 90 });
    const loud = runGate(
      deaf,
      speechBurst({ silenceBeforeMs: 100, speechMs: 300, silenceAfterMs: 0 })
        .signal,
    );
    expect(loud.events).toEqual([]);
    expect(energy(loud.output, 0, loud.output.length)).toBe(0);
  });

  it("feeds a mono input to every output channel", () => {
    const gate = newGate({ channels: 2, lookaheadMs: 0, mode: "open" });
    const input = new Float32Array(BLOCK).fill(0.25);
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    gate.process([input], [left, right], BLOCK, 0);
    expect(left).toEqual(input);
    expect(right).toEqual(input);
  });

  it("keeps the onsets the 50 ms tick + main-thread gain design clipped", () => {
    // Characterises the previous gate: the same VadCore evaluated every
    // 50 ms on the last 512 samples, flipping a 0/1 gain with no delay.
    // (Main-thread message latency, which only made it worse, is ignored.)
    const { signal, onset } = speechBurst({
      silenceBeforeMs: 1017, // the onset lands between two ticks
      speechMs: 400,
      silenceAfterMs: 500,
    });
    const legacy = new VadCore({ threshold: 3 });
    const legacyOut = new Float32Array(signal.length);
    const tick = ms(VAD_TICK_MS);
    let gain = 0;
    for (let i = 0; i < signal.length; i++) {
      if (i > 0 && i % tick === 0) {
        const window = signal.subarray(i - VAD_WINDOW_SAMPLES, i);
        for (const event of legacy.update(
          windowRms(window),
          (i / RATE) * 1000,
        )) {
          if (event.type === "speaking") gain = event.value ? 1 : 0;
        }
      }
      legacyOut[i] = signal[i]! * gain;
    }
    const { output } = runGate(newGate(), signal);

    const first25 = energy(signal, onset, onset + ms(25));
    const legacyKept = energy(legacyOut, onset, onset + ms(25)) / first25;
    const gateKept =
      energy(output, onset + LOOKAHEAD, onset + LOOKAHEAD + ms(25)) / first25;
    expect(legacyKept).toBeLessThan(0.05);
    expect(gateKept).toBe(1);
  });
});

describe("rm-voice-gate AudioWorklet processor", () => {
  type Processor = {
    port: { postMessage: (m: unknown) => void; onmessage: unknown };
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
  };
  let registered: (new (options: unknown) => Processor) | null = null;
  const posted: unknown[] = [];

  beforeEach(async () => {
    posted.length = 0;
    class FakeAudioWorkletProcessor {
      port: Processor["port"] = {
        postMessage: (message: unknown) => posted.push(message),
        onmessage: null,
      };
    }
    vi.stubGlobal("AudioWorkletProcessor", FakeAudioWorkletProcessor);
    vi.stubGlobal("sampleRate", RATE);
    vi.stubGlobal("currentFrame", 0);
    vi.stubGlobal(
      "registerProcessor",
      (name: string, ctor: new (options: unknown) => Processor) => {
        if (name === "rm-voice-gate") registered = ctor;
      },
    );
    vi.resetModules();
    await import("../vad-processor.worklet.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    registered = null;
  });

  it("gates on its own and posts only transitions", () => {
    expect(registered).not.toBeNull();
    const processor = new registered!({
      processorOptions: { channels: 1, threshold: 3, lookaheadMs: 20 },
    });
    const { signal, onset } = speechBurst({
      silenceBeforeMs: 500,
      speechMs: 300,
      silenceAfterMs: 600,
    });
    const output = new Float32Array(signal.length);
    for (let start = 0; start < signal.length; start += BLOCK) {
      vi.stubGlobal("currentFrame", start);
      const out = new Float32Array(BLOCK);
      expect(
        processor.process([[signal.slice(start, start + BLOCK)]], [[out]]),
      ).toBe(true);
      output.set(
        out.subarray(0, Math.min(BLOCK, signal.length - start)),
        start,
      );
    }
    expect(output[onset + LOOKAHEAD]).toBe(signal[onset]);
    expect(posted).toEqual([
      expect.objectContaining({ type: "speaking", value: true }),
      expect.objectContaining({ type: "speaking", value: false }),
    ]);
  });

  it("follows mode and threshold messages, and keeps rendering without input", () => {
    const processor = new registered!({
      processorOptions: { channels: 1, threshold: 3 },
    });
    const send = processor.port.onmessage as (e: { data: unknown }) => void;
    send({ data: { type: "threshold", value: 90 } });
    send({ data: { type: "mode", value: "open" } });
    const out = new Float32Array(BLOCK);
    expect(processor.process([[]], [[out]])).toBe(true);
    expect(posted).toEqual([]);
    send({ data: { type: "stop" } });
    expect(processor.process([[]], [[out]])).toBe(false);
  });
});
