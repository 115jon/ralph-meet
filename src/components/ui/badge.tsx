import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border border-transparent px-1.5 text-ui-2xs font-medium [&>svg]:pointer-events-none [&>svg]:size-3 aria-invalid:border-rm-danger-ink",
  {
    variants: {
      // Quiet Pro: badges are tints, never solid fills. Accent and danger
      // tint their ink to match; everything else is neutral.
      variant: {
        default: "bg-rm-accent-tint text-rm-accent-ink",
        secondary: "bg-rm-tint-2 text-rm-text",
        destructive: "bg-rm-danger-tint text-rm-danger-ink",
        outline: "border-rm-border-strong text-rm-text",
        ghost: "text-rm-text-secondary",
        link: "text-rm-accent-ink underline-offset-[3px] [a&]:hover:underline",
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

export { Badge, badgeVariants };
