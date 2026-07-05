import type {
  PendingCall,
  SharedRtcControlAuthoritySnapshot,
  SharedRtcMediaAuthoritySnapshot,
  SharedRtcSpatialAudioSnapshot,
  SharedRtcVoiceAuthoritySnapshot,
  SpatialAudioState,
  VoiceChannelMember,
  VoiceChannelStatesPayload,
} from "./meeting-room";
import {
  prepareAbandonedPendingCallForChannel,
  preparePendingCallAcceptForVoiceJoin,
} from "./rtc-room-call-state";

export function resolveRtcRoomChannelStartedAtFromControlSnapshot(
  controlAuthoritySnapshot: SharedRtcControlAuthoritySnapshot | null | undefined,
  channelId: string,
) {
  if (!controlAuthoritySnapshot) return undefined;

  let startedAt: number | undefined;
  for (const session of controlAuthoritySnapshot.sessionsByParticipantId.values()) {
    if (session.voice_channel_id !== channelId) continue;
    const joinedAt =
      typeof session.voice_joined_at === "number" && Number.isFinite(session.voice_joined_at)
        ? session.voice_joined_at
        : undefined;
    if (joinedAt === undefined) continue;
    startedAt = typeof startedAt === "number" ? Math.min(startedAt, joinedAt) : joinedAt;
  }

  return startedAt;
}

export function resolveRtcRoomVoiceJoinedAt(
  channelId: string,
  options: {
    candidateJoinedAt?: number | null;
    existingJoinedAt?: number | null;
    controlAuthoritySnapshot?: SharedRtcControlAuthoritySnapshot | null;
  } = {},
  now = Date.now(),
) {
  const candidateJoinedAt =
    typeof options.candidateJoinedAt === "number" && Number.isFinite(options.candidateJoinedAt)
      ? options.candidateJoinedAt
      : undefined;
  const existingJoinedAt =
    typeof options.existingJoinedAt === "number" && Number.isFinite(options.existingJoinedAt)
      ? options.existingJoinedAt
      : undefined;

  if (candidateJoinedAt !== undefined) {
    return existingJoinedAt !== undefined
      ? Math.min(existingJoinedAt, candidateJoinedAt)
      : candidateJoinedAt;
  }
  if (existingJoinedAt !== undefined) {
    return existingJoinedAt;
  }

  return resolveRtcRoomChannelStartedAtFromControlSnapshot(
    options.controlAuthoritySnapshot,
    channelId,
  ) ?? now;
}

export function buildSharedRtcVoiceAuthoritySnapshot(
  controlAuthoritySnapshot?: SharedRtcControlAuthoritySnapshot | null,
  mediaAuthoritySnapshot?: SharedRtcMediaAuthoritySnapshot | null,
): SharedRtcVoiceAuthoritySnapshot | null {
  if (!controlAuthoritySnapshot || !mediaAuthoritySnapshot) return null;

  const channels = new Map<string, { members: VoiceChannelMember[]; startedAt?: number }>();
  const channelIdByClerkUserId = new Map<string, string>();

  for (const session of controlAuthoritySnapshot.sessionsByClerkUserId.values()) {
    const channelId = session.voice_channel_id;
    const clerkUserId = session.clerk_user_id;
    if (!channelId || !clerkUserId) continue;
    if (!mediaAuthoritySnapshot.activeClerkUserIds.has(clerkUserId)) continue;

    const presence = mediaAuthoritySnapshot.presenceByClerkUserId.get(clerkUserId);
    if (!presence) continue;

    let channel = channels.get(channelId);
    if (!channel) {
      channel = { members: [] };
      channels.set(channelId, channel);
    }

    const joinedAt = typeof session.voice_joined_at === "number" && Number.isFinite(session.voice_joined_at)
      ? session.voice_joined_at
      : undefined;
    if (typeof joinedAt === "number") {
      channel.startedAt = typeof channel.startedAt === "number"
        ? Math.min(channel.startedAt, joinedAt)
        : joinedAt;
    }

    channel.members.push({
      clerk_user_id: clerkUserId,
      name: session.name,
      username: session.username,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      avatar_display: session.avatar_display,
      stream_preview_url: session.stream_preview_url,
      connected: presence.connected,
      connection_state: presence.connection_state,
      disconnected_at: presence.disconnected_at,
      reconnect_expires_at: presence.reconnect_expires_at,
      self_mute: session.self_mute,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
      spatial_audio_enabled: session.spatial_audio_enabled,
      spatial_audio_high_fidelity: session.spatial_audio_high_fidelity,
      joined_at: joinedAt,
    });
    channelIdByClerkUserId.set(clerkUserId, channelId);
  }

  for (const channel of channels.values()) {
    const fallbackStartedAt = channel.startedAt ?? mediaAuthoritySnapshot.capturedAt;
    channel.members.sort((left, right) => {
      const leftJoinedAt = left.joined_at ?? fallbackStartedAt;
      const rightJoinedAt = right.joined_at ?? fallbackStartedAt;
      if (leftJoinedAt !== rightJoinedAt) return leftJoinedAt - rightJoinedAt;
      return left.clerk_user_id.localeCompare(right.clerk_user_id);
    });
  }

  return {
    capturedAt: Math.max(controlAuthoritySnapshot.capturedAt, mediaAuthoritySnapshot.capturedAt),
    channels,
    channelIdByClerkUserId,
  };
}

