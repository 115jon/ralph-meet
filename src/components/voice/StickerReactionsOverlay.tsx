import type { SFUClient } from "@/lib/sfu-client";
import { getVoiceReactionMediaUrl } from "@/lib/voice-reaction-media";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StickerReactionsOverlayProps {
  sfu: SFUClient | null;
  /** When set, only reactions from this user ID are shown (per-card display). */
  senderUserId?: string;
}

interface StickerItem {
  id: string;
  url: string;
  /** MIME type of the reaction media. Determines whether to render <video> or <img>. */
  contentType: string;
  className: string;
  style: React.CSSProperties;
  /** Reduced motion: no travel, an opacity fade in place (10.5). */
  fade?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Base animation duration + buffer so we can remove DOM nodes after the CSS
 * animation finishes.  Must be >= the longest keyframe duration in global CSS.
 */
const CLEANUP_DELAY_MS = 4000;

/** Reduced-motion stand-in for the travel keyframes: fade in, hold, fade out. */
const FADE_KEYFRAMES: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: 0.15 },
  { opacity: 1, offset: 0.85 },
  { opacity: 0 },
];
const FADE_DURATION_MS = 2200;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StickerReactionsOverlay({
  sfu,
  senderUserId,
}: StickerReactionsOverlayProps) {
  const [stickers, setStickers] = useState<StickerItem[]>([]);

  // `sfu.on(...)` returns the unsubscribe function from EventEmitter.on.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!sfu) return;

    return sfu.on("app-event", (event) => {
      if (event.type !== "reaction.sticker") return;

      // Per-card filtering: skip only if user_id is present and belongs to a different user.
      // If user_id is absent (e.g. worker DB lookup failed), fall back to showing on all cards.
      if (senderUserId !== undefined) {
        const eventUserId =
          typeof event.user_id === "string" ? event.user_id : null;
        if (eventUserId !== null && eventUserId !== senderUserId) return;
      }

      const stickerUrl = typeof event.url === "string" ? event.url : "";
      if (!stickerUrl) return;

      // Determine content type — fall back to URL-based inference for older events
      const rawContentType =
        typeof event.contentType === "string" ? event.contentType : "";
      const contentType =
        rawContentType ||
        (stickerUrl.includes(".mp4") || stickerUrl.includes("/clips/")
          ? "video/mp4"
          : "image/gif");

      const displayMode =
        typeof event.displayMode === "string" ? event.displayMode : "single";
      const newItems: StickerItem[] = [];

      if (prefersReducedMotion()) {
        // One sticker that fades in place, whatever the mode: bursts, rain
        // and bounces are all travel.
        newItems.push({
          id: crypto.randomUUID(),
          url: stickerUrl,
          contentType,
          className:
            "absolute bottom-4 w-16 h-16 -translate-x-1/2 pointer-events-none object-contain opacity-0",
          style: { left: `${(Math.random() * 60 + 20).toFixed(1)}%` },
          fade: true,
        });
      } else if (displayMode === "single") {
        const id = crypto.randomUUID();
        const rot = (Math.random() * 40 - 20).toFixed(1);
        const left = (Math.random() * 60 + 20).toFixed(1);
        newItems.push({
          id,
          url: stickerUrl,
          contentType,
          className:
            "animate-reaction-single absolute bottom-0 w-16 h-16 pointer-events-none object-contain z-50",
          style: {
            left: `${left}%`,
            "--rot": `${rot}deg`,
          } as React.CSSProperties,
        });
      } else if (displayMode === "burst") {
        const count = 8;
        for (let i = 0; i < count; i++) {
          const id = crypto.randomUUID();
          const angle = i * (360 / count) + (Math.random() * 15 - 7.5);
          const rad = (angle * Math.PI) / 180;
          const distance = Math.random() * 80 + 80;
          const tx = (Math.cos(rad) * distance).toFixed(1);
          const ty = (Math.sin(rad) * distance).toFixed(1);
          const rot = (Math.random() * 180 - 90).toFixed(1);
          const delay = (Math.random() * 0.15).toFixed(2);
          newItems.push({
            id,
            url: stickerUrl,
            contentType,
            className:
              "animate-reaction-burst absolute bottom-4 left-1/2 w-12 h-12 pointer-events-none object-contain z-50",
            style: {
              "--tx": `${tx}px`,
              "--ty": `${ty}px`,
              "--rot": `${rot}deg`,
              animationDelay: `${delay}s`,
            } as React.CSSProperties,
          });
        }
      } else if (displayMode === "rain") {
        const count = 12;
        for (let i = 0; i < count; i++) {
          const id = crypto.randomUUID();
          const left = (Math.random() * 90 + 5).toFixed(1);
          const rot = (Math.random() * 360).toFixed(1);
          const delay = (Math.random() * 1.2).toFixed(2);
          newItems.push({
            id,
            url: stickerUrl,
            contentType,
            className:
              "animate-reaction-rain absolute top-0 w-12 h-12 pointer-events-none object-contain z-50",
            style: {
              left: `${left}%`,
              "--rot": `${rot}deg`,
              animationDelay: `${delay}s`,
            } as React.CSSProperties,
          });
        }
      } else if (displayMode === "bounce") {
        // "bounce" is the wire name; it lands rather than bounces (spec §6:
        // no overshoot). A short ease-out entrance, a hold, a faster exit.
        const id = crypto.randomUUID();
        const left = (Math.random() * 60 + 20).toFixed(1);
        const rot = (Math.random() * 16 - 8).toFixed(1);
        newItems.push({
          id,
          url: stickerUrl,
          contentType,
          className:
            "animate-reaction-land absolute top-1/4 w-16 h-16 -translate-x-1/2 pointer-events-none object-contain z-50",
          style: {
            left: `${left}%`,
            "--rot": `${rot}deg`,
          } as React.CSSProperties,
        });
      }

      if (newItems.length === 0) return;

      setStickers((prev) => [...prev, ...newItems]);

      newItems.forEach((item) => {
        setTimeout(() => {
          setStickers((prev) => prev.filter((s) => s.id !== item.id));
        }, CLEANUP_DELAY_MS);
      });
    });
  }, [sfu, senderUserId]);

  if (stickers.length === 0) return null;

  return (
    <div className="absolute inset-0 z-50 pointer-events-none overflow-hidden select-none">
      {stickers.map((item) => (
        <ReactionMedia key={item.id} item={item} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReactionMedia — renders <video> for MP4 clips (with audio!), <img> otherwise
// ---------------------------------------------------------------------------

function ReactionMedia({ item }: { item: StickerItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = item.contentType === "video/mp4";
  const src = getVoiceReactionMediaUrl(item.url, item.contentType);

  const fadeRef = useRef<HTMLElement | null>(null);

  // Auto-play as soon as the element mounts
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.play().catch(() => {
      // If autoplay was blocked (e.g. browser policy), silently ignore
    });
  }, []);

  useEffect(() => {
    const el = fadeRef.current;
    if (!item.fade || !el || typeof el.animate !== "function") return;
    const animation = el.animate(FADE_KEYFRAMES, {
      duration: FADE_DURATION_MS,
      easing: "ease-out",
      fill: "forwards",
    });
    return () => animation.cancel();
  }, [item.fade]);

  if (isVideo) {
    return (
      <video
        ref={(el) => {
          videoRef.current = el;
          fadeRef.current = el;
        }}
        src={src}
        className={item.className}
        style={item.style}
        autoPlay
        playsInline
        // Do NOT mute — clips should have audio when reacted
        muted={false}
        // Do not loop — play once and let the cleanup timer remove the element
        loop={false}
        preload="auto"
        aria-label="Reaction clip"
      >
        <track kind="captions" />
      </video>
    );
  }

  return (
    <img
      ref={(el) => {
        fadeRef.current = el;
      }}
      src={src}
      alt="Reaction"
      className={item.className}
      style={item.style}
      aria-hidden="true"
    />
  );
}
