import { createFileRoute } from "@tanstack/react-router";

import { apiError, apiSuccess, broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import {
  findCollectibleItem,
  getCollectiblesCatalog,
  type CollectibleCatalogItem,
  type CollectibleKind,
} from "@/lib/collectibles-catalog";
import {
  normalizeAvatarDisplay,
  serializeAvatarDisplay,
  type AvatarCollectibles,
  type AvatarDisplay,
} from "@/lib/avatar-display";

type ApplyBody = {
  kind?: CollectibleKind;
  skuId?: string | null;
  avatarDisplay?: unknown;
};

const COLLECTIBLE_KEYS: Record<CollectibleKind, keyof AvatarCollectibles> = {
  avatar_decoration: "avatarDecoration",
  profile_effect: "profileEffect",
  nameplate: "nameplate",
  profile_frame: "profileFrame",
};

function isCollectibleKind(value: unknown): value is CollectibleKind {
  return (
    value === "avatar_decoration" ||
    value === "profile_effect" ||
    value === "nameplate" ||
    value === "profile_frame"
  );
}

function itemToSelection(item: CollectibleCatalogItem): Partial<AvatarCollectibles> {
  if (item.kind === "avatar_decoration" && item.asset && item.staticUrl) {
    return {
      avatarDecoration: {
        skuId: item.skuId,
        name: item.name,
        asset: item.asset,
        imageUrl: item.staticUrl,
      },
    };
  }

  if (item.kind === "profile_effect") {
    const effects = item.profileEffect?.effects.map((effect) => ({ ...effect })) ?? [];
    return {
      profileEffect: {
        skuId: item.skuId,
        name: item.name,
        animationType: item.profileEffect?.animationType,
        previewUrl: item.previewUrl,
        thumbnailPreviewSrc: item.profileEffect?.thumbnailPreviewSrc,
        reducedMotionSrc: item.profileEffect?.reducedMotionSrc,
        staticFrameSrc: item.profileEffect?.staticFrameSrc,
        staticUrl: item.staticUrl,
        animatedUrl: item.animatedUrl,
        effectUrls: effects.map((effect) => effect.src),
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
        animatedUrl: item.animatedUrl,
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
        layers: item.frame.layers,
      },
    };
  }

  return {};
}

async function invalidateProfileCaches(db: any, userId: string) {
  await Promise.all([
    cacheDel(CacheKey.userProfile(userId)),
    cacheDel(CacheKey.userServers(userId)),
  ]);

  const { results: memberships } = await db.prepare(
    `SELECT server_id FROM server_members WHERE user_id = ?`,
  ).bind(userId).all();

  if (memberships?.length) {
    await Promise.all(
      memberships.map((membership: Record<string, unknown>) =>
        cacheDel(CacheKey.serverMembers(membership.server_id as string)),
      ),
    );
  }
}

function mergeCollectibleSelection(
  current: AvatarDisplay | null,
  kind: CollectibleKind,
  item: CollectibleCatalogItem | null,
) {
  const display: AvatarDisplay = current ?? { version: 1 };
  const collectibles: AvatarCollectibles = { ...(display.collectibles ?? {}) };
  const key = COLLECTIBLE_KEYS[kind];

  if (!item) {
    delete collectibles[key];
  } else {
    Object.assign(collectibles, itemToSelection(item));
  }

  return normalizeAvatarDisplay({
    ...display,
    collectibles,
  });
}

const PATCH = async ({ request }: any) => {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: ApplyBody;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400, undefined, request);
  }

  if (!isCollectibleKind(body.kind)) {
    return apiError("Invalid collectible kind", 400, "INVALID_COLLECTIBLE_KIND", request);
  }

  const db = getDB();
  const catalog = await getCollectiblesCatalog(db);
  const selectedItem = body.skuId ? findCollectibleItem(catalog, body.skuId) : null;

  if (body.skuId && !selectedItem) {
    return apiError("Collectible not found", 404, "COLLECTIBLE_NOT_FOUND", request);
  }

  if (selectedItem && selectedItem.kind !== body.kind) {
    return apiError("Collectible type mismatch", 400, "COLLECTIBLE_TYPE_MISMATCH", request);
  }

  const currentUser = await db.prepare(
    `SELECT username, avatar_display FROM users WHERE id = ?`,
  ).bind(userId).first<{ username: string | null; avatar_display: string | null }>();

  if (!currentUser) {
    return apiError("User not found", 404, "USER_NOT_FOUND", request);
  }

  const baseDisplay = body.avatarDisplay !== undefined
    ? normalizeAvatarDisplay(body.avatarDisplay)
    : normalizeAvatarDisplay(currentUser.avatar_display);

  const nextDisplay = mergeCollectibleSelection(
    baseDisplay,
    body.kind,
    selectedItem,
  );
  const serializedDisplay = serializeAvatarDisplay(nextDisplay);
  const updatedAt = new Date().toISOString();

  let nameplateUrl: string | null | undefined;
  let nameplateContentType: string | null | undefined;

  if (body.kind === "nameplate") {
    if (selectedItem?.kind === "nameplate") {
      nameplateUrl = selectedItem.animatedUrl ?? selectedItem.staticUrl ?? null;
      nameplateContentType = selectedItem.animatedUrl ? "video/webm" : "image/png";
    } else {
      nameplateUrl = null;
      nameplateContentType = null;
    }
  }

  if (body.kind === "nameplate") {
    await db.prepare(
      `UPDATE users
       SET avatar_display = ?, nameplate_url = ?, nameplate_content_type = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(serializedDisplay, nameplateUrl, nameplateContentType, updatedAt, userId).run();
  } else {
    await db.prepare(
      `UPDATE users SET avatar_display = ?, updated_at = ? WHERE id = ?`,
    ).bind(serializedDisplay, updatedAt, userId).run();
  }

  await invalidateProfileCaches(db, userId);

  const updatedUser = await db.prepare(
    `SELECT username, avatar_display, nameplate_url, nameplate_content_type, updated_at
     FROM users WHERE id = ?`,
  ).bind(userId).first<{
    username: string | null;
    avatar_display: string | null;
    nameplate_url: string | null;
    nameplate_content_type: string | null;
    updated_at: string | null;
  }>();

  await broadcastToAll("USER_PROFILE_UPDATE", {
    user_id: userId,
    username: updatedUser?.username ?? currentUser.username,
    avatar_display: updatedUser?.avatar_display ?? null,
    nameplate_url: updatedUser?.nameplate_url ?? null,
    nameplate_content_type: updatedUser?.nameplate_content_type ?? null,
    updated_at: updatedUser?.updated_at ?? updatedAt,
  });

  return apiSuccess({
    ok: true,
    item: selectedItem,
    user: {
      avatar_display: normalizeAvatarDisplay(updatedUser?.avatar_display ?? null),
      nameplate_url: updatedUser?.nameplate_url ?? null,
      nameplate_content_type: updatedUser?.nameplate_content_type ?? null,
      updated_at: updatedUser?.updated_at ?? updatedAt,
    },
  }, 200, request);
};

export const Route = createFileRoute("/api/collectibles/apply")({
  server: {
    handlers: {
      PATCH,
    },
  },
});
