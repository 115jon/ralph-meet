// Voice activity detection core + AudioWorklet processor.
//
// Plain JavaScript on purpose: this file is loaded twice.
//   1. As an ordinary ES module by vad.ts, which uses VadCore on its
//      AnalyserNode timer path (fallback, and every unit test).
//   2. Untransformed, as an AudioWorklet module
//      (`new URL("./vad-processor.worklet.js", import.meta.url)`), where it
//      registers the "rm-vad" processor (speaking detection on a monitor
//      copy) and the "rm-voice-gate" processor (the outbound noise gate).
//      Keep it free of imports.
//
// Every path runs the same VadCore, so the hysteresis is identical: an RMS
// window of the last 512 samples, speaking on at the first window at or above
// the threshold, off after 300 ms below it, and a hardware stall after 5 s of
// exact digital silence. "rm-vad" and the analyser fallback evaluate it every
// 50 ms; the gate evaluates it every millisecond, and additionally requires a
// sustained onset (see GATE_ONSET_MIN_ACTIVE_MS) before it turns speaking on.

export const VAD_WINDOW_SAMPLES = 512;
export const VAD_TICK_MS = 50;
export const VAD_SILENCE_DELAY_MS = 300;
export const VAD_STALL_MS = 5000;

// Outbound gate. The gate delays the audio it passes by GATE_LOOKAHEAD_MS, so
// it opens before a word's first sample reaches its output. To open, the
// 512-sample window must reach the threshold (as everywhere) AND the onset
// must be sustained: at least GATE_ONSET_MIN_ACTIVE_MS of the last
// GATE_ONSET_WINDOW_MS, counted in 1 ms blocks whose RMS reaches the
// threshold minus GATE_ONSET_ACTIVITY_DB. An isolated click (a few ms) never
// gets there, so it neither opens the gate nor lights the speaking
// indicator; speech does within ~10-11 ms, and the gate is fully open
// GATE_ATTACK_MS later, still inside the lookahead (worst case 10 ms + 1 ms
// block alignment + 3 ms attack = 14 ms < 20 ms). The lookahead is the only
// latency the gate adds. Once open, the 300 ms hangover is kept on the output
// timeline (the gate closes once the delayed audio of the last loud window
// has played), then the gain fades out over GATE_RELEASE_MS.
export const GATE_LOOKAHEAD_MS = 20;
export const GATE_ATTACK_MS = 3;
export const GATE_RELEASE_MS = 10;
export const GATE_EVAL_MS = 1;
export const GATE_ONSET_WINDOW_MS = 15;
export const GATE_ONSET_MIN_ACTIVE_MS = 10;
export const GATE_ONSET_ACTIVITY_DB = 6;

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
   * @param {Array<{ type: "speaking" | "stalled", value: boolean }>} [events]
   *   Array to append to (the audio thread reuses one to avoid garbage).
   * @param {boolean} [canStart] false holds speaking off even at or above
   *   the threshold (an onset that is not sustained yet); it does not affect
   *   speech already on.
   * @returns {Array<{ type: "speaking" | "stalled", value: boolean }>}
   */
  update(rms, now, events = [], canStart = true) {
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

    if (rms >= this.threshold && (this.speaking || canStart)) {
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

/** @typedef {"auto" | "open" | "closed"} VoiceGateMode */

/**
 * @param {unknown} mode
 * @returns {mode is VoiceGateMode}
 */
function isVoiceGateMode(mode) {
  return mode === "auto" || mode === "open" || mode === "closed";
}

/**
 * The outbound noise gate, as a pure sample processor (the "rm-voice-gate"
 * worklet is a thin shell around it, and tests drive it directly).
 *
 * Modes: "auto" gates on speech, "open" passes everything (gate disabled),
 * "closed" passes nothing (microphone muted). The decision and the gain both
 * live here, on the audio thread; nothing waits for the main thread.
 */
export class VoiceGateCore {
  /**
   * @param {{
   *   sampleRate: number,
   *   channels?: number,
   *   threshold: number,
   *   silenceDelayMs?: number,
   *   stallMs?: number,
   *   lookaheadMs?: number,
   *   attackMs?: number,
   *   releaseMs?: number,
   *   evalMs?: number,
   *   onsetMinActiveMs?: number,
   *   onsetWindowMs?: number,
   *   mode?: VoiceGateMode,
   * }} options
   */
  constructor(options) {
    const rate = options.sampleRate;
    this.sampleRate = rate;
    this.vad = new VadCore({
      threshold: options.threshold,
      silenceDelayMs: options.silenceDelayMs,
      stallMs: options.stallMs,
    });
    /** @type {VoiceGateMode} */
    this.mode = isVoiceGateMode(options.mode) ? options.mode : "auto";
    this.channels = Math.max(1, Math.min(8, Math.round(options.channels ?? 1)));
    const lookaheadMs = options.lookaheadMs ?? GATE_LOOKAHEAD_MS;
    this.delaySamples = Math.max(0, Math.round((lookaheadMs * rate) / 1000));
    /** @type {Float32Array[]} */
    this.delay = [];
    for (let c = 0; c < this.channels; c++) {
      this.delay.push(new Float32Array(Math.max(1, this.delaySamples)));
    }
    this.delayIndex = 0;
    const toSamples = (/** @type {number} */ ms) =>
      Math.max(1, Math.round((ms * rate) / 1000));
    this.attackStep = 1 / toSamples(options.attackMs ?? GATE_ATTACK_MS);
    this.releaseStep = 1 / toSamples(options.releaseMs ?? GATE_RELEASE_MS);
    this.evalFrames = toSamples(options.evalMs ?? GATE_EVAL_MS);
    this.framesUntilEval = this.evalFrames;
    this.ring = new Float32Array(VAD_WINDOW_SAMPLES);
    this.ringIndex = 0;
    // Onset duration: activity of the last onsetWindow 1 ms blocks.
    this.blockSamples = toSamples(1);
    this.blockFill = 0;
    this.blockSumSq = 0;
    this.onsetMinActive = Math.max(
      1,
      Math.round(options.onsetMinActiveMs ?? GATE_ONSET_MIN_ACTIVE_MS),
    );
    this.activity = new Uint8Array(
      Math.max(
        this.onsetMinActive,
        Math.round(options.onsetWindowMs ?? GATE_ONSET_WINDOW_MS),
      ),
    );
    this.activityIndex = 0;
    this.activeBlocks = 0;
    // Samples the gate stays open after speech ends, so the hangover is
    // measured on the delayed output rather than the input.
    this.releaseCountdown = 0;
    this.lastRms = 0;
    this.gain = this.targetGain();
    /** @type {Array<{ type: "speaking" | "stalled", value: boolean, rms: number }>} */
    this.events = [];
    /** @type {Array<{ type: "speaking" | "stalled", value: boolean }>} */
    this.vadEvents = [];
  }

  get speaking() {
    return this.vad.speaking;
  }

  get stalled() {
    return this.vad.stalled;
  }

  /** Latency the gate adds to everything it passes, in samples. */
  get latencySamples() {
    return this.delaySamples;
  }

  /** @param {number} threshold */
  setThreshold(threshold) {
    this.vad.setThreshold(threshold);
  }

  /** @param {unknown} mode */
  setMode(mode) {
    if (isVoiceGateMode(mode)) this.mode = mode;
  }

  targetGain() {
    if (this.mode === "open") return 1;
    if (this.mode === "closed") return 0;
    return this.vad.speaking || this.releaseCountdown > 0 ? 1 : 0;
  }

  /**
   * Gate one block. `input` holds the input channels (none: silence);
   * `output` channels get the delayed, gated audio. Returns the speaking /
   * stall transitions the block caused, in a reused array: read it before
   * the next call.
   *
   * @param {ArrayLike<Float32Array>} input
   * @param {ArrayLike<Float32Array>} output
   * @param {number} frames
   * @param {number} startFrame absolute frame of the block's first sample
   */
  process(input, output, frames, startFrame) {
    const events = this.events;
    events.length = 0;
    const inChannels = input ? input.length : 0;
    const outChannels = output ? output.length : 0;
    const delaySamples = this.delaySamples;

    for (let i = 0; i < frames; i++) {
      // Mono down-mix for detection (AnalyserNode-equivalent).
      let mono = 0;
      if (inChannels === 1) mono = input[0][i];
      else if (inChannels > 1) {
        for (let c = 0; c < inChannels; c++) mono += input[c][i];
        mono /= inChannels;
      }
      this.ring[this.ringIndex] = mono;
      this.ringIndex = (this.ringIndex + 1) % VAD_WINDOW_SAMPLES;
      this.blockSumSq += mono * mono;
      if (++this.blockFill === this.blockSamples) this.closeActivityBlock();

      const target = this.targetGain();
      if (this.gain < target) {
        this.gain = Math.min(target, this.gain + this.attackStep);
      } else if (this.gain > target) {
        this.gain = Math.max(target, this.gain - this.releaseStep);
      }
      if (this.releaseCountdown > 0) this.releaseCountdown--;

      for (let c = 0; c < this.channels; c++) {
        // A mono input feeds every output channel.
        const sample =
          inChannels === 0 ? 0 : input[c < inChannels ? c : inChannels - 1][i];
        let delayed = sample;
        if (delaySamples > 0) {
          const line = this.delay[c];
          delayed = line[this.delayIndex];
          line[this.delayIndex] = sample;
        }
        if (c < outChannels) output[c][i] = delayed * this.gain;
      }
      for (let c = this.channels; c < outChannels; c++) {
        output[c][i] = output[this.channels - 1][i];
      }
      if (delaySamples > 0) {
        this.delayIndex = (this.delayIndex + 1) % delaySamples;
      }

      if (--this.framesUntilEval === 0) {
        this.framesUntilEval = this.evalFrames;
        this.evaluate(startFrame + i + 1);
      }
    }
    return events;
  }

  /** Whether the onset so far is long enough to be speech, not a click. */
  get onsetSustained() {
    return this.activeBlocks >= this.onsetMinActive;
  }

  closeActivityBlock() {
    // Not mean-centred: 1 ms is a fraction of a voice period, and removing
    // its mean would remove most of a low voice. A DC offset alone still
    // cannot open the gate (the 512-sample window test is mean-centred).
    const rms = Math.sqrt(this.blockSumSq / this.blockFill) * 100;
    const active =
      rms >= this.vad.threshold * 10 ** (-GATE_ONSET_ACTIVITY_DB / 20) ? 1 : 0;
    this.activeBlocks += active - this.activity[this.activityIndex];
    this.activity[this.activityIndex] = active;
    this.activityIndex = (this.activityIndex + 1) % this.activity.length;
    this.blockFill = 0;
    this.blockSumSq = 0;
  }

  /** @param {number} frame */
  evaluate(frame) {
    // RMS of the last 512 samples (order does not matter), as windowRms().
    const ring = this.ring;
    let mean = 0;
    for (let j = 0; j < VAD_WINDOW_SAMPLES; j++) mean += ring[j];
    mean /= VAD_WINDOW_SAMPLES;
    let sum = 0;
    for (let j = 0; j < VAD_WINDOW_SAMPLES; j++) {
      const centered = ring[j] - mean;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / VAD_WINDOW_SAMPLES) * 100;
    this.lastRms = rms;
    const vadEvents = this.vadEvents;
    vadEvents.length = 0;
    this.vad.update(
      rms,
      (frame / this.sampleRate) * 1000,
      vadEvents,
      this.onsetSustained,
    );
    for (const event of vadEvents) {
      if (event.type === "speaking") {
        // Speech end: keep the gain up until the audio that was in the
        // window when the hangover ran out has left the delay line.
        this.releaseCountdown = event.value ? 0 : this.delaySamples;
      }
      this.events.push({ type: event.type, value: event.value, rms });
    }
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

  // The outbound gate: delays and gates the published microphone in place
  // and posts only speaking / stall transitions (for the speaking indicator).
  // The main thread sends mode and threshold changes; the audio path never
  // waits for it.
  class RmVoiceGateProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const init = (options && options.processorOptions) || {};
      this.core = new VoiceGateCore({
        sampleRate,
        channels: init.channels ?? 1,
        threshold: init.threshold ?? 3,
        silenceDelayMs: init.silenceDelayMs,
        lookaheadMs: init.lookaheadMs,
        attackMs: init.attackMs,
        releaseMs: init.releaseMs,
        mode: init.mode,
      });
      this.alive = true;
      this.port.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "threshold") this.core.setThreshold(message.value);
        else if (message.type === "mode") this.core.setMode(message.value);
        else if (message.type === "stop") this.alive = false;
      };
    }

    process(inputs, outputs) {
      if (!this.alive) return false;
      const output = outputs[0] || [];
      const frames = output.length > 0 ? output[0].length : 128;
      const events = this.core.process(
        inputs[0] || [],
        output,
        frames,
        currentFrame,
      );
      for (const event of events) this.port.postMessage(event);
      // Keep rendering without an input: the delay line drains to silence
      // and the published track keeps producing frames.
      return true;
    }
  }

  registerProcessor("rm-voice-gate", RmVoiceGateProcessor);
}
