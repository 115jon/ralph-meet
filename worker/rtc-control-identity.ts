import { createVoiceToken } from "./rtc-room-token";

export interface RtcControlIdentityEnv {
  CALLS_APP_SECRET: string;
  TURN_TOKEN_ID: string;
  TURN_TOKEN_SECRET: string;
  CLERK_SECRET_KEY: string;
  DB: D1Database;
  CACHE: KVNamespace;
}

export interface RtcControlLogger {
  info?: (msg: string, ...args: unknown[]) => void;
  warn?: (msg: string, ...args: unknown[]) => void;
  error?: (msg: string, ...args: unknown[]) => void;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface VerifiedClerkProfile {
  name: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string;
  avatarDisplay?: string | null;
}

export interface RtcRoomIdentifySessionData {
  participantId: string;
  name: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string;
  avatarDisplay?: string | null;
  status: "online" | "idle" | "dnd" | "offline";
  iceServers: IceServer[];
  voiceToken: string;
}

export interface RtcRoomVoiceCredentials {
  voiceToken: string;
  iceServers: IceServer[];
}

export interface RtcRoomControlIdentifyPayload {
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string;
  avatar_display?: string | null;
  clerk_user_id?: string;
}

export const RTC_ROOM_PROFILE_REFRESH_COOLDOWN_MS = 10_000;

const DEFAULT_RTC_ROOM_SLUG = "unknown";
const STUN_SERVER: IceServer = { urls: ["stun:stun.cloudflare.com:3478"] };

export function consumeRtcRoomProfileRefreshCooldown(
  cooldowns: Map<string, number>,
  sessionId: string,
  now = Date.now(),
) {
  const lastRefresh = cooldowns.get(sessionId) ?? 0;
  if (now - lastRefresh < RTC_ROOM_PROFILE_REFRESH_COOLDOWN_MS) return false;
  cooldowns.set(sessionId, now);
  return true;
}

export async function generateRtcRoomVoiceToken(
  env: RtcControlIdentityEnv,
  roomSlug: string | null | undefined,
  participantId: string,
  clerkUserId?: string,
  logger?: RtcControlLogger,
): Promise<string> {
  try {
    if (!env.CALLS_APP_SECRET) {
      logger?.warn?.("CALLS_APP_SECRET not set, skipping voice token");
      return "";
    }
    return await createVoiceToken(
      env.CALLS_APP_SECRET,
      participantId,
      roomSlug || DEFAULT_RTC_ROOM_SLUG,
      clerkUserId,
    );
  } catch (error) {
    logger?.error?.("Voice token generation failed:", error);
    return "";
  }
}

export async function generateRtcRoomTurnCredentials(
  env: RtcControlIdentityEnv,
  logger?: RtcControlLogger,
): Promise<IceServer[]> {
  if (!env.TURN_TOKEN_ID || !env.TURN_TOKEN_SECRET) return [STUN_SERVER];

  try {
    const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_TOKEN_ID}/credentials/generate-ice-servers`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURN_TOKEN_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: 48 * 60 * 60 }),
    });

    if (!response.ok) return [STUN_SERVER];

    const data = (await response.json()) as {
      iceServers?: Array<{ urls?: string[]; username?: string; credential?: string }>;
    };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) return [STUN_SERVER];

    const servers = data.iceServers
      .filter((server) => Array.isArray(server.urls) && server.urls.length > 0)
      .slice(0, 2)
      .map((server) => {
        const filteredUrls = (server.urls ?? []).filter((url) =>
          url.includes(":3478?transport=udp")
          || url.includes(":443?transport=tcp")
          || url.startsWith("stun:")
        );

        return {
          urls: filteredUrls.length > 0 ? filteredUrls : (server.urls ?? []).slice(0, 2),
          username: server.username,
          credential: server.credential,
        };
      });

    logger?.info?.(
      `Generated TURN credentials, count=${servers.length}, flatUrls=${servers.flatMap((server) => server.urls).length}`,
    );
    return servers.length > 0 ? servers : [STUN_SERVER];
  } catch {
    logger?.warn?.("Failed generating TURN credentials, falling back to STUN");
    return [STUN_SERVER];
  }
}

export async function fetchRtcRoomVoiceCredentials(
  env: RtcControlIdentityEnv,
  roomSlug: string | null | undefined,
  participantId: string,
  clerkUserId?: string,
  logger?: RtcControlLogger,
): Promise<RtcRoomVoiceCredentials> {
  const [voiceToken, iceServers] = await Promise.all([
    generateRtcRoomVoiceToken(env, roomSlug, participantId, clerkUserId, logger),
    generateRtcRoomTurnCredentials(env, logger),
  ]);

  return { voiceToken, iceServers };
}

export async function fetchRtcRoomProfileRefreshData(
  env: RtcControlIdentityEnv,
  clerkUserId: string,
  logger?: RtcControlLogger,
): Promise<VerifiedClerkProfile | null> {
  try {
    let d1Name: string | null = null;
    let d1Username: string | null = null;
    let d1DisplayName: string | null = null;
    let d1Avatar: string | null = null;
    let d1AnyAvatar: string | null = null;
    let d1AvatarDisplay: string | null = null;

    try {
      const row = await env.DB.prepare(
        "SELECT username, display_name, avatar_url, avatar_display FROM users WHERE id = ?",
      ).bind(clerkUserId).first<{
        username: string;
        display_name: string | null;
        avatar_url: string | null;
        avatar_display: string | null;
      }>();
      if (row) {
        d1Username = row.username;
        d1DisplayName = row.display_name;
        d1Name = row.display_name?.trim() || row.username;
        d1AnyAvatar = row.avatar_url;
        d1AvatarDisplay = row.avatar_display;
        if (row.avatar_url?.startsWith("/api/avatars/")) {
          d1Avatar = row.avatar_url;
        }
      }
    } catch (error) {
      logger?.error?.("D1 profile fetch failed:", error);
    }

    const cacheKey = `clerk:profile:${clerkUserId}`;
    type ClerkCached = { name: string; imageUrl?: string };
    let clerkData: ClerkCached | null = null;

    try {
      clerkData = await env.CACHE.get<ClerkCached>(cacheKey, "json");
    } catch {
      // ignore cache parse/miss failures
    }

    if (!clerkData) {
      const response = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
        headers: {
          Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        logger?.error?.(`Clerk API error: ${response.status}`);
        if (d1Name) {
          return {
            name: d1Name,
            username: d1Username ?? d1Name,
            displayName: d1DisplayName,
            avatarUrl: d1Avatar ?? d1AnyAvatar ?? undefined,
            avatarDisplay: d1AvatarDisplay,
          };
        }
        return null;
      }

      const user = await response.json() as {
        username?: string;
        first_name?: string;
        last_name?: string;
        image_url?: string;
        unsafe_metadata?: { displayName?: string };
      };
      const clerkName = user.unsafe_metadata?.displayName
        || [user.first_name, user.last_name].filter(Boolean).join(" ")
        || user.username
        || "Guest";

      clerkData = { name: clerkName, imageUrl: user.image_url };
      env.CACHE.put(cacheKey, JSON.stringify(clerkData), { expirationTtl: 300 }).catch(() => { });
    }

    return {
      name: d1Name || clerkData.name,
      username: d1Username ?? d1Name ?? clerkData.name,
      displayName: d1DisplayName,
      avatarUrl: d1Avatar ?? clerkData.imageUrl,
      avatarDisplay: d1AvatarDisplay,
    };
  } catch (error) {
    logger?.error?.("Failed to fetch Clerk profile:", error);
    return null;
  }
}

export async function resolveRtcRoomControlIdentifySessionData(
  env: RtcControlIdentityEnv,
  roomSlug: string | null | undefined,
  participantId: string,
  payload: RtcRoomControlIdentifyPayload,
  logger?: RtcControlLogger,
): Promise<RtcRoomIdentifySessionData> {
  const [iceServers, profile, userRow, voiceToken] = await Promise.all([
    generateRtcRoomTurnCredentials(env, logger),
    payload.clerk_user_id ? fetchRtcRoomProfileRefreshData(env, payload.clerk_user_id, logger) : null,
    payload.clerk_user_id
      ? env.DB.prepare("SELECT status FROM users WHERE id = ?")
        .bind(payload.clerk_user_id)
        .first<{ status: string }>()
        .catch((error: unknown) => {
          logger?.error?.("D1 status fetch failed:", error);
          return null;
        })
      : null,
    generateRtcRoomVoiceToken(env, roomSlug, participantId, payload.clerk_user_id, logger),
  ]);

  let resolvedName = payload.name;
  let resolvedUsername = payload.username ?? payload.name;
  let resolvedDisplayName = payload.display_name ?? null;
  let resolvedAvatar = payload.avatar_url;
  let resolvedAvatarDisplay = payload.avatar_display ?? null;
  let resolvedStatus: "online" | "idle" | "dnd" | "offline" = "online";

  if (profile) {
    resolvedName = profile.name;
    resolvedUsername = profile.username ?? resolvedUsername;
    resolvedDisplayName = profile.displayName ?? null;
    resolvedAvatar = profile.avatarUrl;
    resolvedAvatarDisplay = profile.avatarDisplay ?? null;
  }
  if (userRow?.status) {
    resolvedStatus = userRow.status as "online" | "idle" | "dnd" | "offline";
  }

  logger?.info?.(`Identify: name=${resolvedName}, avatar=${resolvedAvatar}, clerk=${payload.clerk_user_id}`);

  return {
    participantId,
    name: resolvedName,
    username: resolvedUsername,
    displayName: resolvedDisplayName,
    avatarUrl: resolvedAvatar,
    avatarDisplay: resolvedAvatarDisplay,
    status: resolvedStatus,
    iceServers,
    voiceToken,
  };
}
