import { createFileRoute } from "@tanstack/react-router";

import {
  apiError,
  apiSuccess,
  broadcastToUserServers,
  broadcastToUser,
  getDB,
  requireAuth,
} from "@/lib/api-helpers";
import { cacheDel, CacheKey } from "@/lib/cache";
import { clog } from "@/lib/console-logger";
import { ensureUserProfileSchema } from "@/lib/ensure-user-profile-schema";
import { parseMediaContentFilter } from "@/lib/media-content-filter";
import {
  applyProfileThemeDefaults,
  normalizeDisplayNameStyle,
  normalizeHexColor,
  serializeDisplayNameStyle,
} from "@/lib/profile-customization";
import { isAppTheme } from "@/lib/theme-preferences";
import {
  normalizeAvatarDisplay,
  serializeAvatarDisplay,
} from "@/lib/avatar-display";

const log = clog("update-profile");

const PATCH = async ({ request: req }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  let body: {
    displayName?: string;
    username?: string;
    themePreference?: string | null;
    themeSyncEnabled?: boolean;
    mediaContentFilter?: string;
    avatarDisplay?: unknown;
    removeAvatar?: boolean;
    profileAccentColor?: string | null;
    profileBackgroundColor?: string | null;
    profileBannerColor?: string | null;
    displayNameStyle?: unknown | null;
    bio?: string | null;
    pronouns?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const {
    displayName,
    username,
    themePreference,
    themeSyncEnabled,
    mediaContentFilter,
    avatarDisplay,
    removeAvatar,
    profileAccentColor,
    profileBackgroundColor,
    profileBannerColor,
    displayNameStyle,
    bio,
    pronouns,
  } = body;

  if (removeAvatar !== undefined && typeof removeAvatar !== "boolean") {
    return apiError("Invalid avatar removal flag", 400);
  }

  if (
    themePreference !== undefined &&
    themePreference !== null &&
    !isAppTheme(themePreference)
  ) {
    return apiError("Invalid theme preference", 400);
  }

  const normalizedMediaContentFilter =
    mediaContentFilter === undefined
      ? undefined
      : parseMediaContentFilter(mediaContentFilter);
  const normalizedAvatarDisplay =
    avatarDisplay === undefined
      ? undefined
      : normalizeAvatarDisplay(avatarDisplay);
  const normalizedProfileAccentColor =
    profileAccentColor === undefined
      ? undefined
      : profileAccentColor === null
        ? null
        : normalizeHexColor(profileAccentColor);
  const normalizedProfileBackgroundColor =
    profileBackgroundColor === undefined
      ? undefined
      : profileBackgroundColor === null
        ? null
        : normalizeHexColor(profileBackgroundColor);
  const normalizedProfileBannerColor =
    profileBannerColor === undefined
      ? undefined
      : profileBannerColor === null
        ? null
        : normalizeHexColor(profileBannerColor);
  const resolvedSubmittedProfileTheme = applyProfileThemeDefaults({
    profile_accent_color: normalizedProfileAccentColor ?? null,
    profile_background_color: normalizedProfileBackgroundColor ?? null,
    profile_banner_color: normalizedProfileBannerColor ?? null,
  });
  const normalizedDisplayNameStyle =
    displayNameStyle === undefined
      ? undefined
      : displayNameStyle === null
        ? null
        : normalizeDisplayNameStyle(displayNameStyle);

  if (avatarDisplay !== undefined && !normalizedAvatarDisplay) {
    return apiError("Invalid avatar display metadata", 400);
  }

  if (
    profileAccentColor !== undefined &&
    profileAccentColor !== null &&
    !normalizedProfileAccentColor
  ) {
    return apiError("Invalid profile accent color", 400);
  }

  if (
    profileBackgroundColor !== undefined &&
    profileBackgroundColor !== null &&
    !normalizedProfileBackgroundColor
  ) {
    return apiError("Invalid profile background color", 400);
  }

  if (
    profileBannerColor !== undefined &&
    profileBannerColor !== null &&
    !normalizedProfileBannerColor
  ) {
    return apiError("Invalid profile banner color", 400);
  }

  if (
    displayNameStyle !== undefined &&
    displayNameStyle !== null &&
    !normalizedDisplayNameStyle
  ) {
    return apiError("Invalid display name style", 400);
  }

  if (bio !== undefined && bio !== null && typeof bio !== "string") {
    return apiError("Invalid bio", 400);
  }

  if (
    pronouns !== undefined &&
    pronouns !== null &&
    typeof pronouns !== "string"
  ) {
    return apiError("Invalid pronouns", 400);
  }

  const normalizedBio =
    bio === undefined
      ? undefined
      : bio === null
        ? null
        : bio.trim().slice(0, 190) || null;
  const normalizedPronouns =
    pronouns === undefined
      ? undefined
      : pronouns === null
        ? null
        : pronouns.trim().slice(0, 40) || null;

  try {
    const db = getDB();
    await ensureUserProfileSchema(db);

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

    if (normalizedMediaContentFilter !== undefined) {
      updates.push("media_content_filter = ?");
      binds.push(normalizedMediaContentFilter);
    }

    if (normalizedProfileAccentColor !== undefined) {
      updates.push("profile_accent_color = ?");
      binds.push(resolvedSubmittedProfileTheme.profile_accent_color);
    }

    if (normalizedProfileBackgroundColor !== undefined) {
      updates.push("profile_background_color = ?");
      binds.push(resolvedSubmittedProfileTheme.profile_background_color);
    }

    if (normalizedProfileBannerColor !== undefined) {
      updates.push("profile_banner_color = ?");
      binds.push(resolvedSubmittedProfileTheme.profile_banner_color);
    }

    if (normalizedDisplayNameStyle !== undefined) {
      updates.push("display_name_style = ?");
      binds.push(serializeDisplayNameStyle(normalizedDisplayNameStyle));
    }

    if (normalizedBio !== undefined) {
      updates.push("bio = ?");
      binds.push(normalizedBio);
    }

    if (normalizedPronouns !== undefined) {
      updates.push("pronouns = ?");
      binds.push(normalizedPronouns);
    }

    if (removeAvatar) {
      updates.push("avatar_url = NULL");
      if (normalizedAvatarDisplay !== undefined) {
        updates.push("avatar_display = ?");
        binds.push(serializeAvatarDisplay(normalizedAvatarDisplay));
      } else {
        updates.push("avatar_display = NULL");
      }
    } else if (normalizedAvatarDisplay !== undefined) {
      updates.push("avatar_display = ?");
      binds.push(serializeAvatarDisplay(normalizedAvatarDisplay));
    }

    if (updates.length > 0) {
      updates.push("updated_at = ?");
      binds.push(new Date().toISOString());
      binds.push(userId);
      await db
        .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...binds)
        .run();
    }

    // Read back the updated profile
    const updatedUser = await db
      .prepare(
        `SELECT id, username, display_name, avatar_url, avatar_display, banner_url, banner_content_type, nameplate_url, nameplate_content_type, profile_accent_color, profile_background_color, profile_banner_color, display_name_style, theme_preference, theme_sync_enabled, media_content_filter, updated_at, bio, pronouns FROM users WHERE id = ?`,
      )
      .bind(userId)
      .first<{
        id: string;
        username: string;
        display_name: string | null;
        avatar_url: string | null;
        avatar_display: string | null;
        banner_url: string | null;
        banner_content_type: string | null;
        nameplate_url: string | null;
        nameplate_content_type: string | null;
        profile_accent_color: string | null;
        profile_background_color: string | null;
        profile_banner_color: string | null;
        display_name_style: string | null;
        theme_preference: string | null;
        theme_sync_enabled: number;
        media_content_filter: string;
        updated_at: string | null;
        bio: string | null;
        pronouns: string | null;
      }>();
    const parsedDisplayNameStyle = normalizeDisplayNameStyle(
      updatedUser?.display_name_style ?? null,
    );
    const resolvedTheme = applyProfileThemeDefaults({
      profile_accent_color: updatedUser?.profile_accent_color,
      profile_background_color: updatedUser?.profile_background_color,
      profile_banner_color: updatedUser?.profile_banner_color,
    });

    // Cache invalidation
    await Promise.all([
      cacheDel(CacheKey.userProfile(userId)),
      cacheDel(CacheKey.userServers(userId)),
    ]);

    // Invalidate member lists for all servers this user belongs to
    const { results: memberships } = await db
      .prepare(`SELECT server_id FROM server_members WHERE user_id = ?`)
      .bind(userId)
      .all();
    if (memberships?.length) {
      await Promise.all(
        memberships.map((m: Record<string, unknown>) =>
          cacheDel(CacheKey.serverMembers(m.server_id as string)),
        ),
      );
    }

    // Broadcast profile change only to members of the user's servers
    await broadcastToUserServers(userId, "USER_PROFILE_UPDATE", {
      user_id: userId,
      username: updatedUser?.username,
      display_name: updatedUser?.display_name ?? null,
      avatar_url: updatedUser?.avatar_url ?? null,
      avatar_display: updatedUser?.avatar_display ?? null,
      banner_url: updatedUser?.banner_url ?? null,
      banner_content_type: updatedUser?.banner_content_type ?? null,
      nameplate_url: updatedUser?.nameplate_url ?? null,
      nameplate_content_type: updatedUser?.nameplate_content_type ?? null,
      profile_accent_color: resolvedTheme.profile_accent_color,
      profile_background_color: resolvedTheme.profile_background_color,
      profile_banner_color: resolvedTheme.profile_banner_color,
      display_name_style: parsedDisplayNameStyle,
      theme_preference: updatedUser?.theme_preference ?? null,
      theme_sync_enabled: updatedUser?.theme_sync_enabled === 1,
      bio: updatedUser?.bio ?? null,
      pronouns: updatedUser?.pronouns ?? null,
      updated_at: updatedUser?.updated_at ?? null,
    });

    if (normalizedMediaContentFilter !== undefined) {
      await broadcastToUser(userId, "USER_PROFILE_UPDATE", {
        user_id: userId,
        media_content_filter:
          updatedUser?.media_content_filter ?? normalizedMediaContentFilter,
        updated_at: updatedUser?.updated_at ?? null,
      });
    }

    return apiSuccess({
      user: {
        username: updatedUser?.username,
        display_name: updatedUser?.display_name,
        avatar_url: updatedUser?.avatar_url,
        avatar_display: updatedUser?.avatar_display,
        banner_url: updatedUser?.banner_url,
        banner_content_type: updatedUser?.banner_content_type,
        nameplate_url: updatedUser?.nameplate_url,
        nameplate_content_type: updatedUser?.nameplate_content_type,
        profile_accent_color: resolvedTheme.profile_accent_color,
        profile_background_color: resolvedTheme.profile_background_color,
        profile_banner_color: resolvedTheme.profile_banner_color,
        display_name_style: parsedDisplayNameStyle,
        theme_preference: updatedUser?.theme_preference,
        theme_sync_enabled: updatedUser?.theme_sync_enabled === 1,
        media_content_filter: updatedUser?.media_content_filter,
        bio: updatedUser?.bio,
        pronouns: updatedUser?.pronouns,
        updated_at: updatedUser?.updated_at,
      },
    });
  } catch (err: unknown) {
    log.error("Error:", err);
    return apiError("Failed to update profile", 500);
  }
};

export const Route = createFileRoute("/api/update-profile")({
  server: {
    handlers: {
      PATCH,
    },
  },
});
