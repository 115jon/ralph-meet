import type {
  AvatarCollectibles,
  ProfileEffectLayer,
  ProfileFrameSelection,
} from "@/lib/avatar-display";
import type { CollectibleCatalogItem } from "@/lib/collectibles-catalog";

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
