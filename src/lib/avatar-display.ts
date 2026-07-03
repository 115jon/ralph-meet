export type AvatarCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AvatarDecorationSelection = {
  skuId: string;
  name: string;
  asset: string;
  imageUrl: string;
};

export type ProfileEffectLayer = {
  src: string;
  loop?: boolean;
  duration?: number;
  start?: number;
  loopDelay?: number;
  zIndex?: number;
  width?: number;
  height?: number;
  position?: {
    x: number;
    y: number;
  };
  randomizedSources?: Array<{
    src: string;
  }>;
};

export type ProfileEffectSelection = {
  skuId: string;
  name: string;
  animationType?: number;
  previewUrl?: string;
  thumbnailPreviewSrc?: string;
  reducedMotionSrc?: string;
  staticFrameSrc?: string;
  staticUrl?: string;
  animatedUrl?: string;
  effectUrls: string[];
  effects?: ProfileEffectLayer[];
};

export type NameplateSelection = {
  skuId: string;
  name: string;
  staticUrl: string;
  animatedUrl?: string;
};

export type ProfileFrameSelection = {
  skuId: string;
  name: string;
  innerWidth: number;
  overflowTop: number;
  overflowBottom: number;
  overflowHorizontal: number;
  layers: Array<{
    id: string;
    src: string;
    type: string;
    order: "front" | "back";
    anchor: string;
    responsive: boolean;
  }>;
};

export type AvatarCollectibles = {
  avatarDecoration?: AvatarDecorationSelection;
  profileEffect?: ProfileEffectSelection;
  nameplate?: NameplateSelection;
  profileFrame?: ProfileFrameSelection;
};

export type AvatarDisplay = {
  version: 1;
  crop?: AvatarCropRect;
  collectibles?: AvatarCollectibles;
};

type AvatarImageStyle = {
  position: "absolute";
  left: string;
  top: string;
  width: string;
  height: string;
  maxWidth: "none";
  maxHeight: "none";
  objectFit: "fill";
};

