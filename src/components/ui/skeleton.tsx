import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Placeholder block: a static tint-1 shape, no pulse or shimmer (nothing
 * loops at rest). Size and radius come from the caller.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rm-skeleton", className)}
      {...props}
    />
  );
}

export { Skeleton };
