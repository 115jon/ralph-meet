import type {
  RtcRoomIdentifySessionData,
  RtcRoomVoiceCredentials,
  VerifiedClerkProfile,
} from "./rtc-control-identity";

export interface RtcRoomControlSessionEffectsSession {
  id: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  clerk_user_id?: string;
  stream_preview_url?: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  self_video: boolean;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
  suppress: boolean;
  status?: "online" | "idle" | "dnd" | "offline";
  tracks: Array<{
    participant_id: string;
    track_name: string;
    session_id: string;
    mid?: string;
    kind: "audio" | "video";
  }>;
  voice_channel_id?: string;
  subscribed_channels?: string[];
  subscribed_servers?: string[];
}

export interface RtcRoomIncomingCall {
  callId: string;
  callerId: string;
  callerName: string;
  callerUsername?: string;
  callerDisplayName?: string | null;
  callerAvatar?: string;
  channelId: string;
  calleeId: string;
}

export interface RtcRoomControlSessionEffectsAdapter<
  Session extends RtcRoomControlSessionEffectsSession = RtcRoomControlSessionEffectsSession,
  Participant = unknown,
> {
  restoreSubscriptions(ws: WebSocket, session: Session): void;
  restoreVoiceMembershipOnResume(session: Session): Promise<void>;
  buildControlParticipants(excludedParticipantId?: string): Participant[];
  buildVoiceState(session: Session): unknown;
  getSpatialAudioState(scopeId: string): unknown;
  updateSpatialAudioState(scopeId: string, spatialAudioState: unknown, session: Session): unknown;
  sendTo(ws: WebSocket, message: { op: number; d: unknown }): void;
  broadcast(message: { op: number; d: unknown }, excludeWs?: WebSocket): void;
  sendVoiceChannelStates(ws: WebSocket, session: Session): Promise<void>;
  queueBroadcastVoiceChannelState(channelId: string, excludeWs?: WebSocket): void;
  syncVoiceStateProjection(session: Session): void;
  refreshVoiceProjectionIdentity(session: Session, ws: WebSocket): void;
  applyProfileVoiceProjectionUpdate(session: Session, verified: VerifiedClerkProfile): void;
  logInfo(message: string): void;
}

export function sendRtcRoomResumedPayload<
  Session extends RtcRoomControlSessionEffectsSession,
  Participant,
>(
  adapter: RtcRoomControlSessionEffectsAdapter<Session, Participant>,
  ws: WebSocket,
  session: Session,
  credentials: RtcRoomVoiceCredentials,
  options: {
    includeSpatialAudioState: boolean;
    spatialAudioScopeId: string;
    fallbackSpatialAudioScopeId?: string;
  },
) {
  const participants = adapter.buildControlParticipants();
  adapter.sendTo(ws, {
    op: 9,
    d: {
      voice_token: credentials.voiceToken,
      ice_servers: credentials.iceServers,
      participants,
      ...(options.includeSpatialAudioState
        ? {
            spatial_audio_state: adapter.getSpatialAudioState(
              options.spatialAudioScopeId || options.fallbackSpatialAudioScopeId || "",
            ),
          }
        : {}),
    },
  });
}

export function applyRtcRoomControlIdentifyEffects<
  Session extends RtcRoomControlSessionEffectsSession,
  Participant,
>(
  adapter: RtcRoomControlSessionEffectsAdapter<Session, Participant>,
  ws: WebSocket,
  session: Session,
  identifyData: RtcRoomIdentifySessionData,
  roomScopeId: string,
  options: {
    pendingIncomingCall?: RtcRoomIncomingCall | null;
  } = {},
) {
  adapter.refreshVoiceProjectionIdentity(session, ws);

  const participants = adapter.buildControlParticipants(session.id);

  adapter.sendTo(ws, {
    op: 2,
    d: {
      participant_id: session.id,
      ice_servers: identifyData.iceServers,
      participants,
      heartbeat_interval: 45_000,
      voice_token: identifyData.voiceToken,
      spatial_audio_state: adapter.getSpatialAudioState(session.voice_channel_id || roomScopeId),
    },
  });

  adapter.sendVoiceChannelStates(ws, session).catch(() => {});
  if (session.voice_channel_id) {
    adapter.queueBroadcastVoiceChannelState(session.voice_channel_id);
  }

  adapter.broadcast(
    {
      op: 15,
      d: {
        participant: adapter.buildVoiceState(session),
        action: "join",
      },
    },
    ws,
  );

  if (!session.clerk_user_id) return true;

  adapter.broadcast(
    {
      op: 19,
      d: {
        event: "PRESENCE_UPDATE",
        data: {
          user_id: session.clerk_user_id,
          status: session.status,
        },
      },
    },
    ws,
  );

  const pending = options.pendingIncomingCall;
  if (pending && pending.calleeId === session.clerk_user_id) {
    adapter.logInfo(`Found pending call (as callee) for ${session.clerk_user_id}: callId=${pending.callId}`);
    adapter.sendTo(ws, {
      op: 19,
      d: {
        event: "CALL_RING",
        data: {
          call_id: pending.callId,
          caller_id: pending.callerId,
          caller_name: pending.callerName,
          caller_username: pending.callerUsername,
          caller_display_name: pending.callerDisplayName,
          caller_avatar: pending.callerAvatar,
          channel_id: pending.channelId,
          is_reconnect: true,
        },
      },
    });
  }

  return true;
}