const MAX_PERCENT = 100;
const MIN_CROP_SIZE = 1;
const MAX_NAME_LENGTH = 120;
const MAX_URL_LENGTH = 800;
const MAX_FRAME_LAYERS = 20;
const ALLOWED_ASSET_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
  "cdn.yapper.shop",
]);

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanString(value: unknown, maxLength = MAX_NAME_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function cleanAssetHash(value: unknown): string | null {
  const cleaned = cleanString(value, 120);
  if (!cleaned || !/^[a-zA-Z0-9_./'’ -]+$/.test(cleaned)) return null;
  return cleaned;
}

function cleanAssetUrl(value: unknown): string | null {
  const cleaned = cleanString(value, MAX_URL_LENGTH);
  if (!cleaned) return null;

  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_ASSET_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanOptionalNumber(value: unknown, maxValue = 5000): number | undefined {
  if (!isFiniteNumber(value) || value < 0 || value > maxValue) return undefined;
  return Math.round(value);
}

function parseAvatarDisplayInput(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function normalizeAvatarDisplay(value: unknown): AvatarDisplay | null {
  const input = parseAvatarDisplayInput(value);
  if (!input || typeof input !== "object") return null;

  const candidate = input as { version?: unknown; crop?: Partial<AvatarCropRect>; collectibles?: unknown };
  const crop = candidate.crop;
  if (candidate.version !== 1) return null;

  let normalizedCrop: AvatarCropRect | undefined;
  if (crop !== undefined) {
    const { x, y, width, height } = crop;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
      return null;
    }

    if (width < MIN_CROP_SIZE || height < MIN_CROP_SIZE || width > MAX_PERCENT || height > MAX_PERCENT) {
      return null;
    }

    if (x < 0 || y < 0 || x + width > MAX_PERCENT || y + height > MAX_PERCENT) {
      return null;
    }

    normalizedCrop = {
      x: roundPercent(x),
      y: roundPercent(y),
      width: roundPercent(width),
      height: roundPercent(height),
    };
  }

  const collectibles = normalizeAvatarCollectibles(candidate.collectibles);
  if (!normalizedCrop && !collectibles) return null;

  const normalized: AvatarDisplay = { version: 1 };
  if (normalizedCrop) normalized.crop = normalizedCrop;
  if (collectibles) normalized.collectibles = collectibles;

  return normalized;
}

export function serializeAvatarDisplay(value: unknown): string | null {
  const display = normalizeAvatarDisplay(value);
  return display ? JSON.stringify(display) : null;
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Object.is(rounded, -0) ? 0 : rounded}%`;
}

export function avatarDisplayToImageStyle(value: unknown): AvatarImageStyle | undefined {
  const display = normalizeAvatarDisplay(value);
  if (!display?.crop) return undefined;

  const { crop } = display;
  return {
    position: "absolute",
    left: formatPercent(-(crop.x * 100) / crop.width),
    top: formatPercent(-(crop.y * 100) / crop.height),
    width: formatPercent(10_000 / crop.width),
    height: formatPercent(10_000 / crop.height),
    maxWidth: "none",
    maxHeight: "none",
    objectFit: "fill",
  };
}

function normalizeAvatarCollectibles(value: unknown): AvatarCollectibles | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const collectibles: AvatarCollectibles = {};

  const avatarDecoration = normalizeAvatarDecoration(input.avatarDecoration);
  if (avatarDecoration) collectibles.avatarDecoration = avatarDecoration;

  const profileEffect = normalizeProfileEffect(input.profileEffect);
  if (profileEffect) collectibles.profileEffect = profileEffect;

  const nameplate = normalizeNameplate(input.nameplate);
  if (nameplate) collectibles.nameplate = nameplate;

  const profileFrame = normalizeProfileFrame(input.profileFrame);
  if (profileFrame) collectibles.profileFrame = profileFrame;

  return Object.keys(collectibles).length > 0 ? collectibles : undefined;
}

function normalizeAvatarDecoration(value: unknown): AvatarDecorationSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const skuId = cleanString(input.skuId, 64);
  const name = cleanString(input.name);
  const asset = cleanAssetHash(input.asset);
  const imageUrl = cleanAssetUrl(input.imageUrl);
  if (!skuId || !name || !asset || !imageUrl) return undefined;
  return { skuId, name, asset, imageUrl };
}

function normalizeProfileEffect(value: unknown): ProfileEffectSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const skuId = cleanString(input.skuId, 64);
  const name = cleanString(input.name);
  if (!skuId || !name) return undefined;

  const effects = Array.isArray(input.effects)
    ? input.effects
      .map((effect) => {
        if (!effect || typeof effect !== "object") return null;
        const row = effect as Record<string, unknown>;
        const randomizedSources = Array.isArray(row.randomizedSources)
          ? row.randomizedSources
            .map((source) => {
              if (!source || typeof source !== "object") return null;
              const src = cleanAssetUrl((source as Record<string, unknown>).src);
              return src ? { src } : null;
            })
            .filter((source): source is { src: string } => source !== null)
            .slice(0, 12)
          : [];
        const src = cleanAssetUrl(row.src) ?? randomizedSources[0]?.src ?? null;
        if (!src) return null;
        const layer: ProfileEffectLayer = {
          src,
          loop: typeof row.loop === "boolean" ? row.loop : undefined,
          duration: isFiniteNumber(row.duration) ? row.duration : undefined,
          start: isFiniteNumber(row.start) ? row.start : undefined,
          loopDelay: isFiniteNumber(row.loopDelay) ? row.loopDelay : undefined,
          zIndex: isFiniteNumber(row.zIndex) ? row.zIndex : undefined,
          width: cleanOptionalNumber(row.width),
          height: cleanOptionalNumber(row.height),
          position:
            row.position && typeof row.position === "object"
              ? (() => {
                  const position = row.position as Record<string, unknown>;
                  const x = cleanOptionalNumber(position.x);
                  const y = cleanOptionalNumber(position.y);
                  if (x == null || y == null) return undefined;
                  return { x, y };
                })()
              : undefined,
          randomizedSources: randomizedSources.length ? randomizedSources : undefined,
        };
        return layer;
      })
      .filter((effect): effect is ProfileEffectLayer => effect !== null)
      .slice(0, 12)
    : [];
  const legacyEffectUrls = Array.isArray(input.effectUrls)
    ? input.effectUrls.map(cleanAssetUrl).filter((url): url is string => Boolean(url)).slice(0, 12)
    : [];
  const effectUrls = effects.length ? effects.map((effect) => effect.src) : legacyEffectUrls;
  const previewUrl = cleanAssetUrl(input.previewUrl);
  const thumbnailPreviewSrc = cleanAssetUrl(input.thumbnailPreviewSrc);
  const reducedMotionSrc = cleanAssetUrl(input.reducedMotionSrc);
  const staticFrameSrc = cleanAssetUrl(input.staticFrameSrc);
  const staticUrl = cleanAssetUrl(input.staticUrl);
  const animatedUrl = cleanAssetUrl(input.animatedUrl);

  if (
    !previewUrl &&
    !thumbnailPreviewSrc &&
    !reducedMotionSrc &&
    !staticFrameSrc &&
    !staticUrl &&
    !animatedUrl &&
    effectUrls.length === 0
  ) {
    return undefined;
  }

  return {
    skuId,
    name,
    animationType: isFiniteNumber(input.animationType) ? Math.round(input.animationType) : undefined,
    previewUrl: previewUrl ?? undefined,
    thumbnailPreviewSrc: thumbnailPreviewSrc ?? undefined,
    reducedMotionSrc: reducedMotionSrc ?? undefined,
    staticFrameSrc: staticFrameSrc ?? undefined,
    staticUrl: staticUrl ?? undefined,
    animatedUrl: animatedUrl ?? undefined,
    effectUrls,
    effects: effects.length ? effects : undefined,
  };
}

function normalizeNameplate(value: unknown): NameplateSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const skuId = cleanString(input.skuId, 64);
  const name = cleanString(input.name);
  const staticUrl = cleanAssetUrl(input.staticUrl);
  const animatedUrl = cleanAssetUrl(input.animatedUrl);
  if (!skuId || !name || !staticUrl) return undefined;
  return { skuId, name, staticUrl, animatedUrl: animatedUrl ?? undefined };
}

function normalizeProfileFrame(value: unknown): ProfileFrameSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const skuId = cleanString(input.skuId, 64);
  const name = cleanString(input.name);
  if (!skuId || !name) return undefined;

  const rawLayers = Array.isArray(input.layers) ? input.layers : [];
  const layers = rawLayers
    .map((layer) => {
      if (!layer || typeof layer !== "object") return null;
      const row = layer as Record<string, unknown>;
      const id = cleanString(row.id, 64);
      const src = cleanAssetUrl(row.src);
      const type = cleanString(row.type, 32) ?? "staple";
      const anchor = cleanString(row.anchor, 32) ?? "top";
      if (!id || !src) return null;
      return {
        id,
        src,
        type,
        order: row.order === "back" ? "back" as const : "front" as const,
        anchor,
        responsive: row.responsive === true,
      };
    })
    .filter((layer): layer is ProfileFrameSelection["layers"][number] => Boolean(layer))
    .slice(0, MAX_FRAME_LAYERS);

  if (!layers.length) return undefined;

  return {
    skuId,
    name,
    innerWidth: normalizePositiveNumber(input.innerWidth, 1200),
    overflowTop: normalizePositiveNumber(input.overflowTop, 300),
    overflowBottom: normalizePositiveNumber(input.overflowBottom, 200),
    overflowHorizontal: normalizePositiveNumber(input.overflowHorizontal, 50),
    layers,
  };
}

function normalizePositiveNumber(value: unknown, fallback: number) {
  if (!isFiniteNumber(value) || value < 0 || value > 5000) return fallback;
  return Math.round(value);
}

export function getAvatarCollectibles(value: unknown): AvatarCollectibles | undefined {
  return normalizeAvatarDisplay(value)?.collectibles;
}

export function getAvatarDecoration(value: unknown): AvatarDecorationSelection | undefined {
  return getAvatarCollectibles(value)?.avatarDecoration;
}

export function getProfileEffect(value: unknown): ProfileEffectSelection | undefined {
  return getAvatarCollectibles(value)?.profileEffect;
}

export function getProfileEffectLayers(value: unknown): ProfileEffectLayer[] {
  const effect = getProfileEffect(value);
  if (!effect) return [];

  const layers = effect.effects?.length
    ? effect.effects
    : effect.effectUrls.map((src, index) => ({ src, zIndex: index }));

  return [...layers].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
}

export function getProfileFrame(value: unknown): ProfileFrameSelection | undefined {
  return getAvatarCollectibles(value)?.profileFrame;
}
