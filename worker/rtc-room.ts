import { DurableObject } from "cloudflare:workers";
import { clog } from "../src/lib/console-logger";
import { isReconnectWithinGrace, shouldKeepResumableSession } from "../src/lib/voice/connection-generation";
import {
  RTC_CONTROL_HEARTBEAT_INTERVAL_MS,
  RTC_CONTROL_ZOMBIE_TIMEOUT_MS,
  RTC_RECONNECT_GRACE_MS,
  RTC_MEDIA_RECONNECT_GRACE_MS,
  RTC_VOICE_HEARTBEAT_INTERVAL_MS,
  parseVoiceSessionCheckRequest,
  resolveVoiceSessionCheckResponse,
  type VoiceSessionCheckRequest,
  type VoiceSessionCheckResponse,
} from "../src/lib/voice/rtc-room-session";
import type { RtcSocketRole } from "../src/lib/voice/rtc-room-routing";
import {
  ACCEPTED_CALL_TTL_MS,
  CALL_RING_TIMEOUT_MS,
  MeetingRoom,
  type PendingCall,
  type RtcRoomDisconnectCallCleanup,
  type SpatialAudioState,
  type SharedRtcControlAuthoritySnapshot,
  type SharedRtcControlSessionSnapshot,
  type SharedRtcMediaAuthoritySnapshot,
  type SharedRtcSpatialAudioSnapshot,
  type SharedRtcVoiceAuthoritySnapshot,
  type SharedRtcStaleControlMembership,
  type VoiceChannelStatesPayload,
} from "./meeting-room";
import {
  consumeRtcRoomProfileRefreshCooldown,
  fetchRtcRoomProfileRefreshData,
  fetchRtcRoomVoiceCredentials,
  resolveRtcRoomControlIdentifySessionData,
  type RtcRoomIdentifySessionData,
  type RtcRoomVoiceCredentials,
} from "./rtc-control-identity";
import {
  applyRtcRoomChannelSubscribe,
  applyRtcRoomChannelUnsubscribe,
  applyRtcRoomPresenceUpdate,
  applyRtcRoomServerSubscribe,
  type RtcRoomControlPostWriteEffectsAdapter,
} from "./rtc-room-control-post-write-effects";
import {
  type RtcRoomControlSessionEffectsAdapter,
  type RtcRoomControlSessionEffectsSession,
} from "./rtc-room-control-session-effects";
import {
  type RtcRoomControlDisconnectEffectsAdapter,
  type RtcRoomControlDisconnectEffectsSession,
  applyRtcRoomControlDisconnectEffects,
} from "./rtc-room-control-disconnect-effects";
import {
  type RtcRoomControlPipelineMeetingRoom,
  runRtcRoomControlHeartbeatFlow,
  runRtcRoomControlIdentifyFlow,
  runRtcRoomControlProfileRefreshFlow,
  runRtcRoomControlResumeFlow,
  runRtcRoomControlVoiceStateUpdateFlow,
  runRtcRoomRefreshVoiceCredentialsFlow,
} from "./rtc-room-control-pipeline";
import {
  buildCallRingStopMessage,
  buildIncomingPendingCallMessage,
  buildOutgoingPendingCallRingingMessage,
} from "./rtc-room-call-payloads";
import {
  expirePendingCalls as expirePendingCallsValue,
  findPendingCallForUser as findPendingCallForUserValue,
  hasAcceptedCall as hasAcceptedCallValue,
  prepareDisconnectCallCleanup as prepareDisconnectCallCleanupValue,
  preparePendingCallAcceptByCallId as preparePendingCallAcceptByCallIdValue,
  pruneExpiredAcceptedCalls as pruneExpiredAcceptedCallsValue,
} from "./rtc-room-call-state";
import {
  buildSharedRtcVoiceChannelStateUpdateMessage,
  buildSharedRtcVoiceChannelStatesPayload,
  buildSharedRtcVoiceAuthoritySnapshot,
  planRtcRoomSharedVoiceTransition,
  resolveRtcRoomVoiceJoinedAt,
} from "./rtc-room-voice-projection";
import {
  buildSharedRtcControlAuthoritySnapshot as buildSharedRtcControlAuthoritySnapshotValue,
  buildSharedRtcMediaAuthoritySnapshot as buildSharedRtcMediaAuthoritySnapshotValue,
  collectRtcRoomStaleSharedControlMemberships as collectRtcRoomStaleSharedControlMembershipsValue,
  toSharedRtcControlSessionSnapshot as toSharedRtcControlSessionSnapshotValue,
} from "./rtc-room-authority-snapshots";
import {
  computeEarliestAlarmDeadline,
  scheduleEarlierAlarmIfNeeded,
} from "./rtc-room-alarm";
import {
  buildRtcRoomPendingPresenceWrite,
  getRtcRoomPendingPresenceClerkUserId,
  getRtcRoomPendingPresenceStorageKey,
  persistRtcRoomPresenceStatusToD1,
  type PendingPresenceWrite,
} from "./rtc-room-presence";
import {
  canRtcRoomClerkUserAccessVoiceChannel,
  filterRtcRoomSharedVoiceStatesForClerkUserId,
  type SharedVisibilityChannelMeta,
} from "./rtc-room-shared-visibility";
import { RtcRoomMedia } from "./rtc-room-media";

const RESUME_SESSION_KEY_PREFIX = "resume:session:";
const RESUME_EXPIRY_KEY_PREFIX = "resume:expiry:";
const PRESENCE_PENDING_KEY_PREFIX = "presence:pending:";
const ROOM_SCOPED_CONTROL_PATH_RE = /^\/api\/channels\/([^/]+)\/ws$/;
const ROOM_SCOPED_MEDIA_PATH_RE = /^\/api\/channels\/([^/]+)\/voice$/;
const RTC_CONTROL_HELLO_OP = 8;
const RTC_MEDIA_HELLO_OP = 8;
const RTC_CONTROL_IDENTIFY_OP = 0;
const RTC_CONTROL_HEARTBEAT_OP = 3;
const RTC_CONTROL_HEARTBEAT_ACK_OP = 6;
const RTC_CONTROL_RESUME_OP = 7;
const RTC_CONTROL_CLIENT_DISCONNECT_OP = 11;
const RTC_CONTROL_VOICE_STATE_UPDATE_OP = 15;
const RTC_CONTROL_PROFILE_REFRESH_OP = 17;
const RTC_CONTROL_ERROR_OP = 18;
const RTC_CONTROL_DISPATCH_OP = 19;
const RTC_CONTROL_PRESENCE_UPDATE_OP = 26;
const RTC_CONTROL_CHANNEL_SUBSCRIBE_OP = 27;
const RTC_CONTROL_CHANNEL_UNSUBSCRIBE_OP = 28;
const RTC_CONTROL_VOICE_CHANNEL_JOIN_OP = 33;
const RTC_CONTROL_VOICE_CHANNEL_LEAVE_OP = 34;
const RTC_CONTROL_SERVER_SUBSCRIBE_OP = 35;
const RTC_CONTROL_CALL_INITIATE_OP = 36;
const RTC_CONTROL_CALL_ACCEPT_OP = 37;
const RTC_CONTROL_CALL_DECLINE_OP = 38;
const RTC_CONTROL_CALL_END_OP = 39;
const RTC_CONTROL_REFRESH_VOICE_CREDENTIALS_OP = 40;
const RTC_CONTROL_ALREADY_AUTHENTICATED_CODE = 4005;
const RTC_CONTROL_SESSION_INVALID_CODE = 4006;
const rtcRoomLog = clog("RtcRoom");

interface Env {
  CALLS_APP_ID: string;
  CALLS_APP_SECRET: string;
  TURN_TOKEN_ID: string;
  TURN_TOKEN_SECRET: string;
  CLERK_SECRET_KEY: string;
  DB: D1Database;
  BUCKET: R2Bucket;
  CACHE: KVNamespace;
  DEBUG?: string;
}

type SocketRoleAttachment = {
  socket_role?: RtcSocketRole;
  id?: string;
  participant_id?: string;
  clerk_user_id?: string;
};

type RtcRoomControlSessionAttachment = SocketRoleAttachment
  & Partial<SharedRtcControlSessionSnapshot>
  & {
    last_heartbeat?: number;
    seq?: number;
    subscribed_channels?: string[];
    subscribed_servers?: string[];
  }
  & Record<string, unknown>;

type RtcRoomCommittedControlSessionAttachment =
  SocketRoleAttachment
  & RtcRoomControlSessionEffectsSession
  & {
    socket_role?: RtcSocketRole;
    last_heartbeat?: number;
    seq?: number;
  }
  & Record<string, unknown>;

type RtcRoomIdentifiedControlSessionAttachment =
  RtcRoomCommittedControlSessionAttachment & { clerk_user_id: string };

function clearRtcRoomVoiceMediaFlags<T extends {
  self_video?: boolean;
  self_stream?: boolean;
  self_stream_audio?: boolean;
  stream_preview_url?: string | null;
}>(attachment: T): T {
  return {
    ...attachment,
    self_video: false,
    self_stream: false,
    self_stream_audio: false,
    stream_preview_url: null,
  };
}

type ControlIdentifyPayload = {
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string;
  avatar_display?: string | null;
  clerk_user_id?: string;
};

type ControlResumePayload = {
  session_id: string;
  seq_ack: number;
};

type ControlVoiceStateUpdatePayload = {
  self_mute?: boolean;
  self_deaf?: boolean;
  self_video?: boolean;
  self_stream?: boolean;
  self_stream_audio?: boolean;
  stream_preview_url?: string | null;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
  spatial_audio_state?: unknown;
};

type ControlPresenceUpdatePayload = {
  status: "online" | "idle" | "dnd" | "offline";
};

type ControlChannelSubscribePayload = {
  channel_id: string;
};

type ControlCallInitiatePayload = {
  target_user_id: string;
  channel_id: string;
};

type ControlCallAcceptPayload = {
  call_id: string;
};

type ControlProfileRefreshData = {
  name: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string;
  avatarDisplay?: string | null;
};

type ControlVoiceChannelJoinPayload = {
  channel_id: string;
  self_mute?: boolean;
  started_at?: number;
};

type ControlVoiceChannelLeavePayload = {
  channel_id?: string;
};

type ControlServerSubscribePayload = {
  server_id: string;
};

type ControlCallEndPayload = {
  call_id: string;
};

type PendingMeetingRoomStorageBatch = {
  puts?: Record<string, unknown> | Map<string, unknown> | Array<[string, unknown]> | null;
  deletes?: Iterable<string> | null;
};

type RtcRoomPresenceStorage = Pick<
  DurableObjectState<{}>["storage"],
  "list" | "delete" | "getAlarm" | "setAlarm"
>;

type RtcRoomCanonicalSessionRecord = {
  participantId: string;
  clerkUserId: string;
  controlSessionId: string | null;
  mediaConnectionId: string | null;
  voiceChannelId: string | null;
  mediaReconnectExpiresAt: number | null;
  pullSessionId: string | null;
  pushSessionCam: string | null;
  pushSessionScreen: string | null;
};

type RtcRoomMeetingRoomPersistenceBridge = {
  mirrorRtcRoomControlSession(
    ws: WebSocket,
    session: RtcRoomControlSessionEffectsSession | RtcRoomCommittedControlSessionAttachment,
  ): void;
  addRtcRoomChannelSubscription?(channelId: string, ws: WebSocket): void;
  removeRtcRoomChannelSubscription?(channelId: string, ws: WebSocket): void;
  addRtcRoomServerSubscription?(serverId: string, ws: WebSocket): void;
  cleanupRtcRoomChannelSubscriptions?(ws: WebSocket): void;
  cleanupRtcRoomServerSubscriptions?(ws: WebSocket): void;
  deleteRtcRoomLiveControlSession?(ws: WebSocket, participantId: string): void;
  clearRtcRoomLocalResumableControlState?(participantId: string): void;
  clearRtcRoomSharedProjectionChannels?(channelIds: Iterable<string>): boolean;
  drainPendingStorageMutations(): PendingMeetingRoomStorageBatch | null | undefined;
};

const CONTROL_OPS = new Set([
  0,
  3,
  7,
  11,
  15,
  17,
  20,
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  28,
  33,
  34,
  35,
  36,
  37,
  38,
  39,
  40,
]);
const MEDIA_OPS = new Set([1, 4, 5, 10, 12, 13, 14, 100, 101, 102, 103, 104, 105, 106]);

export function getRtcRoomSocketRole(ws: WebSocket): RtcSocketRole | null {
  const attachment = ws.deserializeAttachment() as SocketRoleAttachment | null;
  if (attachment?.socket_role === "control" || attachment?.socket_role === "media") {
    return attachment.socket_role;
  }
  if (attachment?.participant_id) return "media";
  if (attachment?.id) return "control";
  return null;
}

export function inferRtcRoomSocketRole(rawMsg: string | ArrayBuffer): RtcSocketRole | null {
  if (typeof rawMsg !== "string") return null;
  try {
    const message = JSON.parse(rawMsg) as { op?: number };
    if (typeof message.op !== "number") return null;
    if (MEDIA_OPS.has(message.op)) return "media";
    if (CONTROL_OPS.has(message.op)) return "control";
    return null;
  } catch {
    return null;
  }
}

function getRtcRoomSocketClerkUserId(ws: WebSocket): string | null {
  const attachment = ws.deserializeAttachment() as SocketRoleAttachment | null;
  return typeof attachment?.clerk_user_id === "string" && attachment.clerk_user_id
    ? attachment.clerk_user_id
    : null;
}

function getRtcRoomSocketParticipantId(ws: WebSocket): string | null {
  const attachment = ws.deserializeAttachment() as SocketRoleAttachment | null;
  return typeof attachment?.participant_id === "string" && attachment.participant_id
    ? attachment.participant_id
    : null;
}

function isRtcRoomMediaIdentifyMessage(rawMsg: string | ArrayBuffer): boolean {
  if (typeof rawMsg !== "string") return false;
  try {
    return (JSON.parse(rawMsg) as { op?: number }).op === 100;
  } catch {
    return false;
  }
}

