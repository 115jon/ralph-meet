import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EMBED_WIDTH, type EmbedWidth } from "./embed-layout";

/**
 * The one card every link embed sits in (generic links and every provider
 * card: YouTube, TikTok, X, Instagram). Talk Tree anatomy (spec §8,
 * Messages): `ply-2` with a `line` edge at radius 10, no shadow and no
 * coloured leading bar. The embed's own colour now lights the provider dot
 * in its header (see `embeds/EmbedChrome`).
 *
 * `width` is one of the three embed widths; the card never exceeds its
 * column. `bare` drops the fill and edge for content that brings its own
 * surface (a third-party player).
 */
export function EmbedFrame({
  children,
  width = "standard",
  bare = false,
  className,
}: {
  children: ReactNode;
  width?: EmbedWidth;
  bare?: boolean;
  className?: string;
}) {
  const style: CSSProperties = {
    width: `${EMBED_WIDTH[width]}px`,
    maxWidth: "100%",
  };

  return (
    <div
      data-embed-width={width}
      className={cn(
        "overflow-hidden rounded-lg text-ink-1",
        !bare && "border border-line bg-ply-2",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
