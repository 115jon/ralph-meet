import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A native scroll container with the house scrollbar (8px, tint-2 thumb,
 * tint-3 on hover, no track: styles/foundation.css). Native scrolling keeps
 * wheel, keyboard and momentum behaviour and costs nothing at rest; use this
 * instead of a JS scroll area.
 */
const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    orientation?: "vertical" | "horizontal" | "both";
  }
>(function ScrollArea({ className, orientation = "vertical", ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="scroll-area"
      className={cn(
        "min-h-0 overscroll-contain",
        orientation === "vertical" && "overflow-x-hidden overflow-y-auto",
        orientation === "horizontal" && "overflow-x-auto overflow-y-hidden",
        orientation === "both" && "overflow-auto",
        className,
      )}
      {...props}
    />
  );
});

export { ScrollArea };