export class RtcRoom extends DurableObject<Env> {
  public readonly ctx: DurableObjectState<{}>;
  public readonly env: Env;
  private meetingRoom: MeetingRoom | null = null;
  private rtcRoomMedia: RtcRoomMedia | null = null;
  private storedRoomSlug: string | null = null;
  private meetingRoomSharedProjectionBootstrapped = false;
  private rtcRoomProfileRefreshCooldowns = new Map<string, number>();
  private sharedRtcPendingCalls: Map<string, PendingCall> | null = null;
  private sharedRtcAcceptedCalls: Map<string, number> | null = null;
  private pendingRtcRoomPresenceWrites = new Map<string, PendingPresenceWrite>();
  private latestSharedRtcControlAuthoritySnapshot: SharedRtcControlAuthoritySnapshot | null = null;
  private latestSharedRtcVoiceAuthoritySnapshot: SharedRtcVoiceAuthoritySnapshot | null = null;
  private sharedRtcSpatialAudioSnapshot: SharedRtcSpatialAudioSnapshot | null = null;
  private sharedRtcProjectedChannelIds = new Set<string>();
  private sharedRtcChannelMetaCache = new Map<string, SharedVisibilityChannelMeta>();
  private canonicalRtcSessions = new Map<string, RtcRoomCanonicalSessionRecord>();

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  private getMeetingRoom() {
    if (!this.meetingRoom) {
      this.meetingRoom = new MeetingRoom(this.ctx, this.env, { sharedRtcAuthority: true });
      this.meetingRoomSharedProjectionBootstrapped = false;
      this.sharedRtcProjectedChannelIds.clear();
    }
    this.meetingRoom.setSharedRtcAuthority(true);
    return this.meetingRoom;
  }

  private getRtcRoomMedia() {
    if (!this.rtcRoomMedia) {
      this.rtcRoomMedia = new RtcRoomMedia(this.ctx, this.env);
    }
    return this.rtcRoomMedia;
  }

  private findRtcRoomPendingIncomingCall(clerkUserId: string) {
    const pending = findPendingCallForUserValue(
      this.sharedRtcPendingCalls ?? new Map<string, PendingCall>(),
      clerkUserId,
    );
    return pending && pending.calleeId === clerkUserId ? pending : null;
  }

  private createRtcRoomControlPipelineBridge(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
  ): RtcRoomControlPipelineMeetingRoom {
    return {
      createRtcRoomControlSessionEffectsAdapter: () =>
        this.createRtcRoomSharedControlSessionEffectsAdapter(meetingRoom),
    };
  }

  private listRtcRoomLiveControlSessions(excludedParticipantId?: string) {
    const sessionsByParticipantId = new Map<string, RtcRoomIdentifiedControlSessionAttachment>();

    const sockets = this.ctx?.getWebSockets?.() ?? [];
    for (const ws of sockets) {
      if (getRtcRoomSocketRole(ws) !== "control") continue;
      const attachment = this.readRtcRoomControlSessionAttachment(ws);
      if (!attachment) continue;
      if (excludedParticipantId && attachment.id === excludedParticipantId) continue;
      sessionsByParticipantId.set(attachment.id, attachment);
    }

    return [...sessionsByParticipantId.values()];
  }

  private buildRtcRoomAuthoritativeControlParticipants(
    buildVoiceState: (
      session: RtcRoomControlSessionEffectsSession,
    ) => unknown,
    excludedParticipantId?: string,
  ) {
    const liveSessions = this.listRtcRoomLiveControlSessions(excludedParticipantId);
    if (liveSessions.length === 0) return null;

    const participants: unknown[] = [];
    for (const session of liveSessions) {
      participants.push(buildVoiceState(session));
    }

    return participants;
  }

  private setRtcRoomSharedVoiceAuthoritySnapshot(snapshot: SharedRtcVoiceAuthoritySnapshot | null) {
    this.latestSharedRtcVoiceAuthoritySnapshot = snapshot ?? null;
  }

  private listRtcRoomSharedProjectedChannelIds() {
    return new Set(this.sharedRtcProjectedChannelIds);
  }

  private updateRtcRoomSharedProjectedChannelIds(
    channelIds: Iterable<string>,
    authoritativeVoiceSnapshot: SharedRtcVoiceAuthoritySnapshot | null | undefined =
      this.latestSharedRtcVoiceAuthoritySnapshot,
  ) {
    const nextProjectedChannelIds = new Set(this.sharedRtcProjectedChannelIds);
    let changed = false;

    for (const channelId of channelIds) {
      if (authoritativeVoiceSnapshot?.channels.has(channelId)) {
        if (!nextProjectedChannelIds.has(channelId)) {
          changed = true;
        }
        nextProjectedChannelIds.add(channelId);
        continue;
      }

      if (nextProjectedChannelIds.delete(channelId)) {
        changed = true;
      }
    }

    if (changed) {
      this.sharedRtcProjectedChannelIds = nextProjectedChannelIds;
    }

    return changed;
  }

  private sendRtcRoomSharedVoiceChannelStates(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    clerkUserId: string,
    voiceSnapshot: SharedRtcVoiceAuthoritySnapshot | null | undefined =
      this.latestSharedRtcVoiceAuthoritySnapshot,
  ): Promise<boolean> {
    return this.sendRtcRoomSharedVoiceChannelStatesPayload(
      ws,
      clerkUserId,
      buildSharedRtcVoiceChannelStatesPayload(
        voiceSnapshot,
        this.sharedRtcSpatialAudioSnapshot,
      ),
      meetingRoom,
    );
  }

  private queueRtcRoomSharedVoiceStateBroadcasts(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    channelIds: Iterable<string>,
    voiceSnapshot: SharedRtcVoiceAuthoritySnapshot | null | undefined =
      this.latestSharedRtcVoiceAuthoritySnapshot,
    excludeWs?: WebSocket,
  ) {
    const uniqueChannelIds = new Set(channelIds);
    if (uniqueChannelIds.size === 0) return false;

    const messages = new Map<string, { op: number; d: unknown }>();
    for (const channelId of uniqueChannelIds) {
      messages.set(
        channelId,
        buildSharedRtcVoiceChannelStateUpdateMessage(channelId, {
          voiceSnapshot,
          spatialAudioSnapshot: this.sharedRtcSpatialAudioSnapshot,
          op: RTC_CONTROL_DISPATCH_OP,
        }),
      );
    }

    let queued = false;
    const broadcastSharedVoiceStateMessage = this.broadcastRtcRoomSharedVoiceStateMessage
      ?? RtcRoom.prototype.broadcastRtcRoomSharedVoiceStateMessage;
    for (const channelId of uniqueChannelIds) {
      const message = messages.get(channelId);
      if (!message) continue;
      this.ctx.waitUntil(broadcastSharedVoiceStateMessage.call(
        this,
        channelId,
        message,
        meetingRoom,
        excludeWs,
      ));
      queued = true;
    }

    return queued;
  }

  private projectRtcRoomSharedControlSnapshotWithSession(
    _meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    session: RtcRoomControlSessionEffectsSession,
  ) {
    const currentSnapshot = this.latestSharedRtcControlAuthoritySnapshot;
    const projectedSession = this.toSharedRtcControlSessionSnapshot(session);
    if (!currentSnapshot || !projectedSession) return null;

    const sessionsByClerkUserId = new Map(currentSnapshot.sessionsByClerkUserId);
    const sessionsByParticipantId = new Map(currentSnapshot.sessionsByParticipantId);
    sessionsByClerkUserId.set(projectedSession.clerk_user_id, projectedSession);
    sessionsByParticipantId.set(projectedSession.id, projectedSession);

    const projectedSnapshot: SharedRtcControlAuthoritySnapshot = {
      ...currentSnapshot,
      capturedAt: Math.max(currentSnapshot.capturedAt, Date.now()),
      sessionsByClerkUserId,
      sessionsByParticipantId,
    };
    this.latestSharedRtcControlAuthoritySnapshot = projectedSnapshot;
    return projectedSnapshot;
  }

  private queueRtcRoomSharedProjectionBroadcastForSession(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    session: RtcRoomControlSessionEffectsSession,
    excludeWs?: WebSocket,
  ) {
    if (!session.voice_channel_id || !session.clerk_user_id) return false;

    const projectedControlSnapshot = this.projectRtcRoomSharedControlSnapshotWithSession(
      meetingRoom,
      session,
    );
    const projectedVoiceSnapshot = buildSharedRtcVoiceAuthoritySnapshot(
      projectedControlSnapshot,
      this.tryReadSharedRtcMediaAuthoritySnapshot(projectedControlSnapshot?.capturedAt ?? Date.now()),
    );
    this.setRtcRoomSharedVoiceAuthoritySnapshot(projectedVoiceSnapshot);

    const channelId = projectedVoiceSnapshot?.channelIdByClerkUserId.get(session.clerk_user_id);
    if (!channelId) return false;
    this.updateRtcRoomSharedProjectedChannelIds([channelId], projectedVoiceSnapshot);

    return this.queueRtcRoomSharedVoiceStateBroadcasts(
      meetingRoom,
      [channelId],
      projectedVoiceSnapshot,
      excludeWs,
    );
  }

  private createRtcRoomSharedControlSessionEffectsAdapter(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
  ): RtcRoomControlSessionEffectsAdapter<RtcRoomControlSessionEffectsSession> {
    return {
      restoreSubscriptions: (
        ws: WebSocket,
        session: RtcRoomControlSessionEffectsSession,
      ) => {
        if (session.subscribed_channels) {
          for (const channelId of session.subscribed_channels) {
            meetingRoom.addRtcRoomChannelSubscription?.(channelId, ws);
          }
        }
        if (session.subscribed_servers) {
          for (const serverId of session.subscribed_servers) {
            meetingRoom.addRtcRoomServerSubscription?.(serverId, ws);
          }
        }
      },
      restoreVoiceMembershipOnResume: async () => {},
      buildControlParticipants: (excludedParticipantId?: string) =>
        this.buildRtcRoomAuthoritativeControlParticipants(
          (session) => this.toSharedRtcControlSessionSnapshot(session),
          excludedParticipantId,
        )
        ?? [],
      buildVoiceState: (session: RtcRoomControlSessionEffectsSession) =>
        this.toSharedRtcControlSessionSnapshot(session),
      getSpatialAudioState: (scopeId: string) =>
        this.sharedRtcSpatialAudioSnapshot?.get(scopeId),
      updateSpatialAudioState: (
        scopeId: string,
        spatialAudioState: unknown,
        session: RtcRoomControlSessionEffectsSession,
      ) => {
        const nextSpatialAudioState = {
          ...(spatialAudioState as SpatialAudioState),
          updatedBy: session.clerk_user_id || session.id,
          updatedAt: Date.now(),
        };
        const nextSnapshot = new Map(this.sharedRtcSpatialAudioSnapshot ?? []);
        nextSnapshot.set(scopeId, nextSpatialAudioState);
        this.sharedRtcSpatialAudioSnapshot = nextSnapshot;
        return nextSpatialAudioState;
      },
      sendTo: (ws: WebSocket, message: { op: number; d: unknown }) => {
        this.sendRtcRoomControlMessage(ws, message.op, message.d);
      },
      broadcast: (message: { op: number; d: unknown }, excludeWs?: WebSocket) => {
        for (const targetWs of this.ctx.getWebSockets()) {
          if (targetWs === excludeWs) continue;
          if (getRtcRoomSocketRole(targetWs) !== "control") continue;
          this.sendRtcRoomControlMessage(targetWs, message.op, message.d);
        }
      },
      sendVoiceChannelStates: async (
        ws: WebSocket,
        session: RtcRoomControlSessionEffectsSession,
      ) => {
        if (!session.clerk_user_id) {
          return;
        }
        await this.sendRtcRoomSharedVoiceChannelStates(
          meetingRoom,
          ws,
          session.clerk_user_id,
        );
      },
      queueBroadcastVoiceChannelState: (channelId: string, excludeWs?: WebSocket) => {
        void this.queueRtcRoomSharedVoiceStateBroadcasts(
          meetingRoom,
          [channelId],
          undefined,
          excludeWs,
        );
      },
      refreshVoiceProjectionIdentity: (
        session: RtcRoomControlSessionEffectsSession,
        ws: WebSocket,
      ) => {
        void this.queueRtcRoomSharedProjectionBroadcastForSession(meetingRoom, session, ws);
      },
      syncVoiceStateProjection: (session: RtcRoomControlSessionEffectsSession) => {
        void this.queueRtcRoomSharedProjectionBroadcastForSession(meetingRoom, session);
      },
      applyProfileVoiceProjectionUpdate: (session: RtcRoomControlSessionEffectsSession) => {
        void this.queueRtcRoomSharedProjectionBroadcastForSession(meetingRoom, session);
      },
      logInfo: (message: string) => {
        rtcRoomLog.info(message);
      },
    };
  }

  private createRtcRoomSharedControlPostWriteEffectsAdapter(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
  ) {
    return {
      queuePresenceWrite: (clerkUserId, status) => {
        this.queueRtcRoomPendingPresenceWrite(clerkUserId, status);
      },
      broadcastPresenceStatus: (clerkUserId, status) => {
        this.broadcastRtcRoomControlDispatchToUser(clerkUserId, "PRESENCE_UPDATE", {
          user_id: clerkUserId,
          status,
        });
      },
      addChannelSubscription: (channelId, ws) => {
        meetingRoom.addRtcRoomChannelSubscription?.(channelId, ws);
      },
      removeChannelSubscription: (channelId, ws) => {
        meetingRoom.removeRtcRoomChannelSubscription?.(channelId, ws);
      },
      addServerSubscription: (serverId, ws) => {
        meetingRoom.addRtcRoomServerSubscription?.(serverId, ws);
      },
      sendPresenceList: (ws, userIds) => {
        this.sendRtcRoomControlMessage(ws, RTC_CONTROL_DISPATCH_OP, {
          event: "PRESENCE_LIST",
          data: { user_ids: userIds },
        });
      },
      queueVoiceChannelStates: (ws: WebSocket, clerkUserId: string) => {
        this.ctx.waitUntil(this.sendRtcRoomSharedVoiceChannelStates(meetingRoom, ws, clerkUserId));
      },
      logInfo: (message) => {
        rtcRoomLog.info(message);
      },
    } satisfies RtcRoomControlPostWriteEffectsAdapter;
  }

  private hasRtcRoomConcurrentControlSession(ws: WebSocket, clerkUserId: string) {
    for (const otherWs of this.ctx.getWebSockets()) {
      if (otherWs === ws) continue;
      if (getRtcRoomSocketRole(otherWs) !== "control") continue;
      if (getRtcRoomSocketClerkUserId(otherWs) === clerkUserId) {
        return true;
      }
    }

    return false;
  }

