import * as React from "react";

import { Led, type LedState } from "@/components/ui/led";
import { useSpeakingAttr } from "@/hooks/useIsSpeaking";
import { cn } from "@/lib/utils";

export type AvatarSize = 18 | 20 | 24 | 32 | 40 | 64 | 80 | 96;
export type Presence = "online" | "idle" | "dnd" | "offline";
type Ply = "ply-0" | "ply-1" | "ply-2" | "ply-3";

/* Initials are Bricolage 800; below 32 they hold the 11px floor. */
const SIZE: Record<AvatarSize, string> = {
  18: "size-[18px] text-[11px]",
  20: "size-5 text-[11px]",
  24: "size-6 text-[11px]",
  32: "size-8 text-[14px]",
  40: "size-10 text-[18px]",
  // Call tiles (spec §8 Voice: a 64–96 avatar). The initial stays modest:
  // a tile is a person, not a giant letter.
  64: "size-16 text-ui-lg",
  80: "size-20 text-[30px]",
  96: "size-24 text-ui-xl",
};

/** Presence is an LED: online talk, idle amber, dnd muted red, offline unlit. */
export const PRESENCE_LED: Record<Presence, LedState> = {
  online: "talk",
  idle: "idle",
  dnd: "muted",
  offline: "off",
};

const RING: Record<Ply, string> = {
  "ply-0": "[--avatar-ring:var(--ply-0)]",
  "ply-1": "[--avatar-ring:var(--ply-1)]",
  "ply-2": "[--avatar-ring:var(--ply-2)]",
  "ply-3": "[--avatar-ring:var(--ply-3)]",
};

type AvatarProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** Image URL; falls back to the initial on a tint when absent or broken. */
  src?: string | null;
  /** Display name: the alt text and the fallback initial. */
  name: string;
  size?: AvatarSize;
  /** Presence LED (6px, 8 at 40+) in a square cut out of `ring`. */
  presence?: Presence;
  /** The ply the avatar sits on, for the presence dot's cut-out. Default ply-1. */
  ring?: Ply;
  /**
   * Draw the speaking ring for this user. The avatar subscribes to that one
   * user's speaking flag (useIsSpeaking), so only it re-renders on a flip.
   */
  speakingUserId?: string | null;
  /** Force the speaking ring (fixtures, previews); overrides speakingUserId. */
  speaking?: boolean;
};

/**
 * C1 square avatar (DESIGN.md, Avatar): 18 / 20 / 24 / 32 / 40 / 80, plus
 * 64 / 96 for call tiles; 2px corners (`rounded-avatar`), a Bricolage
 * initial on tint-3, an optional presence LED in a square-cut notch at the
 * bottom-right, and the 2px talk `.rm-speak` ring. A square reads as a key
 * on the panel. Decorations and frames are layered by the caller.
 */
function Avatar({
  src,
  name,
  size = 32,
  presence,
  ring = "ply-1",
  speakingUserId,
  speaking,
  className,
  ...props
}: AvatarProps) {
  // Remember which src failed rather than a flag, so a new src (the user
  // changes their picture, or a recycled row shows someone else) gets its
  // own load attempt instead of inheriting the previous image's failure.
  const [brokenSrc, setBrokenSrc] = React.useState<string | null>(null);
  const broken = !!src && brokenSrc === src;
  const subscribed = useSpeakingAttr(
    speaking === undefined ? speakingUserId : null,
  );
  const speakingAttr =
    speaking === undefined
      ? subscribed
      : { "data-speaking": speaking ? "" : undefined };
  const showRing = speaking !== undefined || !!speakingUserId;
  const big = size >= 40;

  return (
    <span
      data-slot="avatar"
      className={cn(
        "relative inline-flex shrink-0 rounded-avatar",
        SIZE[size],
        RING[ring],
        showRing && "rm-speak",
        className,
      )}
      {...(showRing ? speakingAttr : null)}
      {...props}
    >
      {src && !broken ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBrokenSrc(src)}
          className="size-full rounded-[inherit] object-cover"
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className="flex size-full items-center justify-center rounded-[inherit] bg-tint-3 font-display leading-none font-extrabold text-ink-1 select-none"
        >
          {initial(name)}
        </span>
      )}
      {presence ? (
        <span
          aria-hidden="true"
          data-presence={presence}
          className={cn(
            "absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-[2px] bg-(--avatar-ring)",
            big ? "size-3.5" : "size-3",
          )}
        >
          <Led state={PRESENCE_LED[presence]} size={big ? 8 : 6} />
        </span>
      ) : null}
    </span>
  );
}

function initial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0]!.toUpperCase();
}

export { Avatar };
