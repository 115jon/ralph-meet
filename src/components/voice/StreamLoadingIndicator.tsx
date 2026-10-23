import { cn } from "@/lib/utils";

const SQUARE =
  "size-4 rounded-xs bg-rm-accent-ink animate-stream-loader motion-reduce:animate-none @md:size-5";

/**
 * A stream that is on its way: the four-square loader on the tile's own
 * surface (theme-correct in light and dark), with a spoken "Loading".
 * Everything inside a tile stays at or below z-10 (11.1).
 */
export const StreamLoadingIndicator = ({
  className,
}: {
  className?: string;
}) => (
  <div
    role="status"
    className={cn(
      "pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-rm-bg-surface",
      className,
    )}
  >
    <div
      aria-hidden
      className="grid grid-cols-2 gap-1.5 p-2 animate-in fade-in zoom-in-[0.97] duration-200"
    >
      <div className={SQUARE} style={{ animationDelay: "0ms" }} />
      <div className={SQUARE} style={{ animationDelay: "200ms" }} />
      <div className={SQUARE} style={{ animationDelay: "600ms" }} />
      <div className={SQUARE} style={{ animationDelay: "400ms" }} />
    </div>
    <span className="sr-only">Loading stream</span>
  </div>
);
