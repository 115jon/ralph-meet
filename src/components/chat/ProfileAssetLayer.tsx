import { isVideo } from "@/lib/media";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

interface ProfileAssetLayerProps {
  url?: string | null;
  contentType?: string | null;
  alt: string;
  className?: string;
  playVideo?: boolean;
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
      <video
        src={src}
        className={cn("absolute inset-0 h-full w-full object-cover", className)}
        style={maskStyle}
        autoPlay={playVideo}
        loop={playVideo}
        muted
        playsInline
        preload="metadata"
        aria-label={alt}
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
