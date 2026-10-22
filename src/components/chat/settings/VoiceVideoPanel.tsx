import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { Icon } from "@/components/ui/icon";
import { useMediaDevices } from "@/lib/useMediaDevices";
import type { VoiceInputProfile } from "@/lib/voice/input-profiles";
import {
  NOISE_REDUCTION_PROVIDER_LABELS,
  isNoiseReductionProviderSupported,
  type VoiceAudioProcessingSettings,
} from "@/lib/voice/noise-reduction";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useUser } from "@kova/react";
import { useEffect, useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/shallow";
import { AudioCompatibilityHint } from "../AudioCompatibilityHint";
import { InputSensitivityMeter } from "../InputSensitivityMeter";
import CameraCard from "./CameraCard";
import {
  RadioList,
  RangeControl,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  type RowIds,
  type SelectOption,
} from "./primitives";

/**
 * Voice settings for the signed-in user, with the processing chain the mic
 * test and meters should use. Shared by the panel and its preview rail.
 */
export function useVoiceSettingsForSettings() {
  const { user } = useUser();
  const settingsUserId = user?.id ?? null;
  const vSettings = useVoiceSettingsStore(
    useShallow((s) => s.getSettings(settingsUserId)),
  );
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
    if (!settingsUserId) return;
    const storeUser = useVoiceSettingsStore.getState().currentUser;
    if (!storeUser || !storeUser.startsWith("room-")) {
      setCurrentUser(settingsUserId);
    }
  }, [settingsUserId, setCurrentUser]);

  return {
    settingsUserId,
    vSettings,
    audioProcessing,
    noiseReductionSupported,
  };
}

/**
 * Device lists without the entries a browser reports before permission is
 * granted (empty id), which no picker can select, and without "default",
 * which gets its own labelled option.
 */
export function useDeviceOptions() {
  const { audioInputs, audioOutputs } = useMediaDevices();
  return useMemo(() => {
    const build = (
      devices: typeof audioInputs,
      fallback: string,
      unnamed: string,
      icon: SelectOption["icon"],
    ): SelectOption[] => {
      const defaultDevice = devices.find((d) => d.deviceId === "default");
      return [
        { value: "default", label: defaultDevice?.label || fallback, icon },
        ...devices
          .filter((d) => d.deviceId && d.deviceId !== "default")
          .map((device) => ({
            value: device.deviceId,
            label: device.label || `${unnamed} ${device.deviceId.slice(0, 5)}`,
            icon,
          })),
      ];
    };
    return {
      audioInputs,
      audioOutputs,
      input: build(audioInputs, "Default microphone", "Microphone", "mic"),
      output: build(audioOutputs, "Default speaker", "Speaker", "headphones"),
    };
  }, [audioInputs, audioOutputs]);
}

const INPUT_PROFILES: Array<{
  value: VoiceInputProfile;
  label: string;
  desc: string;
}> = [
  {
    value: "standard",
    label: "Voice isolation",
    desc: "Balanced processing for everyday voice.",
  },
  {
    value: "studio",
    label: "Studio",
    desc: "Pure stereo input with processing off.",
  },
  { value: "custom", label: "Custom", desc: "Set each option below." },
];

function SwitchControl({
  ids,
  checked,
  onChange,
  disabled,
}: {
  ids: RowIds;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <SettingsSwitch
      checked={checked}
      onChange={onChange}
      labelledBy={ids.labelId}
      describedBy={ids.descId}
      disabled={disabled}
    />
  );
}

function Hinted({ text, hint }: { text: ReactNode; hint: string }) {
  return (
    <>
      {text}
      <AudioCompatibilityHint>{hint}</AudioCompatibilityHint>
    </>
  );
}

