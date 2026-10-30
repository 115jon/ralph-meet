import * as React from "react";

import { cn } from "@/lib/utils";

export type SegmentedItem<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

/**
 * Segmented rail (DESIGN.md, Toggles): a choice of two to four inside a 2px
 * ink rail, cells split by 2px ink rules, the chosen cell lit in
 * primary-fill. `md` cells are 48px Bricolage control labels (settings);
 * `sm` cells are 32px silkscreen (a quality or background pick in a row).
 *
 * APG radio group: one tab stop on the chosen cell, arrows move and select,
 * Home/End jump. The hover/press overlay is the shared ink overlay.
 */
export function SegmentedControl<T extends string>({
  label,
  items,
  value,
  onValueChange,
  size = "md",
  disabled = false,
  className,
  "aria-describedby": describedBy,
}: {
  /** Accessible name for the group. */
  label: string;
  items: readonly SegmentedItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );

  const move = (from: number, step: number) => {
    const count = items.length;
    for (let i = 1; i <= count; i++) {
      const next = (from + step * i + count) % count;
      if (!items[next]!.disabled) return next;
    }
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = move(index, 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = move(index, -1);
    else if (event.key === "Home") next = move(-1, 1);
    else if (event.key === "End") next = move(items.length, -1);
    else return;
    event.preventDefault();
    onValueChange(items[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      data-slot="segmented-control"
      data-size={size}
      onKeyDown={disabled ? undefined : onKeyDown}
      className={cn(
        "inline-grid overflow-hidden rounded-[2px] border-2 border-ink-1 bg-ply-0",
        disabled && "border-line-strong opacity-60",
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
      }}
    >
      {items.map((item, i) => {
        const on = i === index;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled || item.disabled}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "relative inline-flex min-w-0 items-center justify-center whitespace-nowrap select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-offset-[-4px]!",
              "after:pointer-events-none after:absolute after:inset-0 after:bg-current after:opacity-0 after:transition-opacity after:duration-(--dur-1) pointer-fine:hover:enabled:after:opacity-8 enabled:active:after:opacity-14",
              "disabled:cursor-not-allowed",
              size === "md" ? "text-control h-11 px-4" : "silkscreen h-7 px-3",
              i > 0 && "border-l-2",
              disabled ? "border-line-strong" : "border-ink-1",
              on
                ? "bg-primary-fill text-on-primary forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]"
                : "text-ink-2",
            )}
          >
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
