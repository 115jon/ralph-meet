import {
  resolveVisibleChannelPermissions,
  type ChannelVisibilityOverride,
  type ChannelVisibilityRole,
} from "../src/lib/channel-visibility";
import { filterVoiceChannelStatesPayload } from "../src/lib/voice-channel-state-filter";
import type { VoiceChannelStatesPayload } from "./meeting-room";

interface SharedVisibilityEnv {
  DB: D1Database;
}

export interface SharedVisibilityChannelMeta {
  server_id: string | null;
  channel_type: string;
}

export async function getRtcRoomSharedChannelMeta(
  env: SharedVisibilityEnv,
  channelId: string,
  cache: Map<string, SharedVisibilityChannelMeta>,
): Promise<SharedVisibilityChannelMeta | null> {
  const cached = cache.get(channelId);
  if (cached) return cached;

  const channel = await env.DB.prepare(
    "SELECT server_id, channel_type FROM channels WHERE id = ? LIMIT 1",
  )
    .bind(channelId)
    .first<SharedVisibilityChannelMeta>()
    .catch(() => null);

  if (!channel) return null;
  cache.set(channelId, channel);
  return channel;
}

export async function fetchRtcRoomSharedServerMemberRoles(
  env: SharedVisibilityEnv,
  serverId: string,
  userId: string,
): Promise<ChannelVisibilityRole[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.permissions, r.is_default
     FROM server_members sm
     JOIN member_roles mr ON mr.server_id = sm.server_id AND mr.user_id = sm.user_id
     JOIN roles r ON r.id = mr.role_id
     WHERE sm.server_id = ? AND sm.user_id = ?`,
  )
    .bind(serverId, userId)
    .all()
    .catch(() => ({ results: [] }));

  return (results ?? []) as ChannelVisibilityRole[];
}

export async function canRtcRoomClerkUserAccessVoiceChannel(
  env: SharedVisibilityEnv,
  channelId: string,
  clerkUserId: string,
  cache: Map<string, SharedVisibilityChannelMeta>,
): Promise<boolean> {
  const channel = await getRtcRoomSharedChannelMeta(env, channelId, cache);
  if (!channel) return false;

  if (channel.channel_type === "dm" || channel.server_id === null) {
    const recipient = await env.DB.prepare(
      "SELECT 1 FROM dm_recipients WHERE channel_id = ? AND user_id = ? LIMIT 1",
    )
      .bind(channelId, clerkUserId)
      .first()
      .catch(() => null);

    return !!recipient;
  }

  const userRoles = await fetchRtcRoomSharedServerMemberRoles(env, channel.server_id, clerkUserId);
  if (userRoles.length === 0) return false;

  const roleIds = userRoles.map((role) => role.id);
  const placeholders = roleIds.length > 0 ? roleIds.map(() => "?").join(",") : "''";
  const { results: overrides } = await env.DB.prepare(
    `SELECT channel_id, target_id, target_type, allow, deny
     FROM channel_permission_overrides
     WHERE channel_id = ?
       AND (
         (target_type = 'user' AND target_id = ?) OR
         (target_type = 'role' AND target_id IN (${placeholders}))
       )`,
  )
    .bind(channelId, clerkUserId, ...roleIds)
    .all()
    .catch(() => ({ results: [] }));

  const visiblePermissions = resolveVisibleChannelPermissions(
    [{ id: channelId }],
    clerkUserId,
    userRoles,
    (overrides ?? []) as ChannelVisibilityOverride[],
  );

  return visiblePermissions[channelId] !== undefined;
}

export async function filterRtcRoomSharedVoiceStatesForClerkUserId(
  env: SharedVisibilityEnv,
  clerkUserId: string,
  data: VoiceChannelStatesPayload,
  cache: Map<string, SharedVisibilityChannelMeta>,
): Promise<VoiceChannelStatesPayload | null> {
  const visibleChannelIds = new Set<string>();

  for (const channelId of Object.keys(data.voice_states)) {
    if (await canRtcRoomClerkUserAccessVoiceChannel(env, channelId, clerkUserId, cache)) {
      visibleChannelIds.add(channelId);
    }
  }

  const filtered = filterVoiceChannelStatesPayload(data, visibleChannelIds);
  return {
    ...filtered,
    spatial_audio_states: filtered.spatial_audio_states ?? {},
  };
}
