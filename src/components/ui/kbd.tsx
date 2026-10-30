import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Key caps (DESIGN.md, Kbd), Martian 11 600, 2px corners.
 *
 *   cap       C1 (default): tint-2 key with a 2px ink-2 bottom edge, 24 high
 *   outline   C2: a line-strong outline (menus restyle any Kbd to this)
 *   inverted  C3: ink-1 key with ply-0 ink (the tooltip restyles any Kbd to
 *             its own translucent key)
 *
 * `size="sm"` (20 high) for a cap inside a 36px row or a field.
 */
const KBD_VARIANT = {
  cap: "border-b-2 border-ink-2 bg-tint-2 text-ink-1",
  outline: "border border-line-strong text-ink-2",
  inverted: "bg-ink-1 text-ply-0",
} as const;

function Kbd({
  className,
  variant = "cap",
  size = "md",
  ...props
}: React.ComponentProps<"kbd"> & {
  variant?: keyof typeof KBD_VARIANT;
  size?: "sm" | "md";
}) {
  return (
    <kbd
      data-slot="kbd"
      data-variant={variant}
      className={cn(
        "inline-flex items-center justify-center gap-0.5 rounded-[2px] text-num-xs font-semibold [&_svg]:size-3",
        size === "sm" ? "h-5 min-w-5 px-1" : "h-6 min-w-6 px-1.5",
        KBD_VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Keys of one shortcut, 4px apart. */
function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
