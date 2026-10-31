import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import {
  acquireCaptureAudioContext,
  loadCaptureWorkletModule,
  releaseCaptureAudioContext,
  reportLocalAudioIssue,
} from "./capture-audio-context";
import { markVoice } from "./latency-marks";
import {
  type InGraphVoiceGate,
  type VoiceGateEvent,
  type VoiceGateMode,
  vadWorkletUrl,
} from "./vad";
import {
  GATE_LOOKAHEAD_MS,
  VAD_SILENCE_DELAY_MS,
} from "./vad-processor.worklet.js";

export type NoiseReductionProviderId = "rnnoise" | "krisp-browser";
export type LocalAudioProcessingMode =
  | "passthrough"
  | "true-stereo"
  | "rnnoise";
/** What the microphone publication is: a processor's output, or "direct". */
export type LocalAudioPublicationMode = LocalAudioProcessingMode | "direct";

export interface VoiceAudioProcessingSettings {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoSensitivity: boolean;
  streamHighFidelity: boolean;
  noiseReductionEnabled: boolean;
  noiseReductionProvider: NoiseReductionProviderId;
  /**
   * The sensitivity (noise) gate on the published microphone. Off for the
   * Studio profile. Defaults to on.
   */
  voiceGateEnabled?: boolean;
}

export interface LocalAudioCaptureProcessing {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export interface LocalAudioProcessorHandle {
  mode: LocalAudioProcessingMode;
  preGateStream: MediaStream;
  publicationStream: MediaStream;
  createMonitorStream: () => MediaStream;
  gateController: LocalAudioGateController;
  /** Delay the publication's gate adds (0: no lookahead), in ms. */
  gateLookaheadMs?: number;
  resume: () => void;
  destroy: () => void;
}

export interface LocalAudioGateController {
  /** Manual override: closed (true) or open (false). */
  setGated: (gated: boolean) => void;
  resume: () => void;
  /** The in-graph gate; VoiceActivityDetector drives it by mode. */
  inGraph?: InGraphVoiceGate;
}

export const NOISE_REDUCTION_PROVIDER_LABELS: Record<
  NoiseReductionProviderId,
  string
> = {
  rnnoise: "RNNoise",
  "krisp-browser": "Krisp Browser SDK",
};

const MAX_CHANNELS = 2;
/** Matches getVoiceActivityThreshold(true, …); the detector sets the real one. */
const DEFAULT_GATE_THRESHOLD = 3;
/**
 * A context created or resumed with user activation starts once the output
 * device is open (tens of ms); one still suspended after this needs a
 * gesture (see reportLocalAudioIssue). Nothing waits for it: the publication
 * track exists at once and carries audio as soon as the context runs.
 */
const CONTEXT_START_REPORT_MS = 250;

let rnnoiseBinaryPromise: Promise<ArrayBuffer> | null = null;
type RnnoiseModule = typeof import("@sapphi-red/web-noise-suppressor");

export function isNoiseReductionProviderSupported(
  provider: NoiseReductionProviderId,
): boolean {
  if (provider === "krisp-browser") {
    return false;
  }

  return (
    typeof window !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined"
  );
}

export function resolveLocalAudioProcessingMode(
  settings: VoiceAudioProcessingSettings,
): LocalAudioProcessingMode {
  if (
    settings.noiseReductionEnabled &&
    settings.noiseReductionProvider === "rnnoise"
  ) {
    return "rnnoise";
  }

  if (settings.streamHighFidelity) {
    return "true-stereo";
  }

  return "passthrough";
}

/**
 * Whether the published microphone needs a processor at all. Without the
 * gate and without RNNoise the browser-processed capture track is published
 * as is ("direct"): routing it through Web Audio adds latency (a
 * MediaStreamAudioDestinationNode hop) and changes nothing.
 */
export function resolveLocalAudioPublicationMode(
  settings: VoiceAudioProcessingSettings,
): LocalAudioPublicationMode {
  const mode = resolveLocalAudioProcessingMode(settings);
  if (mode === "rnnoise") return mode;
  return settings.voiceGateEnabled === false ? "direct" : mode;
}

export function resolveCaptureAudioProcessing(
  settings: VoiceAudioProcessingSettings,
): LocalAudioCaptureProcessing {
  if (settings.streamHighFidelity) {
    return {
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
    };
  }

  return {
    noiseSuppression: settings.noiseReductionEnabled
      ? false
      : settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: true,
  };
}

function getEffectiveChannelCount(track: MediaStreamTrack): number {
  const reported = track.getSettings().channelCount;
  if (typeof reported !== "number" || !Number.isFinite(reported)) {
    return 1;
  }

  return Math.max(1, Math.min(Math.round(reported), MAX_CHANNELS));
}

function configureChannelGraph(
  source: MediaStreamAudioSourceNode,
  destination: MediaStreamAudioDestinationNode,
  channelCount: number,
) {
  source.channelCount = channelCount;
  source.channelCountMode = "max";
  source.channelInterpretation = "discrete";

  destination.channelCount = channelCount;
  destination.channelCountMode = "explicit";
  destination.channelInterpretation = "discrete";
}

function disconnectQuietly(node: { disconnect: () => void } | null): void {
  try {
    node?.disconnect();
  } catch {
    // Ignore teardown races.
  }
}

/** Main-thread side of an "rm-voice-gate" node. */
function createInGraphGate(
  node: AudioWorkletNode,
  initialMode: VoiceGateMode,
): InGraphVoiceGate & { dispose: () => void } {
  let mode = initialMode;
  let threshold = DEFAULT_GATE_THRESHOLD;
  let speaking = false;
  let stalled = false;
  let rms = 0;
  const listeners = new Set<(event: VoiceGateEvent) => void>();
  node.port.onmessage = (message: MessageEvent) => {
    const event = message.data as VoiceGateEvent | null;
    if (event?.type !== "speaking" && event?.type !== "stalled") return;
    if (typeof event.rms === "number") rms = event.rms;
    if (event.type === "speaking") speaking = event.value;
    else stalled = event.value;
    for (const listener of [...listeners]) listener(event);
  };
  return {
    setMode(next) {
      if (next === mode) return;
      mode = next;
      node.port.postMessage({ type: "mode", value: next });
    },
    setThreshold(next) {
      if (next === threshold) return;
      threshold = next;
      node.port.postMessage({ type: "threshold", value: next });
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ type: "stalled", value: stalled, rms });
      listener({ type: "speaking", value: speaking, rms });
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
      node.port.onmessage = null;
      node.port.postMessage({ type: "stop" });
    },
  };
}

