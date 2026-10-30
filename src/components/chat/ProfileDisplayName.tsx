import {
  getDisplayNameEffectOverlayStyle,
  getDisplayNameEffectStyle,
  getDisplayNameFontStyle,
  normalizeDisplayColor,
  normalizeDisplayNameStyle,
  resolveReadableDisplayNameStyle,
  type DisplayNameStyle,
} from "@/lib/profile-customization";
import { cn } from "@/lib/utils";
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import InlineEmojiText from "./InlineEmojiText";
import {
  useDecorationPlayback,
  type DecorationPlayback,
} from "./ProfileAssetLayer";

interface ProfileDisplayNameProps {
  text: string;
  displayNameStyle?: DisplayNameStyle | string | null;
  className?: string;
  style?: CSSProperties;
  backgroundColor?: string | null;
  readableFallbackColor?: string | null;
  minContrastRatio?: number;
  /**
   * When the effect plays. `"hover"` (default): static, plays while the
   * row holds the pointer or focus. `true`: plays while mounted (an open
   * profile surface). `false`: always static.
   */
  animate?: DecorationPlayback;
}

export function ProfileDisplayName({
  text,
  displayNameStyle,
  className,
  style,
  backgroundColor,
  readableFallbackColor,
  minContrastRatio,
  animate = "hover",
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
    if (
      !normalizedStyle ||
      explicitContrastContext.backgroundColor ||
      !spanNode ||
      typeof window === "undefined"
    ) {
      return explicitContrastContext;
    }

    const fallbackTextColor =
      explicitContrastContext.fallbackTextColor ??
      normalizeDisplayColor(window.getComputedStyle(spanNode).color);

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
  }, [explicitContrastContext, normalizedStyle, spanNode]);

  const resolvedStyle = useMemo(
    () =>
      resolveReadableDisplayNameStyle(normalizedStyle, {
        backgroundColor: contrastContext.backgroundColor,
        fallbackTextColor: contrastContext.fallbackTextColor,
        minContrastRatio,
      }) ?? normalizedStyle,
    [contrastContext, minContrastRatio, normalizedStyle],
  );
  const hasMotion =
    resolvedStyle?.effect === "gradient" ||
    resolvedStyle?.effect === "neon" ||
    resolvedStyle?.effect === "pop";
  const playing = useDecorationPlayback(
    hasMotion ? spanNode : null,
    hasMotion ? animate : false,
  );

  if (!resolvedStyle) {
    return (
      <span ref={handleSpanRef} className={className} style={style}>
        <InlineEmojiText text={text} />
      </span>
    );
  }

  // Gradient and neon play on a second copy of the name that only fades
  // (compositor-only); it mounts while the effect plays and never in lists.
  const overlayStyle = playing
    ? getDisplayNameEffectOverlayStyle(resolvedStyle)
    : null;

  return (
    <span
      ref={handleSpanRef}
      className={cn(
        "inline-block max-w-full align-top",
        overlayStyle && "relative",
        className,
      )}
      style={{
        ...getDisplayNameFontStyle(resolvedStyle.font),
        ...getDisplayNameEffectStyle(resolvedStyle, { animate: playing }),
        ...style,
      }}
    >
      <InlineEmojiText text={text} />
      {overlayStyle ? (
        <span
          aria-hidden="true"
          data-display-name-overlay=""
          className="pointer-events-none absolute inset-0 overflow-hidden text-ellipsis select-none"
          style={{ padding: "inherit", ...overlayStyle }}
        >
          <InlineEmojiText text={text} />
        </span>
      ) : null}
    </span>
  );
}