export function buildSharedRtcVoiceChannelStateSnapshot(
  channelId: string,
  voiceSnapshot?: SharedRtcVoiceAuthoritySnapshot | null,
  spatialAudioSnapshot?: SharedRtcSpatialAudioSnapshot | null,
) {
  const channelSnapshot = voiceSnapshot?.channels.get(channelId) ?? null;
  const members = channelSnapshot
    ? channelSnapshot.members.map((member) => ({ ...member }))
    : [];
  const startedAt = channelSnapshot?.startedAt
    ?? members.reduce<number | null>((earliest, member) => {
      const joinedAt = typeof member.joined_at === "number" && Number.isFinite(member.joined_at)
        ? member.joined_at
        : null;
      if (joinedAt === null) return earliest;
      return earliest === null ? joinedAt : Math.min(earliest, joinedAt);
    }, null);

  return {
    members,
    startedAt,
    spatialAudioState: spatialAudioSnapshot?.get(channelId),
  };
}

export function buildSharedRtcVoiceChannelStatesPayload(
  voiceSnapshot?: SharedRtcVoiceAuthoritySnapshot | null,
  spatialAudioSnapshot?: SharedRtcSpatialAudioSnapshot | null,
): VoiceChannelStatesPayload {
  const voiceStates: VoiceChannelStatesPayload["voice_states"] = {};
  const voiceStartedAt: VoiceChannelStatesPayload["voice_started_at"] = {};
  const spatialAudioStates: Record<string, SpatialAudioState> = {};

  for (const channelId of voiceSnapshot?.channels.keys() ?? []) {
    const snapshot = buildSharedRtcVoiceChannelStateSnapshot(
      channelId,
      voiceSnapshot,
      spatialAudioSnapshot,
    );
    if (snapshot.members.length === 0) continue;
    voiceStates[channelId] = snapshot.members;
    if (snapshot.startedAt) {
      voiceStartedAt[channelId] = snapshot.startedAt;
    }
    if (snapshot.spatialAudioState) {
      spatialAudioStates[channelId] = snapshot.spatialAudioState;
    }
  }

  return {
    voice_states: voiceStates,
    voice_started_at: voiceStartedAt,
    spatial_audio_states: spatialAudioStates,
  };
}

export function buildSharedRtcVoiceChannelStateUpdateMessage(
  channelId: string,
  options: {
    voiceSnapshot?: SharedRtcVoiceAuthoritySnapshot | null;
    spatialAudioSnapshot?: SharedRtcSpatialAudioSnapshot | null;
    op?: number;
  } = {},
) {
  const snapshot = buildSharedRtcVoiceChannelStateSnapshot(
    channelId,
    options.voiceSnapshot,
    options.spatialAudioSnapshot,
  );
  return {
    op: options.op ?? 19,
    d: {
      event: "VOICE_CHANNEL_STATE_UPDATE",
      data: {
        channel_id: channelId,
        members: snapshot.members,
        started_at: snapshot.startedAt ?? null,
        spatial_audio_state: snapshot.spatialAudioState,
      },
    },
  };
}

export function planRtcRoomSharedVoiceTransition(options: {
  clerkUserId: string;
  beforeVoiceSnapshot?: SharedRtcVoiceAuthoritySnapshot | null;
  afterControlSnapshot?: SharedRtcControlAuthoritySnapshot | null;
  mediaAuthoritySnapshot?: SharedRtcMediaAuthoritySnapshot | null;
  rebroadcastCurrentChannel?: boolean;
  allowImplicitCallAccept?: boolean;
  pendingCalls?: Map<string, PendingCall> | null;
  acceptedCalls?: Map<string, number> | null;
  acceptedCallTtlMs: number;
}) {
  const afterVoiceSnapshot = buildSharedRtcVoiceAuthoritySnapshot(
    options.afterControlSnapshot,
    options.mediaAuthoritySnapshot,
  );
  const previousChannelId = options.beforeVoiceSnapshot?.channelIdByClerkUserId.get(options.clerkUserId);
  const nextChannelId = afterVoiceSnapshot?.channelIdByClerkUserId.get(options.clerkUserId);
  const changedChannelIds = new Set<string>();

  let nextPendingCalls: Map<string, PendingCall> | null = null;
  let nextAcceptedCalls: Map<string, number> | null = null;
  let abandonedPending: PendingCall | null = null;
  let acceptedPending: PendingCall | null = null;

  if (previousChannelId && previousChannelId !== nextChannelId) {
    changedChannelIds.add(previousChannelId);
    if (!afterVoiceSnapshot?.channels.has(previousChannelId)) {
      nextPendingCalls = new Map(options.pendingCalls ?? []);
      abandonedPending = prepareAbandonedPendingCallForChannel(
        nextPendingCalls,
        previousChannelId,
      );
      if (!abandonedPending) {
        nextPendingCalls = null;
      }
    }
  }

  if (nextChannelId && (options.rebroadcastCurrentChannel || nextChannelId !== previousChannelId)) {
    changedChannelIds.add(nextChannelId);
  }

  if (options.allowImplicitCallAccept && nextChannelId && nextChannelId !== previousChannelId) {
    nextPendingCalls = nextPendingCalls ?? new Map(options.pendingCalls ?? []);
    nextAcceptedCalls = new Map(options.acceptedCalls ?? []);
    acceptedPending = preparePendingCallAcceptForVoiceJoin(
      nextPendingCalls,
      nextAcceptedCalls,
      options.clerkUserId,
      nextChannelId,
      options.acceptedCallTtlMs,
    );
    if (!acceptedPending) {
      nextAcceptedCalls = null;
      if (!abandonedPending) {
        nextPendingCalls = null;
      }
    }
  }

  return {
    afterVoiceSnapshot,
    changedChannelIds,
    abandonedPending,
    acceptedPending,
    nextPendingCalls,
    nextAcceptedCalls,
  };
}
