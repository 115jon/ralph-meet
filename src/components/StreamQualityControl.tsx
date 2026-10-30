/**
 * Stream quality as a segmented control: a Resolution row and a Frame rate
 * row of chips, derived from the same preset list on every surface (the web
 * and desktop share pickers and the dock's stream menu), so no surface can
 * offer fewer presets than another.
 *
 *   <StreamQualityControl
 *     value="1080p60"
 *     onChange={setQuality}
 *     availableQualities={getAvailableStreamQualities()}
 *   />
 *
 * `value` and `onChange` use preset ids ("1080p60"). A frame rate a resolution
 * doesn't offer is disabled rather than hidden, so the rows keep their shape.
 */

import { RadioGroup } from "radix-ui";
import { useId } from "react";

import { HIT } from "@/components/ui/interaction";
import {
  SCREEN_SHARE_QUALITY_PRESETS,
  type ScreenShareQualityPreset,
} from "@/lib/screen-share-support";
import { cn } from "@/lib/utils";

export interface StreamQualityControlProps {
  /** The selected preset id, such as "1080p60". */
  value: string;
  onChange: (id: string) => void;
  /** Preset ids this surface may offer (`getAvailableStreamQualities()`). */
  availableQualities: readonly string[];
  disabled?: boolean;
  /** Show the one-line description of the selected preset. Default true. */
  showHint?: boolean;
  className?: string;
}

const GROUP =
  "inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-md bg-tint-1 p-0.5";

const CHIP = cn(
  "relative inline-flex h-7 min-w-12 items-center justify-center rounded-sm px-2.5 text-ui-sm font-medium whitespace-nowrap outline-none [-webkit-tap-highlight-color:transparent] transition-colors duration-(--dur-1) ease-out pointer-coarse:h-11 pointer-coarse:min-w-14",
  "text-ink-2 pointer-fine:hover:enabled:text-ink-1",
  "data-[state=checked]:bg-accent-tint data-[state=checked]:font-semibold data-[state=checked]:text-accent-ink",
  "disabled:cursor-not-allowed disabled:opacity-45",
  HIT,
);

/** The presets this surface offers, in the canonical order. */
function offeredQualityPresets(
  availableQualities: readonly string[],
): ScreenShareQualityPreset[] {
  return SCREEN_SHARE_QUALITY_PRESETS.filter((preset) =>
    availableQualities.includes(preset.id),
  );
}

function Row({
  label,
  labelId,
  children,
}: {
  label: string;
  labelId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span
        id={labelId}
        className="w-22 shrink-0 text-ui-xs font-medium text-ink-3"
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export function StreamQualityControl({
  value,
  onChange,
  availableQualities,
  disabled = false,
  showHint = true,
  className,
}: StreamQualityControlProps) {
  const resolutionLabelId = useId();
  const rateLabelId = useId();
  const presets = offeredQualityPresets(availableQualities);
  if (presets.length === 0) return null;

  const selected = presets.find((preset) => preset.id === value) ?? presets[0];
  const resolutions = [...new Set(presets.map((preset) => preset.label))];
  const rates = [...new Set(presets.map((preset) => preset.fps))].sort(
    (a, b) => a - b,
  );

  const pickResolution = (label: string) => {
    const next =
      presets.find((p) => p.label === label && p.fps === selected.fps) ??
      presets.find((p) => p.label === label);
    if (next) onChange(next.id);
  };
  const pickRate = (fps: number) => {
    const next = presets.find(
      (p) => p.label === selected.label && p.fps === fps,
    );
    if (next) onChange(next.id);
  };

  return (
    <div
      data-slot="stream-quality-control"
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      <Row label="Resolution" labelId={resolutionLabelId}>
        <RadioGroup.Root
          aria-labelledby={resolutionLabelId}
          orientation="horizontal"
          value={selected.label}
          onValueChange={pickResolution}
          disabled={disabled}
          className={GROUP}
        >
          {resolutions.map((label) => (
            <RadioGroup.Item key={label} value={label} className={CHIP}>
              {label}
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </Row>
      <Row label="Frame rate" labelId={rateLabelId}>
        <RadioGroup.Root
          aria-labelledby={rateLabelId}
          orientation="horizontal"
          value={String(selected.fps)}
          onValueChange={(next) => pickRate(Number(next))}
          disabled={disabled}
          className={GROUP}
        >
          {rates.map((fps) => {
            const offered = presets.some(
              (p) => p.label === selected.label && p.fps === fps,
            );
            return (
              <RadioGroup.Item
                key={fps}
                value={String(fps)}
                disabled={!offered}
                className={CHIP}
              >
                {fps} fps
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
      </Row>
      {showHint ? (
        <p className="text-ui-xs text-ink-3 sm:ps-25">{selected.desc}</p>
      ) : null}
    </div>
  );
}