  private createRtcRoomSharedControlDisconnectEffectsAdapter(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
  ): RtcRoomControlDisconnectEffectsAdapter<RtcRoomControlDisconnectEffectsSession> {
    return {
      hasConcurrentControlSession: (ws: WebSocket, clerkUserId: string) =>
        this.hasRtcRoomConcurrentControlSession(ws, clerkUserId),
      broadcast: (message: { op: number; d: unknown }, excludeWs?: WebSocket) => {
        for (const targetWs of this.ctx.getWebSockets()) {
          if (targetWs === excludeWs) continue;
          if (getRtcRoomSocketRole(targetWs) !== "control") continue;
          this.sendRtcRoomControlMessage(targetWs, message.op, message.d);
        }
      },
      buildVoiceState: (session: RtcRoomControlDisconnectEffectsSession) =>
        this.toSharedRtcControlSessionSnapshot(session),
      cleanupChannelSubscriptions: (ws: WebSocket) => {
        meetingRoom.cleanupRtcRoomChannelSubscriptions?.(ws);
      },
      cleanupServerSubscriptions: (ws: WebSocket) => {
        meetingRoom.cleanupRtcRoomServerSubscriptions?.(ws);
      },
      deleteLiveControlSession: (ws: WebSocket, participantId: string) => {
        meetingRoom.deleteRtcRoomLiveControlSession?.(ws, participantId);
      },
      clearResumableControlState: (participantId: string) => {
        meetingRoom.clearRtcRoomLocalResumableControlState?.(participantId);
      },
      closeSocket: (ws: WebSocket, code: number, reason: string) => {
        try { ws.close(code, reason); } catch { /* already closed */ }
      },
    };
  }

  private bootstrapMeetingRoomSharedProjectionIfReady(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    controlAuthoritySnapshot: SharedRtcControlAuthoritySnapshot | null | undefined,
    mediaAuthoritySnapshot = this.tryReadSharedRtcMediaAuthoritySnapshot(),
  ) {
    if (this.meetingRoomSharedProjectionBootstrapped) return false;
    if (!controlAuthoritySnapshot || !mediaAuthoritySnapshot) return false;

    const authoritativeVoiceSnapshot = buildSharedRtcVoiceAuthoritySnapshot(
      controlAuthoritySnapshot,
      mediaAuthoritySnapshot,
    );
    const projectedChannelIds = this.listRtcRoomSharedProjectedChannelIds();
    const authoritativeChannelIds = new Set(authoritativeVoiceSnapshot?.channels.keys() ?? []);
    const staleChannelIds = new Set<string>();
    for (const channelId of projectedChannelIds) {
      if (!authoritativeChannelIds.has(channelId)) {
        staleChannelIds.add(channelId);
      }
    }

    const clearedStaleChannels = staleChannelIds.size > 0
      ? meetingRoom.clearRtcRoomSharedProjectionChannels?.(staleChannelIds) ?? false
      : false;
    const broadcastChannelIds = new Set<string>([
      ...staleChannelIds,
      ...authoritativeChannelIds,
    ]);
    const queueSharedVoiceBroadcasts = this.queueRtcRoomSharedVoiceStateBroadcasts
      ?? RtcRoom.prototype.queueRtcRoomSharedVoiceStateBroadcasts;
    const queuedBroadcasts = broadcastChannelIds.size > 0
      ? queueSharedVoiceBroadcasts.call(
        this,
        meetingRoom,
        broadcastChannelIds,
        authoritativeVoiceSnapshot,
      )
      : false;
    if (!clearedStaleChannels && !queuedBroadcasts) return false;
    this.sharedRtcProjectedChannelIds = new Set(authoritativeChannelIds);
    this.meetingRoomSharedProjectionBootstrapped = true;
    return true;
  }

  private async syncMeetingRoomControlAuthoritySnapshot(
    snapshot?: SharedRtcControlAuthoritySnapshot | null,
  ) {
    const meetingRoom = this.getMeetingRoom();
    const nextSnapshot = snapshot ?? await this.tryReadSharedRtcControlAuthoritySnapshot();
    this.latestSharedRtcControlAuthoritySnapshot = nextSnapshot ?? null;
    const mediaAuthoritySnapshot = this.tryReadSharedRtcMediaAuthoritySnapshot(
      nextSnapshot?.capturedAt ?? Date.now(),
    );
    this.setRtcRoomSharedVoiceAuthoritySnapshot(
      buildSharedRtcVoiceAuthoritySnapshot(nextSnapshot, mediaAuthoritySnapshot),
    );
    this.bootstrapMeetingRoomSharedProjectionIfReady(meetingRoom, nextSnapshot, mediaAuthoritySnapshot);
    this.syncRtcRoomCanonicalSessionRecords(nextSnapshot);
    return nextSnapshot;
  }

  private syncRtcRoomCanonicalSessionRecords(
    controlAuthoritySnapshot: SharedRtcControlAuthoritySnapshot | null | undefined =
      this.latestSharedRtcControlAuthoritySnapshot,
    now = Date.now(),
  ) {
    const records = new Map<string, RtcRoomCanonicalSessionRecord>();
    const recordsByParticipantId = new Map<string, RtcRoomCanonicalSessionRecord>();

    for (const session of controlAuthoritySnapshot?.sessionsByParticipantId.values() ?? []) {
      const record: RtcRoomCanonicalSessionRecord = {
        participantId: session.id,
        clerkUserId: session.clerk_user_id,
        controlSessionId: session.id,
        mediaConnectionId: null,
        voiceChannelId: session.voice_channel_id ?? null,
        mediaReconnectExpiresAt: null,
        pullSessionId: null,
        pushSessionCam: null,
        pushSessionScreen: null,
      };
      records.set(session.clerk_user_id, record);
      recordsByParticipantId.set(session.id, record);
    }

    try {
      for (const row of this.ctx.storage.sql.exec(
        `SELECT
           p.id,
           p.clerk_user_id,
           p.connection_id,
           p.pull_session_id,
           p.push_session_cam,
           p.push_session_screen,
           r.disconnected_at
         FROM participants p
         LEFT JOIN pending_reconnects r ON r.participant_id = p.id`,
      )) {
        const participantId = typeof row.id === "string" && row.id ? row.id : null;
        const clerkUserId = typeof row.clerk_user_id === "string" && row.clerk_user_id
          ? row.clerk_user_id
          : participantId;
        if (!participantId || !clerkUserId) continue;

        const disconnectedAt =
          typeof row.disconnected_at === "number" && Number.isFinite(row.disconnected_at)
            ? row.disconnected_at
            : null;
        const mediaReconnectExpiresAt =
          typeof disconnectedAt === "number"
          && isReconnectWithinGrace(disconnectedAt, now, RTC_MEDIA_RECONNECT_GRACE_MS)
            ? disconnectedAt + RTC_MEDIA_RECONNECT_GRACE_MS
            : null;

        const existing = records.get(clerkUserId) ?? recordsByParticipantId.get(participantId);
        const record: RtcRoomCanonicalSessionRecord = {
          participantId,
          clerkUserId,
          controlSessionId: existing?.controlSessionId ?? null,
          mediaConnectionId:
            typeof row.connection_id === "string" && row.connection_id ? row.connection_id : null,
          voiceChannelId: existing?.voiceChannelId ?? null,
          mediaReconnectExpiresAt,
          pullSessionId:
            typeof row.pull_session_id === "string" && row.pull_session_id ? row.pull_session_id : null,
          pushSessionCam:
            typeof row.push_session_cam === "string" && row.push_session_cam ? row.push_session_cam : null,
          pushSessionScreen:
            typeof row.push_session_screen === "string" && row.push_session_screen ? row.push_session_screen : null,
        };
        records.set(clerkUserId, record);
        recordsByParticipantId.set(participantId, record);
      }
    } catch {
      // Media tables may not exist during cold startup before RtcRoomMedia boots.
    }

    this.canonicalRtcSessions = records;
    return records;
  }

  private queueRtcRoomPendingPresenceWrite(
    clerkUserId: string,
    status: "online" | "idle" | "dnd" | "offline",
    now = Date.now(),
  ) {
    this.pendingRtcRoomPresenceWrites.set(
      clerkUserId,
      buildRtcRoomPendingPresenceWrite(status, now),
    );
    return true;
  }

  private async persistRtcRoomPendingPresenceWrites(now = Date.now()) {
    const pendingPresenceWrites = this.pendingRtcRoomPresenceWrites;
    if (!(pendingPresenceWrites instanceof Map) || pendingPresenceWrites.size === 0) return false;

    const puts: Record<string, PendingPresenceWrite> = {};
    let nextAlarm: number | null = null;
    for (const [clerkUserId, pending] of pendingPresenceWrites) {
      puts[getRtcRoomPendingPresenceStorageKey(clerkUserId)] = pending;
      nextAlarm = nextAlarm === null ? pending.dueAt : Math.min(nextAlarm, pending.dueAt);
    }
    pendingPresenceWrites.clear();

    await this.ctx.storage.put(puts);
    await scheduleEarlierAlarmIfNeeded(this.ctx.storage, nextAlarm, now);
    return true;
  }

  private async flushRtcRoomPendingPresenceWrites(now = Date.now()) {
    const storage = (this as unknown as { ctx?: { storage?: RtcRoomPresenceStorage } }).ctx?.storage;
    if (!storage?.list || !storage.delete || !storage.getAlarm || !storage.setAlarm) {
      return false;
    }

    const pendingEntries = await storage.list<PendingPresenceWrite>({
      prefix: PRESENCE_PENDING_KEY_PREFIX,
    });
    if (pendingEntries.size === 0) return false;

    const deleteKeys: string[] = [];
    const dueWrites: Array<{ clerkUserId: string; status: PendingPresenceWrite["status"] }> = [];
    let nextAlarm: number | null = null;

    for (const [storageKey, pending] of pendingEntries) {
      if (pending.dueAt <= now) {
        const clerkUserId = getRtcRoomPendingPresenceClerkUserId(storageKey);
        if (clerkUserId) {
          dueWrites.push({ clerkUserId, status: pending.status });
        }
        deleteKeys.push(storageKey);
        continue;
      }

      nextAlarm = nextAlarm === null ? pending.dueAt : Math.min(nextAlarm, pending.dueAt);
    }

    if (deleteKeys.length > 0) {
      await storage.delete(deleteKeys);
    }

    for (const dueWrite of dueWrites) {
      try {
        await persistRtcRoomPresenceStatusToD1(this.env, dueWrite.clerkUserId, dueWrite.status);
      } catch (error) {
        rtcRoomLog.error("RtcRoom presence flush failed:", error);
      }
    }

    await scheduleEarlierAlarmIfNeeded(storage, nextAlarm, now);
    return dueWrites.length > 0;
  }

  private async persistMeetingRoomPendingControlBatch(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
  ) {
    await (
      (this as unknown as {
        persistRtcRoomPendingPresenceWrites?: (now?: number) => Promise<boolean>;
      }).persistRtcRoomPendingPresenceWrites
      ?? RtcRoom.prototype.persistRtcRoomPendingPresenceWrites
    ).call(this);
    const batch = meetingRoom.drainPendingStorageMutations();
    if (!batch) return;

    const deleteKeys = batch.deletes ? [...batch.deletes] : [];
    if (deleteKeys.length > 0) {
      await this.ctx.storage.delete(deleteKeys);
    }

    const puts = batch.puts instanceof Map
      ? Object.fromEntries(batch.puts)
      : Array.isArray(batch.puts)
      ? Object.fromEntries(batch.puts)
      : batch.puts;

    if (puts && Object.keys(puts).length > 0) {
      await this.ctx.storage.put(puts);
    }
  }

  private async persistMeetingRoomPendingControlBatchAndSyncSnapshot(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
  ) {
    await this.persistMeetingRoomPendingControlBatch(meetingRoom);
    return await this.syncMeetingRoomControlAuthoritySnapshot();
  }

  private async pruneRtcRoomZombieControlSockets(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    now = Date.now(),
  ) {
    let prunedAny = false;

    for (const ws of this.ctx.getWebSockets()) {
      if (getRtcRoomSocketRole(ws) !== "control") continue;
      const attachment = this.readRtcRoomCommittedControlAttachment(ws);
      const lastHeartbeat = attachment?.last_heartbeat ?? 0;
      if (!lastHeartbeat || now - lastHeartbeat < RTC_CONTROL_ZOMBIE_TIMEOUT_MS) continue;

      await this.handleRtcRoomControlDisconnectLifecycle(meetingRoom, ws, {
        intentional: false,
        closeSocket: true,
        closeCode: 1000,
        closeReason: "Left room",
      });
      prunedAny = true;
    }

    return prunedAny;
  }

  private async pruneRtcRoomExpiredResumableControlSessions(now = Date.now()) {
    const expiryEntries = await this.ctx.storage.list<number>({
      prefix: RESUME_EXPIRY_KEY_PREFIX,
    });
    if (expiryEntries.size === 0) return false;

    const deleteKeys: string[] = [];
    let prunedAny = false;

    for (const [key, disconnectedAt] of expiryEntries) {
      if (typeof disconnectedAt !== "number" || !Number.isFinite(disconnectedAt)) continue;
      if (isReconnectWithinGrace(disconnectedAt, now, RTC_RECONNECT_GRACE_MS)) continue;

      const sessionId = key.slice(RESUME_EXPIRY_KEY_PREFIX.length);
      if (!sessionId) continue;
      const sessionKey = `${RESUME_SESSION_KEY_PREFIX}${sessionId}`;
      const storedSession = await this.ctx.storage.get<RtcRoomControlSessionAttachment>(sessionKey);

      deleteKeys.push(
        sessionKey,
        `${RESUME_EXPIRY_KEY_PREFIX}${sessionId}`,
      );
      this.broadcastRtcRoomExpiredResumableControlSessionLeave(sessionId, storedSession);
      prunedAny = true;
    }

    if (deleteKeys.length > 0) {
      await this.ctx.storage.delete(deleteKeys);
      await this.scheduleRtcRoomControlResumeExpiryAlarm(now);
    }

    return prunedAny;
  }

  private async scheduleRtcRoomControlResumeExpiryAlarm(now = Date.now()) {
    const expiryEntries = await this.ctx.storage.list<number>({
      prefix: RESUME_EXPIRY_KEY_PREFIX,
    });
    if (expiryEntries.size === 0) return false;

    const nextAlarm = computeEarliestAlarmDeadline(
      now,
      [...expiryEntries.values()].map((disconnectedAt) =>
        typeof disconnectedAt === "number" && Number.isFinite(disconnectedAt)
          ? disconnectedAt + RTC_RECONNECT_GRACE_MS
          : undefined,
      ),
    );

    return scheduleEarlierAlarmIfNeeded(this.ctx.storage, nextAlarm, now);
  }

  private async readRtcRoomPendingCallsFromStorage() {
    const storedPendingCalls = await this.ctx.storage.get<Record<string, PendingCall>>("pendingCalls");
    const pendingCalls = new Map<string, PendingCall>();
    if (!storedPendingCalls) return pendingCalls;

    for (const [calleeId, pending] of Object.entries(storedPendingCalls)) {
      if (!pending || typeof pending.callId !== "string" || !pending.callId) continue;
      pendingCalls.set(calleeId, pending);
    }

    return pendingCalls;
  }

