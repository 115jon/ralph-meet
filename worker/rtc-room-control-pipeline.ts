import type {
  RtcRoomIdentifySessionData,
  RtcRoomVoiceCredentials,
  VerifiedClerkProfile,
} from "./rtc-control-identity";
import {
  applyRtcRoomControlIdentifyEffect,
  applyRtcRoomControlProfileRefreshEffect,
  applyRtcRoomControlResumeEffects,
  applyRtcRoomRefreshVoiceCredentialsEffects,
  applyRtcRoomVoiceStateUpdateEffects,
  type RtcRoomIncomingCall,
  type RtcRoomControlSessionEffectsAdapter,
  type RtcRoomControlSessionEffectsSession,
} from "./rtc-room-control-session-effects";

export interface RtcRoomControlPipelineMeetingRoom {
  createRtcRoomControlSessionEffectsAdapter():
    RtcRoomControlSessionEffectsAdapter<RtcRoomControlSessionEffectsSession>;
}

type SessionAttachment = RtcRoomControlSessionEffectsSession;

type MaterializeRtcRoomControlSessionFn = (
  ws: WebSocket,
  attachment: SessionAttachment,
) => Promise<RtcRoomControlSessionEffectsSession>;

type SessionEffectsResult = {
  nextSession: RtcRoomControlSessionEffectsSession;
  sessionEffects: RtcRoomControlSessionEffectsAdapter<RtcRoomControlSessionEffectsSession>;
};

async function materializeRtcRoomControlSessionWithEffects(
  meetingRoom: RtcRoomControlPipelineMeetingRoom,
  ws: WebSocket,
  attachment: SessionAttachment,
  materializeControlSession: MaterializeRtcRoomControlSessionFn,
): Promise<SessionEffectsResult> {
  const nextSession = await materializeControlSession(ws, attachment);
  const sessionEffects = meetingRoom.createRtcRoomControlSessionEffectsAdapter();
  return {
    nextSession,
    sessionEffects,
  };
}

export async function runRtcRoomControlIdentifyFlow(
  meetingRoom: RtcRoomControlPipelineMeetingRoom,
  ws: WebSocket,
  attachment: SessionAttachment,
  identifyData: RtcRoomIdentifySessionData,
  roomScopeId: string,
  materializeControlSession: MaterializeRtcRoomControlSessionFn,
  resolvePendingIncomingCall?: (
    session: RtcRoomControlSessionEffectsSession,
  ) => RtcRoomIncomingCall | null | undefined,
) {
  const { nextSession, sessionEffects } = await materializeRtcRoomControlSessionWithEffects(
    meetingRoom,
    ws,
    attachment,
    materializeControlSession,
  );
  const pendingIncomingCall = resolvePendingIncomingCall?.(nextSession);
  applyRtcRoomControlIdentifyEffect(
    sessionEffects,
    ws,
    nextSession,
    identifyData,
    roomScopeId,
    { pendingIncomingCall },
  );
  return nextSession;
}

export async function runRtcRoomControlHeartbeatFlow(
  meetingRoom: RtcRoomControlPipelineMeetingRoom,
  ws: WebSocket,
  attachment: SessionAttachment,
  materializeControlSession: MaterializeRtcRoomControlSessionFn,
) {
  return await materializeControlSession(ws, attachment);
}

export async function runRtcRoomControlResumeFlow(
  meetingRoom: RtcRoomControlPipelineMeetingRoom,
  ws: WebSocket,
  attachment: SessionAttachment,
  loadCredentials: () => Promise<RtcRoomVoiceCredentials>,
  roomScopeId: string,
  materializeControlSession: MaterializeRtcRoomControlSessionFn,
) {
  const { nextSession, sessionEffects } = await materializeRtcRoomControlSessionWithEffects(
    meetingRoom,
    ws,
    attachment,
    materializeControlSession,
  );
  const credentials = await loadCredentials();
  await applyRtcRoomControlResumeEffects(
    sessionEffects,
    ws,
    nextSession,
    credentials,
    roomScopeId,
  );
  return nextSession;
}

export async function runRtcRoomControlProfileRefreshFlow(
  meetingRoom: RtcRoomControlPipelineMeetingRoom,
  ws: WebSocket,
  attachment: SessionAttachment,
  verified: VerifiedClerkProfile,
  materializeControlSession: MaterializeRtcRoomControlSessionFn,
) {
  const { nextSession, sessionEffects } = await materializeRtcRoomControlSessionWithEffects(
    meetingRoom,
    ws,
    attachment,
    materializeControlSession,
  );
  applyRtcRoomControlProfileRefreshEffect(
    sessionEffects,
    ws,
    nextSession,
    verified,
  );
  return nextSession;
}

export async function runRtcRoomControlVoiceStateUpdateFlow(
  meetingRoom: RtcRoomControlPipelineMeetingRoom,
  ws: WebSocket,
  attachment: SessionAttachment,
  roomScopeId: string,
  spatialAudioState: unknown,
  materializeControlSession: MaterializeRtcRoomControlSessionFn,
) {
  const { nextSession, sessionEffects } = await materializeRtcRoomControlSessionWithEffects(
    meetingRoom,
    ws,
    attachment,
    materializeControlSession,
  );
  applyRtcRoomVoiceStateUpdateEffects(
    sessionEffects,
    ws,
    nextSession,
    roomScopeId,
    spatialAudioState,
  );
  return nextSession;
}

export async function runRtcRoomRefreshVoiceCredentialsFlow(
  meetingRoom: RtcRoomControlPipelineMeetingRoom,
  ws: WebSocket,
  attachment: SessionAttachment,
  credentials: RtcRoomVoiceCredentials,
  roomScopeId: string,
  materializeControlSession: MaterializeRtcRoomControlSessionFn,
) {
  const nextSession = await materializeControlSession(ws, attachment);
  const sessionEffects = meetingRoom.createRtcRoomControlSessionEffectsAdapter();

  applyRtcRoomRefreshVoiceCredentialsEffects(
    sessionEffects,
    ws,
    nextSession,
    credentials,
    roomScopeId,
  );
  return true;
}
