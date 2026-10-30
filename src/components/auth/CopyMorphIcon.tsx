import { Icon, type IconName } from "@/components/ui/icon";
import type { IconSize } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

/**
 * Icon that morphs to a check mark after copying: a quick scale + opacity
 * swap (transform and opacity only), so it reads as one motion instead of
 * two icons. Both glyphs share one grid cell and cross-fade with CSS
 * transitions (interruptible; no animation library), exit faster than enter.
 */
const LAYER = "inline-flex transition-[opacity,scale]";

function layerStyle(shown: boolean): CSSProperties {
  return {
    transitionDuration: shown ? "var(--dur-3)" : "var(--dur-2-exit)",
    transitionTimingFunction: "var(--ease-out)",
  };
}

export function CopyMorphIcon({
  copied,
  icon,
  size = "sm",
}: {
  copied: boolean;
  icon: IconName;
  size?: IconSize;
}) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-grid place-items-center [&>*]:[grid-area:1/1]"
    >
      <span
        className={cn(LAYER, copied ? "scale-[0.7] opacity-0" : "opacity-100")}
        style={layerStyle(!copied)}
      >
        <Icon name={icon} size={size} />
      </span>
      <span
        className={cn(LAYER, copied ? "opacity-100" : "scale-[0.7] opacity-0")}
        style={layerStyle(copied)}
      >
        <Icon name="check" size={size} className="text-accent-ink" />
      </span>
    </span>
  );
}
