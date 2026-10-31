import {
  getProfileEffect,
  getProfileEffectLayers,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import {
  getProfileEffectFallbackAsset,
  getProfileEffectPassDeadlineMs,
  getProfileEffectPassLayers,
  getProfileEffectPlaybackSnapshot,
  isProfileEffectPassComplete,
  shouldReplayProfileEffect,
  type ProfileEffectPlaybackMode,
} from "@/lib/profile-effect-playback";
import { cn } from "@/lib/utils";
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

interface ProfileCollectiblesLayerProps {
  display?: AvatarDisplay | string | null;
  className?: string;
  effectOpacity?: number;
  fit?: "contain" | "cover";
  blendMode?: "normal" | "screen";
  playAnimation?: boolean;
  /** `once` (default): one pass per open, then the still frame. `loop`: shop stages. */
  playback?: ProfileEffectPlaybackMode;
  /** Change it to ask for one more pass (honoured once the last one ended). */
  replayKey?: number;
}

type MediaKind = "image" | "video";

export const PROFILE_EFFECT_STAGE_WIDTH = 450;
export const PROFILE_EFFECT_STAGE_HEIGHT = 880;

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;

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
  return cn(
    "pointer-events-none absolute",
    fit === "cover" ? "object-cover" : "object-contain",
  );
}

function formatStagePercent(value: number, max: number) {
  return `${Math.round((value / max) * 10_000) / 100}%`;
}

function buildLayerMediaStyle(
  fit: "contain" | "cover",
  effectOpacity: number,
  blendMode: "normal" | "screen",
  zIndex?: number,
  layer?: {
    width?: number;
    height?: number;
    position?: {
      x: number;
      y: number;
    };
  },
): CSSProperties {
  const hasExplicitBounds = Boolean(
    layer?.position || layer?.width != null || layer?.height != null,
  );

  return {
    left: layer?.position
      ? formatStagePercent(layer.position.x, PROFILE_EFFECT_STAGE_WIDTH)
      : 0,
    top: layer?.position
      ? formatStagePercent(layer.position.y, PROFILE_EFFECT_STAGE_HEIGHT)
      : 0,
    width: layer?.width
      ? formatStagePercent(layer.width, PROFILE_EFFECT_STAGE_WIDTH)
      : "100%",
    height: layer?.height
      ? formatStagePercent(layer.height, PROFILE_EFFECT_STAGE_HEIGHT)
      : "100%",
    opacity: effectOpacity,
    mixBlendMode: blendMode,
    objectFit: hasExplicitBounds
      ? "fill"
      : fit === "cover"
        ? "cover"
        : "contain",
    zIndex,
  };
}

function EffectVideo({
  src,
  fit,
  style,
  active,
  activeOffsetMs = 0,
  loop = false,
  onFallbackToImage,
  onEnded,
}: {
  src: string;
  fit: "contain" | "cover";
  style: CSSProperties;
  active: boolean;
  activeOffsetMs?: number;
  loop?: boolean;
  onFallbackToImage: () => void;
  onEnded: () => void;
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
          const maxTime =
            Number.isFinite(video.duration) && video.duration > 0
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

      if (!active) {
        video.pause();
        return;
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
  }, [active, activeOffsetMs, src]);

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
      onEnded={onEnded}
    />
  );
}

function EffectMedia({
  src,
  fit,
  style,
  active,
  preferredKind,
  activeOffsetMs = 0,
  loop = false,
  onEnded,
}: {
  src: string;
  fit: "contain" | "cover";
  style: CSSProperties;
  active: boolean;
  preferredKind: MediaKind;
  activeOffsetMs?: number;
  loop?: boolean;
  /** The media played to its end (videos only; images never end). */
  onEnded?: () => void;
}) {
  const guessedKind = useMemo(
    () => inferMediaKind(src, preferredKind),
    [preferredKind, src],
  );
  const [kind, setKind] = useState<MediaKind>(() => guessedKind);
  const [hasRetried, setHasRetried] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);

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
        style={
          hasEnded ? { ...style, opacity: 0, visibility: "hidden" } : style
        }
        active={active}
        activeOffsetMs={activeOffsetMs}
        loop={loop}
        onFallbackToImage={handleMediaError}
        onEnded={() => {
          setHasEnded(true);
          onEnded?.();
        }}
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={buildMediaClassName(fit)}
      style={hasEnded ? { ...style, opacity: 0, visibility: "hidden" } : style}
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
        layer.width ?? 0,
        layer.height ?? 0,
        layer.position?.x ?? 0,
        layer.position?.y ?? 0,
        layer.randomizedSources?.map((source) => source.src).join(",") ?? "",
      ].join(":"),
    ),
  ].join("|");
}

