import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";
import { DISABLED, HIT, PRESS } from "@/components/ui/interaction";

/**
 * Quiet Pro button. Flat, tight, tonal: one solid fill per view (`default`),
 * everything else is a neutral tint mixed from the text colour. Destructive is
 * a red tint; the confirmation copy carries the weight. `danger` is the solid
 * red fill, reserved for the one irreversible action on a surface (Leave).
 *
 * Heights 28 / 32 / 40 (24 for dense `xs`), radius 8 (6 below 32px),
 * weight 500. Focus uses the global ring in styles.css.
 */
/**
 * Solid fills go tonal when disabled instead of fading (9.7): a faded accent
 * or red still reads as the live primary action, and on miku/light themes it
 * blends into the surface. Later in the class list than DISABLED, so
 * tailwind-merge drops its opacity for these variants.
 */
const TONAL_DISABLED =
  "disabled:bg-rm-tint-2 disabled:text-rm-text-muted disabled:opacity-100";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-ui-sm font-medium outline-none",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([data-icon])]:size-4",
    "aria-invalid:border aria-invalid:border-rm-danger-ink",
    PRESS,
    HIT,
    DISABLED,
  ].join(" "),
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground [--hover-o:0.12] ${TONAL_DISABLED}`,
        destructive: "bg-rm-danger-tint text-rm-danger-ink",
        danger: `bg-rm-danger text-rm-on-danger [--hover-o:0.12] ${TONAL_DISABLED}`,
        outline: "border border-rm-border-strong bg-transparent text-rm-text",
        secondary: "bg-rm-tint-2 text-rm-text",
        ghost: "bg-transparent text-rm-text",
        link: "h-auto! px-0! text-rm-accent-ink underline-offset-[3px] after:hidden pointer-fine:hover:underline",
      },
      size: {
        default: "h-8 px-3 has-[>svg]:px-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-ui-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-']):not([data-icon])]:size-3",
        sm: "h-7 gap-1.5 rounded-sm px-2.5 has-[>svg]:px-2",
        lg: "h-10 px-4 text-ui-base has-[>svg]:px-3.5",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-sm [&_svg:not([class*='size-']):not([data-icon])]:size-3",
        "icon-sm": "size-7 rounded-sm",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * Shows a spinner in place of the label without changing the button's
     * width. Sets `aria-busy` and `aria-disabled` (not `disabled`), so focus
     * stays on the button, and swallows clicks while true. Ignored with
     * `asChild`.
     */
    loading?: boolean;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const busy = loading && !asChild;

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      aria-busy={busy || undefined}
      aria-disabled={busy || props["aria-disabled"] || undefined}
      onClick={
        busy
          ? (event: React.MouseEvent<HTMLButtonElement>) =>
              event.preventDefault()
          : onClick
      }
      {...props}
    >
      {busy ? (
        <>
          {/* `contents` keeps the label in the layout so the width holds;
              `invisible` hides it from sight and from assistive tech. */}
          <span className="invisible contents">{children}</span>
          <span className="absolute inset-0 grid place-items-center">
            <Spinner />
            <span className="sr-only">Loading</span>
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block size-4 animate-[spin_700ms_linear_infinite] rounded-full border-2 border-current border-r-transparent motion-reduce:animate-[spin_1.6s_linear_infinite]",
        className,
      )}
    />
  );
}

export { Button, buttonVariants, Spinner };
export type { ButtonProps };
