import { isVideo } from "@/lib/media";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface ProfileAssetLayerProps {
  url?: string | null;
  contentType?: string | null;
  alt: string;
  className?: string;
}

function resolveProfileAssetUrl(url: string, contentType?: string | null) {
  return isVideo(contentType) ? getMediaUrl(url) : getAuthAssetUrl(url);
}

export function ProfileAssetLayer({ url, contentType, alt, className }: ProfileAssetLayerProps) {
  if (!url) return null;

  const src = resolveProfileAssetUrl(url, contentType);

  if (isVideo(contentType)) {
    return (
      <video
        src={src}
        className={cn("absolute inset-0 h-full w-full object-cover", className)}
        autoPlay
        loop
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
    />
  );
}
