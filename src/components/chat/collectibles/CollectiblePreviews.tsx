/**
 * Live previews of collectibles on the user's own avatar, name and profile.
 * Thumbnails use static, resized art (see lib/collectible-assets); the
 * animated original loads only when `animate` is set, and a still stays
 * underneath until it has decoded so nothing flashes empty.
 */

import { AvatarImage } from "@/components/chat/AvatarImage";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { getAvatarDecoration, type AvatarDisplay } from "@/lib/avatar-display";
import {
  decorationMotionUrl,
  decorationStillUrl,
  effectStillUrl,
  nameplateMotionUrl,
  nameplateStillUrl,
} from "@/lib/collectible-assets";
import {
  displayWithCollectible,
  displayWithoutCollectible,
} from "@/lib/collectible-selection";
import type {
  CollectibleCatalogItem,
  CollectibleKind,
} from "@/lib/collectibles-catalog";
import { getDisplayInitial } from "@/lib/display-name";
import { cn } from "@/lib/utils";
import { useState, type CSSProperties } from "react";

import { useAppActive } from "@/hooks/useAppActive";

import { usePrefersReducedMotion } from "./hooks";

export type PreviewIdentity = {
  avatarSrc?: string;
  displayName: string;
  username?: string;
  /** The user's current look; previews swap one slot of it. */
  display?: AvatarDisplay | string | null;
};

/**
 * The avatar under a preview. Avatars are square keys (`rounded-avatar`); a
 * decoration's ring art is drawn for a circle, so a face wearing one keeps the
 * round crop (the same rule as AvatarImage). `round` is that case.
 */
function AvatarFace({
  avatarSrc,
  displayName,
  display,
  round = false,
  className,
}: {
  avatarSrc?: string;
  displayName: string;
  display?: AvatarDisplay | string | null;
  round?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "absolute inset-0 overflow-hidden bg-ply-2",
        round ? "rounded-full" : "rounded-avatar",
        className,
      )}
    >
      {avatarSrc ? (
        <AvatarImage
          src={avatarSrc}
          alt=""
          display={displayWithoutCollectible(display, "avatar_decoration")}
          loading="lazy"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-tint-3 font-display font-extrabold text-ink-1 [font-size:40cqw]">
          {getDisplayInitial({ name: displayName })}
        </span>
      )}
    </span>
  );
}

/**
 * The user's avatar wearing `item`. Size comes from the parent (it fills the
 * box, square). `animate` swaps in the animated APNG once it has loaded.
 */
export function DecorationAvatar({
  item,
  identity,
  animate = false,
  stillSize = 160,
  className,
}: {
  item: CollectibleCatalogItem | null;
  identity: PreviewIdentity;
  animate?: boolean;
  stillSize?: number;
  className?: string;
}) {
  const reduceMotion = usePrefersReducedMotion();
  // Behind a game or in a hidden tab the APNG stops decoding (spec §5f).
  const appActive = useAppActive();
  const motionSrc = item ? decorationMotionUrl(item) : undefined;
  const [loadedMotion, setLoadedMotion] = useState<string | null>(null);
  const playing = animate && appActive && !reduceMotion && Boolean(motionSrc);
  const motionVisible = playing && loadedMotion === motionSrc;

  return (
    <span
      className={cn(
        "relative block aspect-square w-full [container-type:inline-size]",
        className,
      )}
    >
      <AvatarFace
        avatarSrc={identity.avatarSrc}
        displayName={identity.displayName}
        display={identity.display}
        round={Boolean(item)}
      />
      {item ? (
        <>
          <img
            src={decorationStillUrl(item, stillSize)}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            draggable={false}
            className={cn(
              "pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[120%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain",
              motionVisible && "opacity-0",
            )}
          />
          {playing ? (
            <img
              src={motionSrc}
              alt=""
              aria-hidden="true"
              decoding="async"
              draggable={false}
              onLoad={() => setLoadedMotion(motionSrc ?? null)}
              className={cn(
                "pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[120%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain",
                !motionVisible && "opacity-0",
              )}
            />
          ) : null}
        </>
      ) : null}
    </span>
  );
}