const NO_ENDED_LAYERS: ReadonlySet<number> = new Set();

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * The profile effect over a profile surface.
 *
 * `playback="once"` (the default, every profile surface) plays one pass when
 * the surface mounts or the equipped effect changes, then rests on the
 * effect's still frame. Re-renders, status changes and field edits never
 * restart it: the pass is keyed by the effect's timeline, not by `display`'s
 * identity. A changed `replayKey` asks for one more pass, honoured only once
 * the current pass has finished. `playback="loop"` (shop and picker stages)
 * keeps the authored loop running. Reduced motion shows the still frame.
 */
export function ProfileCollectiblesLayer({
  display,
  className,
  effectOpacity = 0.78,
  fit = "contain",
  blendMode = "normal",
  playAnimation = true,
  playback = "once",
  replayKey = 0,
}: ProfileCollectiblesLayerProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const effect = useMemo(() => getProfileEffect(display), [display]);
  const effectLayers = useMemo(
    () => getProfileEffectLayers(display),
    [display],
  );
  const passLayers = useMemo(
    () => getProfileEffectPassLayers(effectLayers, playback),
    [effectLayers, playback],
  );
  const timelineKey = useMemo(() => buildTimelineKey(display), [display]);
  const timelineStartRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackSeed, setPlaybackSeed] = useState(0);
  const [passId, setPassId] = useState(0);
  const [endedLayers, setEndedLayers] =
    useState<ReadonlySet<number>>(NO_ENDED_LAYERS);

  const canAnimate = playAnimation && !prefersReducedMotion;
  const hasLayers = passLayers.length > 0;
  const animatedFallback = useMemo(
    () =>
      getProfileEffectFallbackAsset(effect, {
        playAnimation,
        prefersReducedMotion,
      }),
    [effect, playAnimation, prefersReducedMotion],
  );
  const stillAsset = useMemo(
    () => getProfileEffectFallbackAsset(effect, { playAnimation: false }),
    [effect],
  );
  // Without authored layers the fallback media is the pass: one untimed
  // layer that ends when the video does (or at the cap).
  const fallbackPassLayers = useMemo(
    () => (animatedFallback.src ? [{ src: animatedFallback.src }] : []),
    [animatedFallback.src],
  );
  const timelineLayers = hasLayers ? passLayers : fallbackPassLayers;
  const passComplete =
    playback === "once" &&
    canAnimate &&
    isProfileEffectPassComplete(timelineLayers, elapsedMs, endedLayers);
  const clockRunning = canAnimate && timelineLayers.length > 0 && !passComplete;

  const playbackSnapshot = useMemo(
    () =>
      canAnimate && hasLayers
        ? getProfileEffectPlaybackSnapshot(passLayers, elapsedMs, playbackSeed)
        : { activeLayers: [], renderedLayers: [], nextTransitionMs: null },
    [canAnimate, hasLayers, passLayers, elapsedMs, playbackSeed],
  );
  const passDeadlineMs = useMemo(
    () => getProfileEffectPassDeadlineMs(timelineLayers),
    [timelineLayers],
  );

  // Start a pass: on mount, when the equipped effect changes, when motion is
  // allowed again, and on an honoured replay (passId).
  useEffect(() => {
    if (!canAnimate) {
      startTransition(() => {
        setElapsedMs(0);
        setPlaybackSeed(0);
        setEndedLayers(NO_ENDED_LAYERS);
      });
      return;
    }

    const now = nowMs();
    timelineStartRef.current = now;
    startTransition(() => {
      setPlaybackSeed(Math.max(1, Math.round(now * 1000)));
      setElapsedMs(0);
      setEndedLayers(NO_ENDED_LAYERS);
    });
  }, [canAnimate, timelineKey, passId]);

  // Replay requests: one more pass, only after the current one finished.
  const lastReplayKeyRef = useRef(replayKey);
  useEffect(() => {
    if (replayKey === lastReplayKeyRef.current) return;
    lastReplayKeyRef.current = replayKey;
    if (shouldReplayProfileEffect({ mode: playback, passComplete, canAnimate }))
      startTransition(() => setPassId((id) => id + 1));
  }, [replayKey, playback, passComplete, canAnimate]);

  // Wake at the next layer transition; a `once` pass also wakes at its
  // deadline so it always comes to rest.
  const nextLayerWakeMs =
    playbackSnapshot.nextTransitionMs ?? Number.POSITIVE_INFINITY;
  const nextWakeMs =
    playback === "once" && passDeadlineMs > elapsedMs
      ? Math.min(nextLayerWakeMs, passDeadlineMs)
      : nextLayerWakeMs;
  useEffect(() => {
    if (!clockRunning || !Number.isFinite(nextWakeMs)) return;

    const currentElapsedMs = Math.max(0, nowMs() - timelineStartRef.current);
    const delayMs = Math.max(16, Math.ceil(nextWakeMs - currentElapsedMs));

    const timer = window.setTimeout(() => {
      startTransition(() =>
        setElapsedMs(Math.max(0, nowMs() - timelineStartRef.current)),
      );
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [clockRunning, nextWakeMs]);

  useEffect(() => {
    if (!clockRunning || typeof document === "undefined") return;

    const sync = () => {
      startTransition(() =>
        setElapsedMs(Math.max(0, nowMs() - timelineStartRef.current)),
      );
    };

    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [clockRunning]);

  const markEnded = (index: number) =>
    setEndedLayers((current) => {
      if (current.has(index)) return current;
      const next = new Set(current);
      next.add(index);
      return next;
    });

  if (!animatedFallback.src && !effectLayers.length) return null;

  const resting = playback === "once" && passComplete;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      aria-hidden="true"
      data-effect-playback={
        !canAnimate ? "still" : resting ? "rest" : "playing"
      }
    >
      <div className="pointer-events-none absolute inset-0 z-10">
        {resting && stillAsset.src ? (
          // The pass is over: settle on the still frame with a short fade.
          <div className="absolute inset-0 transition-opacity duration-(--dur-3) ease-out starting:opacity-0">
            <EffectMedia
              key={`rest:${stillAsset.kind}:${stillAsset.src}`}
              src={stillAsset.src}
              fit={fit}
              active={false}
              preferredKind={stillAsset.kind}
              style={buildLayerMediaStyle(fit, effectOpacity, blendMode)}
            />
          </div>
        ) : null}

        {!resting && (!canAnimate || !hasLayers) && animatedFallback.src ? (
          <EffectMedia
            key={`fallback:${animatedFallback.kind}:${animatedFallback.src}:${passId}`}
            src={animatedFallback.src}
            fit={fit}
            active={canAnimate}
            preferredKind={animatedFallback.kind}
            loop={
              canAnimate &&
              playback === "loop" &&
              animatedFallback.kind === "video"
            }
            onEnded={() => markEnded(0)}
            style={buildLayerMediaStyle(fit, effectOpacity, blendMode)}
          />
        ) : null}

        {!resting && canAnimate && hasLayers
          ? playbackSnapshot.renderedLayers.map((state) => (
              <EffectMedia
                key={`${state.renderKey}:${state.active ? "active" : "idle"}`}
                src={state.resolvedSrc}
                fit={fit}
                active={state.active}
                preferredKind="video"
                activeOffsetMs={state.activeOffsetMs}
                loop={
                  state.layer.loop === true &&
                  (state.layer.loopDelay ?? 0) === 0
                }
                onEnded={() => markEnded(state.renderIndex)}
                style={{
                  ...buildLayerMediaStyle(
                    fit,
                    state.active ? effectOpacity : 0,
                    blendMode,
                    state.zIndex,
                    state.layer,
                  ),
                  visibility: state.active ? "visible" : "hidden",
                }}
              />
            ))
          : null}
      </div>
    </div>
  );
}
