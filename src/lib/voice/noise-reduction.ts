import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";

export type NoiseReductionProviderId = "rnnoise" | "krisp-browser";
export type LocalAudioProcessingMode =
  | "passthrough"
  | "true-stereo"
  | "rnnoise";

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
  preGateStream: MediaStream;
  publicationStream: MediaStream;
  createMonitorStream: () => MediaStream;
  gateController: LocalAudioGateController;
  resume: () => void;
  destroy: () => void;
}

export interface LocalAudioGateController {
  setGated: (gated: boolean) => void;
  resume: () => void;
}

export interface LocalAudioGateHandle {
  outputStream: MediaStream;
  gateController: LocalAudioGateController;
  destroy: () => void;
}

export const DEFAULT_NOISE_REDUCTION_PROVIDER: NoiseReductionProviderId =
  "rnnoise";

export const NOISE_REDUCTION_PROVIDER_LABELS: Record<
  NoiseReductionProviderId,
  string
> = {
  rnnoise: "RNNoise",
  "krisp-browser": "Krisp Browser SDK",
};

const WORKLET_SAMPLE_RATE = 48_000;
const MAX_CHANNELS = 2;

let rnnoiseBinaryPromise: Promise<ArrayBuffer> | null = null;
let localAudioGateContext: AudioContext | null = null;
let localAudioGateContextUsers = 0;
type RnnoiseModule = typeof import("@sapphi-red/web-noise-suppressor");

function getLocalAudioGateContext(): AudioContext | null {
  if (localAudioGateContext) return localAudioGateContext;
  if (typeof AudioContext === "undefined") return null;
  try {
    localAudioGateContext = new AudioContext({
      sampleRate: WORKLET_SAMPLE_RATE,
    });
    return localAudioGateContext;
  } catch {
    return null;
  }
}

export function prepareLocalAudioGateContext(): void {
  localAudioGateContextUsers += 1;
  const context = getLocalAudioGateContext();
  context?.resume().catch(() => {});
}

export function resumeLocalAudioGateContext(): Promise<void> {
  const context = localAudioGateContext;
  if (context?.state === "suspended") return context.resume().catch(() => {});
  return Promise.resolve();
}

export function closeLocalAudioGateContext(): void {
  localAudioGateContextUsers = Math.max(0, localAudioGateContextUsers - 1);
  if (localAudioGateContextUsers > 0) return;
  const context = localAudioGateContext;
  localAudioGateContext = null;
  context?.close().catch(() => {});
}

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

export function createLocalAudioGate(
  stream: MediaStream,
): LocalAudioGateHandle | null {
  const inputTrack = stream.getAudioTracks()[0];
  if (!inputTrack) return null;

  const context = getLocalAudioGateContext();
  if (!context || context.state === "suspended") return null;
  let source: MediaStreamAudioSourceNode | null = null;
  let inputClone: MediaStreamTrack | null = null;
  let outputTrack: MediaStreamTrack | null = null;
  let gain: GainNode | null = null;
  let destroyed = false;

  try {
    inputClone = inputTrack.clone();
    source = context.createMediaStreamSource(new MediaStream([inputClone]));
    gain = context.createGain();
    const destination = context.createMediaStreamDestination();

    configureChannelGraph(
      source,
      destination,
      getEffectiveChannelCount(inputTrack),
    );
    source.connect(gain);
    gain.connect(destination);
    gain.gain.value = 1;
    resumeLocalAudioGateContext();

    outputTrack = destination.stream.getAudioTracks()[0] ?? null;
    if (!outputTrack) {
      throw new Error("Audio gate did not produce an output track");
    }
    outputTrack.contentHint = "speech";

    return {
      outputStream: new MediaStream([outputTrack]),
      gateController: {
        setGated: (gated) => {
          if (!destroyed && gain) gain.gain.value = gated ? 0 : 1;
        },
        resume: () => {
          if (!destroyed && context.state === "suspended") {
            context.resume().catch(() => {});
          }
        },
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        try {
          source?.disconnect();
        } catch {
          // Ignore teardown races.
        }
        try {
          gain?.disconnect();
        } catch {
          // Ignore teardown races.
        }
        outputTrack?.stop();
        inputClone?.stop();
      },
    };
  } catch {
    try {
      source?.disconnect();
    } catch {
      // Ignore teardown races.
    }
    try {
      gain?.disconnect();
    } catch {
      // Ignore teardown races.
    }
    outputTrack?.stop();
    inputClone?.stop();
    return null;
  }
}

