import { useAppActive } from "@/hooks/useAppActive";
import { isVideo } from "@/lib/media";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

// ── Decoration playback (name effects, nameplates, profile media) ───────
//
// Decorative personalisation is static in lists and plays only while its row
// is hovered or holds focus, or continuously inside an open profile surface
// (talk-tree-spec §6, performance-motion P1-4). Never under reduced motion,
// and never while the app is inactive (covered by a game, minimised, hidden).

/**
 * `true`: play while mounted (profile card, popover, modal).
 * `"hover"`: static; play while the row (or parent) is hovered or focused.
 * `false`: never play.
 */
export type DecorationPlayback = boolean | "hover";

/**
 * Put this attribute on an open profile surface's root to make every
 * `"hover"` decoration inside it play continuously, without touching each
 * call site.
 */
export const DECORATION_PLAY_ATTR = "data-decoration-play";

/** Elements that count as "the row" for hover playback. */
const DECORATION_ROW_SELECTOR = [
  "[data-decoration-scope]",
  '[role="row"]',
  '[role="listitem"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="treeitem"]',
  "li",
  "button",
  "a[href]",
].join(",");

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function getReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/**
 * Whether a decoration should be playing right now. Pass the decoration's
 * own element. `scope: "row"` uses the nearest row ancestor (names);
 * `scope: "parent"` uses the direct parent (a nameplate fills its row).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useDecorationPlayback(
  node: HTMLElement | null,
  mode: DecorationPlayback,
  scope: "row" | "parent" = "row",
): boolean {
  const active = useAppActive();
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => false,
  );
  const [hovered, setHovered] = useState(false);
  // An open profile surface plays everything inside it. The node is state
  // (set from a ref callback), so this reads mounted DOM, not a ref.
  const inPlayScope =
    mode === "hover" && !!node?.closest(`[${DECORATION_PLAY_ATTR}]`);

  useEffect(() => {
    if (!node || mode !== "hover" || inPlayScope) return;
    const row =
      (scope === "row"
        ? node.closest<HTMLElement>(DECORATION_ROW_SELECTOR)
        : null) ?? node.parentElement;
    if (!row) return;
    let pointerInside = false;
    let focusInside = false;
    const sync = () => setHovered(pointerInside || focusInside);
    const onEnter = () => {
      pointerInside = true;
      sync();
    };
    const onLeave = () => {
      pointerInside = false;
      sync();
    };
    const onFocusIn = () => {
      focusInside = true;
      sync();
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      focusInside = !!next && row.contains(next);
      sync();
    };
    row.addEventListener("pointerenter", onEnter);
    row.addEventListener("pointerleave", onLeave);
    row.addEventListener("focusin", onFocusIn);
    row.addEventListener("focusout", onFocusOut);
    return () => {
      row.removeEventListener("pointerenter", onEnter);
      row.removeEventListener("pointerleave", onLeave);
      row.removeEventListener("focusin", onFocusIn);
      row.removeEventListener("focusout", onFocusOut);
      setHovered(false);
    };
  }, [node, mode, scope, inPlayScope]);

  if (!active || reducedMotion || mode === false) return false;
  if (mode === true) return true;
  return hovered || inPlayScope;
}

interface ProfileAssetLayerProps {
  url?: string | null;
  contentType?: string | null;
  alt: string;
  className?: string;
  /**
   * Video assets: `true` (default) plays while mounted (open profile
   * surfaces); `"hover"` shows the first frame and plays while the parent
   * row is hovered or focused (lists); `false` never plays.
   */
  playVideo?: DecorationPlayback;
  maskPreset?: "nameplateIdentity";
  maskFullOpacityStartPercent?: number;
  useMeasuredMask?: boolean;
}

