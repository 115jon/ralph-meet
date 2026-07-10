import {
  avatarDisplayToImageStyle,
  getAvatarDecoration,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import { cn } from "@/lib/utils";
import type React from "react";

interface AvatarImageProps {
  src: string;
  alt: string;
  display?: AvatarDisplay | string | null;
  className?: string;
  imageClassName?: string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "sync" | "auto";
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  onError?: React.ReactEventHandler<HTMLImageElement>;
}

export function AvatarImage({
  src,
  alt,
  display,
  className,
  imageClassName,
  loading,
  decoding = "async",
  referrerPolicy,
  onError,
}: AvatarImageProps) {
  const displayStyle = avatarDisplayToImageStyle(display);
  const avatarDecoration = getAvatarDecoration(display);

  return (
    <span
      className={cn(
        "relative block h-full w-full overflow-visible rounded-[inherit]",
        className,
      )}
    >
      <span className="absolute inset-0 block overflow-hidden rounded-[inherit]">
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          referrerPolicy={referrerPolicy}
          onError={onError}
          className={cn(
            displayStyle
              ? "block"
              : "absolute inset-0 h-full w-full object-cover",
            imageClassName,
          )}
          style={displayStyle}
        />
      </span>
      {avatarDecoration && (
        <img
          src={avatarDecoration.imageUrl}
          alt=""
          aria-hidden="true"
          loading={loading}
          decoding={decoding}
          className="pointer-events-none absolute left-1/2 top-1/2 z-[1] h-[124%] w-[124%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
        />
      )}
    </span>
  );
}
