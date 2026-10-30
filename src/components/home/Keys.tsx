/**
 * Landing keys as links: a Button rendered onto an `<a>`. `primary` is the
 * C2 notched key with its still dithered cap; `secondary` is the C1 key with
 * an edge. 48px, as on every public page.
 */

import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

export function KeyLink({
  variant = "secondary",
  paired = false,
  className,
  children,
  ...props
}: ComponentProps<"a"> & {
  variant?: "primary" | "secondary";
  /** Secondary beside a primary: a 2px ink edge. */
  paired?: boolean;
}) {
  return (
    <Button
      asChild
      variant={variant}
      size="lg"
      paired={paired}
      className={className}
    >
      <a {...props}>{children}</a>
    </Button>
  );
}
