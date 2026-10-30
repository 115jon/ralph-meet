import type { ReactNode } from "react";

import { AvatarImage } from "@/components/chat/AvatarImage";
import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { Icon, type IconName } from "@/components/ui/icon";
import { Led } from "@/components/ui/led";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { TILE_AVATAR_SIZE } from "./tile-utils";

/**
 * The pieces every call tile shares (talk-tree-spec §8 Voice): the channel
 * grid, the members tray, the focused stage, DM calls and public rooms all
 * draw a person the same way.
 *
 *   surface    ply-2 with a 1px line seam, 2px corners, tinted 6% at most
 *   avatar     64 on grid tiles, 80 for a single focused tile, a square key
 *              (rounded-avatar); without a picture, a tint-3 square with a
 *              Bricolage 800 initial about 40% of it. A decorated avatar keeps
 *              its round crop (AvatarImage), ring art is drawn for a circle.
 *   nameplate  bottom-left: LED (follows [data-speaking]), Bricolage name,
 *              state glyphs
 *   ring       .rm-speak on the tile's outer box, driven by useSpeakingAttr
 */

/** The initial on a 64/80 square: 28px, about 40% of it. */
const TILE_INITIAL_SIZE = "text-ui-2xl";

export function TileAvatar({
  name,
  avatar,
  avatarDisplay,
  sizeClassName = TILE_AVATAR_SIZE,
  initialClassName = TILE_INITIAL_SIZE,
  ringing = false,
  className,
}: {
  name: string;
  avatar?: string | null;
  avatarDisplay?: AvatarDisplay | string | null;
  sizeClassName?: string;
  initialClassName?: string;
  /** Mounts the one allowed loop: a ring that pings while the call rings. */
  ringing?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-visible rounded-avatar",
        sizeClassName,
        className,
      )}
    >
      {avatar ? (
        <AvatarImage
          src={getAuthAssetUrl(avatar)}
          alt={name}
          display={avatarDisplay}
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className={cn(
            "flex size-full items-center justify-center rounded-[inherit] bg-tint-3 font-display [font-optical-sizing:auto] leading-none font-extrabold text-ink-1 select-none",
            initialClassName,
          )}
        >
          {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
        </span>
      )}
      {ringing ? <RingingRing /> : null}
    </span>
  );
}

/**
 * Ringing (spec §6 exception): the only loop allowed in a call, a ring in
 * ink that scales out and fades around the square avatar. Never talk green
 * (green means speaking). The caller unmounts it when ringing ends.
 */
export function RingingRing({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-ringing-ring=""
      className={cn(
        "pointer-events-none absolute inset-0 rounded-avatar border-2 border-ink-3 animate-ring-ping",
        className,
      )}
    />
  );
}

export interface NameplateState {
  isMuted?: boolean;
  isDeafened?: boolean;
  serverMute?: boolean;
}

/**
 * Bottom-left nameplate: LED, a Bricolage 700 name (the kit's person name),
 * state glyphs. Over media it sits on a black/60 chip with white ink (the one
 * media-overlay exception); over the tinted surface it needs no chip. The LED
 * lights from the tile's [data-speaking], so a speaking flip never
 * re-renders this.
 */
export function TileNameplate({
  name,
  overMedia,
  state,
  kindIcon,
  kindLabel,
  meta,
  className,
}: {
  name: string;
  overMedia: boolean;
  state?: NameplateState;
  /** Media kind glyph after the name (screen share). */
  kindIcon?: IconName;
  kindLabel?: string;
  /** Trailing content (quality readout). */
  meta?: ReactNode;
  className?: string;
}) {
  const muted = !!state?.isMuted;
  const deafened = !!state?.isDeafened;
  return (
    <div
      data-tile-nameplate=""
      className={cn(
        "pointer-events-none flex h-6 max-w-[calc(100%-3rem)] min-w-0 items-center gap-1.5 rounded-sm px-1.5",
        overMedia ? "bg-black/60 text-white" : "text-ink-1",
        className,
      )}
    >
      <Led state="talk" follow="speaking" />
      <span className="min-w-0 truncate font-display [font-optical-sizing:auto] text-[13px] leading-4 font-bold">
        <InlineEmojiText text={name} />
      </span>
      {kindIcon ? (
        <Icon
          name={kindIcon}
          size="xs"
          label={kindLabel}
          className={cn("shrink-0", overMedia ? "text-white/80" : "text-ink-3")}
        />
      ) : null}
      {muted ? (
        state?.serverMute ? (
          <span className="flex shrink-0 items-center justify-center rounded-xs bg-danger-fill p-0.5 text-on-danger">
            <Icon name="mic" state="off" size="xs" label="Server muted" />
          </span>
        ) : (
          <Icon
            name="mic"
            state="off"
            size="xs"
            label="Muted"
            className={cn(
              "shrink-0",
              overMedia ? "text-white" : "text-muted-state",
            )}
          />
        )
      ) : null}
      {deafened ? (
        <Icon
          name="deafen"
          state="off"
          size="xs"
          label="Deafened"
          className={cn(
            "shrink-0",
            overMedia ? "text-white" : "text-muted-state",
          )}
        />
      ) : null}
      {meta}
    </div>
  );
}
