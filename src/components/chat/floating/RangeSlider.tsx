import { Num } from "@/components/ui/num";
import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

/**
 * The spec slider (talk-tree-spec §7: 4px track, primary-fill range, 14px
 * thumb, value bubble in Num) drawn over a native range input, so it keeps
 * the input's keyboard, form and `change` behaviour and its name.
 *
 * Used by the players and sound dialogs instead of `ui/slider` because the
 * Radix thumb there doesn't take `aria-label` and needs ResizeObserver
 * (handoff: forward aria props to the thumb, then swap back).
 */
export function RangeSlider({
  value,
  min = 0,
  max = 100,
  onValueChange,
  showValue = "never",
  formatValue = String,
  className,
  inputClassName,
  ...inputProps
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "min" | "max" | "onChange"
> & {
  value: number;
  min?: number;
  max?: number;
  onValueChange: (value: number) => void;
  /** The Num bubble above the thumb: on hover/focus/drag, always, or never. */
  showValue?: "never" | "active" | "always";
  formatValue?: (value: number) => string;
  inputClassName?: string;
}) {
  const span = Math.max(1, max - min);
  const percent = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  return (
    <div
      data-slot="range-slider"
      className={cn(
        "group/range relative flex h-5 min-w-0 items-center has-disabled:opacity-45 pointer-coarse:h-11",
        className,
      )}
    >
      <div className="relative h-1 w-full rounded-full bg-tint-3">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary-fill"
          style={{ width: `${percent}%` }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-1/2 rounded-full bg-primary-fill shadow-xs ring-2 ring-ply-3 transition-[scale] duration-(--dur-1) ease-out group-active/range:scale-110 group-has-[input:focus-visible]/range:outline-2 group-has-[input:focus-visible]/range:outline-offset-2 group-has-[input:focus-visible]/range:outline-focus"
          style={{ left: `${percent}%` }}
        >
          {showValue === "never" ? null : (
            <span
              className={cn(
                "absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-sm bg-ink-1 px-1.5 py-0.5 text-ply-0",
                showValue === "active" &&
                  "opacity-0 transition-opacity duration-(--dur-2) ease-out pointer-fine:group-hover/range:opacity-100 group-active/range:opacity-100 group-has-[input:focus-visible]/range:opacity-100",
              )}
            >
              <Num size="xs">{formatValue(value)}</Num>
            </span>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onValueChange(Number(event.currentTarget.value))}
        className={cn(
          "absolute inset-0 m-0 h-full w-full min-w-0 cursor-pointer opacity-0 disabled:cursor-not-allowed",
          inputClassName,
        )}
        {...inputProps}
      />
    </div>
  );
}
