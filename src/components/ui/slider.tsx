"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { DitherRamp } from "@/components/ui/dither";
import { Num } from "@/components/ui/num";
import { cn } from "@/lib/utils";

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  /**
   * Show the value in a Num bubble above the thumb while hovered, focused or
   * dragged (`"active"`), always (`"always"`), or never (default).
   */
  showValue?: "never" | "active" | "always";
  /** Formats the bubble (e.g. `(v) => \`${v}%\``). */
  formatValue?: (value: number) => string;
  /**
   * The thumb's accessible name. The thumb is the focusable `role="slider"`,
   * so a label on the root never reaches it. Pass an array for a range.
   */
  "aria-label"?: string | string[];
  /** The thumb's labelling/description ids (a settings row's label and help). */
  thumbLabelledBy?: string;
  thumbDescribedBy?: string;
  /** Spoken value per thumb (e.g. `(v) => \`${v} percent\``). */
  getAriaValueText?: (value: number) => string;
};

/**
 * C1 dither fader (DESIGN.md, Slider): an 8px tint-3 track whose range is a
 * still accent dither that gets denser toward the value, and a tall 12x28
 * ink-1 fader cap with 2px corners. The dots never carry text; under forced
 * colours the range is a solid Highlight bar. The value bubble uses Num. The
 * cap grows on press with scale only.
 */
function Slider({
  className,
  showValue = "never",
  formatValue = String,
  value,
  defaultValue,
  onValueChange,
  "aria-label": ariaLabel,
  getAriaValueText,
  thumbLabelledBy,
  thumbDescribedBy,
  ...props
}: SliderProps) {
  // Uncontrolled (`defaultValue`, no `value`) keeps its own state, so the
  // thumbs, the value bubble and aria-valuetext follow a drag either way.
  const [inner, setInner] = React.useState(
    () => defaultValue ?? [props.min ?? 0],
  );
  const controlled = value !== undefined;
  const values = controlled ? value : inner;
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={values}
      onValueChange={(next) => {
        if (!controlled) setInner(next);
        onValueChange?.(next);
      }}
      className={cn(
        "relative flex h-8 w-full touch-none items-center select-none data-[disabled]:opacity-45 pointer-coarse:h-11",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-2 grow overflow-hidden rounded-[1px] bg-tint-3"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full forced-colors:bg-[Highlight]"
        >
          <DitherRamp className="size-full" />
        </SliderPrimitive.Range>
      </SliderPrimitive.Track>
      {values.map((v, i) => (
        <SliderPrimitive.Thumb
          key={i}
          data-slot="slider-thumb"
          aria-label={Array.isArray(ariaLabel) ? ariaLabel[i] : ariaLabel}
          aria-valuetext={getAriaValueText?.(v)}
          aria-labelledby={thumbLabelledBy}
          aria-describedby={thumbDescribedBy}
          className="group/thumb relative block h-7 w-3 rounded-[2px] bg-ink-1 shadow-xs outline-none forced-colors:bg-[ButtonText] transition-[scale] duration-(--dur-1) ease-out active:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[disabled]:cursor-not-allowed motion-reduce:active:scale-100"
        >
          {showValue === "never" ? null : (
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-sm bg-ink-1 px-1.5 py-0.5 text-ply-0",
                showValue === "active" &&
                  "opacity-0 transition-opacity duration-(--dur-2) ease-out group-hover/thumb:opacity-100 group-focus-visible/thumb:opacity-100 group-active/thumb:opacity-100",
              )}
            >
              <Num size="xs">{formatValue(v)}</Num>
            </span>
          )}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
