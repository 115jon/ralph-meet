import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * The one play button for every inline player: YouTube, Vimeo and rich
 * players, TikTok, X video, direct video links and video attachments.
 *
 * It is the visual only. The whole media frame is the control (a `<button>`
 * or link with the accessible name), so the target is large and the disc
 * stays dead centre at any frame size. Give that host the `group/media`
 * class: hover lifts the disc to `ply-4`, keyboard focus rings it, and a
 * pointer press scales it to .96.
 *
 * A `ply-3` float (spec §1h: line plus shadow-2) carrying a Phosphor Fill
 * glyph in `ink-1`, so it follows the theme and keeps its contrast over any
 * frame. No brand colour: YouTube's red pill is gone.
 */
export function MediaPlayButton({
  icon = "play",
  size = "md",
  className,
}: {
  /** `replay` after a video ended; `pause` for the press splash. */
  icon?: "play" | "pause" | "replay";
  /** md 48 (in chat), lg 56 (the image viewer). */
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-media-play=""
      className={cn(
        "pointer-events-none inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-ply-3 text-ink-1 shadow-float",
        "transition-[scale,background-color] duration-(--dur-1) ease-out pointer-fine:group-hover/media:bg-ply-4 group-active/media:scale-(--motion-press-icon)",
        "group-focus-visible/media:outline-2 group-focus-visible/media:outline-offset-2 group-focus-visible/media:outline-focus",
        size === "lg" ? "size-14" : "size-12",
        className,
      )}
    >
      {icon === "replay" ? (
        <Icon name="reset" size="xl" />
      ) : (
        <Icon
          name={icon}
          state="active"
          size="xl"
          // Optical centre: a play triangle's mass sits left of its box.
          className={icon === "play" ? "translate-x-px" : undefined}
        />
      )}
    </span>
  );
}
