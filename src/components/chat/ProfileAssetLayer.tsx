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
}

// Matches the extracted collectible alpha window from Discord's 448x84 WebM:
// fully clear through about 21% of the width, then a long ramp until the art
// reaches full opacity around the last 7-8% on the right.
const NAMEPLATE_IDENTITY_MASK =
  "linear-gradient(90deg, " +
  "rgba(0, 0, 0, 0) 0%, " +
  "rgba(0, 0, 0, 0) 21.4%, " +
  "rgba(0, 0, 0, 0.02) 25%, " +
  "rgba(0, 0, 0, 0.04) 28.6%, " +
  "rgba(0, 0, 0, 0.13) 35.7%, " +
  "rgba(0, 0, 0, 0.27) 42.9%, " +
  "rgba(0, 0, 0, 0.45) 50%, " +
  "rgba(0, 0, 0, 0.65) 57.1%, " +
  "rgba(0, 0, 0, 0.8) 64.3%, " +
  "rgba(0, 0, 0, 0.91) 71.4%, " +
  "rgba(0, 0, 0, 0.98) 78.6%, " +
  "rgba(0, 0, 0, 1) 85.7%, " +
  "rgba(0, 0, 0, 1) 100%)";

const NAMEPLATE_IDENTITY_MASK_STYLE: CSSProperties = {
  maskImage: NAMEPLATE_IDENTITY_MASK,
  WebkitMaskImage: NAMEPLATE_IDENTITY_MASK,
};

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
}: ProfileAssetLayerProps) {
  if (!url) return null;

  const treatAsVideo = isVideo(contentType) || isVideoUrl(url);
  const src = treatAsVideo ? getMediaUrl(url) : getAuthAssetUrl(url);
  const maskStyle = maskPreset === "nameplateIdentity" ? NAMEPLATE_IDENTITY_MASK_STYLE : undefined;

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
