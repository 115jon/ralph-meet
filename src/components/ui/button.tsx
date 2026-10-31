import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";
import { DitherDots } from "@/components/ui/dither";
import { DISABLED, HIT, PRESS } from "@/components/ui/interaction";

/**
 * Keys (DESIGN.md, Buttons). Squared 2px corners, Bricolage 600 labels.
 *
 *   primary      C2 notched key: primary-fill with a cut top-right corner and
 *                a still dithered cap after the label (never under it). One
 *                per view. Sizes sm and xs, and `notch={false}`, give the
 *                C1 solid key instead.
 *   secondary    C1 key with a 2px line-strong edge; `paired` (or a dialog
 *                footer) turns the edge to ink-1 when it sits beside a
 *                primary.
 *   ghost        no fill
 *   outline      1px line-strong edge
 *   danger       danger-fill: irreversible actions only (Leave, delete forever)
 *   destructive  danger-ink on danger-tint: reversible destructive actions
 *   rule         C3: no box, a 2px rule under a bold label (inline actions,
 *                settings footers); the rule turns accent on hover
 *   link         accent ink, underline on hover
 *
 * Heights 24 (xs) / 32 (sm) / 40 (md, default) / 48 (lg). A dialog footer
 * (ButtonDefaults) makes its keys 48. Press scale(.97) at 100ms. Disabled:
 * primary and danger go tonal (tint-2 fill, ink-3 text) so a dead primary
 * never reads as live; a notched key keeps its cap (printed in ink-3) so its
 * width holds between states. The rest fade to 45%. Focus is the global 2px ring on
 * the button's own box (the notch is painted, not clipped, so it shows).
 *
 * `default` is the old name for `primary` and stays as an alias; `icon*`
 * sizes are kept for existing call sites.
 */
const TONAL_DISABLED =
  "disabled:bg-tint-2 disabled:text-ink-3 disabled:opacity-100";

const PRIMARY = `bg-primary-fill text-on-primary [--hover-o:0.12] ${TONAL_DISABLED}`;

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[2px] font-display [font-optical-sizing:auto] font-semibold leading-none outline-none",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([data-icon])]:size-4",
    "aria-invalid:border aria-invalid:border-danger-ink",
    PRESS,
    HIT,
    DISABLED,
  ].join(" "),
  {
    variants: {
      variant: {
        primary: PRIMARY,
        default: PRIMARY,
        secondary:
          "border-2 border-line-strong bg-transparent text-ink-1 disabled:border-line",
        ghost: "bg-transparent text-ink-1",
        outline: "border border-line-strong bg-transparent text-ink-1",
        danger: `bg-danger-fill text-on-danger [--hover-o:0.12] ${TONAL_DISABLED}`,
        destructive: "bg-danger-tint text-danger-ink",
        rule: "h-auto! min-h-10 rounded-none! border-b-2 border-ink-1 bg-transparent px-1! font-bold text-ink-1 after:hidden pointer-fine:hover:border-accent-ink focus-visible:border-accent-ink active:border-accent-ink disabled:border-line-strong",
        link: "h-auto! px-0! font-ui font-medium text-accent-ink underline-offset-[3px] after:hidden pointer-fine:hover:underline",
      },
      size: {
        xs: "h-6 gap-1 px-2 text-[12px] has-[>svg]:px-1.5 [&_svg:not([class*='size-']):not([data-icon])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[14px] has-[>svg]:px-2.5",
        md: "h-10 px-4 text-[15px] has-[>svg]:px-3.5",
        default: "h-10 px-4 text-[15px] has-[>svg]:px-3.5",
        lg: "h-12 px-5 text-[15px] has-[>svg]:px-4.5",
        icon: "size-10",
        "icon-xs":
          "size-6 [&_svg:not([class*='size-']):not([data-icon])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

/**
 * Defaults for the keys inside a region (a dialog footer, a settings
 * footer). Explicit props on a Button still win.
 */
type ButtonDefaultsValue = {
  size?: ButtonSize;
  /** Secondary keys here sit beside a primary: 2px ink edge. */
  paired?: boolean;
};
const ButtonDefaultsContext = React.createContext<ButtonDefaultsValue>({});

function ButtonDefaults({
  children,
  ...value
}: ButtonDefaultsValue & { children: React.ReactNode }) {
  const parent = React.useContext(ButtonDefaultsContext);
  const merged = React.useMemo(
    () => ({ ...parent, ...value }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parent, value.size, value.paired],
  );
  return (
    <ButtonDefaultsContext.Provider value={merged}>
      {children}
    </ButtonDefaultsContext.Provider>
  );
}

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
    /**
     * Primary only: the C2 notched key with its dithered cap (default for
     * md and lg). `false` gives the C1 solid key.
     */
    notch?: boolean;
    /** Secondary only: it sits beside a primary, so its edge is 2px ink. */
    paired?: boolean;
  };

const NOTCH_SIZES = new Set<ButtonSize>(["md", "default", "lg"]);

function Button({
  className,
  variant = "default",
  size: sizeProp,
  asChild = false,
  loading = false,
  notch,
  paired: pairedProp,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const defaults = React.useContext(ButtonDefaultsContext);
  const size = sizeProp ?? defaults.size ?? "default";
  const paired = pairedProp ?? defaults.paired ?? false;
  const Comp = asChild ? Slot.Root : "button";
  const busy = loading && !asChild;
  const isPrimary = variant === "primary" || variant === "default";
  const notched = isPrimary && (notch ?? NOTCH_SIZES.has(size));
  // Every notched key carries its cap, disabled or not, so the width never
  // jumps between states; a disabled key prints it in ink-3 on tint-2.
  const cap = notched ? (
    <KeyCap size={size} dim={Boolean(props.disabled)} />
  ) : null;

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-notch={notched ? "" : undefined}
      className={cn(
        buttonVariants({ variant, size }),
        notched &&
          "rm-notch [--key-fill:var(--primary-fill)] disabled:[--key-fill:var(--tint-2)]",
        notched && "pr-3 has-[>svg]:pr-3",
        variant === "secondary" && paired && "border-ink-1",
        className,
      )}
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
          <span className="invisible contents">
            {children}
            {cap}
          </span>
          <span className="absolute inset-0 grid place-items-center">
            <Spinner />
            <span className="sr-only">Loading</span>
          </span>
        </>
      ) : asChild ? (
        // Slottable: the child element becomes the key and the cap (a direct
        // sibling here, not inside a fragment, so Slot can see it) lands
        // after the child's own content: `<a>Label</a>` -> `<a>Label cap</a>`.
        <Slot.Slottable>{children}</Slot.Slottable>
      ) : (
        children
      )}
      {busy ? null : cap}
    </Comp>
  );
}

/**
 * The notched key's trailing cap: still on-primary dots after the label.
 * `dim` (disabled) prints it in ink-3 to match the tonal label.
 */
function KeyCap({ size, dim = false }: { size: ButtonSize; dim?: boolean }) {
  return (
    <DitherDots
      ink={dim ? "ink-3" : "on-primary"}
      coverage={0.45}
      cell={2}
      className={cn("ml-1 w-3 self-center", size === "lg" ? "h-6" : "h-5")}
    />
  );
}

/** Pending spinner (an allowed loop): only while a request is in flight. */
function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("rm-spinner size-4", className)} />;
}

export { Button, ButtonDefaults, buttonVariants, Spinner };
