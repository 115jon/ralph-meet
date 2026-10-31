"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";

import { lastInputWasKeyboard } from "@/components/ui/dialog-stack";
import { cn } from "@/lib/utils";

/** App-wide tooltip timing (talk-tree-spec §7, overlays issue 11). */
const TOOLTIP_DELAY_MS = 500;
const TOOLTIP_SKIP_MS = 300;

/**
 * 500ms before the first tooltip, then instant between neighbours for 300ms
 * (Radix `skipDelayDuration`, which opens them as `instant-open`).
 *
 * The timing is owned here: per-site `delayDuration` / `skipDelayDuration`
 * props are accepted for compatibility but ignored, so sweeping the pointer
 * across a toolbar or the tree never mounts a tooltip per icon it crosses.
 */
const TooltipProvider = React.memo(function TooltipProvider({
  delayDuration: _delayDuration,
  skipDelayDuration: _skipDelayDuration,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={TOOLTIP_DELAY_MS}
      skipDelayDuration={TOOLTIP_SKIP_MS}
      {...props}
    />
  );
});

const Tooltip = React.memo(function Tooltip({
  delayDuration: _delayDuration,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      disableHoverableContent
      {...props}
    />
  );
});

const TooltipTrigger = React.memo(function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
});

/**
 * One tooltip for the whole app (C1 inverted): ink-1 fill, ply-0 ink,
 * text-ui-xs 500, 2px corners, 28 high, padding 4/8, max 240; a `<Kbd>`
 * inside it becomes a translucent key cap. Presence is
 * 150ms fade + .97 scale from the trigger edge, exit 100ms fade; neighbours
 * open instantly with no animation. Callers should not restyle it.
 */
const TooltipContent = React.memo(function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  // Content mounts when the tooltip opens; a keyboard focus opens it with a
  // fade only (keyboard-initiated motion doesn't scale).
  const [byKeyboard] = React.useState(lastInputWasKeyboard);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-80 flex min-h-7 w-fit max-w-[240px] origin-(--radix-tooltip-content-transform-origin) items-center gap-2 rounded-[2px] bg-ink-1 px-2 py-1 text-ui-xs font-medium text-ply-0 text-balance pointer-events-none forced-colors:border forced-colors:border-[CanvasText]",
          // A key inside the tooltip is its own translucent cap.
          "[&_[data-slot=kbd]]:h-4 [&_[data-slot=kbd]]:min-w-4 [&_[data-slot=kbd]]:border-0 [&_[data-slot=kbd]]:bg-ply-0/20 [&_[data-slot=kbd]]:px-1 [&_[data-slot=kbd]]:text-ply-0",
          "animate-in fade-in-0 zoom-in-[0.97] duration-(--dur-2) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-100 data-[state=closed]:duration-80 data-[state=instant-open]:animate-none",
          byKeyboard && "zoom-in-100!",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
