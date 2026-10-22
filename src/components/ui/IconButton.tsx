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
import { DISABLED, HIT, PRESS } from "@/components/ui/interaction";
import { cn } from "@/lib/utils";
import React from "react";

type IconButtonVariant = "ghost" | "muted" | "active" | "destructive";
type IconButtonSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  xs: "size-6 rounded-sm",
  sm: "size-8 rounded-md",
  md: "size-10 rounded-md",
  lg: "size-12 rounded-lg",
};

/** Icon step per button size: 20 in 32 and 40px targets, 24 in 48. */
const ICON_SIZE: Record<IconButtonSize, IconSize> = {
  xs: "sm",
  sm: "lg",
  md: "lg",
  lg: "xl",
};

/**
 * Quiet Pro: bare until hovered (a currentColor overlay), tonal when pressed
 * or active. Destructive turns its ink red on hover, so the overlay becomes a
 * red tint; it never fills solid.
 */
const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost:
    "text-rm-text-secondary pointer-fine:hover:text-rm-text aria-pressed:bg-rm-tint-2 aria-pressed:text-rm-text",
  muted:
    "text-rm-text-muted pointer-fine:hover:text-rm-text aria-pressed:bg-rm-tint-2 aria-pressed:text-rm-text",
  active: "bg-rm-tint-2 text-rm-text",
  destructive:
    "text-rm-text-muted pointer-fine:hover:text-rm-danger-ink focus-visible:text-rm-danger-ink",
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
   * concept's muted partner. Defaults to idle (Bold).
   */
  iconState?: IconState;
  /** Icon size step override (defaults based on button size) */
  iconSize?: IconSize;
  /** Visual variant */
  variant?: IconButtonVariant;
  /** Button size */
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
        className={cn(
          "inline-flex shrink-0 items-center justify-center outline-none",
          PRESS,
          HIT,
          DISABLED,
          SIZE_CLASSES[size],
          VARIANT_CLASSES[variant],
          SHAPE_CLASSES[shape],
          className,
        )}
        {...props}
        aria-label={ariaLabel}
      >
        <Icon
          name={icon}
          state={iconState}
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
