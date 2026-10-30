import { cn } from "@/lib/utils";

/**
 * Three typing dots as ONE SVG. The SVG element itself breathes (opacity
 * only), so the compositor runs the whole indicator as a single layer;
 * per-circle animations inside an SVG would repaint on the main thread.
 *
 * - `animate` false renders the still dots (the caller decides when typing
 *   has gone quiet).
 * - Reduced motion stops `animate-pulse` globally and `:root[data-app-inactive]`
 *   pauses it (both in `styles/motion.css`).
 * - `variant="badge"` is the avatar-corner pill used in the member list.
 *
 * The SVG is `role="presentation"` and its circles `aria-hidden`: the text
 * beside it (or the row's accessible name) carries the announcement.
 */
export function TypingDots({
  animate = false,
  variant = "inline",
  className,
}: {
  animate?: boolean;
  variant?: "inline" | "badge";
  className?: string;
}) {
  const pulse = animate && "animate-pulse [animation-duration:1.2s]";

  if (variant === "badge") {
    return (
      <svg
        role="presentation"
        viewBox="0 0 12 8"
        className={cn("h-2 w-3 shrink-0 text-ink-3", pulse, className)}
      >
        <rect width="12" height="8" rx="4" fill="currentColor" aria-hidden />
        <circle cx="3.5" cy="4" r="1" className="fill-ply-0" aria-hidden />
        <circle cx="6" cy="4" r="1" className="fill-ply-0" aria-hidden />
        <circle cx="8.5" cy="4" r="1" className="fill-ply-0" aria-hidden />
      </svg>
    );
  }

  return (
    <svg
      role="presentation"
      viewBox="0 0 20 4"
      className={cn(
        "h-1 w-5 shrink-0",
        animate ? "text-ink-2" : "text-ink-3",
        pulse,
        className,
      )}
    >
      <circle cx="2" cy="2" r="2" fill="currentColor" aria-hidden />
      <circle
        cx="10"
        cy="2"
        r="2"
        fill="currentColor"
        opacity="0.7"
        aria-hidden
      />
      <circle
        cx="18"
        cy="2"
        r="2"
        fill="currentColor"
        opacity="0.45"
        aria-hidden
      />
    </svg>
  );
}
