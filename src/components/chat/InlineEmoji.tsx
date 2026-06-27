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
        className={cn("relative inline-block select-text emoji-selectable m-0 p-0", className)}
        style={{
          margin: 0,
          padding: 0,
          height: "1.2em",
          width: "1.2em",
          verticalAlign: "-0.01em",
          overflow: "visible",
        }}
        aria-label={alt}
      >
        <span
          aria-hidden="true"
          className="whitespace-nowrap text-transparent"
          style={{
            display: "inline-block",
            width: "100%",
            height: "100%",
            fontSize: "inherit",
            lineHeight: "inherit",
            color: "transparent",
            pointerEvents: "auto",
            userSelect: "text",
            letterSpacing: "-0.17em",
          }}
        >
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
            className="pointer-events-none absolute object-contain"
            style={{
              aspectRatio: "1 / 1",
              top: "0em",
              left: "0em",
              width: "1.25em",
              height: "1.25em",
            }}
          />
        ) : native ? (
          <span
            className="pointer-events-none absolute inline-flex items-center justify-center"
            style={{
              aspectRatio: "1 / 1",
              top: "0em",
              left: "0em",
              width: "1.25em",
              height: "1.25em",
              fontSize: "1.25em",
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            {native}
          </span>
        ) : (
          <span
            className="pointer-events-none absolute inline-flex items-center justify-center"
            style={{
              aspectRatio: "1 / 1",
              top: "0em",
              left: "0em",
              width: "1.25em",
              height: "1.25em",
            }}
            aria-hidden="true"
          >
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
        className={cn("inline-block w-auto select-none object-contain", className)}
        style={{
          aspectRatio: "1 / 1",
          height: "1.35em",
          verticalAlign: "-0.3em",
        }}
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
