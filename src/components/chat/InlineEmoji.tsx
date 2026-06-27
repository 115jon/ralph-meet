import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface InlineEmojiProps {
  alt: string;
  native?: string | null;
  imageUrl?: string | null;
  fallbackText?: string;
  selectionText?: string;
  selectable?: boolean;
  className?: string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
}

export default function InlineEmoji({
  alt,
  native = null,
  imageUrl = null,
  fallbackText,
  selectionText,
  selectable = false,
  className,
  loading,
  decoding,
}: InlineEmojiProps) {
  const resolvedSelectionText = selectionText ?? fallbackText ?? native ?? alt;

  if (selectable) {
    return (
      <span
        className={cn("relative inline-block h-[1.35em] w-[1.35em] overflow-hidden align-[-0.22em] leading-none select-text", className)}
        aria-label={alt}
      >
        <span aria-hidden="true" className="whitespace-nowrap text-transparent">
          {resolvedSelectionText}
        </span>
        {imageUrl ? (
          <img
            src={getAuthAssetUrl(imageUrl)}
            alt=""
            aria-hidden="true"
            draggable={false}
            loading={loading}
            decoding={decoding}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        ) : native ? (
          <span className="pointer-events-none absolute inset-0 inline-flex items-center justify-center" aria-hidden="true">
            {native}
          </span>
        ) : (
          <span className="pointer-events-none absolute inset-0 inline-flex items-center justify-center" aria-hidden="true">
            {fallbackText ?? alt}
          </span>
        )}
      </span>
    );
  }

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
