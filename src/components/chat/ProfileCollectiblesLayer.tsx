import {
  getProfileEffect,
  getProfileEffectLayers,
  getProfileFrame,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import {
  getProfileEffectFallbackAsset,
  getProfileEffectPlaybackSnapshot,
} from "@/lib/profile-effect-playback";
import { cn } from "@/lib/utils";
import { startTransition, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

interface ProfileCollectiblesLayerProps {
  display?: AvatarDisplay | string | null;
  className?: string;
  effectOpacity?: number;
  fit?: "contain" | "cover";
  blendMode?: "normal" | "screen";
  playAnimation?: boolean;
}

type MediaKind = "image" | "video";

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

function stripQuery(url: string) {
  const queryIndex = url.indexOf("?");
  return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
}

function inferMediaKind(url: string, preferredKind: MediaKind): MediaKind {
  const normalized = stripQuery(url).toLowerCase();

  if (
    normalized.endsWith(".webm") ||
    normalized.endsWith(".mp4") ||
    normalized.endsWith(".m4v") ||
    normalized.endsWith(".mov") ||
    normalized.endsWith(".ogv")
  ) {
    return "video";
  }

  if (
    normalized.endsWith(".png") ||
    normalized.endsWith(".jpg") ||
    normalized.endsWith(".jpeg") ||
    normalized.endsWith(".webp") ||
    normalized.endsWith(".gif") ||
    normalized.endsWith(".apng") ||
    normalized.endsWith(".svg")
  ) {
    return "image";
  }

  return preferredKind;
}

function buildMediaClassName(fit: "contain" | "cover") {
  return cn("absolute inset-0 h-full w-full", fit === "cover" ? "object-cover" : "object-contain");
}

function EffectVideo({
  src,
  fit,
  style,
  activeOffsetMs = 0,
  loop = false,
  onFallbackToImage,
}: {
  src: string;
  fit: "contain" | "cover";
  style: CSSProperties;
  activeOffsetMs?: number;
  loop?: boolean;
  onFallbackToImage: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const desiredTime = Math.max(0, activeOffsetMs) / 1000;

    const syncPlayback = () => {
      if (cancelled) return;

      if (desiredTime > 0) {
        try {
          const maxTime = Number.isFinite(video.duration) && video.duration > 0
            ? Math.max(0, video.duration - 0.05)
            : desiredTime;
          const targetTime = Math.min(desiredTime, maxTime);
          if (Math.abs(video.currentTime - targetTime) > 0.2) {
            video.currentTime = targetTime;
          }
        } catch {
          // Ignore seek failures while metadata is stabilizing.
        }
      }

      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    };

    if (video.readyState >= 1) {
      syncPlayback();
      return () => {
        cancelled = true;
      };
    }

    video.addEventListener("loadedmetadata", syncPlayback);
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", syncPlayback);
    };
  }, [activeOffsetMs, src]);

  return (
    <video
      ref={videoRef}
      src={src}
      className={buildMediaClassName(fit)}
      style={style}
      autoPlay
      loop={loop}
      muted
      playsInline
      preload="metadata"
      onError={onFallbackToImage}
    />
  );
}

