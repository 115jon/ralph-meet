import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";

export type NoiseReductionProviderId = "rnnoise" | "krisp-browser";
export type LocalAudioProcessingMode = "passthrough" | "true-stereo" | "rnnoise";

export interface VoiceAudioProcessingSettings {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoSensitivity: boolean;
  streamHighFidelity: boolean;
  noiseReductionEnabled: boolean;
  noiseReductionProvider: NoiseReductionProviderId;
}

export interface LocalAudioCaptureProcessing {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export interface LocalAudioProcessorHandle {
  mode: LocalAudioProcessingMode;
  processedStream: MediaStream;
  createMonitorStream: () => MediaStream;
  destroy: () => void;
}

export const DEFAULT_NOISE_REDUCTION_PROVIDER: NoiseReductionProviderId = "rnnoise";

export const NOISE_REDUCTION_PROVIDER_LABELS: Record<NoiseReductionProviderId, string> = {
  rnnoise: "RNNoise",
  "krisp-browser": "Krisp Browser SDK",
};

const WORKLET_SAMPLE_RATE = 48_000;
const MAX_CHANNELS = 2;

let rnnoiseBinaryPromise: Promise<ArrayBuffer> | null = null;
type RnnoiseModule = typeof import("@sapphi-red/web-noise-suppressor");

export function isNoiseReductionProviderSupported(provider: NoiseReductionProviderId): boolean {
  if (provider === "krisp-browser") {
    return false;
  }

  return (
    typeof window !== "undefined"
    && typeof AudioContext !== "undefined"
    && typeof AudioWorkletNode !== "undefined"
  );
}

export function resolveLocalAudioProcessingMode(
  settings: VoiceAudioProcessingSettings,
): LocalAudioProcessingMode {
  if (settings.noiseReductionEnabled && settings.noiseReductionProvider === "rnnoise") {
    return "rnnoise";
  }

  if (settings.streamHighFidelity) {
    return "true-stereo";
  }

  return "passthrough";
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
    noiseSuppression: settings.noiseReductionEnabled ? false : settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoSensitivity,
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

function createPassthroughProcessor(track: MediaStreamTrack): LocalAudioProcessorHandle {
  return {
    mode: "passthrough",
    processedStream: new MediaStream([track]),
    createMonitorStream: () => new MediaStream([track.clone()]),
    destroy: () => { },
  };
}

function createTrueStereoProcessor(track: MediaStreamTrack): LocalAudioProcessorHandle {
  const context = new AudioContext({ sampleRate: WORKLET_SAMPLE_RATE });
  const inputTrack = track.clone();
  const sourceStream = new MediaStream([inputTrack]);
  const source = context.createMediaStreamSource(sourceStream);
  const destination = context.createMediaStreamDestination();

  configureChannelGraph(source, destination, getEffectiveChannelCount(track));
  source.connect(destination);
  context.resume().catch(() => { });

  const outputTrack = destination.stream.getAudioTracks()[0];
  if (!outputTrack) {
    inputTrack.stop();
    context.close().catch(() => { });
    return createPassthroughProcessor(track);
  }

  outputTrack.contentHint = "speech";

  return {
    mode: "true-stereo",
    processedStream: new MediaStream([outputTrack]),
    createMonitorStream: () => new MediaStream([outputTrack.clone()]),
    destroy: () => {
      try {
        source.disconnect();
      } catch {
        // Ignore teardown races.
      }
      outputTrack.stop();
      inputTrack.stop();
      context.close().catch(() => { });
    },
  };
}

async function loadRnnoiseBinaryOnce(loadRnnoiseFn: RnnoiseModule["loadRnnoise"]): Promise<ArrayBuffer> {
  rnnoiseBinaryPromise ??= loadRnnoiseFn({
    url: rnnoiseWasmUrl,
    simdUrl: rnnoiseSimdWasmUrl,
  });

  return rnnoiseBinaryPromise;
}

async function createRnnoiseProcessor(track: MediaStreamTrack): Promise<LocalAudioProcessorHandle> {
  const context = new AudioContext({ sampleRate: WORKLET_SAMPLE_RATE });
  const { RnnoiseWorkletNode, loadRnnoise } = await import("@sapphi-red/web-noise-suppressor");
  await context.audioWorklet.addModule(rnnoiseWorkletUrl);

  const wasmBinary = await loadRnnoiseBinaryOnce(loadRnnoise);
  const inputTrack = track.clone();
  const sourceStream = new MediaStream([inputTrack]);
  const source = context.createMediaStreamSource(sourceStream);
  const destination = context.createMediaStreamDestination();
  const channelCount = getEffectiveChannelCount(track);

  configureChannelGraph(source, destination, channelCount);

  const rnnoise = new RnnoiseWorkletNode(context, {
    maxChannels: channelCount,
    wasmBinary,
  });

  source.connect(rnnoise);
  rnnoise.connect(destination);
  context.resume().catch(() => { });

  const outputTrack = destination.stream.getAudioTracks()[0];
  if (!outputTrack) {
    rnnoise.destroy();
    try {
      rnnoise.disconnect();
    } catch {
      // Ignore teardown races.
    }
    inputTrack.stop();
    context.close().catch(() => { });
    return createPassthroughProcessor(track);
  }

  outputTrack.contentHint = "speech";

  return {
    mode: "rnnoise",
    processedStream: new MediaStream([outputTrack]),
    createMonitorStream: () => new MediaStream([outputTrack.clone()]),
    destroy: () => {
      rnnoise.destroy();
      try {
        source.disconnect();
      } catch {
        // Ignore teardown races.
      }
      try {
        rnnoise.disconnect();
      } catch {
        // Ignore teardown races.
      }
      outputTrack.stop();
      inputTrack.stop();
      context.close().catch(() => { });
    },
  };
}

export async function createLocalAudioProcessor(
  stream: MediaStream,
  settings: VoiceAudioProcessingSettings,
): Promise<LocalAudioProcessorHandle | null> {
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    return null;
  }

  const mode = resolveLocalAudioProcessingMode(settings);
  if (mode === "rnnoise" && isNoiseReductionProviderSupported(settings.noiseReductionProvider)) {
    return createRnnoiseProcessor(audioTrack);
  }

  if (mode === "true-stereo") {
    return createTrueStereoProcessor(audioTrack);
  }

  return createPassthroughProcessor(audioTrack);
}
