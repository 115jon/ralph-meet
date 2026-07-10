interface ListenTogetherLoudnessPresetConfig {
  compressorThresholdDb: number;
  compressorKneeDb: number;
  compressorRatio: number;
  compressorAttackSeconds: number;
  compressorReleaseSeconds: number;
  makeupGainDb: number;
  limiterCeilingDb: number;
}

export const LISTEN_TOGETHER_LOUDNESS_PRESETS = {
  "peak-protection": {
    label: "Protect",
    compressorThresholdDb: 0,
    compressorKneeDb: 0,
    compressorRatio: 1,
    compressorAttackSeconds: 0.003,
    compressorReleaseSeconds: 0.1,
    makeupGainDb: 0,
    limiterCeilingDb: -1,
  },
  balanced: {
    label: "Balanced",
    compressorThresholdDb: -18,
    compressorKneeDb: 9,
    compressorRatio: 2.5,
    compressorAttackSeconds: 0.01,
    compressorReleaseSeconds: 0.25,
    makeupGainDb: 2,
    limiterCeilingDb: -1,
  },
  night: {
    label: "Night",
    compressorThresholdDb: -30,
    compressorKneeDb: 12,
    compressorRatio: 6,
    compressorAttackSeconds: 0.005,
    compressorReleaseSeconds: 0.35,
    makeupGainDb: 6,
    limiterCeilingDb: -2,
  },
} as const satisfies Record<string, ListenTogetherLoudnessPresetConfig & { label: string }>;

export type ListenTogetherLoudnessPreset = keyof typeof LISTEN_TOGETHER_LOUDNESS_PRESETS;
export const LISTEN_TOGETHER_LOUDNESS_PRESET_OPTIONS = Object.entries(
  LISTEN_TOGETHER_LOUDNESS_PRESETS,
) as [ListenTogetherLoudnessPreset, (typeof LISTEN_TOGETHER_LOUDNESS_PRESETS)[ListenTogetherLoudnessPreset]][];

export interface ListenTogetherAudioSettings {
  enabled: boolean;
  preset: ListenTogetherLoudnessPreset;
}

function toGain(db: number) {
  return 10 ** (db / 20);
}

export function getListenTogetherLoudnessPreset(preset: ListenTogetherLoudnessPreset) {
  return LISTEN_TOGETHER_LOUDNESS_PRESETS[preset];
}

export class ListenTogetherAudioProcessor {
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private makeupGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private volumeGain: GainNode | null = null;

  connect(audio: HTMLAudioElement, context: AudioContext): boolean {
    if (this.source) return true;
    try {
      const source = context.createMediaElementSource(audio);
      const compressor = context.createDynamicsCompressor();
      const makeupGain = context.createGain();
      const limiter = context.createDynamicsCompressor();
      const volumeGain = context.createGain();

      // The final compressor only catches near-clipping peaks after leveling.
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.1;

      source.connect(compressor);
      compressor.connect(makeupGain);
      makeupGain.connect(limiter);
      limiter.connect(volumeGain);
      volumeGain.connect(context.destination);

      this.context = context;
      this.source = source;
      this.compressor = compressor;
      this.makeupGain = makeupGain;
      this.limiter = limiter;
      this.volumeGain = volumeGain;
      return true;
    } catch {
      return false;
    }
  }

  applySettings(settings: ListenTogetherAudioSettings) {
    const context = this.context;
    const compressor = this.compressor;
    const makeupGain = this.makeupGain;
    const limiter = this.limiter;
    if (!context || !compressor || !makeupGain || !limiter) return;

    const preset = getListenTogetherLoudnessPreset(settings.preset);
    const now = context.currentTime;
    const apply = (parameter: AudioParam, value: number) => {
      parameter.setTargetAtTime(value, now, 0.03);
    };

    if (!settings.enabled) {
      apply(compressor.threshold, 0);
      apply(compressor.knee, 0);
      apply(compressor.ratio, 1);
      apply(makeupGain.gain, 1);
      apply(limiter.threshold, 0);
      apply(limiter.ratio, 1);
      return;
    }

    apply(compressor.threshold, preset.compressorThresholdDb);
    apply(compressor.knee, preset.compressorKneeDb);
    apply(compressor.ratio, preset.compressorRatio);
    apply(compressor.attack, preset.compressorAttackSeconds);
    apply(compressor.release, preset.compressorReleaseSeconds);
    apply(makeupGain.gain, toGain(preset.makeupGainDb));
    apply(limiter.threshold, preset.limiterCeilingDb);
    apply(limiter.ratio, 20);
  }

  setVolume(volume: number) {
    const context = this.context;
    const volumeGain = this.volumeGain;
    if (!context || !volumeGain) return;
    volumeGain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), context.currentTime, 0.03);
  }

  close() {
    this.source?.disconnect();
    this.compressor?.disconnect();
    this.makeupGain?.disconnect();
    this.limiter?.disconnect();
    this.volumeGain?.disconnect();
    this.context = null;
    this.source = null;
    this.compressor = null;
    this.makeupGain = null;
    this.limiter = null;
    this.volumeGain = null;
    // The context belongs to the SFU pipeline and may still be playing voice tracks.
  }
}
