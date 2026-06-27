import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, broadcastToAll, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { clog } from "@/lib/console-logger";
import { isAppTheme } from "@/lib/theme-preferences";

const log = clog("update-profile");

const PATCH = async ({ request: req, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: {
    displayName?: string;
    username?: string;
    themePreference?: string | null;
    themeSyncEnabled?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const { displayName, username, themePreference, themeSyncEnabled } = body;

  if (themePreference !== undefined && themePreference !== null && !isAppTheme(themePreference)) {
    return apiError("Invalid theme preference", 400);
  }

  try {
    const db = getDB();

    // Update D1 (source of truth for profile data)
    const updates: string[] = [];
    const binds: unknown[] = [];

    if (displayName !== undefined) {
      updates.push("display_name = ?");
      binds.push(displayName || null);
    }

    if (username !== undefined) {
      const trimmed = username.trim().toLowerCase();
      updates.push("username = ?");
      binds.push(trimmed);

    }

    if (themePreference !== undefined) {
      updates.push("theme_preference = ?");
      binds.push(themePreference);
    }

    if (themeSyncEnabled !== undefined) {
      updates.push("theme_sync_enabled = ?");
      binds.push(themeSyncEnabled ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      binds.push(new Date().toISOString());
      binds.push(userId);
      await db.prepare(
        `UPDATE users SET ${updates.join(", ")} WHERE id = ?`
      ).bind(...binds).run();
    }

    // Read back the updated profile
    const updatedUser = await db.prepare(
      `SELECT id, username, display_name, avatar_url, theme_preference, theme_sync_enabled, updated_at FROM users WHERE id = ?`
    ).bind(userId).first<{ id: string; username: string; display_name: string | null; avatar_url: string | null; theme_preference: string | null; theme_sync_enabled: number; updated_at: string | null }>();

    // Cache invalidation
    await Promise.all([
      cacheDel(CacheKey.userProfile(userId)),
      cacheDel(CacheKey.userServers(userId)),
    ]);

    // Invalidate member lists for all servers this user belongs to
    const { results: memberships } = await db.prepare(
      `SELECT server_id FROM server_members WHERE user_id = ?`
    ).bind(userId).all();
    if (memberships?.length) {
      await Promise.all(
        memberships.map((m: Record<string, unknown>) =>
          cacheDel(CacheKey.serverMembers(m.server_id as string))
        )
      );
    }

    // Broadcast profile change to all connected clients
    await broadcastToAll("USER_PROFILE_UPDATE", {
      user_id: userId,
      username: updatedUser?.username,
      display_name: updatedUser?.display_name ?? null,
      avatar_url: updatedUser?.avatar_url ?? null,
      theme_preference: updatedUser?.theme_preference ?? null,
      theme_sync_enabled: updatedUser?.theme_sync_enabled === 1,
      updated_at: updatedUser?.updated_at ?? null,
    });

    return apiSuccess({
      user: {
        username: updatedUser?.username,
        display_name: updatedUser?.display_name,
        avatar_url: updatedUser?.avatar_url,
        theme_preference: updatedUser?.theme_preference,
        theme_sync_enabled: updatedUser?.theme_sync_enabled === 1,
        updated_at: updatedUser?.updated_at,
      },
    });
  } catch (err: unknown) {
    log.error("Error:", err);
    return apiError("Failed to update profile", 500);
  }
}


export const Route = createFileRoute('/api/update-profile')({
  server: {
    handlers: {
      PATCH,
    }
  }
});
