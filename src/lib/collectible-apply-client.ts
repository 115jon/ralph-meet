import { apiPatch } from "@/lib/api-client";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { getCollectibleApplySelections } from "@/lib/collectible-selection";
import type {
  CollectibleCatalogItem,
  CollectibleKind,
  CollectiblesCatalog,
} from "@/lib/collectibles-catalog";

export type CollectibleApplyUser = {
  avatar_display: AvatarDisplay | null;
  nameplate_url: string | null;
  nameplate_content_type: string | null;
  updated_at: string | null;
};

/**
 * Equip `item` in its slot (or clear the slot when `item` is null) through
 * PATCH /api/collectibles/apply. Bundles apply every piece at once. Returns
 * the saved user fields and the slots that changed.
 */
export async function applyCollectible({
  catalog,
  kind,
  item,
  currentDisplay,
}: {
  catalog: CollectiblesCatalog | null;
  kind: CollectibleKind;
  item: CollectibleCatalogItem | null;
  currentDisplay: AvatarDisplay | string | null | undefined;
}): Promise<{ user: CollectibleApplyUser; appliedKinds: CollectibleKind[] }> {
  const selections = item ? getCollectibleApplySelections(catalog, item) : [];
  const data = await apiPatch<{ ok: true; user: CollectibleApplyUser }>(
    "/api/collectibles/apply",
    {
      ...(selections.length > 1
        ? { selections }
        : { kind: item?.kind ?? kind, skuId: item?.skuId ?? null }),
      avatarDisplay: currentDisplay ?? null,
    },
  );
  return {
    user: data.user,
    appliedKinds: selections.length
      ? selections.map((selection) => selection.kind)
      : [item?.kind ?? kind],
  };
}
