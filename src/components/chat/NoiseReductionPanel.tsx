import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { cn } from "@/lib/utils";
import {
  NOISE_REDUCTION_PROVIDER_LABELS,
  isNoiseReductionProviderSupported,
  type VoiceAudioProcessingSettings,
} from "@/lib/voice/noise-reduction";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { AudioWaveform, ShieldCheck } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { MicTestWidget } from "./MicTestWidget";

interface NoiseReductionPanelProps {
  settingsUserId?: string | null;
  compact?: boolean;
  className?: string;
}

export function NoiseReductionPanel({
  settingsUserId,
  compact = false,
  className,
}: NoiseReductionPanelProps) {
  const settings = useVoiceSettingsStore(useShallow((state) => state.getSettings(settingsUserId)));
  const updateUserSettings = useVoiceSettingsStore((state) => state.updateUserSettings);
  const supported = isNoiseReductionProviderSupported(settings.noiseReductionProvider);
  const providerLabel = NOISE_REDUCTION_PROVIDER_LABELS[settings.noiseReductionProvider] ?? "RNNoise";

  const processing: VoiceAudioProcessingSettings = {
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoSensitivity: settings.autoSensitivity,
    streamHighFidelity: settings.streamHighFidelity,
    noiseReductionEnabled: supported ? settings.noiseReductionEnabled : false,
    noiseReductionProvider: settings.noiseReductionProvider,
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-rm-border bg-rm-bg-surface p-4 shadow-[0_12px_32px_rgba(0,0,0,0.18)]",
        compact ? "w-[340px] max-w-[calc(100vw-2rem)]" : "w-full",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <AudioWaveform size={16} className="text-sky-300" />
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-rm-text-muted">
              Noise Suppression
            </span>
          </div>
          <div className="space-y-1">
            <h3 className="text-[15px] font-bold text-rm-text">
              Suppress background noise before your voice leaves the app
            </h3>
            <p className="text-[12px] leading-relaxed text-rm-text-muted">
              Enable live {providerLabel} noise suppression for your outbound voice. It updates in real time while you test, and it takes priority over high-fidelity pass-through while active.
            </p>
          </div>
        </div>

        <SettingsSwitch
          checked={supported && settings.noiseReductionEnabled}
          onChange={() => {
            if (!supported) return;

            updateUserSettings((current) => {
              const nextEnabled = !current.noiseReductionEnabled;
              return {
                ...current,
                noiseReductionEnabled: nextEnabled,
                noiseReductionProvider: current.noiseReductionProvider ?? "rnnoise",
                streamHighFidelity: nextEnabled ? false : current.streamHighFidelity,
                spatialAudioEnabled: nextEnabled ? false : current.spatialAudioEnabled,
                noiseSuppression: nextEnabled ? false : current.noiseSuppression,
              };
            }, settingsUserId ?? undefined);
          }}
        />
      </div>

      {!supported && (
        <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
          This browser does not expose the AudioWorklet features needed for live provider-based noise suppression here yet.
        </div>
      )}

      <div className="mt-4">
        <MicTestWidget
          sensitivity={settings.sensitivity}
          autoSensitivity={settings.autoSensitivity}
          inputDeviceId={settings.inputDeviceId}
          outputDeviceId={settings.outputDeviceId}
          processing={processing}
        />
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg border border-rm-border bg-rm-bg-elevated/30 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-rm-text-muted">
          <ShieldCheck size={12} className="text-emerald-400" />
          Powered By
        </div>
        <div className="text-sm font-black tracking-tight text-rm-text">
          {providerLabel}
        </div>
      </div>
    </div>
  );
}
