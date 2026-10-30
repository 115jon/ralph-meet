import type {
  ProfileEffectLayer,
  ProfileEffectSelection,
} from "@/lib/avatar-display";

type MediaKind = "image" | "video";

export type ProfileEffectFallbackAsset = {
  src: string | null;
  kind: MediaKind;
};

export type ProfileEffectPlaybackLayerState = {
  layer: ProfileEffectLayer;
  resolvedSrc: string;
  renderIndex: number;
  renderKey: string;
  active: boolean;
  cycleIndex: number;
  startMs: number;
  activeOffsetMs: number;
  zIndex: number;
  nextTransitionMs: number | null;
};

export type ProfileEffectPlaybackSnapshot = {
  activeLayers: ProfileEffectPlaybackLayerState[];
  renderedLayers: ProfileEffectPlaybackLayerState[];
  nextTransitionMs: number | null;
};

function normalizeNonNegativeInt(value: number | undefined, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return fallback;
  return Math.round(value);
}

function normalizeFiniteInt(value: number | undefined, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(value);
}

function normalizePositiveInt(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null;
  return Math.round(value);
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getLayerSourceOptions(layer: ProfileEffectLayer) {
  const sources = [
    layer.src,
    ...(layer.randomizedSources?.map((source) => source.src) ?? []),
  ].filter(
    (src, index, entries) => Boolean(src) && entries.indexOf(src) === index,
  );

  return sources.length ? sources : [layer.src];
}

function buildPlaybackRenderKey(
  renderIndex: number,
  resolvedSrc: string,
  invocationSeed: number,
) {
  return `${renderIndex}:${resolvedSrc}:${invocationSeed}`;
}

export function resolveProfileEffectLayerSource(
  layer: ProfileEffectLayer,
  cycleIndex = 0,
  invocationSeed = 0,
) {
  const sources = getLayerSourceOptions(layer);
  if (sources.length === 1) return sources[0];

  const sourceIndex =
    hashString(`${layer.src}:${cycleIndex}:${invocationSeed}`) % sources.length;
  return sources[sourceIndex];
}

function pickFallbackAsset(
  candidates: Array<{ src?: string; kind: MediaKind }>,
): ProfileEffectFallbackAsset {
  for (const candidate of candidates) {
    if (candidate.src) return { src: candidate.src, kind: candidate.kind };
  }
  return { src: null, kind: "image" };
}

export function getProfileEffectFallbackAsset(
  effect: ProfileEffectSelection | undefined,
  options?: {
    playAnimation?: boolean;
    prefersReducedMotion?: boolean;
  },
): ProfileEffectFallbackAsset {
  if (!effect) return { src: null, kind: "image" };

  const playAnimation = options?.playAnimation !== false;
  const prefersReducedMotion = options?.prefersReducedMotion === true;

  if (prefersReducedMotion) {
    return pickFallbackAsset([
      { src: effect.reducedMotionSrc, kind: "image" },
      { src: effect.staticFrameSrc, kind: "image" },
      { src: effect.staticUrl, kind: "image" },
      { src: effect.thumbnailPreviewSrc, kind: "image" },
      { src: effect.previewUrl, kind: "image" },
      { src: effect.animatedUrl, kind: "video" },
      { src: effect.effectUrls[0], kind: "video" },
    ]);
  }

  if (!playAnimation) {
    return pickFallbackAsset([
      { src: effect.staticFrameSrc, kind: "image" },
      { src: effect.reducedMotionSrc, kind: "image" },
      { src: effect.staticUrl, kind: "image" },
      { src: effect.thumbnailPreviewSrc, kind: "image" },
      { src: effect.previewUrl, kind: "image" },
      { src: effect.animatedUrl, kind: "video" },
      { src: effect.effectUrls[0], kind: "video" },
    ]);
  }

  return pickFallbackAsset([
    { src: effect.animatedUrl, kind: "video" },
    { src: effect.effectUrls[0], kind: "video" },
    { src: effect.thumbnailPreviewSrc, kind: "image" },
    { src: effect.previewUrl, kind: "image" },
    { src: effect.staticFrameSrc, kind: "image" },
    { src: effect.reducedMotionSrc, kind: "image" },
    { src: effect.staticUrl, kind: "image" },
  ]);
}

export function getProfileEffectLayerState(
  layer: ProfileEffectLayer,
  elapsedMs: number,
  renderIndex = 0,
  invocationSeed = 0,
): ProfileEffectPlaybackLayerState {
  const safeElapsed = normalizeNonNegativeInt(elapsedMs);
  const startMs = normalizeNonNegativeInt(layer.start);
  const durationMs = normalizePositiveInt(layer.duration);
  const loopDelayMs = normalizeNonNegativeInt(layer.loopDelay);
  const zIndex = 4 + renderIndex + normalizeFiniteInt(layer.zIndex);
  const pendingSrc = resolveProfileEffectLayerSource(layer, 0, invocationSeed);

  if (safeElapsed < startMs) {
    return {
      layer,
      resolvedSrc: pendingSrc,
      renderIndex,
      renderKey: `${buildPlaybackRenderKey(renderIndex, pendingSrc, invocationSeed)}:pending`,
      active: false,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: 0,
      zIndex,
      nextTransitionMs: startMs,
    };
  }

  if (!durationMs) {
    const resolvedSrc = resolveProfileEffectLayerSource(
      layer,
      0,
      invocationSeed,
    );
    return {
      layer,
      resolvedSrc,
      renderIndex,
      renderKey: buildPlaybackRenderKey(
        renderIndex,
        resolvedSrc,
        invocationSeed,
      ),
      active: true,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: safeElapsed - startMs,
      zIndex,
      nextTransitionMs: null,
    };
  }

  if (layer.loop !== true) {
    const active = safeElapsed < startMs + durationMs;
    const resolvedSrc = resolveProfileEffectLayerSource(
      layer,
      0,
      invocationSeed,
    );
    return {
      layer,
      resolvedSrc,
      renderIndex,
      renderKey: buildPlaybackRenderKey(
        renderIndex,
        resolvedSrc,
        invocationSeed,
      ),
      active,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: active ? safeElapsed - startMs : durationMs,
      zIndex,
      nextTransitionMs: active ? startMs + durationMs : null,
    };
  }

  const periodMs = durationMs + loopDelayMs;
  if (periodMs <= 0) {
    const resolvedSrc = resolveProfileEffectLayerSource(
      layer,
      0,
      invocationSeed,
    );
    return {
      layer,
      resolvedSrc,
      renderIndex,
      renderKey: buildPlaybackRenderKey(
        renderIndex,
        resolvedSrc,
        invocationSeed,
      ),
      active: true,
      cycleIndex: 0,
      startMs,
      activeOffsetMs: safeElapsed - startMs,
      zIndex,
      nextTransitionMs: null,
    };
  }

  const elapsedSinceStart = safeElapsed - startMs;
  const cycleIndex = Math.floor(elapsedSinceStart / periodMs);
  const cycleStartMs = startMs + cycleIndex * periodMs;
  const cycleElapsedMs = elapsedSinceStart - cycleIndex * periodMs;
  const active = cycleElapsedMs < durationMs;
  const resolvedSrc = resolveProfileEffectLayerSource(
    layer,
    cycleIndex,
    invocationSeed,
  );

  return {
    layer,
    resolvedSrc,
    renderIndex,
    renderKey: buildPlaybackRenderKey(renderIndex, resolvedSrc, invocationSeed),
    active,
    cycleIndex,
    startMs: cycleStartMs,
    activeOffsetMs: active ? cycleElapsedMs : durationMs,
    zIndex,
    nextTransitionMs: active
      ? cycleStartMs + durationMs
      : cycleStartMs + periodMs,
  };
}

export function getProfileEffectPlaybackSnapshot(
  layers: ProfileEffectLayer[],
  elapsedMs: number,
  invocationSeed = 0,
): ProfileEffectPlaybackSnapshot {
  const safeElapsed = normalizeNonNegativeInt(elapsedMs);
  const states = layers.map((layer, index) =>
    getProfileEffectLayerState(layer, safeElapsed, index, invocationSeed),
  );
  const nextTransitionMs = states.reduce<number | null>((soonest, state) => {
    if (state.nextTransitionMs == null) return soonest;
    if (state.nextTransitionMs <= safeElapsed) return soonest;
    return soonest == null
      ? state.nextTransitionMs
      : Math.min(soonest, state.nextTransitionMs);
  }, null);

  return {
    activeLayers: states.filter((state) => state.active),
    renderedLayers: states.filter(
      (state) =>
        state.active ||
        safeElapsed >= normalizeNonNegativeInt(state.layer.start),
    ),
    nextTransitionMs,
  };
}

/* ------------------------------------------------------------------ */
/* Pass policy                                                          */
/* ------------------------------------------------------------------ */

/**
 * How a profile surface plays its effect.
 *
 * - `once`: one pass when the surface opens, then rest on the effect's still
 *   frame. Looping layers play their first cycle only. Every profile surface
 *   uses this (popovers, the modal, the sheet, the account popover, the
 *   editor preview): editing a status or a field never replays it, and nothing
 *   loops at rest (DESIGN.md, the Silent Idle Rule). A replay request (banner
 *   hover on someone else's card, the editor's Preview button) starts one more
 *   pass, and only after the current one has finished.
 * - `loop`: the authored timeline, loops and loop delays included, for as long
 *   as the surface is up. Only the shop / picker stage previews use it.
 */
export type ProfileEffectPlaybackMode = "once" | "loop";

/**
 * A layer with no authored duration plays its media to the end (it is not
 * looped in a pass); this caps the pass when that media never reports an end
 * (an animated image, a stalled video).
 */
export const PROFILE_EFFECT_UNTIMED_LAYER_CAP_MS = 10_000;

/** The layers as one pass plays them: no layer repeats. */
export function getProfileEffectPassLayers(
  layers: ProfileEffectLayer[],
  mode: ProfileEffectPlaybackMode,
): ProfileEffectLayer[] {
  if (mode === "loop") return layers;
  return layers.map((layer) =>
    layer.loop === true ? { ...layer, loop: false } : layer,
  );
}

/** When a layer finishes in one pass, in ms from the pass start. */
function getLayerPassEndMs(layer: ProfileEffectLayer) {
  const startMs = normalizeNonNegativeInt(layer.start);
  const durationMs = normalizePositiveInt(layer.duration);
  return {
    timed: durationMs != null,
    endMs: startMs + (durationMs ?? PROFILE_EFFECT_UNTIMED_LAYER_CAP_MS),
  };
}

/**
 * The latest moment one pass can still be running (every timed layer done,
 * every untimed layer at its cap). The component schedules its final check
 * here, so a pass always ends even when no media reports `ended`.
 */
export function getProfileEffectPassDeadlineMs(
  layers: ProfileEffectLayer[],
): number {
  return layers.reduce(
    (latest, layer) => Math.max(latest, getLayerPassEndMs(layer).endMs),
    0,
  );
}

/**
 * Whether one pass has finished at `elapsedMs`: every timed layer is past its
 * end, and every untimed layer has reported `ended` (by its index in
 * `layers`) or reached the cap. No layers means nothing to play.
 */
export function isProfileEffectPassComplete(
  layers: ProfileEffectLayer[],
  elapsedMs: number,
  endedLayerIndexes: ReadonlySet<number> = new Set(),
): boolean {
  const safeElapsed = normalizeNonNegativeInt(elapsedMs);
  return layers.every((layer, index) => {
    const { timed, endMs } = getLayerPassEndMs(layer);
    if (safeElapsed >= endMs) return true;
    return !timed && endedLayerIndexes.has(index);
  });
}

/**
 * Whether a replay request starts a new pass. Only a finished `once` pass
 * replays: a request mid-pass is dropped (no restart from frame 0), `loop`
 * never needs one, and a still surface (no animation, reduced motion) has
 * nothing to play.
 */
export function shouldReplayProfileEffect({
  mode,
  passComplete,
  canAnimate,
}: {
  mode: ProfileEffectPlaybackMode;
  passComplete: boolean;
  canAnimate: boolean;
}): boolean {
  return mode === "once" && canAnimate && passComplete;
}