function createAudioProcessorHandle({
  mode,
  context,
  inputTrack,
  source,
  preGateDestination,
  publicationDestination,
  gateGain,
  destroyProcessedNode,
}: {
  mode: LocalAudioProcessingMode;
  context: AudioContext;
  inputTrack: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  preGateDestination: MediaStreamAudioDestinationNode;
  publicationDestination: MediaStreamAudioDestinationNode;
  gateGain: GainNode;
  destroyProcessedNode?: () => void;
}): LocalAudioProcessorHandle | null {
  const preGateTrack = preGateDestination.stream.getAudioTracks()[0] ?? null;
  const publicationTrack =
    publicationDestination.stream.getAudioTracks()[0] ?? null;
  if (!preGateTrack || !publicationTrack) return null;

  preGateTrack.contentHint = "speech";
  publicationTrack.contentHint = "speech";
  let destroyed = false;

  return {
    mode,
    preGateStream: preGateDestination.stream,
    publicationStream: publicationDestination.stream,
    createMonitorStream: () => new MediaStream([preGateTrack.clone()]),
    gateController: {
      setGated: (gated) => {
        if (!destroyed) gateGain.gain.value = gated ? 0 : 1;
      },
      resume: () => {
        if (!destroyed && context.state === "suspended") {
          context.resume().catch(() => {});
        }
      },
    },
    resume: () => {
      if (!destroyed && context.state === "suspended") {
        context.resume().catch(() => {});
      }
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      destroyProcessedNode?.();
      try {
        source.disconnect();
      } catch {
        // Ignore teardown races.
      }
      try {
        gateGain.disconnect();
      } catch {
        // Ignore teardown races.
      }
      try {
        preGateDestination.disconnect();
      } catch {
        // Ignore teardown races.
      }
      try {
        publicationDestination.disconnect();
      } catch {
        // Ignore teardown races.
      }
      preGateTrack.stop();
      publicationTrack.stop();
      inputTrack.stop();
      context.close().catch(() => {});
    },
  };
}

