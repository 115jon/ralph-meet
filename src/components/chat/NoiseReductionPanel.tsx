import { Icon } from "@/components/ui/icon";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  NOISE_REDUCTION_PROVIDER_LABELS,
  isNoiseReductionProviderSupported,
} from "@/lib/voice/noise-reduction";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { useId } from "react";
import { useShallow } from "zustand/shallow";

interface NoiseReductionPanelProps {
  settingsUserId?: string | null;
  /** Bare body for a popover/drawer host (no card border or surface). */
  compact?: boolean;
  className?: string;
}

/**
 * A switch row and one line: "Removes background noise from your mic." The
 * provider (RNNoise) is a muted footnote. The full variant is the same row
 * on a card with one more line about when the change applies.
 */
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
  const labelId = useId();
  const descId = useId();
  const supported = isNoiseReductionProviderSupported(
    settings.noiseReductionProvider,
  );
  const providerLabel =
    NOISE_REDUCTION_PROVIDER_LABELS[settings.noiseReductionProvider] ??
    "RNNoise";

  const toggle = () => {
    if (!supported) return;

    updateVoiceSettings((current) => {
      const nextEnabled = !current.noiseReductionEnabled;
      return {
        ...current,
        noiseReductionEnabled: nextEnabled,
        noiseReductionProvider: current.noiseReductionProvider ?? "rnnoise",
        noiseSuppression: nextEnabled ? false : current.noiseSuppression,
      };
    }, settingsUserId ?? undefined);
  };

  return (
    <div
      className={cn(
        compact ? "p-3" : "w-full rounded-lg border border-line bg-ply-2 p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            id={labelId}
            className={cn(
              "font-semibold text-ink-1",
              compact ? "text-ui-sm" : "text-ui-md",
            )}
          >
            Noise suppression
          </p>
          <p id={descId} className="mt-0.5 text-ui-sm text-pretty text-ink-2">
            Removes background noise from your mic.
          </p>
          {compact ? null : (
            <p className="mt-1 text-ui-xs text-pretty text-ink-3">
              It updates while you test and works with high-fidelity and spatial
              audio.
            </p>
          )}
        </div>

        <Switch
          aria-labelledby={labelId}
          aria-describedby={descId}
          checked={supported && settings.noiseReductionEnabled}
          disabled={!supported}
          onCheckedChange={toggle}
          className="mt-0.5"
        />
      </div>

      {!supported && (
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded-md bg-warning-tint px-3 py-2 text-ui-sm text-warning-ink"
        >
          <Icon name="warning" size="sm" className="mt-px shrink-0" />
          This browser can&apos;t run live noise suppression. Try the desktop
          app or a recent Chrome, Edge or Firefox.
        </div>
      )}

      <p className="mt-2 text-ui-xs text-ink-3">Powered by {providerLabel}</p>
    </div>
  );
}
