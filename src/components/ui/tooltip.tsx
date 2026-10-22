"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = React.memo(function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
});

const Tooltip = React.memo(function Tooltip({
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
 * One tooltip for the whole app (Quiet Pro): inverted so it reads on every
 * ground (text-colour fill, page-colour ink), 12px/500, 6px radius, no
 * border. 125ms ease-out scale and fade from the trigger edge; once one
 * tooltip is open, neighbours open instantly (Radix `instant-open`). Callers
 * should not restyle it.
 */
const TooltipContent = React.memo(function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-80 w-fit max-w-[280px] origin-(--radix-tooltip-content-transform-origin) rounded-sm bg-rm-text px-2 py-1 text-ui-xs font-medium text-rm-bg-primary text-balance pointer-events-none",
          "animate-in fade-in-0 zoom-in-[0.97] duration-[125ms] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97] data-[state=instant-open]:animate-none",
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
