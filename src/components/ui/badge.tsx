import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Label badges are tints, never solid fills: h-5, 2px corners, text-ui-xs
 * 500. A status word is an `LedLabel` (ui/led), not a badge. The solid red
 * square count chip is `CountBadge` below, for mentions and unread DMs only.
 */
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border border-transparent px-1.5 text-ui-xs font-medium [&>svg]:pointer-events-none [&>svg]:size-3 aria-invalid:border-danger-ink",
  {
    variants: {
      variant: {
        default: "bg-accent-tint text-accent-ink",
        secondary: "bg-tint-2 text-ink-1",
        destructive: "bg-danger-tint text-danger-ink",
        live: "bg-live-tint text-live-ink",
        talk: "bg-talk-tint text-success-ink",
        warning: "bg-warning-tint text-warning-ink",
        outline: "border-line-strong text-ink-1",
        ghost: "text-ink-2",
        link: "text-accent-ink underline-offset-[3px] [a&]:pointer-fine:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

/**
 * C1 square count chip (DESIGN.md, Badge · LED): min 18x18, 2px corners,
 * --badge, Martian 11 600. Counts above `max` read "max+". Pass `ring` to cut it out
 * of the ply it overlaps (rail tiles, avatars).
 */
function CountBadge({
  count,
  max = 99,
  ring,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  count: number;
  max?: number;
  ring?: "ply-0" | "ply-1" | "ply-2" | "ply-3";
}) {
  if (count <= 0) return null;
  const label = count > max ? `${max}+` : String(count);
  return (
    <span
      data-slot="count-badge"
      className={cn(
        "badge-count",
        ring === "ply-0" && "ring-2 ring-ply-0",
        ring === "ply-1" && "ring-2 ring-ply-1",
        ring === "ply-2" && "ring-2 ring-ply-2",
        ring === "ply-3" && "ring-2 ring-ply-3",
        className,
      )}
      {...props}
    >
      {label}
    </span>
  );
}

export { Badge, CountBadge };
