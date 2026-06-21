import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface InlineEmojiProps {
  alt: string;
  native?: string | null;
  imageUrl?: string | null;
  fallbackText?: string;
  className?: string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
}

export default function InlineEmoji({
  alt,
  native = null,
  imageUrl = null,
  fallbackText,
  className,
  loading,
  decoding,
}: InlineEmojiProps) {
  if (imageUrl) {
    return (
      <img
        src={getAuthAssetUrl(imageUrl)}
        alt={alt}
        draggable={false}
        loading={loading}
        decoding={decoding}
        className={cn("inline-block h-[1.35em] w-[1.35em] select-none align-[-0.22em] object-contain", className)}
      />
    );
  }

  if (native) {
    return (
      <span className={cn("inline-block select-none leading-none", className)} aria-label={alt}>
        {native}
      </span>
    );
  }

  return <span className={className}>{fallbackText ?? alt}</span>;
}