export async function applyRtcRoomControlResumeEffects<
  Session extends RtcRoomControlSessionEffectsSession,
  Participant,
>(
  adapter: RtcRoomControlSessionEffectsAdapter<Session, Participant>,
  ws: WebSocket,
  session: Session,
  credentials: RtcRoomVoiceCredentials,
  roomScopeId: string,
) {
  adapter.restoreSubscriptions(ws, session);
  await adapter.restoreVoiceMembershipOnResume(session);
  adapter.logInfo(`Resumed session: ${session.id}, sending authoritative room snapshot`);
  sendRtcRoomResumedPayload(adapter, ws, session, credentials, {
    includeSpatialAudioState: true,
    spatialAudioScopeId: session.voice_channel_id || roomScopeId,
    fallbackSpatialAudioScopeId: roomScopeId,
  });
  await adapter.sendVoiceChannelStates(ws, session);
  return true;
}

export function applyRtcRoomRefreshVoiceCredentialsEffects<
  Session extends RtcRoomControlSessionEffectsSession,
  Participant,
>(
  adapter: RtcRoomControlSessionEffectsAdapter<Session, Participant>,
  ws: WebSocket,
  session: Session,
  credentials: RtcRoomVoiceCredentials,
  roomScopeId: string,
) {
  sendRtcRoomResumedPayload(adapter, ws, session, credentials, {
    includeSpatialAudioState: false,
    spatialAudioScopeId: session.voice_channel_id || roomScopeId,
    fallbackSpatialAudioScopeId: roomScopeId,
  });
  return true;
}

export function applyRtcRoomVoiceStateUpdateEffects<
  Session extends RtcRoomControlSessionEffectsSession,
  Participant,
>(
  adapter: RtcRoomControlSessionEffectsAdapter<Session, Participant>,
  ws: WebSocket,
  session: Session,
  roomScopeId: string,
  spatialAudioState?: unknown,
) {
  const spatialAudioScopeId = session.voice_channel_id || roomScopeId;
  const nextSpatialAudioState = spatialAudioState === undefined
    ? adapter.getSpatialAudioState(spatialAudioScopeId)
    : adapter.updateSpatialAudioState(spatialAudioScopeId, spatialAudioState, session);

  adapter.broadcast(
    {
      op: 15,
      d: {
        participant: adapter.buildVoiceState(session),
        action: "update",
        spatial_audio_state: nextSpatialAudioState,
      },
    },
    ws,
  );

  adapter.syncVoiceStateProjection(session);
  return true;
}

export function applyRtcRoomProfileRefreshEffects<
  Session extends RtcRoomControlSessionEffectsSession,
  Participant,
>(
  adapter: RtcRoomControlSessionEffectsAdapter<Session, Participant>,
  ws: WebSocket,
  session: Session,
  verified: VerifiedClerkProfile,
) {
  adapter.broadcast(
    {
      op: 16,
      d: {
        participant_id: session.id,
        name: verified.name,
        username: verified.username,
        display_name: verified.displayName ?? null,
        avatar_url: verified.avatarUrl,
        avatar_display: verified.avatarDisplay ?? null,
      },
    },
    ws,
  );

  if (!session.voice_channel_id || !session.clerk_user_id) return true;

  adapter.applyProfileVoiceProjectionUpdate(session, verified);
  return true;
}

export const applyRtcRoomControlIdentifyEffect = applyRtcRoomControlIdentifyEffects;
export const applyRtcRoomControlResumeEffect = applyRtcRoomControlResumeEffects;
export const applyRtcRoomRefreshVoiceCredentialsEffect = applyRtcRoomRefreshVoiceCredentialsEffects;
export const applyRtcRoomControlVoiceStateUpdateEffect = applyRtcRoomVoiceStateUpdateEffects;
export const applyRtcRoomControlProfileRefreshEffect = applyRtcRoomProfileRefreshEffects;
