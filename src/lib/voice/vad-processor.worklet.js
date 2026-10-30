// Voice activity detection core + AudioWorklet processor.
//
// Plain JavaScript on purpose: this file is loaded twice.
//   1. As an ordinary ES module by vad.ts, which uses VadCore on its
//      AnalyserNode timer path (fallback, and every unit test).
//   2. Untransformed, as an AudioWorklet module
//      (`new URL("./vad-processor.worklet.js", import.meta.url)`), where it
//      registers the "rm-vad" processor. Keep it free of imports.
//
// Both paths run the same VadCore, so the hysteresis is identical: an RMS
// window of the last 512 samples, evaluated every 50 ms, speaking on at the
// first window at or above the threshold, off after 300 ms below it, and a
// hardware stall after 5 s of exact digital silence.

export const VAD_WINDOW_SAMPLES = 512;
export const VAD_TICK_MS = 50;
export const VAD_SILENCE_DELAY_MS = 300;
export const VAD_STALL_MS = 5000;

/**
 * RMS of time-domain samples on the VAD's 0..100 scale (mean-centred, so a
 * DC offset is not speech). Same maths as calculateTimeDomainRms in vad.ts.
 * @param {Float32Array} data
 * @param {number} [length]
 */
export function windowRms(data, length = data.length) {
  if (length === 0) return 0;
  let mean = 0;
  for (let i = 0; i < length; i++) mean += data[i];
  mean /= length;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const centered = data[i] - mean;
    sum += centered * centered;
  }
  return Math.sqrt(sum / length) * 100;
}

/**
 * Speaking / stall hysteresis. `update()` takes one RMS reading and the time
 * in ms, and returns only the transitions it caused.
 */
export class VadCore {
  /**
   * @param {{ threshold: number, silenceDelayMs?: number, stallMs?: number, speaking?: boolean }} options
   */
  constructor(options) {
    this.threshold = options.threshold;
    this.silenceDelayMs = options.silenceDelayMs ?? VAD_SILENCE_DELAY_MS;
    this.stallMs = options.stallMs ?? VAD_STALL_MS;
    this.speaking = options.speaking === true;
    this.stalled = false;
    /** @type {number | null} */
    this.silenceStart = null;
    /** @type {number | null} */
    this.pureSilenceStart = null;
  }

  /** @param {number} threshold */
  setThreshold(threshold) {
    this.threshold = threshold;
  }

  /** The owner forced speaking off (mic disabled); re-detect from here. */
  resetSpeaking() {
    this.speaking = false;
  }

  /**
   * @param {number} rms
   * @param {number} now
   * @returns {Array<{ type: "speaking" | "stalled", value: boolean }>}
   */
  update(rms, now) {
    /** @type {Array<{ type: "speaking" | "stalled", value: boolean }>} */
    const events = [];

    if (rms === 0) {
      if (this.pureSilenceStart === null) {
        this.pureSilenceStart = now;
      } else if (!this.stalled && now - this.pureSilenceStart >= this.stallMs) {
        this.stalled = true;
        events.push({ type: "stalled", value: true });
      }
    } else {
      this.pureSilenceStart = null;
      if (this.stalled) {
        this.stalled = false;
        events.push({ type: "stalled", value: false });
      }
    }

    if (rms >= this.threshold) {
      this.silenceStart = null;
      if (!this.speaking) {
        this.speaking = true;
        events.push({ type: "speaking", value: true });
      }
    } else if (this.speaking) {
      if (this.silenceStart === null) {
        this.silenceStart = now;
      } else if (now - this.silenceStart >= this.silenceDelayMs) {
        this.speaking = false;
        events.push({ type: "speaking", value: false });
      }
    }

    return events;
  }
}

/* global registerProcessor, AudioWorkletProcessor, sampleRate, currentFrame */
if (
  typeof registerProcessor === "function" &&
  typeof AudioWorkletProcessor === "function"
) {
  class RmVadProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const init = (options && options.processorOptions) || {};
      this.core = new VadCore({
        threshold: init.threshold ?? 3,
        silenceDelayMs: init.silenceDelayMs,
        speaking: init.speaking,
      });
      this.ring = new Float32Array(VAD_WINDOW_SAMPLES);
      this.window = new Float32Array(VAD_WINDOW_SAMPLES);
      this.ringIndex = 0;
      this.filled = 0;
      this.framesPerTick = Math.max(
        1,
        Math.round((sampleRate * VAD_TICK_MS) / 1000),
      );
      this.framesUntilTick = this.framesPerTick;
      this.alive = true;
      this.port.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "threshold") this.core.setThreshold(message.value);
        else if (message.type === "reset-speaking") this.core.resetSpeaking();
        else if (message.type === "stop") this.alive = false;
      };
    }

    process(inputs) {
      if (!this.alive) return false;
      const input = inputs[0];
      const channels = input ? input.length : 0;
      const frames = channels > 0 ? input[0].length : 128;

      for (let i = 0; i < frames; i++) {
        // AnalyserNode-equivalent mono down-mix (speakers: average).
        let sample = 0;
        if (channels === 1) sample = input[0][i];
        else if (channels > 1) {
          for (let c = 0; c < channels; c++) sample += input[c][i];
          sample /= channels;
        }
        this.ring[this.ringIndex] = sample;
        this.ringIndex = (this.ringIndex + 1) % VAD_WINDOW_SAMPLES;
        if (this.filled < VAD_WINDOW_SAMPLES) this.filled++;

        if (--this.framesUntilTick === 0) {
          this.framesUntilTick = this.framesPerTick;
          this.evaluate(currentFrame + i + 1);
        }
      }
      return true;
    }

    evaluate(frame) {
      // Oldest-to-newest copy of the last 512 samples (zeros until full,
      // like an AnalyserNode that has just started).
      const start = this.ringIndex;
      for (let j = 0; j < VAD_WINDOW_SAMPLES; j++) {
        this.window[j] = this.ring[(start + j) % VAD_WINDOW_SAMPLES];
      }
      const rms = windowRms(this.window);
      const now = (frame / sampleRate) * 1000;
      const events = this.core.update(rms, now);
      for (const event of events) {
        // Only transitions cross to the main thread.
        this.port.postMessage({ ...event, rms });
      }
    }
  }

  registerProcessor("rm-vad", RmVadProcessor);
}
