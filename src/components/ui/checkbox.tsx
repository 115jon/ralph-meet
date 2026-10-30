"use client";

import * as React from "react";
import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioPrimitive,
} from "radix-ui";

import { Icon } from "@/components/ui/icon";
import { HIT } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";

/**
 * C1 hard checkbox (DESIGN.md, Toggles): a 24px square key, 2px corners and
 * a 2px ink-2 edge; checked fills primary with an on-primary Fill check.
 * Hover lifts the edge to ink-1 on a tint-1 fill; press scales to .92 (not under reduced motion).
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative inline-flex size-6 shrink-0 items-center justify-center rounded-[2px] border-2 border-ink-2 bg-transparent text-on-primary outline-none transition-[scale] duration-(--dur-1) ease-out pointer-fine:hover:border-ink-1 pointer-fine:hover:bg-tint-1 motion-safe:enabled:active:scale-[0.92] data-[state=checked]:border-primary-fill data-[state=checked]:bg-primary-fill disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-danger-ink motion-reduce:transition-none",
        HIT,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center"
      >
        <Icon name="check" state="active" size="sm" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/**
 * Round radios, for long lists only (a choice of two to four is a
 * `SegmentedControl`). 24px ring in ink-2, ink-1 and a 10px dot when chosen.
 */
function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-1", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-ink-2 outline-none transition-[scale] duration-(--dur-1) ease-out pointer-fine:hover:border-ink-1 pointer-fine:hover:bg-tint-1 motion-safe:enabled:active:scale-[0.92] data-[state=checked]:border-ink-1 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none",
        HIT,
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="size-2.5 rounded-full bg-ink-1 forced-colors:bg-[CanvasText]"
      />
    </RadioPrimitive.Item>
  );
}

export { Checkbox, RadioGroup, RadioGroupItem };
