import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import React from "react";

type IconButtonVariant = "ghost" | "muted" | "active" | "destructive";
type IconButtonSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
};

const ICON_SIZE: Record<IconButtonSize, number> = {
  xs: 14,
  sm: 18,
  md: 20,
  lg: 24,
};

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost:
    "text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover transition-all",
  muted:
    "text-rm-text-muted/60 hover:text-rm-text hover:bg-rm-bg-hover transition-all",
  active: "text-rm-text bg-rm-bg-active transition-all",
  destructive:
    "text-rm-text-muted hover:text-destructive hover:bg-destructive/10 transition-all",
};

const SHAPE_CLASSES = {
  square: "rounded-lg",
  circle: "rounded-full",
} as const;

interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Lucide icon component */
  icon: React.ElementType;
  /** Icon size override (defaults based on button size) */
  iconSize?: number;
  /** Visual variant */
  variant?: IconButtonVariant;
  /** Button size */
  size?: IconButtonSize;
  /** Border radius shape */
  shape?: "square" | "circle";
  /** Tooltip text (uses the existing Tooltip components) */
  tooltip?: string;
  /** Tooltip placement */
  tooltipSide?: "top" | "bottom" | "left" | "right";
  /** Additional icon className */
  iconClassName?: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon: Icon,
      iconSize,
      variant = "ghost",
      size = "sm",
      shape = "square",
      tooltip,
      tooltipSide = "top",
      iconClassName,
      className,
      ...props
    },
    ref,
  ) => {
    const resolvedIconSize = iconSize ?? ICON_SIZE[size];

    const button = (
      <button
        ref={ref}
        className={cn(
          "inline-flex shrink-0 items-center justify-center outline-none",
          SIZE_CLASSES[size],
          VARIANT_CLASSES[variant],
          SHAPE_CLASSES[shape],
          props.disabled && "opacity-40 cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <Icon size={resolvedIconSize} className={iconClassName} />
      </button>
    );

    if (tooltip) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent
            side={tooltipSide}
            sideOffset={8}
            className="bg-rm-bg-floating border-none text-rm-text-primary text-[13px] font-bold shadow-xl px-3 py-2 rounded-lg"
          >
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return button;
  },
);

IconButton.displayName = "IconButton";
