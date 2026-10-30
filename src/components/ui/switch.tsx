"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { HIT } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";

/**
 * C1 LED switch (DESIGN.md, Toggles): a 56x28 key with 2px corners. Off is a
 * tint-3 track with a 20px ink-2 thumb inset 4px on every side; on fades the
 * primary-fill track in, the on-primary thumb slides 28px (still inset 4px),
 * and a talk LED lights in the track (on is a light, as everywhere else).
 * Only opacity and transform move, 150ms ease-out. `size="sm"` (40x20, a
 * 14px thumb inset 3px) is for dense rows. Name it with `aria-label` or
 * `aria-labelledby`.
 */
function Switch({
  className,
  size = "md",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "group/switch relative inline-flex shrink-0 items-center rounded-[2px] bg-tint-3 outline-none [-webkit-tap-highlight-color:transparent] transition-[scale] duration-(--dur-1) ease-out enabled:active:scale-(--motion-press) disabled:cursor-not-allowed disabled:opacity-45 forced-colors:border forced-colors:border-[ButtonText]",
        sm ? "h-5 w-10" : "h-7 w-14",
        HIT,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-[inherit] bg-primary-fill opacity-0 transition-opacity duration-(--dur-2) ease-out group-data-[state=checked]/switch:opacity-100"
      />
      <span
        aria-hidden="true"
        data-slot="led"
        data-state="talk"
        data-size="6"
        data-lit=""
        className={cn(
          "rm-led absolute! top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-(--dur-2) group-data-[state=checked]/switch:opacity-100",
          sm ? "left-1.5" : "left-2",
        )}
      />
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none relative block rounded-[1px] bg-ink-2 transition-[translate] duration-(--dur-2) ease-out data-[state=checked]:bg-on-primary motion-reduce:transition-none forced-colors:bg-[ButtonText]",
          sm
            ? "h-3.5 w-3.5 translate-x-[3px] data-[state=checked]:translate-x-[23px]"
            : "h-5 w-5 translate-x-1 data-[state=checked]:translate-x-8",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
