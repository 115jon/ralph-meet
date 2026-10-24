import { SettingsSwitch } from "@/components/chat/SettingsSwitch";
import { cn } from "@/lib/utils";
import {
  NOISE_REDUCTION_PROVIDER_LABELS,
  isNoiseReductionProviderSupported,
} from "@/lib/voice/noise-reduction";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { Icon } from "@/components/ui/icon";
import { useShallow } from "zustand/shallow";

interface NoiseReductionPanelProps {
  settingsUserId?: string | null;
  /** Bare body for a popover/drawer host (no card border or surface). */
  compact?: boolean;
  className?: string;
}

export function NoiseReductionPanel({
  settingsUserId,
  compact = false,
  className,
}: NoiseReductionPanelProps) {
  const settings = useVoiceSettingsStore(
    useShallow((state) => state.getSettings(settingsUserId)),
  );
  const updateVoiceSettings = useVoiceSettingsStore(
    (state) => state.updateVoiceSettings,
  );
  const supported = isNoiseReductionProviderSupported(
    settings.noiseReductionProvider,
  );
  const providerLabel =
    NOISE_REDUCTION_PROVIDER_LABELS[settings.noiseReductionProvider] ??
    "RNNoise";

  return (
    <div
      className={cn(
        compact
          ? "p-3"
          : "w-full rounded-xl border border-rm-border bg-rm-bg-surface p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Icon name="speaking" size="sm" className="text-rm-text-muted" />
            <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-rm-text-muted">
              Noise suppression
            </span>
          </div>
          <div className="space-y-1">
            <h3 className="text-ui-base font-semibold text-rm-text">
              Suppress background noise before your voice leaves the app
            </h3>
            <p className="text-ui-xs leading-relaxed text-rm-text-muted">
              Enable live {providerLabel} noise suppression for your outbound
              voice. It updates in real time while you test and remains
              compatible with high-fidelity and spatial audio.
            </p>
          </div>
        </div>

        <SettingsSwitch
          ariaLabel="Suppress background noise"
          checked={supported && settings.noiseReductionEnabled}
          onChange={() => {
            if (!supported) return;

            updateVoiceSettings((current) => {
              const nextEnabled = !current.noiseReductionEnabled;
              return {
                ...current,
                noiseReductionEnabled: nextEnabled,
                noiseReductionProvider:
                  current.noiseReductionProvider ?? "rnnoise",
                noiseSuppression: nextEnabled
                  ? false
                  : current.noiseSuppression,
              };
            }, settingsUserId ?? undefined);
          }}
        />
      </div>

      {!supported && (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-md bg-rm-warning-tint px-3 py-2 text-ui-sm text-rm-warning-ink"
        >
          <Icon name="warning" size="sm" className="mt-px shrink-0" />
          This browser can&apos;t run live noise suppression. Try the desktop
          app or a recent Chrome, Edge or Firefox.
        </div>
      )}

      <div className="mt-4 flex items-center justify-between rounded-lg border border-rm-border bg-rm-bg-elevated/30 px-3 py-2">
        <div className="text-ui-2xs font-semibold uppercase tracking-[0.08em] flex items-center gap-2 text-rm-text-muted">
          <Icon name="privacy" size="xs" />
          Powered by
        </div>
        <div className="text-ui-sm font-semibold tracking-tight text-rm-text">
          {providerLabel}
        </div>
      </div>
    </div>
  );
}