  private async readRtcRoomAcceptedCallsFromStorage() {
    const storedAcceptedCalls = await this.ctx.storage.get<Record<string, number>>("acceptedCallExpiry");
    const acceptedCalls = new Map<string, number>();
    if (!storedAcceptedCalls) return acceptedCalls;

    for (const [callId, expiresAt] of Object.entries(storedAcceptedCalls)) {
      if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) continue;
      acceptedCalls.set(callId, expiresAt);
    }

    return acceptedCalls;
  }

  private async persistRtcRoomPendingCallsToStorage(pendingCalls: Map<string, PendingCall>) {
    if (pendingCalls.size === 0) {
      await this.ctx.storage.delete("pendingCalls");
      return false;
    }

    await this.ctx.storage.put("pendingCalls", Object.fromEntries(pendingCalls));
    return true;
  }

  private async persistRtcRoomAcceptedCallsToStorage(acceptedCalls: Map<string, number>) {
    if (acceptedCalls.size === 0) {
      await this.ctx.storage.delete("acceptedCallExpiry");
      return false;
    }

    await this.ctx.storage.put("acceptedCallExpiry", Object.fromEntries(acceptedCalls));
    return true;
  }

  private async syncRtcRoomSharedCallStateMirror(meetingRoom: RtcRoomMeetingRoomPersistenceBridge) {
    const [pendingCalls, acceptedCalls] = await Promise.all([
      this.readRtcRoomPendingCallsFromStorage(),
      this.readRtcRoomAcceptedCallsFromStorage(),
    ]);
    this.sharedRtcPendingCalls = pendingCalls;
    this.sharedRtcAcceptedCalls = acceptedCalls;
    void meetingRoom;
    return { pendingCalls, acceptedCalls };
  }

  private async scheduleRtcRoomSharedCallStateAlarm(now = Date.now()) {
    const [pendingCalls, acceptedCalls] = await Promise.all([
      this.readRtcRoomPendingCallsFromStorage(),
      this.readRtcRoomAcceptedCallsFromStorage(),
    ]);
    const nextAlarm = computeEarliestAlarmDeadline(now, [
      ...[...pendingCalls.values()].map((pending) => pending.expiresAt),
      ...acceptedCalls.values(),
    ]);

    return scheduleEarlierAlarmIfNeeded(this.ctx.storage, nextAlarm, now);
  }

  private async persistRtcRoomSharedCallState(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    pendingCalls: Map<string, PendingCall>,
    acceptedCalls: Map<string, number>,
    options: {
      pendingChanged?: boolean;
      acceptedChanged?: boolean;
      now?: number;
    } = {},
  ) {
    const pendingChanged = options.pendingChanged ?? true;
    const acceptedChanged = options.acceptedChanged ?? true;
    const now = options.now ?? Date.now();

    await Promise.all([
      pendingChanged
        ? this.persistRtcRoomPendingCallsToStorage(pendingCalls)
        : Promise.resolve(false),
      acceptedChanged
        ? this.persistRtcRoomAcceptedCallsToStorage(acceptedCalls)
        : Promise.resolve(false),
    ]);
    await this.scheduleRtcRoomSharedCallStateAlarm(now);
    this.sharedRtcPendingCalls = new Map(pendingCalls);
    this.sharedRtcAcceptedCalls = new Map(acceptedCalls);
    void meetingRoom;
  }

  private async runRtcRoomSharedCallStateAlarm(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    now = Date.now(),
  ) {
    const { pendingCalls, acceptedCalls } = await this.syncRtcRoomSharedCallStateMirror(meetingRoom);
    const expiredPendingCalls = expirePendingCallsValue(pendingCalls, now);
    const acceptedCallsChanged = pruneExpiredAcceptedCallsValue(acceptedCalls, now);

    if (expiredPendingCalls.length === 0 && !acceptedCallsChanged) return false;

    await this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls, {
      pendingChanged: expiredPendingCalls.length > 0,
      acceptedChanged: acceptedCallsChanged,
      now,
    });
    for (const pending of expiredPendingCalls) {
      this.broadcastRtcRoomPendingCallStop(pending, "timeout");
    }

    return true;
  }

  private async syncMeetingRoomMediaState(clerkUserId: string | null) {
    const beforeVoiceSnapshot = this.meetingRoomSharedProjectionBootstrapped && clerkUserId
      ? await this.readCurrentSharedRtcVoiceAuthoritySnapshot()
      : null;
    const wasBootstrapped = this.meetingRoomSharedProjectionBootstrapped;

    this.syncMeetingRoomMediaAuthoritySnapshot();
    if (!clerkUserId) return false;
    const controlAuthoritySnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    if (!controlAuthoritySnapshot) return false;
    if (!wasBootstrapped && this.meetingRoomSharedProjectionBootstrapped) {
      return true;
    }

    const meetingRoom = this.getMeetingRoom() as unknown as RtcRoomMeetingRoomPersistenceBridge;
    return this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
      clerkUserId,
      beforeVoiceSnapshot,
      afterControlSnapshot: controlAuthoritySnapshot,
      rebroadcastCurrentChannel: true,
    });
  }

  private normalizeRtcRoomStoredControlAttachment(
    value: RtcRoomControlSessionAttachment | null | undefined,
  ): RtcRoomCommittedControlSessionAttachment | null {
    if (!value || typeof value.id !== "string" || !value.id) return null;
    if (typeof value.name !== "string" || !value.name) return null;
    return {
      ...value,
      socket_role: "control",
    } as RtcRoomCommittedControlSessionAttachment;
  }

  private async clearRtcRoomSharedControlMemberships(
    staleMemberships: SharedRtcStaleControlMembership[],
  ) {
    if (staleMemberships.length === 0) return new Set<string>();

    const lookup = new Set(
      staleMemberships.map(({ channelId, clerkUserId }) => `${channelId}\u0000${clerkUserId}`),
    );
    const changedChannelIds = new Set<string>();
    const puts: Record<string, RtcRoomCommittedControlSessionAttachment> = {};

    for (const ws of this.ctx.getWebSockets()) {
      if (getRtcRoomSocketRole(ws) !== "control") continue;
      const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
      if (!currentAttachment?.voice_channel_id) continue;
      if (!lookup.has(`${currentAttachment.voice_channel_id}\u0000${currentAttachment.clerk_user_id}`)) {
        continue;
      }

      const channelId = currentAttachment.voice_channel_id;
      const nextAttachment: RtcRoomCommittedControlSessionAttachment = clearRtcRoomVoiceMediaFlags({
        ...currentAttachment,
        socket_role: "control",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      });
      ws.serializeAttachment(nextAttachment);
      puts[`${RESUME_SESSION_KEY_PREFIX}${nextAttachment.id}`] = nextAttachment;
      changedChannelIds.add(channelId);
    }

    const storedEntries = await this.ctx.storage.list<RtcRoomControlSessionAttachment>({
      prefix: RESUME_SESSION_KEY_PREFIX,
    });
    for (const [key, value] of storedEntries) {
      const currentAttachment = this.normalizeRtcRoomStoredControlAttachment(value);
      if (!currentAttachment?.voice_channel_id) continue;
      if (!lookup.has(`${currentAttachment.voice_channel_id}\u0000${currentAttachment.clerk_user_id}`)) {
        continue;
      }

      const channelId = currentAttachment.voice_channel_id;
      const nextAttachment: RtcRoomCommittedControlSessionAttachment = clearRtcRoomVoiceMediaFlags({
        ...currentAttachment,
        socket_role: "control",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      });
      puts[key] = nextAttachment;
      changedChannelIds.add(channelId);
    }

    if (Object.keys(puts).length > 0) {
      await this.ctx.storage.put(puts);
    }

    return changedChannelIds;
  }

  private collectRtcRoomStaleSharedControlMemberships(
    controlAuthoritySnapshot: SharedRtcControlAuthoritySnapshot | null | undefined,
    mediaAuthoritySnapshot: SharedRtcMediaAuthoritySnapshot | null | undefined,
  ): SharedRtcStaleControlMembership[] {
    return collectRtcRoomStaleSharedControlMembershipsValue(
      controlAuthoritySnapshot,
      mediaAuthoritySnapshot,
    );
  }

  private async reconcileRtcRoomSharedControlIntentFromMedia(
    mediaAuthoritySnapshot: SharedRtcMediaAuthoritySnapshot | null | undefined,
  ) {
    const controlAuthoritySnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    const staleMemberships = this.collectRtcRoomStaleSharedControlMemberships(
      controlAuthoritySnapshot,
      mediaAuthoritySnapshot,
    );
    if (staleMemberships.length === 0) return new Set<string>();

    const changedChannelIds = await this.clearRtcRoomSharedControlMemberships(staleMemberships);
    if (changedChannelIds.size > 0) {
      await this.syncMeetingRoomControlAuthoritySnapshot();
    }

    return changedChannelIds;
  }

  private async getStoredRoomSlug() {
    if (this.storedRoomSlug) return this.storedRoomSlug;
    const storedSlug = await this.ctx.storage.get<string>("roomSlug");
    if (storedSlug) {
      this.storedRoomSlug = storedSlug;
      return storedSlug;
    }
    return null;
  }

  private persistRoomSlug(roomSlug: string) {
    this.storedRoomSlug = roomSlug;
    this.meetingRoom?.setRoomSlugFromRtcRoom(roomSlug);
    this.rtcRoomMedia?.setRoomSlugFromRtcRoom(roomSlug);
    this.ctx.storage.put("roomSlug", roomSlug).catch(() => { });
  }

  private toSharedRtcControlSessionSnapshot(
    session: Partial<SharedRtcControlSessionSnapshot> | null | undefined,
  ): SharedRtcControlSessionSnapshot | null {
    return toSharedRtcControlSessionSnapshotValue(session);
  }

  private async readSharedRtcControlAuthoritySnapshot(now = Date.now()): Promise<SharedRtcControlAuthoritySnapshot> {
    const [resumableEntries, expiryEntries] = await Promise.all([
      this.ctx.storage.list<SharedRtcControlSessionSnapshot>({
        prefix: RESUME_SESSION_KEY_PREFIX,
      }),
      this.ctx.storage.list<number>({
        prefix: RESUME_EXPIRY_KEY_PREFIX,
      }),
    ]);
    const resumableSessions: Array<Partial<SharedRtcControlSessionSnapshot> | null> = [];
    for (const [key, session] of resumableEntries) {
      const sessionId = key.slice(RESUME_SESSION_KEY_PREFIX.length);
      if (!sessionId) continue;

      const disconnectedAt = expiryEntries.get(`${RESUME_EXPIRY_KEY_PREFIX}${sessionId}`);
      if (typeof disconnectedAt !== "number" || !Number.isFinite(disconnectedAt)) continue;
      if (!isReconnectWithinGrace(disconnectedAt, now, RTC_RECONNECT_GRACE_MS)) continue;

      resumableSessions.push(session);
    }

    return buildSharedRtcControlAuthoritySnapshotValue({
      capturedAt: now,
      resumableSessions,
      liveSessions: this.listRtcRoomLiveControlSessions(),
    });
  }

  private async tryReadSharedRtcControlAuthoritySnapshot(now = Date.now()) {
    try {
      return await this.readSharedRtcControlAuthoritySnapshot(now);
    } catch {
      return null;
    }
  }

  private async readCurrentSharedRtcAuthorityState(now = Date.now()) {
    const controlAuthoritySnapshot = await this.tryReadSharedRtcControlAuthoritySnapshot(now);
    return {
      controlAuthoritySnapshot,
      voiceAuthoritySnapshot: buildSharedRtcVoiceAuthoritySnapshot(
        controlAuthoritySnapshot,
        this.tryReadSharedRtcMediaAuthoritySnapshot(now),
      ),
    };
  }

  private normalizeRtcRoomVoiceChannelStartedAt(startedAt: unknown): number | undefined {
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return undefined;
    const now = Date.now();
    const maxRestoreAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (startedAt < now - maxRestoreAgeMs || startedAt > now + 60_000) return undefined;
    return startedAt;
  }

  private readRtcRoomControlSessionAttachment(ws: WebSocket): RtcRoomIdentifiedControlSessionAttachment | null {
    const attachment = this.readRtcRoomCommittedControlAttachment(ws);
    if (!attachment) return null;
    if (typeof attachment.clerk_user_id !== "string" || !attachment.clerk_user_id) return null;
    return attachment as RtcRoomIdentifiedControlSessionAttachment;
  }

  private readRtcRoomCommittedControlAttachment(ws: WebSocket): RtcRoomCommittedControlSessionAttachment | null {
    const attachment = ws.deserializeAttachment() as RtcRoomControlSessionAttachment | null;
    if (!attachment || typeof attachment.id !== "string" || !attachment.id) return null;
    if (typeof attachment.name !== "string" || !attachment.name) return null;
    return attachment as RtcRoomCommittedControlSessionAttachment;
  }

  private async readStoredRtcRoomControlSessionAttachment(
    sessionId: string,
  ): Promise<RtcRoomCommittedControlSessionAttachment | null> {
    const stored = await this.ctx.storage.get<RtcRoomControlSessionAttachment>(`${RESUME_SESSION_KEY_PREFIX}${sessionId}`);
    if (!stored || typeof stored.id !== "string" || !stored.id) return null;
    if (typeof stored.name !== "string" || !stored.name) return null;
    return {
      ...stored,
      socket_role: "control",
    } as RtcRoomCommittedControlSessionAttachment;
  }

  private sendRtcRoomControlMessage(ws: WebSocket, op: number, d: unknown) {
    try {
      ws.send(JSON.stringify({ op, d }));
    } catch {
      // Ignore socket-close races while mirroring MeetingRoom's send semantics.
    }
  }

  private async sendRtcRoomSharedVoiceChannelStatesPayload(
    ws: WebSocket,
    clerkUserId: string,
    data: VoiceChannelStatesPayload,
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge = this.getMeetingRoom(),
  ): Promise<boolean> {
    void meetingRoom;
    const sharedRtcChannelMetaCache = this.sharedRtcChannelMetaCache
      ?? RtcRoom.prototype.sharedRtcChannelMetaCache;
    const filtered = await filterRtcRoomSharedVoiceStatesForClerkUserId(
      this.env,
      clerkUserId,
      data,
      sharedRtcChannelMetaCache,
    );
    if (!filtered) return false;

    this.sendRtcRoomControlMessage(ws, RTC_CONTROL_DISPATCH_OP, {
      event: "VOICE_CHANNEL_STATES",
      data: filtered,
    });
    return true;
  }

  private async broadcastRtcRoomSharedVoiceStateMessage(
    channelId: string,
    message: { op: number; d: unknown },
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge = this.getMeetingRoom(),
    excludeWs?: WebSocket,
  ): Promise<boolean> {
    void meetingRoom;
    const sharedRtcChannelMetaCache = this.sharedRtcChannelMetaCache
      ?? RtcRoom.prototype.sharedRtcChannelMetaCache;
    let sent = false;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      if (getRtcRoomSocketRole(ws) !== "control") continue;

      const clerkUserId = getRtcRoomSocketClerkUserId(ws);
      if (!clerkUserId) continue;
      if (!(await canRtcRoomClerkUserAccessVoiceChannel(
        this.env,
        channelId,
        clerkUserId,
        sharedRtcChannelMetaCache,
      ))) {
        continue;
      }

      this.sendRtcRoomControlMessage(ws, message.op, message.d);
      sent = true;
    }

    return sent;
  }

  private sendRtcRoomControlError(ws: WebSocket, code: number, message: string) {
    this.sendRtcRoomControlMessage(ws, RTC_CONTROL_ERROR_OP, { code, message });
  }

  private buildRtcRoomVoiceStateFromControlAttachment(
    sessionId: string,
    storedSession?: Partial<RtcRoomControlSessionAttachment> | null,
  ) {
    if (!storedSession) return null;

    return {
      id: storedSession.id ?? sessionId,
      clerk_user_id: storedSession.clerk_user_id,
      name: storedSession.name ?? sessionId,
      username: storedSession.username,
      display_name: storedSession.display_name,
      avatar_url: storedSession.avatar_url ?? undefined,
      avatar_display: storedSession.avatar_display,
      stream_preview_url: storedSession.stream_preview_url,
      self_mute: storedSession.self_mute ?? false,
      self_deaf: storedSession.self_deaf ?? false,
      self_stream: storedSession.self_stream ?? false,
      self_stream_audio: storedSession.self_stream_audio,
      self_video: storedSession.self_video ?? false,
      spatial_audio_enabled: storedSession.spatial_audio_enabled,
      spatial_audio_high_fidelity: storedSession.spatial_audio_high_fidelity,
      suppress: storedSession.suppress ?? false,
      status: storedSession.status,
      tracks: [...(storedSession.tracks ?? [])],
    };
  }

  private broadcastRtcRoomExpiredResumableControlSessionLeave(
    sessionId: string,
    storedSession?: Partial<RtcRoomControlSessionAttachment> | null,
  ) {
    const participant = this.buildRtcRoomVoiceStateFromControlAttachment(sessionId, storedSession);
    if (!participant) return false;

    for (const ws of this.ctx.getWebSockets()) {
      if (getRtcRoomSocketRole(ws) !== "control") continue;
      this.sendRtcRoomControlMessage(ws, RTC_CONTROL_VOICE_STATE_UPDATE_OP, {
        participant,
        action: "leave",
      });
    }

    return true;
  }

  private broadcastRtcRoomControlDispatchToUser(
    userId: string,
    event: string,
    data: Record<string, unknown>,
  ) {
    for (const ws of this.ctx.getWebSockets()) {
      if (getRtcRoomSocketRole(ws) !== "control") continue;
      if (getRtcRoomSocketClerkUserId(ws) !== userId) continue;
      this.sendRtcRoomControlMessage(ws, RTC_CONTROL_DISPATCH_OP, { event, data });
    }
  }

  private sendRtcRoomCallRingStop(ws: WebSocket, callId: string | null, reason: string) {
    const message = buildCallRingStopMessage(callId, reason);
    this.sendRtcRoomControlMessage(ws, message.op, message.d);
  }

  private broadcastRtcRoomCallRingStopToUser(
    userId: string,
    callId: string,
    reason: string,
  ) {
    const message = buildCallRingStopMessage(callId, reason);
    this.broadcastRtcRoomControlDispatchToUser(userId, message.d.event, message.d.data);
  }

  private broadcastRtcRoomPendingCallStop(
    pending: PendingCall,
    reason: string,
  ) {
    this.broadcastRtcRoomCallRingStopToUser(pending.callerId, pending.callId, reason);
    this.broadcastRtcRoomCallRingStopToUser(pending.calleeId, pending.callId, reason);
  }

  private broadcastRtcRoomIncomingPendingCall(pending: PendingCall) {
    const message = buildIncomingPendingCallMessage(pending);
    this.broadcastRtcRoomControlDispatchToUser(pending.calleeId, message.d.event, message.d.data);
  }

  private broadcastRtcRoomOutgoingPendingCallRinging(pending: PendingCall) {
    const message = buildOutgoingPendingCallRingingMessage(pending);
    this.broadcastRtcRoomControlDispatchToUser(pending.callerId, message.d.event, message.d.data);
  }

  private applyRtcRoomDisconnectCallCleanup(
    cleanup: RtcRoomDisconnectCallCleanup,
  ) {
    for (const notification of cleanup.notifications) {
      this.broadcastRtcRoomCallRingStopToUser(
        notification.userId,
        notification.callId,
        cleanup.reason,
      );
    }
    return true;
  }

  private async persistRtcRoomControlSessionAttachment(
    attachment: RtcRoomCommittedControlSessionAttachment,
  ) {
    await this.ctx.storage.put({
      [`${RESUME_SESSION_KEY_PREFIX}${attachment.id}`]: attachment,
    });
  }

  private toRtcRoomCommittedControlSessionAttachment(
    attachment: RtcRoomControlSessionEffectsSession,
  ): RtcRoomCommittedControlSessionAttachment {
    const currentAttachment = attachment as Partial<RtcRoomCommittedControlSessionAttachment>;
    return {
      ...attachment,
      socket_role: "control",
      last_heartbeat:
        typeof currentAttachment.last_heartbeat === "number"
        && Number.isFinite(currentAttachment.last_heartbeat)
          ? currentAttachment.last_heartbeat
          : Date.now(),
      seq:
        typeof currentAttachment.seq === "number" && Number.isFinite(currentAttachment.seq)
          ? currentAttachment.seq
          : 0,
      subscribed_channels: attachment.subscribed_channels ?? [],
      subscribed_servers: attachment.subscribed_servers ?? [],
    };
  }

  private async persistRtcRoomControlAttachmentAndRehydrate(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    attachment: RtcRoomControlSessionEffectsSession,
  ) {
    const committedAttachment = this.toRtcRoomCommittedControlSessionAttachment(attachment);
    ws.serializeAttachment(committedAttachment);
    await this.persistRtcRoomControlSessionAttachment(committedAttachment);
    meetingRoom.mirrorRtcRoomControlSession(ws, committedAttachment);
    return committedAttachment;
  }

  private async persistRtcRoomControlAttachmentSyncSnapshotAndRehydrate(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    attachment: RtcRoomControlSessionEffectsSession,
  ) {
    const committedAttachment = this.toRtcRoomCommittedControlSessionAttachment(attachment);
    ws.serializeAttachment(committedAttachment);
    await this.persistRtcRoomControlSessionAttachment(committedAttachment);
    await this.syncMeetingRoomControlAuthoritySnapshot();
    meetingRoom.mirrorRtcRoomControlSession(ws, committedAttachment);
    return committedAttachment;
  }

  private findRtcRoomControlSocketByClerkUserId(clerkUserId: string) {
    for (const ws of this.ctx.getWebSockets()) {
      if (getRtcRoomSocketRole(ws) !== "control") continue;
      if (getRtcRoomSocketClerkUserId(ws) === clerkUserId) {
        return ws;
      }
    }
    return null;
  }

  private listRtcRoomOnlineClerkUserIds() {
    const onlineUserIds = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (getRtcRoomSocketRole(ws) !== "control") continue;
      const clerkUserId = getRtcRoomSocketClerkUserId(ws);
      if (clerkUserId) {
        onlineUserIds.add(clerkUserId);
      }
    }
    return Array.from(onlineUserIds);
  }

  private async persistRtcRoomControlDisconnectState(
    attachment: RtcRoomCommittedControlSessionAttachment,
    intentional: boolean,
    disconnectedAt: number,
  ) {
    if (shouldKeepResumableSession(intentional)) {
      await this.ctx.storage.put({
        [`${RESUME_SESSION_KEY_PREFIX}${attachment.id}`]: attachment,
        [`${RESUME_EXPIRY_KEY_PREFIX}${attachment.id}`]: disconnectedAt,
      });
      await this.scheduleRtcRoomControlResumeExpiryAlarm(disconnectedAt);
      return;
    }

    await this.ctx.storage.delete([
      `${RESUME_SESSION_KEY_PREFIX}${attachment.id}`,
      `${RESUME_EXPIRY_KEY_PREFIX}${attachment.id}`,
    ]);
  }

  private async canRtcRoomServerSubscribe(serverId: string, clerkUserId: string) {
    const row = await this.env.DB.prepare(
      "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?",
    ).bind(serverId, clerkUserId).first();
    return Boolean(row);
  }

  private async handleRtcRoomControlIdentify(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d: ControlIdentifyPayload,
  ) {
    const existingAttachment = ws.deserializeAttachment() as SocketRoleAttachment | null;
    if (typeof existingAttachment?.id === "string" && existingAttachment.id) {
      this.sendRtcRoomControlError(
        ws,
        RTC_CONTROL_ALREADY_AUTHENTICATED_CODE,
        "Already identified",
      );
      return true;
    }

    const participantId = crypto.randomUUID();
    const identifyData = await resolveRtcRoomControlIdentifySessionData(
      this.env,
      await this.getStoredRoomSlug(),
      participantId,
      d,
    );

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      socket_role: "control",
      id: participantId,
      name: identifyData.name,
      username: identifyData.username,
      display_name: identifyData.displayName ?? null,
      avatar_url: identifyData.avatarUrl,
      avatar_display: identifyData.avatarDisplay ?? null,
      clerk_user_id: d.clerk_user_id,
      stream_preview_url: null,
      self_mute: true,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      spatial_audio_enabled: false,
      spatial_audio_high_fidelity: false,
      suppress: false,
      status: identifyData.status,
      tracks: [],
      last_heartbeat: Date.now(),
      seq: 0,
      subscribed_channels: [],
    subscribed_servers: [],
    };

    const roomScopeId = await this.getStoredRoomSlug() ?? "";
    await this.syncRtcRoomSharedCallStateMirror(meetingRoom);
    await runRtcRoomControlIdentifyFlow(
      this.createRtcRoomControlPipelineBridge(meetingRoom),
      ws,
      nextAttachment,
      identifyData,
      roomScopeId,
      this.persistRtcRoomControlAttachmentSyncSnapshotAndRehydrate.bind(this, meetingRoom),
      (session) => session.clerk_user_id
        ? this.findRtcRoomPendingIncomingCall(session.clerk_user_id)
        : null,
    );
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlHeartbeat(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
  ) {
    const currentAttachment = this.readRtcRoomCommittedControlAttachment(ws);
    if (!currentAttachment) {
      this.sendRtcRoomControlMessage(ws, RTC_CONTROL_HEARTBEAT_ACK_OP, { seq: 0 });
      return true;
    }

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      last_heartbeat: Date.now(),
      seq: (currentAttachment.seq ?? 0) + 1,
    };

    await runRtcRoomControlHeartbeatFlow(
      this.createRtcRoomControlPipelineBridge(meetingRoom),
      ws,
      nextAttachment,
      this.persistRtcRoomControlAttachmentAndRehydrate.bind(this, meetingRoom),
    );
    this.sendRtcRoomControlMessage(ws, RTC_CONTROL_HEARTBEAT_ACK_OP, { seq: nextAttachment.seq });
    await this.persistMeetingRoomPendingControlBatch(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlResume(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d: ControlResumePayload,
  ) {
    const beforeVoiceSnapshot = await this.readCurrentSharedRtcVoiceAuthoritySnapshot();
    const storedAttachment = await this.readStoredRtcRoomControlSessionAttachment(d.session_id);
    if (!storedAttachment) {
      this.sendRtcRoomControlError(
        ws,
        RTC_CONTROL_SESSION_INVALID_CODE,
        "Session not found for resume",
      );
      return true;
    }

    const disconnectedAt = await this.ctx.storage.get<number>(`${RESUME_EXPIRY_KEY_PREFIX}${d.session_id}`);
    if (
      typeof disconnectedAt === "number"
      && Number.isFinite(disconnectedAt)
      && !isReconnectWithinGrace(disconnectedAt, Date.now(), RTC_RECONNECT_GRACE_MS)
    ) {
      await this.ctx.storage.delete([
        `${RESUME_SESSION_KEY_PREFIX}${d.session_id}`,
        `${RESUME_EXPIRY_KEY_PREFIX}${d.session_id}`,
      ]);
      await this.syncMeetingRoomControlAuthoritySnapshot();
      this.sendRtcRoomControlError(
        ws,
        RTC_CONTROL_SESSION_INVALID_CODE,
        "Session expired for resume",
      );
      return true;
    }

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...storedAttachment,
      socket_role: "control",
      last_heartbeat: Date.now(),
    };

    await this.ctx.storage.delete(`${RESUME_EXPIRY_KEY_PREFIX}${d.session_id}`);
    const roomScopeId = await this.getStoredRoomSlug() ?? "";
    await runRtcRoomControlResumeFlow(
      this.createRtcRoomControlPipelineBridge(meetingRoom),
      ws,
      nextAttachment,
      () => fetchRtcRoomVoiceCredentials(
        this.env,
        roomScopeId,
        nextAttachment.id,
        typeof nextAttachment.clerk_user_id === "string" ? nextAttachment.clerk_user_id : undefined,
      ),
      roomScopeId,
      this.persistRtcRoomControlAttachmentSyncSnapshotAndRehydrate.bind(this, meetingRoom),
    );
    const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    if (nextAttachment.clerk_user_id) {
      this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
        clerkUserId: nextAttachment.clerk_user_id,
        beforeVoiceSnapshot,
        afterControlSnapshot,
        rebroadcastCurrentChannel: true,
      });
    }
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlRefreshVoiceCredentials(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
  ) {
    const currentAttachment = this.readRtcRoomCommittedControlAttachment(ws);
    if (!currentAttachment) return false;

    const credentials = await fetchRtcRoomVoiceCredentials(
      this.env,
      await this.getStoredRoomSlug(),
      currentAttachment.id,
      typeof currentAttachment.clerk_user_id === "string" ? currentAttachment.clerk_user_id : undefined,
    );

    await this.syncMeetingRoomControlAuthoritySnapshot();
    runRtcRoomRefreshVoiceCredentialsFlow(
      this.createRtcRoomControlPipelineBridge(meetingRoom),
      ws,
      currentAttachment,
      credentials,
      await this.getStoredRoomSlug() ?? "",
      async (targetWs, attachment) => {
        meetingRoom.mirrorRtcRoomControlSession(targetWs, attachment);
        return attachment;
      },
    );
    return true;
  }

  private async handleRtcRoomControlVoiceChannelJoin(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d: ControlVoiceChannelJoinPayload,
  ) {
    if (!d.channel_id) return false;

    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    const {
      controlAuthoritySnapshot: beforeControlSnapshot,
      voiceAuthoritySnapshot: beforeVoiceSnapshot,
    } = await this.readCurrentSharedRtcAuthorityState();

    const previousChannelId =
      typeof currentAttachment.voice_channel_id === "string" && currentAttachment.voice_channel_id
        ? currentAttachment.voice_channel_id
        : undefined;
    const candidateStartedAt = this.normalizeRtcRoomVoiceChannelStartedAt(d.started_at);
    const existingJoinedAt =
      typeof currentAttachment.voice_joined_at === "number" && Number.isFinite(currentAttachment.voice_joined_at)
        ? currentAttachment.voice_joined_at
        : undefined;
    const joiningSameChannel = previousChannelId === d.channel_id;
    const voiceJoinedAt = resolveRtcRoomVoiceJoinedAt(d.channel_id, {
      candidateJoinedAt: candidateStartedAt,
      existingJoinedAt: joiningSameChannel ? existingJoinedAt : undefined,
      controlAuthoritySnapshot: beforeControlSnapshot,
    });

    const nextAttachmentBase: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      voice_channel_id: d.channel_id,
      voice_joined_at: voiceJoinedAt,
      self_mute: d.self_mute ?? true,
    };
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = joiningSameChannel
      ? nextAttachmentBase
      : clearRtcRoomVoiceMediaFlags(nextAttachmentBase);

    const nextSession = await this.persistRtcRoomControlAttachmentAndRehydrate(
      meetingRoom,
      ws,
      nextAttachment,
    );
    if (!nextSession) return false;

    const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    if (nextSession.clerk_user_id) {
      this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
        clerkUserId: nextSession.clerk_user_id,
        beforeVoiceSnapshot,
        afterControlSnapshot,
        rebroadcastCurrentChannel: true,
        allowImplicitCallAccept: true,
      });
    }
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlVoiceStateUpdate(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d: ControlVoiceStateUpdatePayload,
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
    };

    if (d.self_mute !== undefined) nextAttachment.self_mute = d.self_mute;
    if (d.self_deaf !== undefined) nextAttachment.self_deaf = d.self_deaf;
    if (d.self_video !== undefined) nextAttachment.self_video = d.self_video;
    if (d.self_stream !== undefined) nextAttachment.self_stream = d.self_stream;
    if (d.self_stream_audio !== undefined) nextAttachment.self_stream_audio = d.self_stream_audio;
    if (d.stream_preview_url !== undefined) nextAttachment.stream_preview_url = d.stream_preview_url;
    if (d.spatial_audio_enabled !== undefined) nextAttachment.spatial_audio_enabled = d.spatial_audio_enabled;
    if (d.spatial_audio_high_fidelity !== undefined) {
      nextAttachment.spatial_audio_high_fidelity = d.spatial_audio_high_fidelity;
    }

    await runRtcRoomControlVoiceStateUpdateFlow(
      this.createRtcRoomControlPipelineBridge(meetingRoom),
      ws,
      nextAttachment,
      await this.getStoredRoomSlug() ?? "",
      d.spatial_audio_state,
      this.persistRtcRoomControlAttachmentAndRehydrate.bind(this, meetingRoom),
    );
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlPresenceUpdate(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlPresenceUpdatePayload,
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    if (!d || !["online", "idle", "dnd", "offline"].includes(d.status)) return true;

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      status: d.status,
    };

    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    const postWriteEffects = this.createRtcRoomSharedControlPostWriteEffectsAdapter(meetingRoom);
    if (postWriteEffects) {
      applyRtcRoomPresenceUpdate(postWriteEffects, nextAttachment, d.status);
    }
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlChannelSubscribe(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlChannelSubscribePayload,
  ) {
    const currentAttachment = this.readRtcRoomCommittedControlAttachment(ws);
    if (!currentAttachment) return false;
    if (!d?.channel_id) return true;

    const subscribedChannels = Array.isArray(currentAttachment.subscribed_channels)
      ? currentAttachment.subscribed_channels
      : [];
    const alreadySubscribed = subscribedChannels.includes(d.channel_id);
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      subscribed_channels: alreadySubscribed
        ? subscribedChannels
        : [...subscribedChannels, d.channel_id],
    };

    if (!alreadySubscribed) {
      await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    }
    const postWriteEffects = this.createRtcRoomSharedControlPostWriteEffectsAdapter(meetingRoom);
    if (postWriteEffects) {
      applyRtcRoomChannelSubscribe(
        postWriteEffects,
        ws,
        alreadySubscribed ? currentAttachment : nextAttachment,
        d,
        this.listRtcRoomOnlineClerkUserIds(),
      );
    }
    if (!alreadySubscribed) {
      await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    }
    return true;
  }

  private async handleRtcRoomControlChannelUnsubscribe(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlChannelSubscribePayload,
  ) {
    const currentAttachment = this.readRtcRoomCommittedControlAttachment(ws);
    if (!currentAttachment) return false;
    if (!d?.channel_id) return true;

    const subscribedChannels = Array.isArray(currentAttachment.subscribed_channels)
      ? currentAttachment.subscribed_channels
      : [];
    const hadSubscription = subscribedChannels.includes(d.channel_id);
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      subscribed_channels: subscribedChannels.filter((channelId) => channelId !== d.channel_id),
    };

    if (hadSubscription) {
      await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    }
    const postWriteEffects = this.createRtcRoomSharedControlPostWriteEffectsAdapter(meetingRoom);
    if (postWriteEffects) {
      applyRtcRoomChannelUnsubscribe(
        postWriteEffects,
        ws,
        hadSubscription ? nextAttachment : currentAttachment,
        d,
      );
    }
    if (hadSubscription) {
      await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    }
    return true;
  }

  private async handleRtcRoomControlServerSubscribe(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlServerSubscribePayload,
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    if (!d?.server_id) return true;

    const subscribedServers = Array.isArray(currentAttachment.subscribed_servers)
      ? currentAttachment.subscribed_servers
      : [];
    if (subscribedServers.includes(d.server_id)) {
      return true;
    }

    try {
      const allowed = await this.canRtcRoomServerSubscribe(d.server_id, currentAttachment.clerk_user_id);
      if (!allowed) {
        rtcRoomLog.info(
          `ServerSubscribe denied: ${currentAttachment.name} is not member of ${d.server_id}`,
        );
        return true;
      }
    } catch (error) {
      rtcRoomLog.error("ServerSubscribe D1 error:", error);
      return true;
    }

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      subscribed_servers: [...subscribedServers, d.server_id],
    };

    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    const postWriteEffects = this.createRtcRoomSharedControlPostWriteEffectsAdapter(meetingRoom);
    if (postWriteEffects) {
      applyRtcRoomServerSubscribe(postWriteEffects, ws, nextAttachment, d);
    }
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlCallInitiate(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlCallInitiatePayload,
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    if (!d?.target_user_id || !d.channel_id) return true;
    const {
      controlAuthoritySnapshot: beforeControlSnapshot,
      voiceAuthoritySnapshot: beforeVoiceSnapshot,
    } = await this.readCurrentSharedRtcAuthorityState();
    const { pendingCalls, acceptedCalls } = await this.syncRtcRoomSharedCallStateMirror(meetingRoom);
    const callerId = currentAttachment.clerk_user_id;
    const calleeId = d.target_user_id;
    if (callerId === calleeId) {
      this.sendRtcRoomCallRingStop(ws, null, "invalid");
      return true;
    }
    if (findPendingCallForUserValue(pendingCalls, callerId)) {
      this.sendRtcRoomCallRingStop(ws, null, "busy");
      return true;
    }
    if (pendingCalls.has(calleeId)) {
      this.sendRtcRoomCallRingStop(ws, null, "busy");
      return true;
    }

    try {
      const rel = await this.env.DB.prepare(
        "SELECT type FROM relationships WHERE user_id = ? AND target_user_id = ?",
      ).bind(calleeId, callerId).first<{ type: number }>();
      if (rel?.type === 1) {
        this.sendRtcRoomCallRingStop(ws, null, "unavailable");
        return true;
      }
    } catch (error) {
      rtcRoomLog.error?.("Call relationship check failed:", error);
    }

    const calleeWs = this.findRtcRoomControlSocketByClerkUserId(calleeId);
    const calleeAttachment = calleeWs
      ? this.readRtcRoomCommittedControlAttachment(calleeWs)
      : null;
    if (!calleeAttachment) {
      this.sendRtcRoomCallRingStop(ws, null, "unavailable");
      return true;
    }

    const callId = crypto.randomUUID();
    const sortedIds = [callerId, calleeId].sort();
    const pending: PendingCall = {
      callId,
      callerId,
      calleeId,
      channelId: d.channel_id,
      voiceRoomId: `dm-call-${sortedIds[0]}-${sortedIds[1]}`,
      expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
      callerName: currentAttachment.name,
      callerUsername: currentAttachment.username ?? currentAttachment.name,
      callerDisplayName: currentAttachment.display_name ?? currentAttachment.name,
      callerAvatar: currentAttachment.avatar_url ?? undefined,
      calleeName: calleeAttachment.name,
      calleeUsername: calleeAttachment.username ?? calleeAttachment.name,
      calleeDisplayName: calleeAttachment.display_name ?? calleeAttachment.name,
      calleeAvatar: calleeAttachment.avatar_url ?? undefined,
    };
    pendingCalls.set(calleeId, pending);

    const previousChannelId =
      typeof currentAttachment.voice_channel_id === "string" && currentAttachment.voice_channel_id
        ? currentAttachment.voice_channel_id
        : undefined;
    const nextAttachmentBase: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      voice_channel_id: pending.channelId,
      voice_joined_at: resolveRtcRoomVoiceJoinedAt(pending.channelId, {
        controlAuthoritySnapshot: beforeControlSnapshot,
      }),
    };
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = previousChannelId === pending.channelId
      ? nextAttachmentBase
      : clearRtcRoomVoiceMediaFlags(nextAttachmentBase);

    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    this.broadcastRtcRoomIncomingPendingCall(pending);
    this.broadcastRtcRoomOutgoingPendingCallRinging(pending);
    const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
      clerkUserId: currentAttachment.clerk_user_id,
      beforeVoiceSnapshot,
      afterControlSnapshot,
      rebroadcastCurrentChannel: true,
    });
    await this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls, {
      pendingChanged: true,
      acceptedChanged: false,
    });
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlCallAccept(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlCallAcceptPayload,
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    if (!d?.call_id) return true;
    const {
      controlAuthoritySnapshot: beforeControlSnapshot,
      voiceAuthoritySnapshot: beforeVoiceSnapshot,
    } = await this.readCurrentSharedRtcAuthorityState();
    const { pendingCalls, acceptedCalls } = await this.syncRtcRoomSharedCallStateMirror(meetingRoom);
    if (hasAcceptedCallValue(acceptedCalls, d.call_id)) {
      await this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls, {
        pendingChanged: false,
        acceptedChanged: true,
      });
      return true;
    }

    const pending = preparePendingCallAcceptByCallIdValue(
      pendingCalls,
      acceptedCalls,
      currentAttachment.clerk_user_id,
      d.call_id,
      ACCEPTED_CALL_TTL_MS,
    );
    if (!pending) {
      this.sendRtcRoomCallRingStop(ws, d.call_id, "expired");
      await this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls, {
        pendingChanged: false,
        acceptedChanged: true,
      });
      return true;
    }

    const previousChannelId =
      typeof currentAttachment.voice_channel_id === "string" && currentAttachment.voice_channel_id
        ? currentAttachment.voice_channel_id
        : undefined;
    const nextAttachmentBase: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      voice_channel_id: pending.channelId,
      voice_joined_at: resolveRtcRoomVoiceJoinedAt(pending.channelId, {
        controlAuthoritySnapshot: beforeControlSnapshot,
      }),
    };
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = previousChannelId === pending.channelId
      ? nextAttachmentBase
      : clearRtcRoomVoiceMediaFlags(nextAttachmentBase);

    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    this.broadcastRtcRoomPendingCallStop(pending, "accepted");
    const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
      clerkUserId: currentAttachment.clerk_user_id,
      beforeVoiceSnapshot,
      afterControlSnapshot,
      rebroadcastCurrentChannel: true,
    });
    await this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls);
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlCallDecline(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlCallAcceptPayload,
  ) {
    if (!d?.call_id) return true;
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    const { pendingCalls, acceptedCalls } = await this.syncRtcRoomSharedCallStateMirror(meetingRoom);
    const pending = pendingCalls.get(currentAttachment.clerk_user_id);
    if (!pending || pending.callId !== d.call_id) return true;

    pendingCalls.delete(currentAttachment.clerk_user_id);
    this.broadcastRtcRoomPendingCallStop(pending, "declined");
    await this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls, {
      pendingChanged: true,
      acceptedChanged: false,
    });
    await this.persistMeetingRoomPendingControlBatch(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlCallEnd(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlCallEndPayload,
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    if (!d?.call_id) return true;
    const beforeVoiceSnapshot = await this.readCurrentSharedRtcVoiceAuthoritySnapshot();
    const { pendingCalls, acceptedCalls } = await this.syncRtcRoomSharedCallStateMirror(meetingRoom);
    const pending = findPendingCallForUserValue(pendingCalls, currentAttachment.clerk_user_id);
    if (!pending) return true;
    pendingCalls.delete(pending.calleeId);

    const callerWs = this.findRtcRoomControlSocketByClerkUserId(pending.callerId);
    if (callerWs) {
      const callerAttachment = this.readRtcRoomCommittedControlAttachment(callerWs);
      if (callerAttachment) {
        const previousChannelId =
          typeof callerAttachment.voice_channel_id === "string" && callerAttachment.voice_channel_id
            ? callerAttachment.voice_channel_id
            : undefined;
        const nextAttachment: RtcRoomCommittedControlSessionAttachment = clearRtcRoomVoiceMediaFlags({
          ...callerAttachment,
          socket_role: "control",
          voice_channel_id: undefined,
          voice_joined_at: undefined,
        });
        const nextSession = await this.persistRtcRoomControlAttachmentAndRehydrate(
          meetingRoom,
          callerWs,
          nextAttachment,
        );
        if (previousChannelId && nextSession?.clerk_user_id) {
          const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
          this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
            clerkUserId: nextSession.clerk_user_id,
            beforeVoiceSnapshot,
            afterControlSnapshot,
          });
        }
      }
    }

    this.broadcastRtcRoomPendingCallStop(pending, "cancelled");
    await this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls, {
      pendingChanged: true,
      acceptedChanged: false,
    });
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlProfileRefresh(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment?.clerk_user_id) return false;
    if (consumeRtcRoomProfileRefreshCooldown(this.rtcRoomProfileRefreshCooldowns, currentAttachment.id) === false) {
      return true;
    }

    const verified = await fetchRtcRoomProfileRefreshData(this.env, currentAttachment.clerk_user_id);
    if (!verified) return true;

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      name: verified.name,
      username: verified.username,
      display_name: verified.displayName ?? null,
      avatar_url: verified.avatarUrl,
      avatar_display: verified.avatarDisplay ?? null,
    };

    await runRtcRoomControlProfileRefreshFlow(
      this.createRtcRoomControlPipelineBridge(meetingRoom),
      ws,
      nextAttachment,
      verified,
      this.persistRtcRoomControlAttachmentAndRehydrate.bind(this, meetingRoom),
    );
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlDisconnectLifecycle(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    options: {
      intentional: boolean;
      closeSocket?: boolean;
      closeCode?: number;
      closeReason?: string;
    },
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    const beforeVoiceSnapshot = await this.readCurrentSharedRtcVoiceAuthoritySnapshot();
    const sharedCallState =
      typeof currentAttachment.clerk_user_id === "string" && currentAttachment.clerk_user_id
        ? await this.syncRtcRoomSharedCallStateMirror(meetingRoom)
        : null;

    const previousChannelId =
      typeof currentAttachment.voice_channel_id === "string" && currentAttachment.voice_channel_id
        ? currentAttachment.voice_channel_id
        : undefined;
    const nextAttachmentBase: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
    };
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = options.intentional
      ? clearRtcRoomVoiceMediaFlags({
          ...nextAttachmentBase,
          voice_channel_id: undefined,
          voice_joined_at: undefined,
        })
      : nextAttachmentBase;
    const now = Date.now();
    this.rtcRoomProfileRefreshCooldowns.delete(currentAttachment.id);
    const disconnectCallCleanup =
      typeof currentAttachment.clerk_user_id === "string" && currentAttachment.clerk_user_id
        ? prepareDisconnectCallCleanupValue(
          sharedCallState?.pendingCalls ?? new Map<string, PendingCall>(),
          currentAttachment.clerk_user_id,
          "disconnected",
        )
        : null;

    if (options.intentional) {
      ws.serializeAttachment(nextAttachment);
    }

    await this.persistRtcRoomControlDisconnectState(nextAttachment, options.intentional, now);
    const disconnectEffects = this.createRtcRoomSharedControlDisconnectEffectsAdapter(meetingRoom);
    if (disconnectEffects) {
      applyRtcRoomControlDisconnectEffects(
        disconnectEffects,
        ws,
        currentAttachment,
        {
          intentional: options.intentional,
          closeSocket: options.closeSocket,
          closeCode: options.closeCode,
          closeReason: options.closeReason,
          emitLeaveBroadcast: !options.intentional,
        },
      );
    }
    if (disconnectCallCleanup) {
      this.applyRtcRoomDisconnectCallCleanup(disconnectCallCleanup);
      if (sharedCallState) {
        await this.persistRtcRoomSharedCallState(
          meetingRoom,
          sharedCallState.pendingCalls,
          sharedCallState.acceptedCalls,
          {
            pendingChanged: true,
            acceptedChanged: false,
            now,
          },
        );
      }
    }
    const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
      clerkUserId: currentAttachment.clerk_user_id,
      beforeVoiceSnapshot,
      afterControlSnapshot,
      rebroadcastCurrentChannel: !options.intentional,
    });
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private async handleRtcRoomControlVoiceChannelLeave(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    d?: ControlVoiceChannelLeavePayload,
  ) {
    const currentAttachment = this.readRtcRoomControlSessionAttachment(ws);
    if (!currentAttachment) return false;
    const beforeVoiceSnapshot = await this.readCurrentSharedRtcVoiceAuthoritySnapshot();

    const previousChannelId =
      typeof currentAttachment.voice_channel_id === "string" && currentAttachment.voice_channel_id
        ? currentAttachment.voice_channel_id
        : undefined;
    if (d?.channel_id && previousChannelId && previousChannelId !== d.channel_id) {
      return true;
    }
    if (!previousChannelId) return true;

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = clearRtcRoomVoiceMediaFlags({
      ...currentAttachment,
      socket_role: "control",
      voice_channel_id: undefined,
      voice_joined_at: undefined,
    });
    const nextSession = await this.persistRtcRoomControlAttachmentAndRehydrate(
      meetingRoom,
      ws,
      nextAttachment,
    );
    if (!nextSession) return false;

    const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    if (nextSession.clerk_user_id) {
      this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
        clerkUserId: nextSession.clerk_user_id,
        beforeVoiceSnapshot,
        afterControlSnapshot,
      });
    }
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
    return true;
  }

  private acceptRoomScopedControlWebSocket(url: URL): Response | null {
    const roomMatch = url.pathname.match(ROOM_SCOPED_CONTROL_PATH_RE);
    if (!roomMatch) return null;

    const gatewayVersion = parseInt(url.searchParams.get("v") ?? "1", 10);
    this.syncMeetingRoomMediaAuthoritySnapshot();
    this.persistRoomSlug(roomMatch[1]);
    this.getMeetingRoom().setRoomSlugFromRtcRoom(roomMatch[1]);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ socket_role: "control" } satisfies Pick<SocketRoleAttachment, "socket_role">);

    try {
      server.send(JSON.stringify({
        op: RTC_CONTROL_HELLO_OP,
        d: {
          heartbeat_interval: RTC_CONTROL_HEARTBEAT_INTERVAL_MS,
          gateway_version: gatewayVersion,
        },
      }));
    } catch {
      // Ignore races where the client disconnects during the opening handshake.
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptRoomScopedMediaWebSocket(url: URL): Response | null {
    const roomMatch = url.pathname.match(ROOM_SCOPED_MEDIA_PATH_RE);
    if (!roomMatch) return null;

    const gatewayVersion = parseInt(url.searchParams.get("v") ?? "1", 10);
    this.persistRoomSlug(roomMatch[1]);
    this.getRtcRoomMedia().setRoomSlugFromRtcRoom(roomMatch[1]);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ socket_role: "media" } satisfies Pick<SocketRoleAttachment, "socket_role">);

    try {
      server.send(JSON.stringify({
        op: RTC_MEDIA_HELLO_OP,
        d: {
          heartbeat_interval: RTC_VOICE_HEARTBEAT_INTERVAL_MS,
          gateway_version: gatewayVersion,
        },
      }));
    } catch {
      // Ignore races where the client disconnects during the opening handshake.
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private async tryHandleRtcRoomControlLifecycleMessage(
    meetingRoom: MeetingRoom,
    ws: WebSocket,
    rawMsg: string | ArrayBuffer,
  ) {
    if (typeof rawMsg !== "string") return false;
    const controlMeetingRoom = meetingRoom as unknown as RtcRoomMeetingRoomPersistenceBridge;

    try {
      const msg = JSON.parse(rawMsg) as { op?: number; d?: unknown };
      switch (msg.op) {
        case RTC_CONTROL_IDENTIFY_OP:
          return await this.handleRtcRoomControlIdentify(
            controlMeetingRoom,
            ws,
            msg.d as ControlIdentifyPayload,
          );
        case RTC_CONTROL_HEARTBEAT_OP:
          return await this.handleRtcRoomControlHeartbeat(
            controlMeetingRoom,
            ws,
          );
        case RTC_CONTROL_RESUME_OP:
          return await this.handleRtcRoomControlResume(
            controlMeetingRoom,
            ws,
            msg.d as ControlResumePayload,
          );
        case RTC_CONTROL_CLIENT_DISCONNECT_OP:
          return await this.handleRtcRoomControlDisconnectLifecycle(
            controlMeetingRoom,
            ws,
            {
              intentional: true,
              closeSocket: true,
              closeCode: 1000,
              closeReason: "Left room",
            },
          );
        case RTC_CONTROL_VOICE_STATE_UPDATE_OP:
          return await this.handleRtcRoomControlVoiceStateUpdate(
            controlMeetingRoom,
            ws,
            msg.d as ControlVoiceStateUpdatePayload,
          );
        case RTC_CONTROL_PRESENCE_UPDATE_OP:
          return await this.handleRtcRoomControlPresenceUpdate(
            controlMeetingRoom,
            ws,
            msg.d as ControlPresenceUpdatePayload | undefined,
          );
        case RTC_CONTROL_CHANNEL_SUBSCRIBE_OP:
          return await this.handleRtcRoomControlChannelSubscribe(
            controlMeetingRoom,
            ws,
            msg.d as ControlChannelSubscribePayload | undefined,
          );
        case RTC_CONTROL_CHANNEL_UNSUBSCRIBE_OP:
          return await this.handleRtcRoomControlChannelUnsubscribe(
            controlMeetingRoom,
            ws,
            msg.d as ControlChannelSubscribePayload | undefined,
          );
        case RTC_CONTROL_PROFILE_REFRESH_OP:
          return await this.handleRtcRoomControlProfileRefresh(
            controlMeetingRoom,
            ws,
          );
        case RTC_CONTROL_VOICE_CHANNEL_JOIN_OP:
          return await this.handleRtcRoomControlVoiceChannelJoin(
            controlMeetingRoom,
            ws,
            msg.d as ControlVoiceChannelJoinPayload,
          );
        case RTC_CONTROL_VOICE_CHANNEL_LEAVE_OP:
          return await this.handleRtcRoomControlVoiceChannelLeave(
            controlMeetingRoom,
            ws,
            msg.d as ControlVoiceChannelLeavePayload | undefined,
          );
        case RTC_CONTROL_SERVER_SUBSCRIBE_OP:
          return await this.handleRtcRoomControlServerSubscribe(
            controlMeetingRoom,
            ws,
            msg.d as ControlServerSubscribePayload | undefined,
          );
        case RTC_CONTROL_CALL_INITIATE_OP:
          return await this.handleRtcRoomControlCallInitiate(
            controlMeetingRoom,
            ws,
            msg.d as ControlCallInitiatePayload | undefined,
          );
        case RTC_CONTROL_CALL_ACCEPT_OP:
          return await this.handleRtcRoomControlCallAccept(
            controlMeetingRoom,
            ws,
            msg.d as ControlCallAcceptPayload | undefined,
          );
        case RTC_CONTROL_CALL_DECLINE_OP:
          return await this.handleRtcRoomControlCallDecline(
            controlMeetingRoom,
            ws,
            msg.d as ControlCallAcceptPayload | undefined,
          );
        case RTC_CONTROL_CALL_END_OP:
          return await this.handleRtcRoomControlCallEnd(
            controlMeetingRoom,
            ws,
            msg.d as ControlCallEndPayload | undefined,
          );
        case RTC_CONTROL_REFRESH_VOICE_CREDENTIALS_OP:
          return await this.handleRtcRoomControlRefreshVoiceCredentials(
            controlMeetingRoom,
            ws,
          );
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  private collectActiveMediaParticipantIds() {
    const participantIds = new Set<string>();

    for (const ws of this.ctx.getWebSockets()) {
      if (getRtcRoomSocketRole(ws) !== "media") continue;
      const participantId = getRtcRoomSocketParticipantId(ws);
      if (participantId) {
        participantIds.add(participantId);
      }
    }

    return participantIds;
  }

  private readSharedRtcMediaAuthoritySnapshot(
    now = Date.now(),
    allowBootstrap = true,
  ): SharedRtcMediaAuthoritySnapshot {
    const buildSnapshot = (): SharedRtcMediaAuthoritySnapshot => {
      const liveParticipantIds = this.collectActiveMediaParticipantIds();
      const participantRows = this.ctx.storage.sql.exec(
        `SELECT
           p.id,
           p.clerk_user_id,
           p.pull_session_id,
           p.push_session_cam,
           p.push_session_screen,
           r.disconnected_at
         FROM participants p
         LEFT JOIN pending_reconnects r ON r.participant_id = p.id`,
      );

      const countRow = [...this.ctx.storage.sql.exec(
        "SELECT COUNT(*) AS demo_chat_message_count FROM demo_chat_messages",
      )][0] as { demo_chat_message_count?: number } | undefined;

      return buildSharedRtcMediaAuthoritySnapshotValue({
        capturedAt: now,
        participantRows,
        liveParticipantIds,
        mediaReconnectGraceMs: RTC_MEDIA_RECONNECT_GRACE_MS,
        demoChatMessageCount: countRow?.demo_chat_message_count ?? 0,
      });
    };

    try {
      return buildSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!allowBootstrap || !/no such table/i.test(message)) {
        throw error;
      }

      // Unified rooms store RTC media state in RtcRoomMedia's SQLite schema. If
      // snapshot reads race ahead of media construction, bootstrap the schema
      // once and then answer from RtcRoom's own storage view.
      this.getRtcRoomMedia();
      return this.readSharedRtcMediaAuthoritySnapshot(now, false);
    }
  }

  private tryReadSharedRtcMediaAuthoritySnapshot(now = Date.now()) {
    try {
      return this.readSharedRtcMediaAuthoritySnapshot(now);
    } catch {
      return null;
    }
  }

  private syncMeetingRoomMediaAuthoritySnapshot(
    now = Date.now(),
    snapshot = this.tryReadSharedRtcMediaAuthoritySnapshot(now),
  ) {
    const meetingRoom = this.getMeetingRoom();
    meetingRoom.setSharedRtcMediaAuthoritySnapshot(snapshot);
    this.syncRtcRoomCanonicalSessionRecords(this.latestSharedRtcControlAuthoritySnapshot, now);
    return snapshot;
  }

  private async readCurrentSharedRtcVoiceAuthoritySnapshot(now = Date.now()) {
    const controlAuthoritySnapshot = await this.tryReadSharedRtcControlAuthoritySnapshot(now);
    return buildSharedRtcVoiceAuthoritySnapshot(
      controlAuthoritySnapshot,
      this.tryReadSharedRtcMediaAuthoritySnapshot(now),
    );
  }

  private applyRtcRoomSharedVoiceTransitionEffects(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    options: {
      clerkUserId: string;
      beforeVoiceSnapshot?: SharedRtcVoiceAuthoritySnapshot | null;
      afterControlSnapshot?: SharedRtcControlAuthoritySnapshot | null;
      rebroadcastCurrentChannel?: boolean;
      allowImplicitCallAccept?: boolean;
    },
  ) {
    const {
      afterVoiceSnapshot,
      changedChannelIds,
      abandonedPending,
      acceptedPending,
      nextPendingCalls,
      nextAcceptedCalls,
    } = planRtcRoomSharedVoiceTransition({
      clerkUserId: options.clerkUserId,
      beforeVoiceSnapshot: options.beforeVoiceSnapshot,
      afterControlSnapshot: options.afterControlSnapshot,
      mediaAuthoritySnapshot: this.tryReadSharedRtcMediaAuthoritySnapshot(
        options.afterControlSnapshot?.capturedAt ?? Date.now(),
      ),
      rebroadcastCurrentChannel: options.rebroadcastCurrentChannel,
      allowImplicitCallAccept: options.allowImplicitCallAccept,
      pendingCalls: this.sharedRtcPendingCalls,
      acceptedCalls: this.sharedRtcAcceptedCalls,
      acceptedCallTtlMs: ACCEPTED_CALL_TTL_MS,
    });

    if (abandonedPending && nextPendingCalls) {
      this.sharedRtcPendingCalls = nextPendingCalls;
      this.broadcastRtcRoomPendingCallStop(abandonedPending, "abandoned");
    }

    if (acceptedPending && nextPendingCalls && nextAcceptedCalls) {
      this.sharedRtcPendingCalls = nextPendingCalls;
      this.sharedRtcAcceptedCalls = nextAcceptedCalls;
      this.broadcastRtcRoomPendingCallStop(acceptedPending, "accepted");
    }

    if (nextPendingCalls || nextAcceptedCalls) {
      this.ctx.waitUntil(this.persistRtcRoomSharedCallState(
        meetingRoom,
        nextPendingCalls ?? new Map(this.sharedRtcPendingCalls ?? []),
        nextAcceptedCalls ?? new Map(this.sharedRtcAcceptedCalls ?? []),
        {
          pendingChanged: Boolean(nextPendingCalls),
          acceptedChanged: Boolean(nextAcceptedCalls),
        },
      ));
    }

    this.setRtcRoomSharedVoiceAuthoritySnapshot(afterVoiceSnapshot);

    if (changedChannelIds.size > 0) {
      this.applyRtcRoomSharedProjectionChannelUpdates(
        meetingRoom,
        changedChannelIds,
        afterVoiceSnapshot,
      );
      return true;
    }

    return false;
  }

  private applyRtcRoomSharedProjectionChannelUpdates(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    changedChannelIds: Iterable<string>,
    authoritativeVoiceSnapshot?: SharedRtcVoiceAuthoritySnapshot | null,
  ) {
    const uniqueChannelIds = new Set(changedChannelIds);
    if (uniqueChannelIds.size === 0) return false;

    const staleChannelIds = new Set<string>();
    for (const channelId of uniqueChannelIds) {
      if (!authoritativeVoiceSnapshot?.channels.has(channelId)) {
        staleChannelIds.add(channelId);
      }
    }

    if (staleChannelIds.size > 0) {
      meetingRoom.clearRtcRoomSharedProjectionChannels?.(staleChannelIds);
    }
    const updateRtcRoomSharedProjectedChannelIds = this.updateRtcRoomSharedProjectedChannelIds
      ?? RtcRoom.prototype.updateRtcRoomSharedProjectedChannelIds;
    updateRtcRoomSharedProjectedChannelIds.call(this, uniqueChannelIds, authoritativeVoiceSnapshot);
    const queueSharedVoiceBroadcasts = this.queueRtcRoomSharedVoiceStateBroadcasts
      ?? RtcRoom.prototype.queueRtcRoomSharedVoiceStateBroadcasts;
    return queueSharedVoiceBroadcasts.call(
      this,
      meetingRoom,
      uniqueChannelIds,
      authoritativeVoiceSnapshot,
    );
  }

  private async reconcileRtcRoomSharedVoiceProjection(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    changedChannelIds: Iterable<string> = [],
  ) {
    const authoritativeVoiceSnapshot = await this.readCurrentSharedRtcVoiceAuthoritySnapshot();
    const allChannelIds = new Set<string>(changedChannelIds);
    const listRtcRoomSharedProjectedChannelIds = this.listRtcRoomSharedProjectedChannelIds
      ?? RtcRoom.prototype.listRtcRoomSharedProjectedChannelIds;

    for (const channelId of authoritativeVoiceSnapshot?.channels.keys() ?? []) {
      allChannelIds.add(channelId);
    }
    for (const channelId of listRtcRoomSharedProjectedChannelIds.call(this)) {
      allChannelIds.add(channelId);
    }

    if (allChannelIds.size === 0) return false;
    const setVoiceSnapshot = this.setRtcRoomSharedVoiceAuthoritySnapshot
      ?? RtcRoom.prototype.setRtcRoomSharedVoiceAuthoritySnapshot;
    setVoiceSnapshot.call(this, authoritativeVoiceSnapshot);
    return this.applyRtcRoomSharedProjectionChannelUpdates(
      meetingRoom,
      allChannelIds,
      authoritativeVoiceSnapshot,
    );
  }

  private async readUnifiedMediaSessionCheck(
    parsed: NonNullable<ReturnType<typeof parseVoiceSessionCheckRequest>>,
  ): Promise<VoiceSessionCheckResponse> {
    const readFromRtcRoomState = () => {
      const mediaAuthoritySnapshot = this.readSharedRtcMediaAuthoritySnapshot();
      let userMatchedScope = false;
      let exactSessionMatched = false;

      for (const row of this.ctx.storage.sql.exec(
        "SELECT id FROM participants WHERE clerk_user_id = ?",
        parsed.userId,
      )) {
        const participantId = row.id as string | null;
        if (!participantId || !mediaAuthoritySnapshot.liveParticipantIds.has(participantId)) continue;

        userMatchedScope = true;
        if (parsed.sessionId && participantId === parsed.sessionId) {
          exactSessionMatched = true;
          break;
        }
      }

      return resolveVoiceSessionCheckResponse(
        userMatchedScope,
        exactSessionMatched,
        parsed.requireExactSession,
      ) satisfies VoiceSessionCheckResponse;
    };

    if (parsed.requireChannelMatch) {
      const expectedRoomSuffix = `-${parsed.channelId}`;
      const roomSlug = await this.getStoredRoomSlug();
      if (!roomSlug || !roomSlug.endsWith(expectedRoomSuffix)) {
        return resolveVoiceSessionCheckResponse(
          false,
          false,
          parsed.requireExactSession,
        ) satisfies VoiceSessionCheckResponse;
      }
    }

    return readFromRtcRoomState();
  }

  private async handleUnifiedVoiceSessionCheck(request: Request): Promise<Response> {
    try {
      const body = await request.json() as VoiceSessionCheckRequest;
      const parsed = parseVoiceSessionCheckRequest(body);
      if (!parsed) {
        return Response.json({ error: "Missing voice session lookup fields" }, { status: 400 });
      }

      return Response.json(
        await this.readUnifiedMediaSessionCheck(parsed) satisfies VoiceSessionCheckResponse,
      );
    } catch (error) {
      return Response.json({ error: `Voice session check unavailable: ${error}` }, { status: 503 });
    }
  }

  private hasControlSockets() {
    return this.ctx.getWebSockets().some((ws) => getRtcRoomSocketRole(ws) === "control");
  }

  private hasMediaSockets() {
    return this.ctx.getWebSockets().some((ws) => getRtcRoomSocketRole(ws) === "media");
  }

  private async hasPendingControlAlarmWork() {
    const [resumableExpiryEntries, pendingPresenceEntries, legacyResumableExpiry, pendingCalls, acceptedCallExpiry] = await Promise.all([
      this.ctx.storage.list<number>({ prefix: RESUME_EXPIRY_KEY_PREFIX }),
      this.ctx.storage.list({ prefix: PRESENCE_PENDING_KEY_PREFIX }),
      this.ctx.storage.get<Record<string, number>>("resumableSessionExpiry"),
      this.ctx.storage.get<Record<string, unknown>>("pendingCalls"),
      this.ctx.storage.get<Record<string, number>>("acceptedCallExpiry"),
    ]);
    return Boolean(
      resumableExpiryEntries.size > 0 ||
      pendingPresenceEntries.size > 0 ||
      (legacyResumableExpiry && Object.keys(legacyResumableExpiry).length > 0) ||
      (pendingCalls && Object.keys(pendingCalls).length > 0) ||
      (acceptedCallExpiry && Object.keys(acceptedCallExpiry).length > 0),
    );
  }

  private hasPendingMediaAlarmWork(snapshot?: SharedRtcMediaAuthoritySnapshot | null) {
    const mediaAuthoritySnapshot = snapshot ?? (() => {
      try {
        return this.readSharedRtcMediaAuthoritySnapshot();
      } catch {
        return null;
      }
    })();
    return Boolean(
      mediaAuthoritySnapshot &&
      (mediaAuthoritySnapshot.participantCount > 0 ||
        mediaAuthoritySnapshot.pendingReconnectCount > 0 ||
        mediaAuthoritySnapshot.demoChatMessageCount > 0),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/voice-session-check") {
      return this.handleUnifiedVoiceSessionCheck(request);
    }
    const controlWebSocketResponse = this.acceptRoomScopedControlWebSocket(url);
    if (controlWebSocketResponse) {
      return controlWebSocketResponse;
    }
    const mediaWebSocketResponse = this.acceptRoomScopedMediaWebSocket(url);
    if (mediaWebSocketResponse) {
      return mediaWebSocketResponse;
    }
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer) {
    const role = getRtcRoomSocketRole(ws) ?? inferRtcRoomSocketRole(rawMsg);
    if (role === "media") {
      const result = await this.getRtcRoomMedia().webSocketMessage(ws, rawMsg);
      if (isRtcRoomMediaIdentifyMessage(rawMsg)) {
        await this.syncMeetingRoomMediaState(getRtcRoomSocketClerkUserId(ws));
      }
      return result;
    }
    this.syncMeetingRoomMediaAuthoritySnapshot();
    const meetingRoom = this.getMeetingRoom();
    if (await this.tryHandleRtcRoomControlLifecycleMessage(meetingRoom, ws, rawMsg)) {
      return;
    }
    return meetingRoom.webSocketMessage(ws, rawMsg);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const role = getRtcRoomSocketRole(ws);
    if (role === "media") {
      const clerkUserId = getRtcRoomSocketClerkUserId(ws);
      await this.getRtcRoomMedia().webSocketClose(ws, code, reason);
      await this.syncMeetingRoomMediaState(clerkUserId);
      return;
    }
    this.syncMeetingRoomMediaAuthoritySnapshot();
    const meetingRoom = this.getMeetingRoom() as unknown as RtcRoomMeetingRoomPersistenceBridge;
    await this.handleRtcRoomControlDisconnectLifecycle(meetingRoom, ws, {
      intentional: false,
      closeSocket: false,
      closeCode: code,
      closeReason: reason,
    });
  }

  async webSocketError(ws: WebSocket) {
    const role = getRtcRoomSocketRole(ws);
    if (role === "media") {
      const clerkUserId = getRtcRoomSocketClerkUserId(ws);
      await this.getRtcRoomMedia().webSocketError(ws);
      await this.syncMeetingRoomMediaState(clerkUserId);
      return;
    }
    this.syncMeetingRoomMediaAuthoritySnapshot();
    const meetingRoom = this.getMeetingRoom() as unknown as RtcRoomMeetingRoomPersistenceBridge;
    await this.handleRtcRoomControlDisconnectLifecycle(meetingRoom, ws, {
      intentional: false,
      closeSocket: false,
    });
  }

  async alarm() {
    const initialMediaAuthoritySnapshot = this.tryReadSharedRtcMediaAuthoritySnapshot();
    const shouldRunMeeting = this.hasControlSockets() || await this.hasPendingControlAlarmWork();
    const shouldRunVoice = this.hasMediaSockets() || this.hasPendingMediaAlarmWork(initialMediaAuthoritySnapshot);

    if (!shouldRunVoice && !shouldRunMeeting) return;

    const failures: unknown[] = [];
    let voiceSucceeded = false;
    let meetingSucceeded = false;

    if (shouldRunVoice) {
      try {
        await this.getRtcRoomMedia().alarm();
        voiceSucceeded = true;
      } catch (err) {
        failures.push(err);
      }
    }

    let mediaAuthoritySnapshot = initialMediaAuthoritySnapshot;
    if (shouldRunVoice) {
      mediaAuthoritySnapshot = this.tryReadSharedRtcMediaAuthoritySnapshot();
    }
    if (shouldRunMeeting || voiceSucceeded) {
      mediaAuthoritySnapshot = this.syncMeetingRoomMediaAuthoritySnapshot(Date.now(), mediaAuthoritySnapshot);
    }

    if (shouldRunMeeting) {
      try {
        const meetingRoom = this.getMeetingRoom() as unknown as RtcRoomMeetingRoomPersistenceBridge;
        const now = Date.now();
        await (
          this as unknown as {
            pruneRtcRoomZombieControlSockets?: (
              meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
              now?: number,
              ) => Promise<boolean>;
          }
        ).pruneRtcRoomZombieControlSockets?.(meetingRoom, now);
        await (
          this as unknown as {
            pruneRtcRoomExpiredResumableControlSessions?: (
              now?: number,
              ) => Promise<boolean>;
          }
        ).pruneRtcRoomExpiredResumableControlSessions?.(now);
        await (
          this as unknown as {
            runRtcRoomSharedCallStateAlarm?: (
              meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
              now?: number,
            ) => Promise<boolean>;
          }
        ).runRtcRoomSharedCallStateAlarm?.(meetingRoom, now);
        await (
          (this as unknown as {
            flushRtcRoomPendingPresenceWrites?: (now?: number) => Promise<boolean>;
          }).flushRtcRoomPendingPresenceWrites
          ?? RtcRoom.prototype.flushRtcRoomPendingPresenceWrites
        ).call(this, now);
        meetingSucceeded = true;
      } catch (err) {
        failures.push(err);
      }
      await this.syncMeetingRoomControlAuthoritySnapshot();
    }

    const shouldReconcileSharedVoice = voiceSucceeded || (!shouldRunVoice && meetingSucceeded);

    if (shouldReconcileSharedVoice) {
      try {
        const meetingRoom = this.getMeetingRoom() as unknown as RtcRoomMeetingRoomPersistenceBridge;
        const changedChannelIds = await (
          this as unknown as {
            reconcileRtcRoomSharedControlIntentFromMedia?: (
              mediaAuthoritySnapshot: SharedRtcMediaAuthoritySnapshot | null | undefined,
            ) => Promise<Set<string>>;
          }
        ).reconcileRtcRoomSharedControlIntentFromMedia?.(mediaAuthoritySnapshot) ?? new Set<string>();
        await this.reconcileRtcRoomSharedVoiceProjection(meetingRoom, changedChannelIds);
      } catch (err) {
        failures.push(err);
      }
    }

    if (failures.length > 0) {
      throw failures[0];
    }
  }
}
