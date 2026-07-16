import { createFileRoute } from "@tanstack/react-router";

import {
  apiError,
  apiSuccess,
  broadcastToUserServers,
  getDB,
  requireAuth,
} from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import {
  findCollectibleItem,
  getCollectiblesCatalog,
  type CollectibleKind,
} from "@/lib/collectibles-catalog";
import {
  normalizeAvatarDisplay,
  serializeAvatarDisplay,
  type AvatarCollectibles,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import { collectibleItemToSelection } from "@/lib/collectible-selection";

type ApplyBody = {
  kind?: CollectibleKind;
  skuId?: string | null;
  selections?: Array<{
    kind?: CollectibleKind;
    skuId?: string | null;
  }>;
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

async function invalidateProfileCaches(db: any, userId: string) {
  await Promise.all([
    cacheDel(CacheKey.userProfile(userId)),
    cacheDel(CacheKey.userServers(userId)),
  ]);

  const { results: memberships } = await db
    .prepare(`SELECT server_id FROM server_members WHERE user_id = ?`)
    .bind(userId)
    .all();

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
  item: ReturnType<typeof findCollectibleItem>,
) {
  const display: AvatarDisplay = current ?? { version: 1 };
  const collectibles: AvatarCollectibles = { ...(display.collectibles ?? {}) };
  const key = COLLECTIBLE_KEYS[kind];

  if (!item) {
    delete collectibles[key];
  } else {
    Object.assign(collectibles, collectibleItemToSelection(item));
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

  const db = getDB();
  const catalog = await getCollectiblesCatalog(db);
  const requestedSelections =
    Array.isArray(body.selections) && body.selections.length > 0
      ? body.selections
      : [{ kind: body.kind, skuId: body.skuId }];
  const parsedSelections: Array<{
    kind: CollectibleKind;
    item: ReturnType<typeof findCollectibleItem>;
  }> = [];

  for (const selection of requestedSelections) {
    if (!isCollectibleKind(selection.kind)) {
      return apiError(
        "Invalid collectible kind",
        400,
        "INVALID_COLLECTIBLE_KIND",
        request,
      );
    }

    const selectedItem = selection.skuId
      ? findCollectibleItem(catalog, selection.skuId)
      : null;

    if (selection.skuId && !selectedItem) {
      return apiError(
        "Collectible not found",
        404,
        "COLLECTIBLE_NOT_FOUND",
        request,
      );
    }

    if (selectedItem && selectedItem.kind !== selection.kind) {
      return apiError(
        "Collectible type mismatch",
        400,
        "COLLECTIBLE_TYPE_MISMATCH",
        request,
      );
    }

    parsedSelections.push({
      kind: selection.kind,
      item: selectedItem,
    });
  }

  const currentUser = await db
    .prepare(`SELECT username, avatar_display FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ username: string | null; avatar_display: string | null }>();

  if (!currentUser) {
    return apiError("User not found", 404, "USER_NOT_FOUND", request);
  }

  const baseDisplay =
    body.avatarDisplay !== undefined
      ? normalizeAvatarDisplay(body.avatarDisplay)
      : normalizeAvatarDisplay(currentUser.avatar_display);

  const nextDisplay = parsedSelections.reduce<AvatarDisplay | null>(
    (currentDisplay, selection) =>
      mergeCollectibleSelection(currentDisplay, selection.kind, selection.item),
    baseDisplay,
  );
  const serializedDisplay = serializeAvatarDisplay(nextDisplay);
  const updatedAt = new Date().toISOString();
  const selectedNameplate = nextDisplay?.collectibles?.nameplate;
  const nameplateUrl =
    selectedNameplate?.animatedUrl ?? selectedNameplate?.staticUrl ?? null;
  const nameplateContentType = selectedNameplate
    ? selectedNameplate.animatedUrl
      ? "video/webm"
      : "image/png"
    : null;

  await db
    .prepare(
      `UPDATE users
     SET avatar_display = ?, nameplate_url = ?, nameplate_content_type = ?, updated_at = ?
     WHERE id = ?`,
    )
    .bind(
      serializedDisplay,
      nameplateUrl,
      nameplateContentType,
      updatedAt,
      userId,
    )
    .run();

  await invalidateProfileCaches(db, userId);

  const updatedUser = await db
    .prepare(
      `SELECT username, avatar_display, nameplate_url, nameplate_content_type, updated_at
     FROM users WHERE id = ?`,
    )
    .bind(userId)
    .first<{
      username: string | null;
      avatar_display: string | null;
      nameplate_url: string | null;
      nameplate_content_type: string | null;
      updated_at: string | null;
    }>();

  await broadcastToUserServers(userId, "USER_PROFILE_UPDATE", {
    user_id: userId,
    username: updatedUser?.username ?? currentUser.username,
    avatar_display: updatedUser?.avatar_display ?? null,
    nameplate_url: updatedUser?.nameplate_url ?? null,
    nameplate_content_type: updatedUser?.nameplate_content_type ?? null,
    updated_at: updatedUser?.updated_at ?? updatedAt,
  });

  return apiSuccess(
    {
      ok: true,
      item:
        parsedSelections.length === 1
          ? (parsedSelections[0]?.item ?? null)
          : null,
      items: parsedSelections
        .map((selection) => selection.item)
        .filter(
          (item): item is NonNullable<ReturnType<typeof findCollectibleItem>> =>
            item != null,
        ),
      user: {
        avatar_display: normalizeAvatarDisplay(
          updatedUser?.avatar_display ?? null,
        ),
        nameplate_url: updatedUser?.nameplate_url ?? null,
        nameplate_content_type: updatedUser?.nameplate_content_type ?? null,
        updated_at: updatedUser?.updated_at ?? updatedAt,
      },
    },
    200,
    request,
  );
};

export const Route = createFileRoute("/api/collectibles/apply")({
  server: {
    handlers: {
      PATCH,
    },
  },
});