/** A small profile-card silhouette used behind effect and frame thumbnails. */
function CardSilhouette({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-0 overflow-hidden rounded-[inherit] bg-ply-2 [container-type:inline-size]",
        className,
      )}
    >
      <span className="absolute inset-x-0 top-0 h-[42cqw] bg-tint-2" />
      <span className="absolute left-[7cqw] top-[30cqw] aspect-square w-[30cqw] rounded-avatar border-[2cqw] border-ply-2 bg-tint-3" />
      <span className="absolute left-[7cqw] top-[66cqw] h-[5cqw] w-[46cqw] rounded-full bg-tint-3" />
      <span className="absolute left-[7cqw] top-[75cqw] h-[4cqw] w-[30cqw] rounded-full bg-tint-2" />
      <span className="absolute inset-x-[7cqw] top-[88cqw] h-[30cqw] rounded-[5cqw] bg-tint-1" />
    </span>
  );
}

/** Portrait thumbnail of a profile effect (450:880), static. */
export function EffectThumb({
  item,
  className,
}: {
  item: CollectibleCatalogItem | null;
  className?: string;
}) {
  const src = item ? effectStillUrl(item) : undefined;
  return (
    <span
      className={cn(
        "relative block aspect-[450/880] w-full overflow-hidden rounded-md",
        className,
      )}
    >
      <CardSilhouette />
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

/** Neutral stand-ins for the profile-theme variables ProfileSurfaceShell reads. */
const NEUTRAL_PROFILE_THEME = {
  "--rm-profile-custom-background": "var(--color-ply-2)",
  "--rm-profile-custom-card-border": "var(--color-line)",
  "--rm-profile-custom-surface": "none",
  "--rm-profile-custom-surface-overlay-strong": "none",
} as CSSProperties;

/**
 * The user's profile card with `display` applied: effect playing, frame drawn
 * around it. Fills its box at the profile aspect (450:880); every inner size
 * is in container units so it reads the same at 140px or 320px wide.
 */
function ProfileCardPreview({
  identity,
  display,
  playAnimation = true,
  className,
  style,
}: {
  identity: PreviewIdentity;
  display: AvatarDisplay | null;
  playAnimation?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const roundAvatar = Boolean(getAvatarDecoration(display));
  return (
    <div
      className={cn(
        "relative aspect-[450/880] [container-type:inline-size]",
        className,
      )}
      style={{ ...NEUTRAL_PROFILE_THEME, ...style }}
    >
      <div className="absolute inset-0">
        <ProfileSurfaceShell
          display={display}
          variant="card"
          fit="cover"
          playAnimation={playAnimation}
          // A shop / picker stage is a preview on demand: the authored loop.
          effectPlayback="loop"
          className="h-full w-full"
          surfaceClassName="rounded-[7cqw]"
        >
          <div className="relative h-full [container-type:inline-size]">
            <div className="h-[42cqw] bg-tint-2" />
            <div className="absolute left-[7cqw] top-[26cqw] aspect-square w-[30cqw]">
              {/* Square like the real card's avatar; a decoration's ring art
                  is drawn for a circle, so a decorated one keeps the round
                  halo and crop. */}
              <span
                className={cn(
                  "absolute -inset-[4%] bg-ply-2",
                  roundAvatar ? "rounded-full" : "rounded-avatar",
                )}
              />
              <span className="absolute inset-0">
                {identity.avatarSrc ? (
                  <span
                    className={cn(
                      "absolute inset-0",
                      roundAvatar ? "rounded-full" : "rounded-avatar",
                    )}
                  >
                    <AvatarImage
                      src={identity.avatarSrc}
                      alt=""
                      display={display}
                    />
                  </span>
                ) : (
                  <span
                    className={cn(
                      "absolute inset-0 flex items-center justify-center bg-tint-3 font-display font-extrabold text-ink-1 [font-size:12cqw]",
                      roundAvatar ? "rounded-full" : "rounded-avatar",
                    )}
                  >
                    {getDisplayInitial({ name: identity.displayName })}
                  </span>
                )}
              </span>
            </div>
            <div className="px-[7cqw] pt-[18cqw]">
              <p className="truncate font-semibold leading-tight text-ink-1 [font-size:7.5cqw]">
                {identity.displayName}
              </p>
              {identity.username ? (
                <p className="truncate leading-tight text-ink-3 [font-size:5cqw]">
                  {identity.username}
                </p>
              ) : null}
              <div className="mt-[6cqw] space-y-[2.5cqw] rounded-[4cqw] bg-tint-1 p-[4cqw]">
                <span className="block h-[2.4cqw] w-[38%] rounded-full bg-tint-3" />
                <span className="block h-[2cqw] w-[82%] rounded-full bg-tint-2" />
                <span className="block h-[2cqw] w-[64%] rounded-full bg-tint-2" />
              </div>
            </div>
          </div>
        </ProfileSurfaceShell>
      </div>
    </div>
  );
}

/** Portrait thumbnail of a profile frame drawn around a card silhouette. */
export function FrameThumb({
  item,
  identity,
  className,
}: {
  item: CollectibleCatalogItem | null;
  identity: PreviewIdentity;
  className?: string;
}) {
  const display = item
    ? displayWithCollectible(null, "profile_frame", item)
    : null;
  return (
    <ProfileCardPreview
      identity={{ ...identity, username: undefined }}
      display={display}
      playAnimation={false}
      className={cn("w-full", className)}
    />
  );
}

/**
 * The user's name on a nameplate, the way it shows in member lists.
 */
export function NameplateRow({
  item,
  identity,
  animate = false,
  className,
}: {
  item: CollectibleCatalogItem | null;
  identity: PreviewIdentity;
  animate?: boolean;
  className?: string;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const appActive = useAppActive();
  const still = item ? nameplateStillUrl(item) : undefined;
  const motion = item ? nameplateMotionUrl(item) : undefined;
  const playing = animate && appActive && !reduceMotion && Boolean(motion);

  return (
    <span
      className={cn(
        "relative flex h-12 w-full items-center gap-3 overflow-hidden rounded-md bg-ply-2 px-3",
        className,
      )}
    >
      {still ? (
        <img
          src={still}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right"
        />
      ) : null}
      {playing ? (
        <video
          src={motion}
          poster={still}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right"
        />
      ) : null}
      <span className="relative size-8 shrink-0 [container-type:inline-size]">
        <AvatarFace
          avatarSrc={identity.avatarSrc}
          displayName={identity.displayName}
          display={identity.display}
        />
      </span>
      <span
        // Plate art fades out toward the leading edge where the name sits,
        // so the row's own text colour stays readable in both themes.
        className="relative min-w-0 truncate text-ui-sm font-semibold text-ink-1"
      >
        {identity.displayName}
      </span>
    </span>
  );
}

/**
 * The large live preview for one slot: avatar wearing a decoration, the
 * profile card with an effect or frame, or a member list with the nameplate.
 * `cardClassName` sizes the profile card (effects, frames).
 */
export function CollectibleStage({
  kind,
  identity,
  item,
  display,
  decorationClassName = "w-24 p-3 md:w-52 md:p-6",
  cardClassName = "h-56 md:h-[min(520px,100%)]",
}: {
  decorationClassName?: string;
  cardClassName?: string;
  kind: CollectibleKind;
  identity: PreviewIdentity;
  item: CollectibleCatalogItem | null;
  display: AvatarDisplay | null;
}) {
  if (kind === "avatar_decoration") {
    return (
      <div className={decorationClassName}>
        <DecorationAvatar
          item={item}
          identity={identity}
          animate
          stillSize={240}
        />
      </div>
    );
  }
  if (kind === "nameplate") {
    return (
      <div
        aria-hidden="true"
        className="flex w-full max-w-72 flex-col gap-1 rounded-lg border border-line bg-ply-1 p-2"
      >
        <span className="flex h-10 items-center gap-3 px-3 opacity-50">
          <span className="size-7 rounded-avatar bg-tint-3" />
          <span className="h-2 w-20 rounded-full bg-tint-3" />
        </span>
        <NameplateRow item={item} identity={identity} animate />
        <span className="flex h-10 items-center gap-3 px-3 opacity-50">
          <span className="size-7 rounded-avatar bg-tint-3" />
          <span className="h-2 w-28 rounded-full bg-tint-3" />
        </span>
      </div>
    );
  }
  return (
    <ProfileCardPreview
      identity={identity}
      display={display}
      className={cardClassName}
    />
  );
}