function createIdentityProcessor(
  track: MediaStreamTrack,
  mode: "passthrough" | "true-stereo" = "passthrough",
): LocalAudioProcessorHandle | null {
  let context: AudioContext | null = null;
  let inputTrack: MediaStreamTrack | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let preGateDestination: MediaStreamAudioDestinationNode | null = null;
  let publicationDestination: MediaStreamAudioDestinationNode | null = null;
  let gateGain: GainNode | null = null;

  try {
    context = new AudioContext({ sampleRate: WORKLET_SAMPLE_RATE });
    inputTrack = track.clone();
    source = context.createMediaStreamSource(new MediaStream([inputTrack]));
    preGateDestination = context.createMediaStreamDestination();
    publicationDestination = context.createMediaStreamDestination();
    gateGain = context.createGain();

    const channelCount = getEffectiveChannelCount(track);
    configureChannelGraph(source, preGateDestination, channelCount);
    configureChannelGraph(source, publicationDestination, channelCount);
    source.connect(preGateDestination);
    source.connect(gateGain);
    gateGain.connect(publicationDestination);
    gateGain.gain.value = 1;
    context.resume().catch(() => {});

    const processor = createAudioProcessorHandle({
      mode,
      context,
      inputTrack,
      source,
      preGateDestination,
      publicationDestination,
      gateGain,
    });
    if (processor) return processor;
  } catch {
    // Fall through to the common cleanup below.
  }

  try {
    source?.disconnect();
  } catch {
    // Ignore teardown races.
  }
  try {
    gateGain?.disconnect();
  } catch {
    // Ignore teardown races.
  }
  preGateDestination?.stream.getTracks().forEach((outputTrack) => {
    outputTrack.stop();
  });
  publicationDestination?.stream.getTracks().forEach((outputTrack) => {
    outputTrack.stop();
  });
  inputTrack?.stop();
  context?.close().catch(() => {});
  return null;
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

async function createRnnoiseProcessor(
  track: MediaStreamTrack,
): Promise<LocalAudioProcessorHandle> {
  let context: AudioContext | null = null;
  let inputTrack: MediaStreamTrack | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let rnnoiseNode: { destroy: () => void; disconnect: () => void } | null =
    null;
  let preGateDestination: MediaStreamAudioDestinationNode | null = null;
  let publicationDestination: MediaStreamAudioDestinationNode | null = null;
  let gateGain: GainNode | null = null;
  try {
    context = new AudioContext({ sampleRate: WORKLET_SAMPLE_RATE });
    const { RnnoiseWorkletNode, loadRnnoise } =
      await import("@sapphi-red/web-noise-suppressor");
    await context.audioWorklet.addModule(rnnoiseWorkletUrl);

    const wasmBinary = await loadRnnoiseBinaryOnce(loadRnnoise);
    inputTrack = track.clone();
    const sourceStream = new MediaStream([inputTrack]);
    source = context.createMediaStreamSource(sourceStream);
    preGateDestination = context.createMediaStreamDestination();
    publicationDestination = context.createMediaStreamDestination();
    const channelCount = getEffectiveChannelCount(track);

    configureChannelGraph(source, preGateDestination, channelCount);
    configureChannelGraph(source, publicationDestination, channelCount);

    const rnnoise = new RnnoiseWorkletNode(context, {
      maxChannels: channelCount,
      wasmBinary,
    });
    rnnoiseNode = rnnoise;
    gateGain = context.createGain();

    source.connect(rnnoise);
    rnnoise.connect(preGateDestination);
    rnnoise.connect(gateGain);
    gateGain.connect(publicationDestination);
    gateGain.gain.value = 1;
    context.resume().catch(() => {});

    const processor = createAudioProcessorHandle({
      mode: "rnnoise",
      context,
      inputTrack,
      source,
      preGateDestination,
      publicationDestination,
      gateGain,
      destroyProcessedNode: () => {
        rnnoise.destroy();
        try {
          rnnoise.disconnect();
        } catch {
          // Ignore teardown races.
        }
      },
    });
    if (!processor) throw new Error("RNNoise did not produce output tracks");
    return processor;
  } catch (error) {
    rnnoiseNode?.destroy();
    try {
      rnnoiseNode?.disconnect();
    } catch {
      // Ignore teardown races.
    }
    try {
      source?.disconnect();
    } catch {
      // Ignore teardown races.
    }
    try {
      gateGain?.disconnect();
    } catch {
      // Ignore teardown races.
    }
    preGateDestination?.stream
      .getTracks()
      .forEach((outputTrack) => outputTrack.stop());
    publicationDestination?.stream
      .getTracks()
      .forEach((outputTrack) => outputTrack.stop());
    inputTrack?.stop();
    context?.close().catch(() => {});
    throw error;
  }
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
  if (
    mode === "rnnoise" &&
    isNoiseReductionProviderSupported(settings.noiseReductionProvider)
  ) {
    try {
      return await createRnnoiseProcessor(audioTrack);
    } catch {
      return createIdentityProcessor(audioTrack);
    }
  }

  if (mode === "true-stereo") {
    return (
      createIdentityProcessor(audioTrack, "true-stereo") ??
      createIdentityProcessor(audioTrack)
    );
  }

  return createIdentityProcessor(audioTrack);
}
