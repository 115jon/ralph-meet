import InlineEmojiText from "@/components/chat/InlineEmojiText";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { useMediaDevices } from "@/lib/useMediaDevices";
import {
  NOISE_REDUCTION_PROVIDER_LABELS,
  isNoiseReductionProviderSupported,
  type VoiceAudioProcessingSettings,
} from "@/lib/voice/noise-reduction";
import type { VoiceInputProfile } from "@/lib/voice/input-profiles";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import {
  AudioWaveform,
  Check,
  ExternalLink,
  Headphones,
  Mic,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/shallow";
import { MicTestWidget } from "./MicTestWidget";
import { InputSensitivityMeter } from "./InputSensitivityMeter";
import { SettingsSoundboardTriggers } from "./SettingsSoundboardTriggers";
import { AudioCompatibilityHint } from "./AudioCompatibilityHint";

function VoiceSettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold text-rm-text">{title}</div>
        {description && (
          <p className="max-w-[560px] text-xs leading-5 text-rm-text-muted">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function VolumeSlider({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-3" htmlFor={id}>
      <span className="flex items-center justify-between gap-3 text-sm font-semibold text-rm-text">
        <span>{label}</span>
        <span className="tabular-nums text-xs font-medium text-rm-text-muted">
          {value}%
        </span>
      </span>
      <input
        id={id}
        type="range"
        min="0"
        max="200"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-ew-resize appearance-none rounded-full bg-rm-bg-elevated accent-rm-accent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-ew-resize [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-ew-resize [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
      />
    </label>
  );
}

const INPUT_PROFILES: Array<[VoiceInputProfile, string, string]> = [
  ["standard", "Voice isolation", "Balanced processing for everyday voice."],
  ["studio", "Studio", "Pure stereo input with processing disabled."],
  ["custom", "Custom", "Choose the processing controls below."],
];

export default function SettingsVoiceTab() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const servers = useChatStore((state) => state.servers);
  const { audioInputs, audioOutputs } = useMediaDevices();
  const vSettings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
  const selectedProfile = vSettings.inputProfile;
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateVoiceSettings = useVoiceSettingsStore(
    (s) => s.updateVoiceSettings,
  );
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const setInputProfileStore = useVoiceSettingsStore((s) => s.setInputProfile);
  const setCurrentUser = useVoiceSettingsStore((s) => s.setCurrentUser);
  const noiseReductionSupported = isNoiseReductionProviderSupported(
    vSettings.noiseReductionProvider,
  );
  const audioProcessing = useMemo<VoiceAudioProcessingSettings>(
    () => ({
      noiseSuppression: vSettings.noiseSuppression,
      echoCancellation: vSettings.echoCancellation,
      autoSensitivity: vSettings.autoSensitivity,
      streamHighFidelity: vSettings.streamHighFidelity,
      noiseReductionEnabled:
        noiseReductionSupported && vSettings.noiseReductionEnabled,
      noiseReductionProvider: vSettings.noiseReductionProvider,
    }),
    [
      noiseReductionSupported,
      vSettings.autoSensitivity,
      vSettings.echoCancellation,
      vSettings.noiseReductionEnabled,
      vSettings.noiseReductionProvider,
      vSettings.noiseSuppression,
      vSettings.streamHighFidelity,
    ],
  );

  useEffect(() => {
    const initStore = () => {
      if (settingsUserId) {
        const storeUser = useVoiceSettingsStore.getState().currentUser;
        if (!storeUser || !storeUser.startsWith("room-")) {
          setCurrentUser(settingsUserId);
        }
      }
    };
    initStore();
  }, [settingsUserId, setCurrentUser]);

  const handleVoiceToggle = (key: string) => {
    updateVoiceSettings((s: any) => {
      const newVal = !s[key];
      const updates: any = { [key]: newVal };

      if (key === "streamHighFidelity" && newVal) {
        updates.echoCancellation = false;
        updates.noiseSuppression = false;
      }

      if (key === "spatialAudioEnabled" && newVal) {
        updates.streamHighFidelity = true;
        updates.echoCancellation = false;
        updates.noiseSuppression = false;
      }

      if (key === "noiseReductionEnabled" && newVal) {
        updates.noiseSuppression = false;
      }

      if (key === "noiseSuppression" && newVal) {
        updates.noiseReductionEnabled = false;
        updates.streamHighFidelity = false;
      }

      if (
        (key === "echoCancellation" || key === "noiseSuppression") &&
        newVal
      ) {
        updates.streamHighFidelity = false;
      }

      return { ...s, ...updates };
    }, settingsUserId ?? undefined);
  };

  const handleVoiceSlider = (key: string, val: number) => {
    const update =
      key === "sensitivity" ? updateVoiceSettings : updateUserSettings;
    update((s: any) => ({ ...s, [key]: val }), settingsUserId ?? undefined);
  };

  const filteredAudioInputs = audioInputs.filter(
    (d) => d.deviceId !== "default",
  );
  const filteredAudioOutputs = audioOutputs.filter(
    (d) => d.deviceId !== "default",
  );
  const defaultAudioInput = audioInputs.find((d) => d.deviceId === "default");
  const defaultAudioOutput = audioOutputs.find((d) => d.deviceId === "default");

  const setInputProfile = (profile: VoiceInputProfile) => {
    setInputProfileStore(profile, settingsUserId ?? undefined);
  };

  const setNoiseReductionProvider = (provider: string) => {
    const enabled = provider === "rnnoise" && noiseReductionSupported;
    updateVoiceSettings(
      (current) => ({
        ...current,
        noiseReductionProvider:
          provider as typeof current.noiseReductionProvider,
        noiseReductionEnabled: enabled,
        noiseSuppression: enabled ? false : current.noiseSuppression,
      }),
      settingsUserId ?? undefined,
    );
  };

  const deviceOptions = {
    input: [
      {
        value: "default",
        label: defaultAudioInput?.label || "Default microphone",
        icon: <Mic size={16} />,
      },
      ...filteredAudioInputs.map((device) => ({
        value: device.deviceId,
        label: device.label || `Microphone ${device.deviceId.slice(0, 5)}`,
        icon: <Mic size={16} />,
      })),
    ],
    output: [
      {
        value: "default",
        label: defaultAudioOutput?.label || "Default speaker",
        icon: <Headphones size={16} />,
      },
      ...filteredAudioOutputs.map((device) => ({
        value: device.deviceId,
        label: device.label || `Speaker ${device.deviceId.slice(0, 5)}`,
        icon: <Headphones size={16} />,
      })),
    ],
  };

  return (
    <div className="animate-in fade-in duration-150">
      <h1 className="mb-2 hidden text-2xl font-bold text-rm-text md:block">
        Voice
      </h1>
      <p className="mb-8 text-sm text-rm-text-muted">
        Tune your microphone, speaker, and voice processing.
      </p>

      <div className="space-y-8">
        <section className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-rm-text">
                <Mic size={16} className="text-rm-text-muted" />
                Microphone
              </label>
              <Select
                value={vSettings.inputDeviceId}
                onValueChange={(value) => {
                  const device = audioInputs.find(
                    (item) => item.deviceId === value,
                  );
                  setDevice("input", value, settingsUserId ?? undefined, {
                    label: device?.label,
                    groupId: device?.groupId,
                  });
                }}
              >
                <SelectTrigger
                  aria-label="Select microphone"
                  className="w-full h-11 rounded-lg border-rm-border bg-rm-bg-surface px-3 text-sm text-rm-text hover:bg-rm-bg-elevated"
                >
                  <SelectValue placeholder="Select microphone" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  className="rounded-xl border-rm-border bg-rm-bg-floating p-1.5 text-rm-text shadow-2xl"
                >
                  {deviceOptions.input.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      textValue={option.label}
                      className="text-rm-text-secondary hover:bg-rm-bg-elevated hover:text-rm-text focus:bg-rm-bg-elevated focus:text-rm-text"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {option.icon}
                        <InlineEmojiText text={option.label} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-rm-text">
                <Headphones size={16} className="text-rm-text-muted" />
                Speaker
              </label>
              <Select
                value={vSettings.outputDeviceId}
                onValueChange={(value) => {
                  const device = audioOutputs.find(
                    (item) => item.deviceId === value,
                  );
                  setDevice("output", value, settingsUserId ?? undefined, {
                    label: device?.label,
                    groupId: device?.groupId,
                  });
                }}
              >
                <SelectTrigger
                  aria-label="Select speaker"
                  className="w-full h-11 rounded-lg border-rm-border bg-rm-bg-surface px-3 text-sm text-rm-text hover:bg-rm-bg-elevated"
                >
                  <SelectValue placeholder="Select speaker" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  className="rounded-xl border-rm-border bg-rm-bg-floating p-1.5 text-rm-text shadow-2xl"
                >
                  {deviceOptions.output.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      textValue={option.label}
                      className="text-rm-text-secondary hover:bg-rm-bg-elevated hover:text-rm-text focus:bg-rm-bg-elevated focus:text-rm-text"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {option.icon}
                        <InlineEmojiText text={option.label} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <VolumeSlider
              id="microphone-volume"
              label="Microphone volume"
              value={vSettings.inputVolume}
              onChange={(value) => handleVoiceSlider("inputVolume", value)}
            />
            <VolumeSlider
              id="speaker-volume"
              label="Speaker volume"
              value={vSettings.outputVolume}
              onChange={(value) => handleVoiceSlider("outputVolume", value)}
            />
          </div>

          <MicTestWidget
            sensitivity={vSettings.sensitivity}
            autoSensitivity={vSettings.autoSensitivity}
            inputDeviceId={vSettings.inputDeviceId}
            outputDeviceId={vSettings.outputDeviceId}
            processing={audioProcessing}
          />
        </section>

        <div className="border-t border-rm-border" />

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-rm-text">
            Input profile
          </h2>
          <div className="divide-y divide-rm-border">
            {INPUT_PROFILES.map(([value, label, description]) => (
              <button
                key={value}
                type="button"
                onClick={() => setInputProfile(value)}
                className="flex w-full items-start gap-3 py-3 text-left"
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                    selectedProfile === value
                      ? "border-rm-accent bg-rm-accent text-white"
                      : "border-rm-text-muted/60"
                  }`}
                >
                  {selectedProfile === value && (
                    <Check size={12} strokeWidth={3} />
                  )}
                </span>
                <span>
                  <span className="block text-sm font-medium text-rm-text">
                    {label}
                  </span>
                  <span className="block text-xs leading-5 text-rm-text-muted">
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {selectedProfile === "custom" ? (
            <>
              <VoiceSettingRow
                title="Automatically adjust input sensitivity"
                description="Let the voice detector adapt to your microphone level."
              >
                <SettingsSwitch
                  checked={vSettings.autoSensitivity}
                  onChange={() => handleVoiceToggle("autoSensitivity")}
                  ariaLabel="Automatically adjust input sensitivity"
                />
              </VoiceSettingRow>

              <InputSensitivityMeter
                autoSensitivity={vSettings.autoSensitivity}
                inputDeviceId={vSettings.inputDeviceId}
                processing={audioProcessing}
                value={vSettings.sensitivity}
                onCommit={(value) => handleVoiceSlider("sensitivity", value)}
              />

              <VoiceSettingRow
                title="Noise suppression"
                description={
                  <>
                    Reduce background noise with{" "}
                    <a
                      href="https://github.com/xiph/rnnoise"
                      target="_blank"
                      rel="noreferrer"
                      className="text-rm-accent hover:underline"
                    >
                      RNNoise <ExternalLink size={11} className="inline" />
                    </a>
                    .{" "}
                    <AudioCompatibilityHint>
                      RNNoise replaces browser noise suppression while active,
                      but it remains compatible with high fidelity, spatial
                      audio, echo cancellation, and input sensitivity.
                    </AudioCompatibilityHint>
                  </>
                }
              >
                <Select
                  value={vSettings.noiseReductionEnabled ? "rnnoise" : "none"}
                  onValueChange={setNoiseReductionProvider}
                >
                  <SelectTrigger
                    aria-label="Select noise suppression"
                    className="h-10 min-w-[180px] rounded-lg border-rm-border bg-rm-bg-surface px-3 text-sm text-rm-text hover:bg-rm-bg-elevated"
                  >
                    <SelectValue placeholder="Select noise suppression" />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    align="start"
                    className="rounded-xl border-rm-border bg-rm-bg-floating p-1.5 text-rm-text shadow-2xl"
                  >
                    {[
                      {
                        value: "none",
                        label: "None",
                        icon: <AudioWaveform size={16} />,
                      },
                      {
                        value: "rnnoise",
                        label:
                          NOISE_REDUCTION_PROVIDER_LABELS.rnnoise ?? "RNNoise",
                        icon: <AudioWaveform size={16} />,
                      },
                    ].map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        textValue={option.label}
                        className="text-rm-text-secondary hover:bg-rm-bg-elevated hover:text-rm-text focus:bg-rm-bg-elevated focus:text-rm-text"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {option.icon}
                          <InlineEmojiText text={option.label} />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </VoiceSettingRow>

              <VoiceSettingRow
                title="Browser noise suppression"
                description={
                  <>
                    Use the browser's built-in noise suppression path.
                    <AudioCompatibilityHint>
                      Browser noise suppression is disabled when RNNoise or high
                      fidelity audio is active.
                    </AudioCompatibilityHint>
                  </>
                }
              >
                <SettingsSwitch
                  checked={vSettings.noiseSuppression}
                  onChange={() => handleVoiceToggle("noiseSuppression")}
                  ariaLabel="Toggle browser noise suppression"
                />
              </VoiceSettingRow>
              <VoiceSettingRow
                title="Echo cancellation"
                description={
                  <>
                    Reduce microphone pickup from your speaker output.
                    <AudioCompatibilityHint>
                      Echo cancellation is unavailable with high fidelity audio
                      because high fidelity disables browser capture processing.
                      It remains compatible with RNNoise.
                    </AudioCompatibilityHint>
                  </>
                }
              >
                <SettingsSwitch
                  checked={vSettings.echoCancellation}
                  onChange={() => handleVoiceToggle("echoCancellation")}
                  ariaLabel="Toggle echo cancellation"
                />
              </VoiceSettingRow>
              <VoiceSettingRow
                title="High fidelity audio"
                description={
                  <>
                    Keep stereo microphone input with browser processing
                    disabled.
                    <AudioCompatibilityHint>
                      High fidelity disables browser noise suppression and echo
                      cancellation. RNNoise, spatial audio, and input
                      sensitivity remain available.
                    </AudioCompatibilityHint>
                  </>
                }
              >
                <SettingsSwitch
                  checked={vSettings.streamHighFidelity}
                  onChange={() => handleVoiceToggle("streamHighFidelity")}
                  ariaLabel="Toggle high fidelity audio"
                />
              </VoiceSettingRow>
              <VoiceSettingRow
                title="Spatial audio"
                description={
                  <>
                    Hear room placement with stereo panning.
                    <AudioCompatibilityHint>
                      Spatial audio enables high fidelity capture, so browser
                      noise suppression and echo cancellation are unavailable.
                      RNNoise remains compatible.
                    </AudioCompatibilityHint>
                  </>
                }
              >
                <SettingsSwitch
                  checked={vSettings.spatialAudioEnabled}
                  onChange={() => handleVoiceToggle("spatialAudioEnabled")}
                  ariaLabel="Toggle spatial audio"
                />
              </VoiceSettingRow>
            </>
          ) : (
            <p className="py-4 text-xs leading-5 text-rm-text-muted">
              Select Custom to tune sensitivity, noise suppression, echo
              cancellation, and high fidelity audio.
            </p>
          )}
        </section>

        <div className="border-t border-rm-border" />

        <SettingsSoundboardTriggers userId={settingsUserId} servers={servers} />

        <div className="border-t border-rm-border" />

        <VoiceSettingRow
          title="Always show stream preview"
          description="Keep your stream preview visible while the app is unfocused."
        >
          <SettingsSwitch
            checked={!!vSettings.alwaysShowStreamPreview}
            onChange={() => handleVoiceToggle("alwaysShowStreamPreview")}
            ariaLabel="Always show stream preview"
          />
        </VoiceSettingRow>
      </div>
    </div>
  );
}