function EffectMedia({
  src,
  fit,
  style,
  preferredKind,
  activeOffsetMs = 0,
  loop = false,
}: {
  src: string;
  fit: "contain" | "cover";
  style: CSSProperties;
  preferredKind: MediaKind;
  activeOffsetMs?: number;
  loop?: boolean;
}) {
  const guessedKind = useMemo(() => inferMediaKind(src, preferredKind), [preferredKind, src]);
  const [kind, setKind] = useState<MediaKind>(() => guessedKind);
  const [hasRetried, setHasRetried] = useState(false);

  const handleMediaError = () => {
    if (hasRetried) return;
    setHasRetried(true);
    setKind((currentKind) => (currentKind === "video" ? "image" : "video"));
  };

  if (kind === "video") {
    return (
      <EffectVideo
        src={src}
        fit={fit}
        style={style}
        activeOffsetMs={activeOffsetMs}
        loop={loop}
        onFallbackToImage={handleMediaError}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={buildMediaClassName(fit)}
      style={style}
      loading="lazy"
      decoding="async"
      onError={handleMediaError}
    />
  );
}

function buildTimelineKey(display?: AvatarDisplay | string | null) {
  const effect = getProfileEffect(display);
  const layers = getProfileEffectLayers(display);
  return [
    effect?.skuId ?? "none",
    ...layers.map((layer) =>
      [
        layer.src,
        layer.start ?? 0,
        layer.duration ?? 0,
        layer.loop === true ? 1 : 0,
        layer.loopDelay ?? 0,
        layer.zIndex ?? 0,
        layer.randomizedSources?.map((source) => source.src).join(",") ?? "",
      ].join(":"),
    ),
  ].join("|");
}

export function ProfileCollectiblesLayer({
  display,
  className,
  effectOpacity = 0.78,
  fit = "contain",
  blendMode = "normal",
  playAnimation = true,
}: ProfileCollectiblesLayerProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const effect = useMemo(() => getProfileEffect(display), [display]);
  const effectLayers = useMemo(() => getProfileEffectLayers(display), [display]);
  const frame = useMemo(() => getProfileFrame(display), [display]);
  const timelineKey = useMemo(() => buildTimelineKey(display), [display]);
  const timelineStartRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackSeed, setPlaybackSeed] = useState(0);

  const shouldAnimateLayers = playAnimation && !prefersReducedMotion && effectLayers.length > 0;
  const fallbackAsset = useMemo(
    () => getProfileEffectFallbackAsset(effect, { playAnimation, prefersReducedMotion }),
    [effect, playAnimation, prefersReducedMotion],
  );
  const playbackSnapshot = useMemo(
    () => (
      shouldAnimateLayers
        ? getProfileEffectPlaybackSnapshot(effectLayers, elapsedMs, playbackSeed)
        : { activeLayers: [], nextTransitionMs: null }
    ),
    [effectLayers, elapsedMs, playbackSeed, shouldAnimateLayers],
  );

  useEffect(() => {
    if (!shouldAnimateLayers) {
      startTransition(() => {
        setElapsedMs(0);
        setPlaybackSeed(0);
      });
      return;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    timelineStartRef.current = now;
    startTransition(() => {
      setPlaybackSeed(Math.max(1, Math.round(now * 1000)));
      setElapsedMs(0);
    });
  }, [shouldAnimateLayers, timelineKey]);

  useEffect(() => {
    if (!shouldAnimateLayers) return;
    if (playbackSnapshot.nextTransitionMs == null) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const currentElapsedMs = Math.max(0, now - timelineStartRef.current);
    const delayMs = Math.max(16, Math.ceil(playbackSnapshot.nextTransitionMs - currentElapsedMs));

    const timer = window.setTimeout(() => {
      const tickNow = typeof performance !== "undefined" ? performance.now() : Date.now();
      startTransition(() => setElapsedMs(Math.max(0, tickNow - timelineStartRef.current)));
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [playbackSnapshot.nextTransitionMs, shouldAnimateLayers]);

  useEffect(() => {
    if (!shouldAnimateLayers || typeof document === "undefined") return;

    const sync = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      startTransition(() => setElapsedMs(Math.max(0, now - timelineStartRef.current)));
    };

    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [shouldAnimateLayers]);

  if (!fallbackAsset.src && !effectLayers.length && !frame) return null;

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      {!shouldAnimateLayers && fallbackAsset.src ? (
        <EffectMedia
          key={`fallback:${fallbackAsset.kind}:${fallbackAsset.src}`}
          src={fallbackAsset.src}
          fit={fit}
          preferredKind={fallbackAsset.kind}
          loop={playAnimation && !prefersReducedMotion && fallbackAsset.kind === "video"}
          style={{ opacity: effectOpacity, mixBlendMode: blendMode }}
        />
      ) : null}

      {shouldAnimateLayers
        ? playbackSnapshot.activeLayers.map((state) => (
            <EffectMedia
              key={state.renderKey}
              src={state.resolvedSrc}
              fit={fit}
              preferredKind="video"
              activeOffsetMs={state.activeOffsetMs}
              loop={state.layer.loop === true && (state.layer.duration == null || !Number.isFinite(state.layer.duration))}
              style={{
                opacity: effectOpacity,
                mixBlendMode: blendMode,
                zIndex: state.zIndex,
              }}
            />
          ))
        : null}

      {frame?.layers.map((layer) => (
        <img
          key={layer.id}
          src={layer.src}
          alt=""
          className={cn(
            "absolute left-1/2 z-20 max-w-none -translate-x-1/2 object-contain",
            layer.anchor === "bottom" ? "bottom-[-8%]" : "top-[-10%]",
            layer.type === "rail" ? "w-[112%]" : "w-[122%]",
            layer.order === "back" && "z-0 opacity-80",
          )}
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  );
}
