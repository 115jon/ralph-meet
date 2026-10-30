import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Icon,
  type IconName,
  type IconSize,
  type IconState,
} from "@/components/ui/icon";
import { DISABLED, HIT, PRESS, PRESS_ICON } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";
import React from "react";

type IconButtonVariant = "ghost" | "muted" | "active" | "destructive" | "plain";

/**
 * Talk Tree sizes (spec §7) are the pixel steps 24 / 28 / 32 / 40 with icons
 * 16 / 16 / 18 / 20. The named steps are the older API and keep their pixel
 * sizes (xs 24, sm 32, md 40, lg 48).
 */
type IconButtonSize = 24 | 28 | 32 | 40 | "xs" | "sm" | "md" | "lg";

/**
 * The state a toggle shows (spec §7):
 *   idle     ghost, Bold glyph
 *   toggled  tint-2 fill, Fill glyph          (a panel this opens is open)
 *   off      muted-state tint + ink, Fill     (mic muted, deafened, camera off)
 *   live     live tint + ink, Fill            (camera on, sharing)
 * Sets the glyph weight unless `iconState` is passed. Pair a toggle with
 * `aria-pressed`.
 */
type IconButtonTone = "idle" | "toggled" | "off" | "live";

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  24: "size-6 rounded-sm",
  28: "size-7 rounded-sm",
  32: "size-8 rounded-md",
  40: "size-10 rounded-md",
  xs: "size-6 rounded-sm",
  sm: "size-8 rounded-md",
  md: "size-10 rounded-md",
  lg: "size-12 rounded-lg",
};

const ICON_SIZE: Record<IconButtonSize, IconSize> = {
  24: "sm",
  28: "sm",
  32: "md",
  40: "lg",
  xs: "sm",
  sm: "md",
  md: "lg",
  lg: "xl",
};

/** Bare until hovered (an ink overlay), tonal when pressed or active. */
const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost:
    "text-ink-2 pointer-fine:hover:text-ink-1 aria-pressed:bg-tint-2 aria-pressed:text-ink-1",
  muted:
    "text-ink-3 pointer-fine:hover:text-ink-1 aria-pressed:bg-tint-2 aria-pressed:text-ink-1",
  active: "bg-tint-2 text-ink-1",
  destructive:
    "text-ink-3 pointer-fine:hover:text-danger-ink focus-visible:text-danger-ink",
  /** No colour of its own: the caller paints it (the dock recipe). */
  plain: "",
};

const TONE_CLASSES: Record<IconButtonTone, string> = {
  idle: "",
  toggled: "bg-tint-2 text-ink-1",
  off: "bg-muted-state-tint text-muted-state pointer-fine:hover:text-muted-state",
  live: "bg-live-tint text-live-ink pointer-fine:hover:text-live-ink [--hover-o:0.12]",
};

const TONE_ICON: Record<IconButtonTone, IconState> = {
  idle: "idle",
  toggled: "active",
  off: "off",
  live: "active",
};

const SHAPE_CLASSES = {
  square: "",
  circle: "rounded-full",
} as const;

type IconButtonBaseProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  /** App icon concept (see components/ui/icon/mapping.ts) */
  icon: IconName;
  /**
   * Icon weight state: "active" (Fill) for on/selected, "off" for the
   * concept's muted partner. Defaults to the tone's weight (idle: Bold).
   */
  iconState?: IconState;
  /** Icon size step override (defaults based on button size) */
  iconSize?: IconSize;
  /** Visual variant (default ghost) */
  variant?: IconButtonVariant;
  /** Toggle state (talk-tree-spec §7): idle, toggled, off, live. */
  tone?: IconButtonTone;
  /** 24 | 28 | 32 | 40, or the legacy xs | sm | md | lg. Default 32. */
  size?: IconButtonSize;
  /** Border radius shape */
  shape?: "square" | "circle";
  /** Tooltip placement */
  tooltipSide?: "top" | "bottom" | "left" | "right";
  /** Additional icon className */
  iconClassName?: string;
};

/**
 * An icon-only button must have an accessible name. Pass `aria-label`, or a
 * `tooltip` (used as the name when `aria-label` is absent), or
 * `aria-labelledby`.
 */
type IconButtonNameProps =
  | { "aria-label": string; tooltip?: string }
  | { tooltip: string; "aria-label"?: string }
  | { "aria-labelledby": string; tooltip?: string; "aria-label"?: string };

export type IconButtonProps = IconButtonBaseProps & IconButtonNameProps;

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      iconState,
      iconSize,
      variant = "ghost",
      tone,
      size = "sm",
      shape = "square",
      tooltip,
      tooltipSide = "top",
      iconClassName,
      className,
      type,
      ...props
    },
    ref,
  ) => {
    const resolvedIconSize = iconSize ?? ICON_SIZE[size];
    const resolvedIconState = iconState ?? (tone ? TONE_ICON[tone] : undefined);
    const ariaLabel = props["aria-label"] ?? tooltip;

    if (import.meta.env.DEV && !ariaLabel && !props["aria-labelledby"]) {
      console.warn(
        "IconButton: missing accessible name. Pass aria-label or tooltip.",
      );
    }

    const button = (
      <button
        ref={ref}
        type={type ?? "button"}
        data-tone={tone}
        className={cn(
          "inline-flex shrink-0 items-center justify-center outline-none",
          PRESS,
          PRESS_ICON,
          "transition-[scale,color,background-color]",
          HIT,
          DISABLED,
          SIZE_CLASSES[size],
          // A set tone owns the fill and ink, so the variant's own
          // aria-pressed tint can't override it.
          tone && tone !== "idle"
            ? TONE_CLASSES[tone]
            : VARIANT_CLASSES[variant],
          SHAPE_CLASSES[shape],
          className,
        )}
        {...props}
        aria-label={ariaLabel}
      >
        <Icon
          name={icon}
          state={resolvedIconState}
          size={resolvedIconSize}
          className={iconClassName}
        />
      </button>
    );

    if (tooltip) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return button;
  },
);

IconButton.displayName = "IconButton";
