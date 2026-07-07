import {
  getDisplayNameEffectStyle,
  getDisplayNameFontStyle,
  normalizeDisplayNameStyle,
  type DisplayNameStyle,
} from "@/lib/profile-customization";
import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

interface ProfileDisplayNameProps {
  text: string;
  displayNameStyle?: DisplayNameStyle | string | null;
  className?: string;
  style?: CSSProperties;
}

export function ProfileDisplayName({
  text,
  displayNameStyle,
  className,
  style,
}: ProfileDisplayNameProps) {
  const normalizedStyle = normalizeDisplayNameStyle(displayNameStyle);

  if (!normalizedStyle) {
    return (
      <span className={className} style={style}>
        {text}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-block max-w-full align-top", className)}
      style={{
        ...getDisplayNameFontStyle(normalizedStyle.font),
        ...getDisplayNameEffectStyle(normalizedStyle),
        ...style,
      }}
    >
      {text}
    </span>
  );
}