export default function VoiceVideoPanel() {
  const {
    settingsUserId,
    vSettings,
    audioProcessing,
    noiseReductionSupported,
  } = useVoiceSettingsForSettings();
  const devices = useDeviceOptions();
  const setDevice = useVoiceSettingsStore((s) => s.setDevice);
  const updateVoiceSettings = useVoiceSettingsStore(
    (s) => s.updateVoiceSettings,
  );
  const updateUserSettings = useVoiceSettingsStore((s) => s.updateUserSettings);
  const setInputProfileStore = useVoiceSettingsStore((s) => s.setInputProfile);
  const custom = vSettings.inputProfile === "custom";

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

  const selectDevice = (kind: "input" | "output", value: string) => {
    const list = kind === "input" ? devices.audioInputs : devices.audioOutputs;
    const device = list.find((item) => item.deviceId === value);
    setDevice(kind, value, settingsUserId ?? undefined, {
      label: device?.label,
      groupId: device?.groupId,
    });
  };

  const renderDeviceLabel = (option: SelectOption) => (
    <InlineEmojiText text={option.label} />
  );

  return (
    <>
      <SettingsCard id="input">
        <SettingsRow id="microphone">
          {(ids) => (
            <SettingsSelect
              ids={ids}
              value={vSettings.inputDeviceId}
              options={devices.input}
              onValueChange={(value) => selectDevice("input", value)}
              placeholder="Choose a microphone"
              renderLabel={renderDeviceLabel}
            />
          )}
        </SettingsRow>
        <SettingsRow id="input-volume">
          {(ids) => (
            <RangeControl
              ids={ids}
              value={vSettings.inputVolume}
              max={200}
              onChange={(value) => handleVoiceSlider("inputVolume", value)}
            />
          )}
        </SettingsRow>
        <SettingsRow id="input-profile" layout="block">
          {(ids) => (
            <RadioList
              ids={ids}
              name="voice-input-profile"
              value={vSettings.inputProfile}
              options={INPUT_PROFILES}
              onChange={(profile) =>
                setInputProfileStore(profile, settingsUserId ?? undefined)
              }
            />
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        id="processing"
        description={
          custom
            ? "Changes apply to your mic right away."
            : "Set by your input profile. Choose Custom to change these."
        }
      >
        <SettingsRow id="auto-sensitivity" layout="inline" disabled={!custom}>
          {(ids) => (
            <SwitchControl
              ids={ids}
              checked={vSettings.autoSensitivity}
              onChange={() => handleVoiceToggle("autoSensitivity")}
              disabled={!custom}
            />
          )}
        </SettingsRow>
        <SettingsRow
          id="sensitivity"
          layout="block"
          disabled={!custom || vSettings.autoSensitivity}
          description={
            !custom
              ? "Set by your input profile."
              : vSettings.autoSensitivity
                ? "Automatic. Turn off automatic sensitivity to drag the marker."
                : "Sound above the marker is sent. Talk to see your level."
          }
        >
          {(ids) =>
            custom ? (
              <InputSensitivityMeter
                labelledBy={ids.labelId}
                autoSensitivity={vSettings.autoSensitivity}
                inputDeviceId={vSettings.inputDeviceId}
                processing={audioProcessing}
                value={vSettings.sensitivity}
                onCommit={(value) => handleVoiceSlider("sensitivity", value)}
              />
            ) : null
          }
        </SettingsRow>
        <SettingsRow
          id="noise-suppression"
          disabled={!custom}
          description={
            <Hinted
              text={
                <>
                  Reduces background noise with{" "}
                  <a
                    href="https://github.com/xiph/rnnoise"
                    target="_blank"
                    rel="noreferrer"
                    className="text-rm-accent-ink underline-offset-[3px] pointer-fine:hover:underline"
                  >
                    RNNoise
                    <Icon
                      name="externalLink"
                      size="xs"
                      className="ml-0.5 inline align-[-1px]"
                    />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  .
                </>
              }
              hint="RNNoise replaces browser noise suppression while active, but it remains compatible with high fidelity, spatial audio, echo cancellation, and input sensitivity."
            />
          }
        >
          {(ids) => (
            <SettingsSelect
              ids={ids}
              value={vSettings.noiseReductionEnabled ? "rnnoise" : "none"}
              disabled={!custom}
              options={[
                { value: "none", label: "Off" },
                {
                  value: "rnnoise",
                  label: NOISE_REDUCTION_PROVIDER_LABELS.rnnoise ?? "RNNoise",
                },
              ]}
              onValueChange={setNoiseReductionProvider}
            />
          )}
        </SettingsRow>
        <SettingsRow
          id="browser-noise-suppression"
          layout="inline"
          disabled={!custom}
          description={
            <Hinted
              text="Uses your browser's built-in noise suppression."
              hint="Browser noise suppression is disabled when RNNoise or high fidelity audio is active."
            />
          }
        >
          {(ids) => (
            <SwitchControl
              ids={ids}
              checked={vSettings.noiseSuppression}
              onChange={() => handleVoiceToggle("noiseSuppression")}
              disabled={!custom}
            />
          )}
        </SettingsRow>
        <SettingsRow
          id="echo-cancellation"
          layout="inline"
          disabled={!custom}
          description={
            <Hinted
              text="Stops your mic picking up your speakers."
              hint="Echo cancellation is unavailable with high fidelity audio because high fidelity disables browser capture processing. It remains compatible with RNNoise."
            />
          }
        >
          {(ids) => (
            <SwitchControl
              ids={ids}
              checked={vSettings.echoCancellation}
              onChange={() => handleVoiceToggle("echoCancellation")}
              disabled={!custom}
            />
          )}
        </SettingsRow>
        <SettingsRow
          id="high-fidelity"
          layout="inline"
          disabled={!custom}
          description={
            <Hinted
              text="Keeps stereo mic input with browser processing off."
              hint="High fidelity disables browser noise suppression and echo cancellation. RNNoise, spatial audio, and input sensitivity remain available."
            />
          }
        >
          {(ids) => (
            <SwitchControl
              ids={ids}
              checked={vSettings.streamHighFidelity}
              onChange={() => handleVoiceToggle("streamHighFidelity")}
              disabled={!custom}
            />
          )}
        </SettingsRow>
        <SettingsRow
          id="spatial-audio"
          layout="inline"
          disabled={!custom}
          description={
            <Hinted
              text="Hear where people sit in the room with stereo panning."
              hint="Spatial audio enables high fidelity capture, so browser noise suppression and echo cancellation are unavailable. RNNoise remains compatible."
            />
          }
        >
          {(ids) => (
            <SwitchControl
              ids={ids}
              checked={vSettings.spatialAudioEnabled}
              onChange={() => handleVoiceToggle("spatialAudioEnabled")}
              disabled={!custom}
            />
          )}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard id="output">
        <SettingsRow id="speaker">
          {(ids) => (
            <SettingsSelect
              ids={ids}
              value={vSettings.outputDeviceId}
              options={devices.output}
              onValueChange={(value) => selectDevice("output", value)}
              placeholder="Choose a speaker"
              renderLabel={renderDeviceLabel}
            />
          )}
        </SettingsRow>
        <SettingsRow id="output-volume">
          {(ids) => (
            <RangeControl
              ids={ids}
              value={vSettings.outputVolume}
              max={200}
              onChange={(value) => handleVoiceSlider("outputVolume", value)}
            />
          )}
        </SettingsRow>
      </SettingsCard>

      <CameraCard />

      <SettingsCard id="screen-share">
        <SettingsRow id="stream-preview" layout="inline">
          {(ids) => (
            <SwitchControl
              ids={ids}
              checked={!!vSettings.alwaysShowStreamPreview}
              onChange={() => handleVoiceToggle("alwaysShowStreamPreview")}
            />
          )}
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
