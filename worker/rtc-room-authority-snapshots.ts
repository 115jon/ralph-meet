import type {
  SharedRtcControlAuthoritySnapshot,
  SharedRtcControlSessionSnapshot,
  SharedRtcMediaAuthoritySnapshot,
  SharedRtcMediaPresenceSnapshot,
  SharedRtcStaleControlMembership,
} from "./meeting-room";

type SharedRtcMediaAuthorityRow = {
  id?: string | null;
  clerk_user_id?: string | null;
  pull_session_id?: unknown;
  push_session_cam?: unknown;
  push_session_screen?: unknown;
  disconnected_at?: number | null;
};

export function toSharedRtcControlSessionSnapshot(
  session: Partial<SharedRtcControlSessionSnapshot> | null | undefined,
): SharedRtcControlSessionSnapshot | null {
  if (!session) return null;
  if (typeof session.id !== "string" || !session.id) return null;
  if (typeof session.clerk_user_id !== "string" || !session.clerk_user_id) return null;
  if (typeof session.name !== "string" || !session.name) return null;
  return {
    id: session.id,
    name: session.name,
    username: session.username,
    display_name: session.display_name ?? null,
    avatar_url: session.avatar_url ?? null,
    avatar_display: session.avatar_display ?? null,
    clerk_user_id: session.clerk_user_id,
    stream_preview_url: session.stream_preview_url ?? null,
    self_mute: session.self_mute === true,
    self_deaf: session.self_deaf === true,
    self_stream: session.self_stream === true,
    self_stream_audio: session.self_stream_audio === true,
    self_video: session.self_video === true,
    spatial_audio_enabled: session.spatial_audio_enabled === true,
    spatial_audio_high_fidelity: session.spatial_audio_high_fidelity === true,
    suppress: session.suppress === true,
    status:
      session.status === "online"
      || session.status === "idle"
      || session.status === "dnd"
      || session.status === "offline"
        ? session.status
        : undefined,
    tracks: Array.isArray(session.tracks) ? [...session.tracks] : [],
    voice_channel_id:
      typeof session.voice_channel_id === "string" && session.voice_channel_id
        ? session.voice_channel_id
        : undefined,
    voice_joined_at:
      typeof session.voice_joined_at === "number" && Number.isFinite(session.voice_joined_at)
        ? session.voice_joined_at
        : undefined,
  };
}

export function buildSharedRtcControlAuthoritySnapshot(options: {
  capturedAt?: number;
  resumableSessions?: Iterable<Partial<SharedRtcControlSessionSnapshot> | null | undefined>;
  liveSessions?: Iterable<Partial<SharedRtcControlSessionSnapshot> | null | undefined>;
} = {}): SharedRtcControlAuthoritySnapshot {
  const capturedAt = options.capturedAt ?? Date.now();
  const sessionsByClerkUserId = new Map<string, SharedRtcControlSessionSnapshot>();
  const sessionsByParticipantId = new Map<string, SharedRtcControlSessionSnapshot>();
  let liveSessionCount = 0;
  let resumableSessionCount = 0;

  const remember = (session: SharedRtcControlSessionSnapshot) => {
    sessionsByParticipantId.set(session.id, session);
    sessionsByClerkUserId.set(session.clerk_user_id, session);
  };

  for (const candidate of options.resumableSessions ?? []) {
    const session = toSharedRtcControlSessionSnapshot(candidate);
    if (!session) continue;
    resumableSessionCount += 1;
    remember(session);
  }

  for (const candidate of options.liveSessions ?? []) {
    const session = toSharedRtcControlSessionSnapshot(candidate);
    if (!session) continue;
    liveSessionCount += 1;
    remember(session);
  }

  return {
    capturedAt,
    sessionsByClerkUserId,
    sessionsByParticipantId,
    liveSessionCount,
    resumableSessionCount,
  };
}