async function loadRnnoiseBinaryOnce(
  loadRnnoiseFn: RnnoiseModule["loadRnnoise"],
): Promise<ArrayBuffer> {
  rnnoiseBinaryPromise ??= loadRnnoiseFn({
    url: rnnoiseWasmUrl,
    simdUrl: rnnoiseSimdWasmUrl,
  }).catch((error) => {
    rnnoiseBinaryPromise = null;
    throw error;
  });

  return rnnoiseBinaryPromise;
}

/** Starts `context` without waiting; reports it if it stays suspended. */
function watchContextStart(
  context: AudioContext,
  isDestroyed: () => boolean,
): void {
  if (context.state === "running") return;
  Promise.resolve(context.resume?.()).catch(() => {});
  setTimeout(() => {
    if (!isDestroyed() && context.state === "suspended") {
      // Only a user gesture starts it now. The published microphone stays
      // gated (silent) until then; the voice session's audio-blocked prompt
      // and click listener resume it through resume().
      reportLocalAudioIssue("capture-context-suspended", context.state);
    }
  }, CONTEXT_START_REPORT_MS);
}

/**
 * Builds source → [RNNoise] → pre-gate monitor, and → voice gate →
 * publication, on the shared capture context.
 */
async function createProcessor(
  track: MediaStreamTrack,
  mode: LocalAudioProcessingMode,
  voiceGate: boolean,
): Promise<LocalAudioProcessorHandle> {
  const startedAt = performance.now();
  const context = acquireCaptureAudioContext();
  if (!context) {
    reportLocalAudioIssue("capture-context-unavailable");
    throw new Error("Capture AudioContext is unavailable");
  }
  let inputTrack: MediaStreamTrack | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let rnnoiseNode: { destroy: () => void; disconnect: () => void } | null =
    null;
  let gateNode: AudioWorkletNode | null = null;
  let gate: ReturnType<typeof createInGraphGate> | null = null;
  let preGateDestination: MediaStreamAudioDestinationNode | null = null;
  let publicationDestination: MediaStreamAudioDestinationNode | null = null;
  const teardown = () => {
    gate?.dispose();
    rnnoiseNode?.destroy();
    disconnectQuietly(rnnoiseNode);
    disconnectQuietly(source);
    disconnectQuietly(gateNode);
    disconnectQuietly(preGateDestination);
    disconnectQuietly(publicationDestination);
    preGateDestination?.stream.getTracks().forEach((t) => t.stop());
    publicationDestination?.stream.getTracks().forEach((t) => t.stop());
    inputTrack?.stop();
    releaseCaptureAudioContext(context);
  };

  try {
    let rnnoise: {
      Node: RnnoiseModule["RnnoiseWorkletNode"];
      wasmBinary: ArrayBuffer;
    } | null = null;
    if (mode === "rnnoise") {
      const { RnnoiseWorkletNode, loadRnnoise } =
        await import("@sapphi-red/web-noise-suppressor");
      await loadCaptureWorkletModule(context, rnnoiseWorkletUrl);
      rnnoise = {
        Node: RnnoiseWorkletNode,
        wasmBinary: await loadRnnoiseBinaryOnce(loadRnnoise),
      };
    }
    try {
      await loadCaptureWorkletModule(context, vadWorkletUrl());
    } catch (error) {
      reportLocalAudioIssue("gate-unavailable", String(error));
      throw error;
    }

    inputTrack = track.clone();
    source = context.createMediaStreamSource(new MediaStream([inputTrack]));
    preGateDestination = context.createMediaStreamDestination();
    publicationDestination = context.createMediaStreamDestination();
    const channelCount = getEffectiveChannelCount(track);
    configureChannelGraph(source, preGateDestination, channelCount);
    configureChannelGraph(source, publicationDestination, channelCount);

    let processed: AudioNode = source;
    if (rnnoise) {
      const node = new rnnoise.Node(context, {
        maxChannels: channelCount,
        wasmBinary: rnnoise.wasmBinary,
      });
      rnnoiseNode = node;
      source.connect(node);
      processed = node;
    }

    const lookaheadMs = voiceGate ? GATE_LOOKAHEAD_MS : 0;
    const initialMode: VoiceGateMode = voiceGate ? "auto" : "open";
    gateNode = new AudioWorkletNode(context, "rm-voice-gate", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channelCount],
      channelCount,
      channelCountMode: "max",
      channelInterpretation: "discrete",
      processorOptions: {
        channels: channelCount,
        threshold: DEFAULT_GATE_THRESHOLD,
        silenceDelayMs: VAD_SILENCE_DELAY_MS,
        lookaheadMs,
        mode: initialMode,
      },
    });
    gate = createInGraphGate(gateNode, initialMode);
    processed.connect(preGateDestination);
    processed.connect(gateNode);
    gateNode.connect(publicationDestination);

    const preGateTrack = preGateDestination.stream.getAudioTracks()[0];
    const publicationTrack = publicationDestination.stream.getAudioTracks()[0];
    if (!preGateTrack || !publicationTrack) {
      throw new Error("Audio processor did not produce output tracks");
    }
    preGateTrack.contentHint = "speech";
    publicationTrack.contentHint = "speech";

    let destroyed = false;
    watchContextStart(context, () => destroyed);
    markVoice("audio-processor-ready", {
      mode,
      buildMs: Math.round(performance.now() - startedAt),
      contextState: context.state,
    });
    const resume = () => {
      if (!destroyed && context.state === "suspended") {
        context.resume().catch(() => {});
      }
    };
    const activeGate = gate;
    return {
      mode,
      preGateStream: preGateDestination.stream,
      publicationStream: publicationDestination.stream,
      createMonitorStream: () => new MediaStream([preGateTrack.clone()]),
      gateController: {
        setGated: (gated) => {
          if (!destroyed) activeGate.setMode(gated ? "closed" : "open");
        },
        resume,
        inGraph: activeGate,
      },
      gateLookaheadMs: lookaheadMs,
      resume,
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        teardown();
      },
    };
  } catch (error) {
    teardown();
    throw error;
  }
}

/**
 * The outbound microphone processor for `settings`: RNNoise when enabled
 * (falling back to the identity graph if it fails to load), always with the
 * in-graph voice gate in front of the publication stream (lookahead only
 * when the sensitivity gate is on).
 */
export async function createLocalAudioProcessor(
  stream: MediaStream,
  settings: VoiceAudioProcessingSettings,
): Promise<LocalAudioProcessorHandle | null> {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    return null;
  }

  const mode = resolveLocalAudioProcessingMode(settings);
  const voiceGate = settings.voiceGateEnabled !== false;
  if (
    mode === "rnnoise" &&
    isNoiseReductionProviderSupported(settings.noiseReductionProvider)
  ) {
    try {
      return await createProcessor(audioTrack, "rnnoise", voiceGate);
    } catch {
      // Fall back to the identity graph below.
    }
  }

  try {
    return await createProcessor(
      audioTrack,
      mode === "true-stereo" ? "true-stereo" : "passthrough",
      voiceGate,
    );
  } catch (error) {
    reportLocalAudioIssue("processor-unavailable", String(error));
    return null;
  }
}
