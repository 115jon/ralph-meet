import type {
  AvatarCollectibles,
  AvatarDisplay,
  ProfileEffectLayer,
  ProfileFrameSelection,
} from "@/lib/avatar-display";
import { getAvatarCollectibles } from "@/lib/avatar-display";
import type { CollectibleCatalogItem, CollectibleKind, CollectiblesCatalog } from "@/lib/collectibles-catalog";

const KIND_ORDER: CollectibleKind[] = [
  "avatar_decoration",
  "profile_effect",
  "nameplate",
  "profile_frame",
];

function cloneProfileEffectLayer(layer: NonNullable<CollectibleCatalogItem["profileEffect"]>["effects"][number]): ProfileEffectLayer {
  return {
    ...layer,
    position: layer.position ? { ...layer.position } : undefined,
    randomizedSources: layer.randomizedSources?.map((source) => ({ ...source })),
  };
}

function cloneProfileFrameLayers(
  item: CollectibleCatalogItem,
): ProfileFrameSelection["layers"] | undefined {
  return item.frame?.layers.map((layer) => ({ ...layer }));
}

export function collectibleItemToSelection(item: CollectibleCatalogItem): Partial<AvatarCollectibles> {
  if (item.kind === "avatar_decoration" && item.asset) {
    return {
      avatarDecoration: {
        skuId: item.skuId,
        name: item.name,
        asset: item.asset,
        imageUrl: item.staticUrl ?? item.previewUrl ?? item.animatedUrl ?? "",
      },
    };
  }

  if (item.kind === "profile_effect") {
    const effects = item.profileEffect?.effects.map((effect) => cloneProfileEffectLayer(effect)) ?? [];
    return {
      profileEffect: {
        skuId: item.skuId,
        name: item.name,
        animationType: item.profileEffect?.animationType,
        previewUrl: item.previewUrl ?? undefined,
        thumbnailPreviewSrc: item.profileEffect?.thumbnailPreviewSrc,
        reducedMotionSrc: item.profileEffect?.reducedMotionSrc,
        staticFrameSrc: item.profileEffect?.staticFrameSrc,
        staticUrl: item.staticUrl ?? undefined,
        animatedUrl: item.animatedUrl ?? undefined,
        effectUrls: effects.length
          ? effects.map((effect) => effect.src)
          : item.animatedUrl
            ? [item.animatedUrl]
            : [],
        effects,
      },
    };
  }

  if (item.kind === "nameplate" && item.staticUrl) {
    return {
      nameplate: {
        skuId: item.skuId,
        name: item.name,
        staticUrl: item.staticUrl,
        animatedUrl: item.animatedUrl ?? undefined,
        palette: item.palette ?? undefined,
      },
    };
  }

  if (item.kind === "profile_frame" && item.frame) {
    return {
      profileFrame: {
        skuId: item.skuId,
        name: item.name,
        innerWidth: item.frame.innerWidth,
        overflowTop: item.frame.overflowTop,
        overflowBottom: item.frame.overflowBottom,
        overflowHorizontal: item.frame.overflowHorizontal,
        layers: cloneProfileFrameLayers(item) ?? [],
      },
    };
  }

  return {};
}

export function selectedSkuForKind(
  display: AvatarDisplay | string | null | undefined,
  kind: CollectibleKind,
) {
  const collectibles = getAvatarCollectibles(display);
  if (kind === "avatar_decoration") return collectibles?.avatarDecoration?.skuId;
  if (kind === "profile_effect") return collectibles?.profileEffect?.skuId;
  if (kind === "nameplate") return collectibles?.nameplate?.skuId;
  return collectibles?.profileFrame?.skuId;
}

export function isBundleCollectible(item: CollectibleCatalogItem) {
  const isNameplate = item.kind === "nameplate";
  return !isNameplate && (
    (item.productType >= 1000 && item.productType < 2000) ||
    item.name.toLowerCase().includes("bundle")
  );
}

function resolveBundleProductId(
  catalog: CollectiblesCatalog | null | undefined,
  item: CollectibleCatalogItem,
) {
  if (!catalog) return null;
  if (isBundleCollectible(item)) return item.productId ?? null;

  const bundleProductIds = new Set(
    catalog.items
      .filter(isBundleCollectible)
      .map((candidate) => candidate.productId)
      .filter((productId): productId is string => typeof productId === "string" && productId.length > 0),
  );

  return item.productIds?.find((productId) => bundleProductIds.has(productId)) ?? null;
}

export function getBundleConstituentItems(
  catalog: CollectiblesCatalog | null | undefined,
  item: CollectibleCatalogItem,
) {
  const bundleProductId = resolveBundleProductId(catalog, item);
  if (!catalog || !bundleProductId) return [item];

  const candidates = catalog.items.filter(
    (candidate) => candidate.productId === bundleProductId || candidate.productIds?.includes(bundleProductId),
  );
  if (!candidates.length) return [item];

  const byKind = new Map<CollectibleKind, CollectibleCatalogItem>();
  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftRank =
      (left.id === item.id ? -20 : 0) +
      (left.productId === bundleProductId ? -10 : 0) +
      KIND_ORDER.indexOf(left.kind);
    const rightRank =
      (right.id === item.id ? -20 : 0) +
      (right.productId === bundleProductId ? -10 : 0) +
      KIND_ORDER.indexOf(right.kind);
    return leftRank - rightRank;
  });

  for (const candidate of sortedCandidates) {
    if (!byKind.has(candidate.kind)) {
      byKind.set(candidate.kind, candidate);
    }
  }

  return [...byKind.values()];
}

export function getCollectibleApplySelections(
  catalog: CollectiblesCatalog | null | undefined,
  item: CollectibleCatalogItem,
) {
  const selections = (isBundleCollectible(item) ? getBundleConstituentItems(catalog, item) : [item])
    .map((constituent) => ({ kind: constituent.kind, skuId: constituent.skuId }));

  return selections.length ? selections : [{ kind: item.kind, skuId: item.skuId }];
}

export function isBundleFullyApplied(
  display: AvatarDisplay | string | null | undefined,
  catalog: CollectiblesCatalog | null | undefined,
  item: CollectibleCatalogItem,
) {
  if (!isBundleCollectible(item)) return false;
  const constituents = getBundleConstituentItems(catalog, item);
  return constituents.length > 1 && constituents.every(
    (constituent) => selectedSkuForKind(display, constituent.kind) === constituent.skuId,
  );
}