export function buildSharedRtcMediaAuthoritySnapshot(options: {
  capturedAt?: number;
  participantRows?: Iterable<SharedRtcMediaAuthorityRow>;
  liveParticipantIds?: Set<string>;
  mediaReconnectGraceMs: number;
  demoChatMessageCount?: number;
}): SharedRtcMediaAuthoritySnapshot {
  const capturedAt = options.capturedAt ?? Date.now();
  const liveParticipantIds = options.liveParticipantIds ?? new Set<string>();
  const liveClerkUserIds = new Set<string>();
  const activeClerkUserIds = new Set<string>();
  const presenceByClerkUserId = new Map<string, SharedRtcMediaPresenceSnapshot>();
  let participantCount = 0;
  let pendingReconnectCount = 0;

  for (const row of options.participantRows ?? []) {
    participantCount += 1;

    const participantId = typeof row.id === "string" ? row.id : null;
    const clerkUserId = typeof row.clerk_user_id === "string" ? row.clerk_user_id : null;
    const disconnectedAt =
      typeof row.disconnected_at === "number" && Number.isFinite(row.disconnected_at)
        ? row.disconnected_at
        : null;
    const withinReconnectGrace =
      typeof disconnectedAt === "number"
      && disconnectedAt > capturedAt - options.mediaReconnectGraceMs;
    const hasLiveMediaSession = Boolean(
      row.pull_session_id || row.push_session_cam || row.push_session_screen,
    );

    if (typeof disconnectedAt === "number") {
      pendingReconnectCount += 1;
    }

    if (!clerkUserId) continue;
    if (participantId && liveParticipantIds.has(participantId) && (hasLiveMediaSession || withinReconnectGrace)) {
      liveClerkUserIds.add(clerkUserId);
      activeClerkUserIds.add(clerkUserId);
      presenceByClerkUserId.set(clerkUserId, {
        connected: true,
        connection_state: "connected",
        disconnected_at: null,
        reconnect_expires_at: null,
      });
      continue;
    }

    if (!withinReconnectGrace) continue;

    activeClerkUserIds.add(clerkUserId);
    const reconnectPresence: SharedRtcMediaPresenceSnapshot = {
      connected: false,
      connection_state: "reconnecting",
      disconnected_at: disconnectedAt,
      reconnect_expires_at: disconnectedAt + options.mediaReconnectGraceMs,
    };
    const existingPresence = presenceByClerkUserId.get(clerkUserId);
    if (
      !existingPresence
      || existingPresence.connected
      || (existingPresence.reconnect_expires_at ?? 0) < (reconnectPresence.reconnect_expires_at ?? 0)
    ) {
      presenceByClerkUserId.set(clerkUserId, reconnectPresence);
    }
  }

  return {
    capturedAt,
    liveParticipantIds,
    liveClerkUserIds,
    activeClerkUserIds,
    presenceByClerkUserId,
    participantCount,
    pendingReconnectCount,
    demoChatMessageCount: options.demoChatMessageCount ?? 0,
  };
}

export function collectRtcRoomStaleSharedControlMemberships(
  controlAuthoritySnapshot: SharedRtcControlAuthoritySnapshot | null | undefined,
  mediaAuthoritySnapshot: SharedRtcMediaAuthoritySnapshot | null | undefined,
): SharedRtcStaleControlMembership[] {
  if (!controlAuthoritySnapshot || !mediaAuthoritySnapshot) return [];

  const staleMemberships = new Map<string, SharedRtcStaleControlMembership>();
  for (const session of controlAuthoritySnapshot.sessionsByClerkUserId.values()) {
    if (!session.voice_channel_id) continue;
    if (mediaAuthoritySnapshot.activeClerkUserIds.has(session.clerk_user_id)) continue;
    staleMemberships.set(`${session.voice_channel_id}\u0000${session.clerk_user_id}`, {
      channelId: session.voice_channel_id,
      clerkUserId: session.clerk_user_id,
    });
  }

  return [...staleMemberships.values()];
}
