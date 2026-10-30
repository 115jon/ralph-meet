import React from "react";

import { IconButton, type IconButtonProps } from "@/components/ui/IconButton";
import { dockIconState, dockState, type DockState } from "@/components/ui/dock";
import { cn } from "@/lib/utils";

export type DockButtonProps = Omit<IconButtonProps, "variant" | "iconState"> & {
  state: DockState;
  quiet?: boolean;
};

/**
 * An `IconButton` painted with the call-control recipe in `ui/dock.ts`:
 * 40px by default (the stage bar, 20px glyph), 32 in the call strip and the
 * account row. Pass `aria-pressed` for toggles; the state already sets the
 * glyph weight.
 */
export const DockButton = React.forwardRef<HTMLButtonElement, DockButtonProps>(
  ({ state, quiet, size = 40, className, ...props }, ref) => (
    <IconButton
      ref={ref}
      size={size}
      variant="plain"
      iconState={dockIconState(state)}
      className={cn(dockState(state, { quiet }), className)}
      {...(props as IconButtonProps)}
    />
  ),
);

DockButton.displayName = "DockButton";
