export type VoiceInputProfile = "standard" | "studio" | "custom";

export interface VoiceInputProfileSettings {
  noiseSuppression: boolean;
  noiseReductionEnabled: boolean;
  echoCancellation: boolean;
  autoSensitivity: boolean;
  streamHighFidelity: boolean;
  spatialAudioEnabled: boolean;
}

export const VOICE_INPUT_PROFILE_SETTINGS = {
  standard: {
    noiseSuppression: true,
    noiseReductionEnabled: false,
    echoCancellation: true,
    autoSensitivity: false,
    streamHighFidelity: false,
    spatialAudioEnabled: false,
  },
  studio: {
    noiseSuppression: false,
    noiseReductionEnabled: false,
    echoCancellation: false,
    autoSensitivity: false,
    streamHighFidelity: true,
    spatialAudioEnabled: false,
  },
} satisfies Record<
  Exclude<VoiceInputProfile, "custom">,
  VoiceInputProfileSettings
>;
