import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one card every link embed sits in (generic links and every provider
 * card: YouTube, TikTok, X, Instagram, Spotify). Flat surface with a hairline,
 * `rounded-xl` like other media inside a message (design-system 5.1, 1.2: no
 * shadow). `accentColor` is the embed's own colour (sent by the server), drawn
 * as a 4px leading stripe only when present.
 */
export function EmbedFrame({
  children,
  width,
  accentColor,
  className,
}: {
  children: ReactNode;
  /** Preferred width in px; the frame never exceeds its column. */
  width?: number;
  accentColor?: string;
  className?: string;
}) {
  const style: CSSProperties = {
    width: width ? `${width}px` : "100%",
    maxWidth: "100%",
  };
  if (accentColor) {
    style.borderLeftColor = accentColor;
    style.borderLeftWidth = 4;
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface text-rm-text",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