const DEFAULT_NAMEPLATE_MASK_FULL_OPACITY_START = 92.86;
export const NAMEPLATE_MASK_SCALE_CSS_VAR = "--nameplate-mask-scale";
const NAMEPLATE_IDENTITY_ALPHA_STOPS: Array<{
  percent: number;
  alpha: number;
}> = [
  { percent: 0, alpha: 0 },
  { percent: 21.4, alpha: 0 },
  { percent: 25, alpha: 0.02 },
  { percent: 28.6, alpha: 0.04 },
  { percent: 35.7, alpha: 0.13 },
  { percent: 42.9, alpha: 0.27 },
  { percent: 50, alpha: 0.45 },
  { percent: 57.1, alpha: 0.65 },
  { percent: 64.3, alpha: 0.8 },
  { percent: 71.4, alpha: 0.91 },
  { percent: 78.6, alpha: 0.98 },
  { percent: 85.7, alpha: 1 },
  { percent: 92.86, alpha: 1 },
  { percent: 100, alpha: 1 },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildNameplateIdentityMask(
  fullOpacityStartPercent?: number,
  useMeasuredMask = false,
) {
  const targetFullOpacityStart = clamp(
    fullOpacityStartPercent ?? DEFAULT_NAMEPLATE_MASK_FULL_OPACITY_START,
    DEFAULT_NAMEPLATE_MASK_FULL_OPACITY_START,
    99,
  );
  const measuredMaskScale = `var(${NAMEPLATE_MASK_SCALE_CSS_VAR}, 1)`;

  return `linear-gradient(90deg, ${NAMEPLATE_IDENTITY_ALPHA_STOPS.map(
    ({ percent, alpha }) => {
      if (percent === 100) {
        return `rgba(0, 0, 0, ${alpha}) 100%`;
      }

      if (useMeasuredMask) {
        return `rgba(0, 0, 0, ${alpha}) calc(${percent}% * ${measuredMaskScale})`;
      }

      const scaledPercent =
        (percent / DEFAULT_NAMEPLATE_MASK_FULL_OPACITY_START) *
        targetFullOpacityStart;
      return `rgba(0, 0, 0, ${alpha}) ${Math.min(100, scaledPercent).toFixed(2)}%`;
    },
  ).join(", ")})`;
}

function isVideoUrl(url: string) {
  return /\.(?:mp4|webm|mov|m4v|ogv)(?:[?#].*)?$/i.test(url);
}

export function ProfileAssetLayer({
  url,
  contentType,
  alt,
  className,
  playVideo = true,
  maskPreset,
  maskFullOpacityStartPercent,
  useMeasuredMask = false,
}: ProfileAssetLayerProps) {
  if (!url) return null;

  const treatAsVideo = isVideo(contentType) || isVideoUrl(url);
  const src = treatAsVideo ? getMediaUrl(url) : getAuthAssetUrl(url);
  const maskStyle =
    maskPreset === "nameplateIdentity"
      ? ({
          maskImage: buildNameplateIdentityMask(
            maskFullOpacityStartPercent,
            useMeasuredMask,
          ),
          WebkitMaskImage: buildNameplateIdentityMask(
            maskFullOpacityStartPercent,
            useMeasuredMask,
          ),
        } satisfies CSSProperties)
      : undefined;

  if (treatAsVideo) {
    return (
      <ProfileVideoLayer
        src={src}
        alt={alt}
        className={className}
        style={maskStyle}
        playback={playVideo}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
      style={maskStyle}
    />
  );
}

/**
 * A looping profile video that only decodes while it should play: paused on
 * its first frame otherwise (lists, reduced motion, app inactive).
 */
function ProfileVideoLayer({
  src,
  alt,
  className,
  style,
  playback,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  playback: DecorationPlayback;
}) {
  const [node, setNode] = useState<HTMLVideoElement | null>(null);
  const setRef = useCallback((element: HTMLVideoElement | null) => {
    setNode(element);
  }, []);
  const playing = useDecorationPlayback(node, playback, "parent");

  useEffect(() => {
    if (!node) return;
    if (playing) {
      const attempt = node.play?.();
      if (attempt && typeof attempt.catch === "function") {
        attempt.catch(() => {});
      }
    } else {
      node.pause?.();
    }
  }, [node, playing, src]);

  return (
    <video
      ref={setRef}
      src={src}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
      style={style}
      loop
      muted
      playsInline
      preload="metadata"
      aria-label={alt}
    />
  );
}
