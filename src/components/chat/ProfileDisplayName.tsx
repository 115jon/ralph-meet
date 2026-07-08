import {
  getDisplayNameEffectStyle,
  getDisplayNameFontStyle,
  normalizeDisplayColor,
  normalizeDisplayNameStyle,
  resolveReadableDisplayNameStyle,
  type DisplayNameStyle,
} from "@/lib/profile-customization";
import { cn } from "@/lib/utils";
import { useCallback, useMemo, useState, type CSSProperties } from "react";

interface ProfileDisplayNameProps {
  text: string;
  displayNameStyle?: DisplayNameStyle | string | null;
  className?: string;
  style?: CSSProperties;
  backgroundColor?: string | null;
  readableFallbackColor?: string | null;
  minContrastRatio?: number;
}

export function ProfileDisplayName({
  text,
  displayNameStyle,
  className,
  style,
  backgroundColor,
  readableFallbackColor,
  minContrastRatio,
}: ProfileDisplayNameProps) {
  const [spanNode, setSpanNode] = useState<HTMLSpanElement | null>(null);
  const normalizedStyle = useMemo(
    () => normalizeDisplayNameStyle(displayNameStyle),
    [displayNameStyle],
  );
  const explicitContrastContext = useMemo(
    () => ({
      backgroundColor: normalizeDisplayColor(backgroundColor),
      fallbackTextColor: normalizeDisplayColor(readableFallbackColor),
    }),
    [backgroundColor, readableFallbackColor],
  );
  const handleSpanRef = useCallback((node: HTMLSpanElement | null) => {
    setSpanNode(node);
  }, []);
  const contrastContext = useMemo(() => {
    if (!normalizedStyle || explicitContrastContext.backgroundColor || !spanNode || typeof window === "undefined") {
      return explicitContrastContext;
    }

    const fallbackTextColor =
      explicitContrastContext.fallbackTextColor
      ?? normalizeDisplayColor(window.getComputedStyle(spanNode).color);

    let resolvedBackgroundColor: string | null = null;
    let currentNode: HTMLElement | null = spanNode;
    while (currentNode) {
      const computedBackground = normalizeDisplayColor(
        window.getComputedStyle(currentNode).backgroundColor,
      );
      if (computedBackground) {
        resolvedBackgroundColor = computedBackground;
        break;
      }
      currentNode = currentNode.parentElement;
    }

    if (!resolvedBackgroundColor) {
      resolvedBackgroundColor = normalizeDisplayColor(
        window.getComputedStyle(document.body).backgroundColor,
      );
    }

    return {
      backgroundColor: resolvedBackgroundColor,
      fallbackTextColor,
    };
  }, [
    explicitContrastContext,
    normalizedStyle,
    spanNode,
  ]);

  const resolvedStyle = useMemo(
    () => resolveReadableDisplayNameStyle(normalizedStyle, {
      backgroundColor: contrastContext.backgroundColor,
      fallbackTextColor: contrastContext.fallbackTextColor,
      minContrastRatio,
    }) ?? normalizedStyle,
    [contrastContext, minContrastRatio, normalizedStyle],
  );

  if (!resolvedStyle) {
    return (
      <span ref={handleSpanRef} className={className} style={style}>
        {text}
      </span>
    );
  }

  return (
    <span
      ref={handleSpanRef}
      className={cn("inline-block max-w-full align-top", className)}
      style={{
        ...getDisplayNameFontStyle(resolvedStyle.font),
        ...getDisplayNameEffectStyle(resolvedStyle),
        ...style,
      }}
    >
      {text}
    </span>
  );
}
