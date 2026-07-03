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
  type RtcRoomCallEffectsAdapter,
  type RtcRoomDisconnectCallCleanup,
  type SharedRtcControlAuthoritySnapshot,
  type SharedRtcControlSessionSnapshot,
  type SharedRtcMediaAuthoritySnapshot,
  type SharedRtcMediaPresenceSnapshot,
  type SharedRtcVoiceAuthoritySnapshot,
  type SharedRtcStaleControlMembership,
  type SharedRtcVoiceChannelTransition,
  type VoiceChannelMember,
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
  applyRtcRoomControlIdentifyEffect,
  applyRtcRoomControlResumeEffects,
  applyRtcRoomControlProfileRefreshEffect,
  applyRtcRoomRefreshVoiceCredentialsEffects,
  applyRtcRoomVoiceStateUpdateEffects,
  type RtcRoomControlSessionEffectsAdapter,
  type RtcRoomControlSessionEffectsSession,
} from "./rtc-room-control-session-effects";
import { applyRtcRoomControlDisconnectEffects } from "./rtc-room-control-disconnect-effects";
import { VoiceRoom } from "./voice-room";

const RESUME_SESSION_KEY_PREFIX = "resume:session:";
const RESUME_EXPIRY_KEY_PREFIX = "resume:expiry:";
const PRESENCE_PENDING_KEY_PREFIX = "presence:pending:";
const ROOM_SCOPED_CONTROL_PATH_RE = /^\/api\/channels\/([^/]+)\/ws$/;
const ROOM_SCOPED_MEDIA_PATH_RE = /^\/api\/(?:channels|room)\/([^/]+)\/voice$/;
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

type RtcRoomMeetingRoomPersistenceBridge = {
  applyRtcRoomControlIdentifyFromSocket?(
    ws: WebSocket,
    identifyData: RtcRoomIdentifySessionData,
  ): unknown;
  createRtcRoomControlPostWriteEffectsAdapter?(): RtcRoomControlPostWriteEffectsAdapter | null | undefined;
  createRtcRoomControlSessionEffectsAdapter?():
    | RtcRoomControlSessionEffectsAdapter<RtcRoomControlSessionEffectsSession>
    | null
    | undefined;
  createRtcRoomControlDisconnectEffectsAdapter?(): ReturnType<MeetingRoom["createRtcRoomControlDisconnectEffectsAdapter"]> | null | undefined;
  bootstrapRtcRoomSharedProjection?(): boolean;
  applyRtcRoomSharedProjectionCleanup?(channelIds: Iterable<string>): boolean;
  applyRtcRoomProfileRefreshFromSocket?(
    ws: WebSocket,
    verified: ControlProfileRefreshData,
  ): unknown;
  applyRtcRoomControlDisconnectFromSocket?(
    ws: WebSocket,
    options: {
      intentional: boolean;
      now?: number;
      previousChannelId?: string;
      closeSocket?: boolean;
      closeCode?: number;
      closeReason?: string;
    },
  ): unknown;
  rehydrateRtcRoomControlSessionFromSocket?(
    ws: WebSocket,
  ): SharedRtcControlSessionSnapshot | null | undefined;
  syncRtcRoomSharedCallState?(
    pendingCalls: Map<string, PendingCall>,
    acceptedCalls: Map<string, number>,
  ): unknown;
  applyRtcRoomVoiceChannelTransition?(
    session: SharedRtcControlSessionSnapshot,
    transition: SharedRtcVoiceChannelTransition,
  ): unknown;
  expireRtcRoomResumableControlSession?(
    sessionId: string,
    storedSession?: RtcRoomControlSessionAttachment | null,
  ): boolean;
  runRtcRoomControlAlarm?(): Promise<void>;
  drainPendingStorageBatch?(): PendingMeetingRoomStorageBatch | null | undefined;
  drainPendingStorageMutations?(): PendingMeetingRoomStorageBatch | null | undefined;
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
  private voiceRoom: VoiceRoom | null = null;
  private storedRoomSlug: string | null = null;
  private meetingRoomSharedProjectionBootstrapped = false;
  private rtcRoomProfileRefreshCooldowns = new Map<string, number>();
  private sharedRtcPendingCalls: Map<string, PendingCall> | null = null;
  private sharedRtcAcceptedCalls: Map<string, number> | null = null;

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  private getMeetingRoom() {
    if (!this.meetingRoom) {
      this.meetingRoom = new MeetingRoom(this.ctx, this.env, { sharedRtcAuthority: true });
      this.meetingRoomSharedProjectionBootstrapped = false;
    }
    this.meetingRoom.setSharedRtcAuthority(true);
    return this.meetingRoom;
  }

  private getVoiceRoom() {
    if (!this.voiceRoom) {
      this.voiceRoom = new VoiceRoom(this.ctx, this.env);
    }
    return this.voiceRoom;
  }

  private bootstrapMeetingRoomSharedProjectionIfReady(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    controlAuthoritySnapshot: SharedRtcControlAuthoritySnapshot | null | undefined,
    mediaAuthoritySnapshot = this.tryReadSharedRtcMediaAuthoritySnapshot(),
  ) {
    if (this.meetingRoomSharedProjectionBootstrapped) return false;
    if (!controlAuthoritySnapshot || !mediaAuthoritySnapshot) return false;
    if (!meetingRoom.bootstrapRtcRoomSharedProjection?.()) return false;
    this.meetingRoomSharedProjectionBootstrapped = true;
    return true;
  }

  private async syncMeetingRoomControlAuthoritySnapshot(
    snapshot?: SharedRtcControlAuthoritySnapshot | null,
  ) {
    const meetingRoom = this.getMeetingRoom();
    const nextSnapshot = snapshot ?? await this.tryReadSharedRtcControlAuthoritySnapshot();
    meetingRoom.setSharedRtcControlAuthoritySnapshot(nextSnapshot);
    const mediaAuthoritySnapshot = this.tryReadSharedRtcMediaAuthoritySnapshot(
      nextSnapshot?.capturedAt ?? Date.now(),
    );
    meetingRoom.setSharedRtcVoiceAuthoritySnapshot?.(
      this.buildSharedRtcVoiceAuthoritySnapshot(nextSnapshot, mediaAuthoritySnapshot),
    );
    this.bootstrapMeetingRoomSharedProjectionIfReady(meetingRoom, nextSnapshot, mediaAuthoritySnapshot);
    return nextSnapshot;
  }

  private async persistMeetingRoomPendingControlBatch(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
  ) {
    const batch = meetingRoom.drainPendingStorageBatch?.() ?? meetingRoom.drainPendingStorageMutations?.();
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

  private async pruneRtcRoomExpiredResumableControlSessions(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    now = Date.now(),
  ) {
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
      const storedSession = meetingRoom.expireRtcRoomResumableControlSession
        ? await this.ctx.storage.get<RtcRoomControlSessionAttachment>(sessionKey)
        : null;

      deleteKeys.push(
        sessionKey,
        `${RESUME_EXPIRY_KEY_PREFIX}${sessionId}`,
      );
      meetingRoom.expireRtcRoomResumableControlSession?.(sessionId, storedSession);
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

    let nextAlarm: number | null = null;
    for (const disconnectedAt of expiryEntries.values()) {
      if (typeof disconnectedAt !== "number" || !Number.isFinite(disconnectedAt)) continue;
      const deadline = disconnectedAt + RTC_RECONNECT_GRACE_MS;
      if (deadline <= now) {
        nextAlarm = now;
        break;
      }
      nextAlarm = nextAlarm === null ? deadline : Math.min(nextAlarm, deadline);
    }

    if (nextAlarm === null) return false;

    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm <= now || nextAlarm < currentAlarm) {
      await this.ctx.storage.setAlarm(nextAlarm);
      return true;
    }

    return false;
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
    meetingRoom.syncRtcRoomSharedCallState?.(pendingCalls, acceptedCalls);
    return { pendingCalls, acceptedCalls };
  }

  private async scheduleRtcRoomSharedCallStateAlarm(now = Date.now()) {
    const [pendingCalls, acceptedCalls] = await Promise.all([
      this.readRtcRoomPendingCallsFromStorage(),
      this.readRtcRoomAcceptedCallsFromStorage(),
    ]);
    let nextAlarm: number | null = null;

    for (const pending of pendingCalls.values()) {
      const deadline = pending.expiresAt;
      if (!Number.isFinite(deadline)) continue;
      if (deadline <= now) {
        nextAlarm = now;
        break;
      }
      nextAlarm = nextAlarm === null ? deadline : Math.min(nextAlarm, deadline);
    }

    if (nextAlarm !== now) {
      for (const expiresAt of acceptedCalls.values()) {
        if (!Number.isFinite(expiresAt)) continue;
        if (expiresAt <= now) {
          nextAlarm = now;
          break;
        }
        nextAlarm = nextAlarm === null ? expiresAt : Math.min(nextAlarm, expiresAt);
      }
    }

    if (nextAlarm === null) return false;

    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm <= now || nextAlarm < currentAlarm) {
      await this.ctx.storage.setAlarm(nextAlarm);
      return true;
    }

    return false;
  }

  private hasRtcRoomAcceptedCall(callId: string, acceptedCalls: Map<string, number>, now = Date.now()) {
    const expiresAt = acceptedCalls.get(callId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      acceptedCalls.delete(callId);
      return false;
    }
    return true;
  }

  private async markRtcRoomAcceptedCall(
    callId: string,
    acceptedCalls: Map<string, number>,
    expiresAt = Date.now() + ACCEPTED_CALL_TTL_MS,
  ) {
    acceptedCalls.set(callId, expiresAt);
    await this.persistRtcRoomAcceptedCallsToStorage(acceptedCalls);
    await this.scheduleRtcRoomSharedCallStateAlarm(expiresAt);
    return expiresAt;
  }

  private takeRtcRoomPendingCallForAcceptance(
    pendingCalls: Map<string, PendingCall>,
    acceptedCalls: Map<string, number>,
    calleeId: string,
    matches: (pending: PendingCall) => boolean,
    now = Date.now(),
  ) {
    const pending = pendingCalls.get(calleeId);
    if (!pending || !matches(pending)) return null;

    acceptedCalls.set(pending.callId, now + ACCEPTED_CALL_TTL_MS);
    pendingCalls.delete(calleeId);
    return pending;
  }

  private prepareRtcRoomPendingCallAcceptForVoiceJoin(
    pendingCalls: Map<string, PendingCall>,
    acceptedCalls: Map<string, number>,
    clerkUserId: string,
    channelId: string,
    now = Date.now(),
  ) {
    return this.takeRtcRoomPendingCallForAcceptance(
      pendingCalls,
      acceptedCalls,
      clerkUserId,
      (pending) => pending.channelId === channelId,
      now,
    );
  }

  private prepareRtcRoomPendingCallAcceptByCallId(
    pendingCalls: Map<string, PendingCall>,
    acceptedCalls: Map<string, number>,
    calleeId: string,
    callId: string,
    now = Date.now(),
  ) {
    return this.takeRtcRoomPendingCallForAcceptance(
      pendingCalls,
      acceptedCalls,
      calleeId,
      (pending) => pending.callId === callId,
      now,
    );
  }

  private prepareRtcRoomAbandonedPendingCallForChannel(
    pendingCalls: Map<string, PendingCall>,
    channelId: string,
  ) {
    for (const [calleeId, pending] of pendingCalls) {
      if (pending.channelId !== channelId) continue;
      pendingCalls.delete(calleeId);
      return pending;
    }
    return null;
  }

  private prepareRtcRoomDisconnectCallCleanup(
    pendingCalls: Map<string, PendingCall>,
    userId: string,
    reason: string,
  ): RtcRoomDisconnectCallCleanup | null {
    const notifications: Array<{ userId: string; callId: string }> = [];

    const pendingAsCallee = pendingCalls.get(userId);
    if (pendingAsCallee) {
      pendingCalls.delete(userId);
      notifications.push({
        userId: pendingAsCallee.callerId,
        callId: pendingAsCallee.callId,
      });
    }

    for (const [calleeId, call] of pendingCalls) {
      if (call.callerId !== userId) continue;
      pendingCalls.delete(calleeId);
      notifications.push({
        userId: calleeId,
        callId: call.callId,
      });
    }

    if (notifications.length === 0) return null;
    return { reason, notifications };
  }

  private findRtcRoomPendingCallForUser(pendingCalls: Map<string, PendingCall>, userId: string) {
    for (const pending of pendingCalls.values()) {
      if (pending.callerId === userId || pending.calleeId === userId) {
        return pending;
      }
    }
    return null;
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
    meetingRoom.syncRtcRoomSharedCallState?.(pendingCalls, acceptedCalls);
  }

  private async runRtcRoomSharedCallStateAlarm(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    now = Date.now(),
  ) {
    const { pendingCalls, acceptedCalls } = await this.syncRtcRoomSharedCallStateMirror(meetingRoom);

    const expiredPendingCalls: PendingCall[] = [];
    for (const [calleeId, pending] of pendingCalls) {
      if (pending.expiresAt > now) continue;
      pendingCalls.delete(calleeId);
      expiredPendingCalls.push(pending);
    }

    let acceptedCallsChanged = false;
    for (const [callId, expiresAt] of acceptedCalls) {
      if (expiresAt > now) continue;
      acceptedCalls.delete(callId);
      acceptedCallsChanged = true;
    }

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
    this.syncMeetingRoomMediaAuthoritySnapshot();
    if (!clerkUserId) return false;
    const controlAuthoritySnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    if (!controlAuthoritySnapshot) return false;
    return this.getMeetingRoom().syncVoiceMemberConnectionStatesFromMedia(clerkUserId);
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
      const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
        ...currentAttachment,
        socket_role: "control",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      };
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
      puts[key] = {
        ...currentAttachment,
        socket_role: "control",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      };
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
    if (!controlAuthoritySnapshot || !mediaAuthoritySnapshot) return [];

    const staleMemberships = new Map<string, SharedRtcStaleControlMembership>();
    for (const session of controlAuthoritySnapshot.sessionsByClerkUserId.values()) {
      if (!session.voice_channel_id) continue;
      if (mediaAuthoritySnapshot.activeClerkUserIds.has(session.clerk_user_id)) continue;
      staleMemberships.set(
        `${session.voice_channel_id}\u0000${session.clerk_user_id}`,
        {
          channelId: session.voice_channel_id,
          clerkUserId: session.clerk_user_id,
        },
      );
    }

    return [...staleMemberships.values()];
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
    this.voiceRoom?.setRoomSlugFromRtcRoom(roomSlug);
    this.ctx.storage.put("roomSlug", roomSlug).catch(() => { });
  }

  private toSharedRtcControlSessionSnapshot(
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
      voice_channel_id: typeof session.voice_channel_id === "string" && session.voice_channel_id
        ? session.voice_channel_id
        : undefined,
      voice_joined_at: typeof session.voice_joined_at === "number" && Number.isFinite(session.voice_joined_at)
        ? session.voice_joined_at
        : undefined,
    };
  }

  private async readSharedRtcControlAuthoritySnapshot(now = Date.now()): Promise<SharedRtcControlAuthoritySnapshot> {
    const sessionsByClerkUserId = new Map<string, SharedRtcControlSessionSnapshot>();
    const sessionsByParticipantId = new Map<string, SharedRtcControlSessionSnapshot>();
    let liveSessionCount = 0;
    let resumableSessionCount = 0;

    const remember = (session: SharedRtcControlSessionSnapshot, overwrite: boolean) => {
      if (overwrite || !sessionsByParticipantId.has(session.id)) {
        sessionsByParticipantId.set(session.id, session);
      }
      if (!overwrite && sessionsByClerkUserId.has(session.clerk_user_id)) return;
      sessionsByClerkUserId.set(session.clerk_user_id, session);
    };

    const resumableEntries = await this.ctx.storage.list<SharedRtcControlSessionSnapshot>({
      prefix: RESUME_SESSION_KEY_PREFIX,
    });
    for (const row of resumableEntries.values()) {
      const session = this.toSharedRtcControlSessionSnapshot(row);
      if (!session) continue;
      resumableSessionCount += 1;
      remember(session, true);
    }

    for (const ws of this.ctx.getWebSockets()) {
      if (getRtcRoomSocketRole(ws) !== "control") continue;
      const session = this.toSharedRtcControlSessionSnapshot(
        ws.deserializeAttachment() as Partial<SharedRtcControlSessionSnapshot> | null,
      );
      if (!session) continue;
      liveSessionCount += 1;
      remember(session, true);
    }

    return {
      capturedAt: now,
      sessionsByClerkUserId,
      sessionsByParticipantId,
      liveSessionCount,
      resumableSessionCount,
    };
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
      voiceAuthoritySnapshot: this.buildSharedRtcVoiceAuthoritySnapshot(
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

  private resolveRtcRoomChannelStartedAtFromControlSnapshot(
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

  private resolveRtcRoomVoiceJoinedAt(
    channelId: string,
    options: {
      candidateJoinedAt?: number | null;
      existingJoinedAt?: number | null;
      controlAuthoritySnapshot?: SharedRtcControlAuthoritySnapshot | null;
    } = {},
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

    return this.resolveRtcRoomChannelStartedAtFromControlSnapshot(
      options.controlAuthoritySnapshot,
      channelId,
    ) ?? Date.now();
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

  private sendRtcRoomControlError(ws: WebSocket, code: number, message: string) {
    this.sendRtcRoomControlMessage(ws, RTC_CONTROL_ERROR_OP, { code, message });
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
    this.sendRtcRoomControlMessage(ws, RTC_CONTROL_DISPATCH_OP, {
      event: "CALL_RING_STOP",
      data: {
        call_id: callId,
        reason,
      },
    });
  }

  private broadcastRtcRoomCallRingStopToUser(
    userId: string,
    callId: string,
    reason: string,
  ) {
    this.broadcastRtcRoomControlDispatchToUser(userId, "CALL_RING_STOP", {
      call_id: callId,
      reason,
    });
  }

  private broadcastRtcRoomPendingCallStop(
    pending: PendingCall,
    reason: string,
  ) {
    this.broadcastRtcRoomCallRingStopToUser(pending.callerId, pending.callId, reason);
    this.broadcastRtcRoomCallRingStopToUser(pending.calleeId, pending.callId, reason);
  }

  private broadcastRtcRoomIncomingPendingCall(pending: PendingCall) {
    this.broadcastRtcRoomControlDispatchToUser(pending.calleeId, "CALL_RING", {
      call_id: pending.callId,
      caller_id: pending.callerId,
      caller_name: pending.callerName,
      caller_username: pending.callerUsername,
      caller_display_name: pending.callerDisplayName,
      caller_avatar: pending.callerAvatar,
      channel_id: pending.channelId,
    });
  }

  private broadcastRtcRoomOutgoingPendingCallRinging(pending: PendingCall) {
    this.broadcastRtcRoomControlDispatchToUser(pending.callerId, "CALL_RINGING", {
      call_id: pending.callId,
      callee_id: pending.calleeId,
      callee_name: pending.calleeName,
      callee_username: pending.calleeUsername,
      callee_display_name: pending.calleeDisplayName,
      callee_avatar: pending.calleeAvatar,
      channel_id: pending.channelId,
    });
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

  private async persistRtcRoomControlAttachmentAndRehydrate(
    meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
    ws: WebSocket,
    attachment: RtcRoomCommittedControlSessionAttachment,
  ) {
    ws.serializeAttachment(attachment);
    await this.persistRtcRoomControlSessionAttachment(attachment);
    const sessionEffects = meetingRoom.createRtcRoomControlSessionEffectsAdapter?.();
    return sessionEffects?.materializeControlSession?.(ws, attachment)
      ?? meetingRoom.rehydrateRtcRoomControlSessionFromSocket?.(ws)
      ?? this.toSharedRtcControlSessionSnapshot(attachment);
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

    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    const sessionEffects = meetingRoom.createRtcRoomControlSessionEffectsAdapter?.();
    if (sessionEffects) {
      const roomScopeId = await this.getStoredRoomSlug() ?? "";
      applyRtcRoomControlIdentifyEffect(
        sessionEffects,
        ws,
        nextAttachment,
        identifyData,
        roomScopeId,
      );
    }
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

    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
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
    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    const credentials = await fetchRtcRoomVoiceCredentials(
      this.env,
      await this.getStoredRoomSlug(),
      nextAttachment.id,
      typeof nextAttachment.clerk_user_id === "string" ? nextAttachment.clerk_user_id : undefined,
    );
    const postRehydrateEffects = meetingRoom.createRtcRoomControlSessionEffectsAdapter?.();
    if (postRehydrateEffects) {
      const roomScopeId = await this.getStoredRoomSlug() ?? "";
      await applyRtcRoomControlResumeEffects(
        postRehydrateEffects,
        ws,
        nextAttachment,
        credentials,
        roomScopeId,
      );
    }
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

    const postRehydrateEffects = meetingRoom.createRtcRoomControlSessionEffectsAdapter?.();
    if (postRehydrateEffects) {
      postRehydrateEffects.materializeControlSession?.(ws, currentAttachment);
      const roomScopeId = await this.getStoredRoomSlug() ?? "";
      applyRtcRoomRefreshVoiceCredentialsEffects(
        postRehydrateEffects,
        ws,
        currentAttachment,
        credentials,
        roomScopeId,
      );
    }
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
    const voiceJoinedAt = this.resolveRtcRoomVoiceJoinedAt(d.channel_id, {
      candidateJoinedAt: candidateStartedAt,
      existingJoinedAt: joiningSameChannel ? existingJoinedAt : undefined,
      controlAuthoritySnapshot: beforeControlSnapshot,
    });

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      voice_channel_id: d.channel_id,
      voice_joined_at: voiceJoinedAt,
      self_mute: d.self_mute ?? true,
    };

    if (!joiningSameChannel) {
      nextAttachment.self_video = false;
      nextAttachment.self_stream = false;
      nextAttachment.stream_preview_url = null;
    }

    const nextSession = await this.persistRtcRoomControlAttachmentAndRehydrate(
      meetingRoom,
      ws,
      nextAttachment,
    );
    if (!nextSession) return false;

    const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
      clerkUserId: nextSession.clerk_user_id,
      beforeVoiceSnapshot,
      afterControlSnapshot,
      rebroadcastCurrentChannel: true,
      allowImplicitCallAccept: true,
    });
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

    const nextSession = await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    const sessionEffects = meetingRoom.createRtcRoomControlSessionEffectsAdapter?.();
    if (nextSession && sessionEffects) {
      const roomScopeId = await this.getStoredRoomSlug() ?? "";
      applyRtcRoomVoiceStateUpdateEffects(
        sessionEffects,
        ws,
        nextSession as RtcRoomControlSessionEffectsSession,
        roomScopeId,
        d.spatial_audio_state,
      );
    }
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
    const postWriteEffects = meetingRoom.createRtcRoomControlPostWriteEffectsAdapter?.();
    if (postWriteEffects) {
      applyRtcRoomPresenceUpdate(postWriteEffects, ws, d.status);
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
    } else {
      meetingRoom.createRtcRoomControlSessionEffectsAdapter?.()
        ?.materializeControlSession?.(ws, currentAttachment);
    }
    const postWriteEffects = meetingRoom.createRtcRoomControlPostWriteEffectsAdapter?.();
    if (postWriteEffects) {
      applyRtcRoomChannelSubscribe(postWriteEffects, ws, d);
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
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      subscribed_channels: subscribedChannels.filter((channelId) => channelId !== d.channel_id),
    };

    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    const postWriteEffects = meetingRoom.createRtcRoomControlPostWriteEffectsAdapter?.();
    if (postWriteEffects) {
      applyRtcRoomChannelUnsubscribe(postWriteEffects, ws, d);
    }
    await this.persistMeetingRoomPendingControlBatchAndSyncSnapshot(meetingRoom);
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
      meetingRoom.createRtcRoomControlSessionEffectsAdapter?.()
        ?.materializeControlSession?.(ws, currentAttachment);
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
    const postWriteEffects = meetingRoom.createRtcRoomControlPostWriteEffectsAdapter?.();
    if (postWriteEffects) {
      applyRtcRoomServerSubscribe(postWriteEffects, ws, d);
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
    if (this.findRtcRoomPendingCallForUser(pendingCalls, callerId)) {
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
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      voice_channel_id: pending.channelId,
      voice_joined_at: this.resolveRtcRoomVoiceJoinedAt(pending.channelId, {
        controlAuthoritySnapshot: beforeControlSnapshot,
      }),
    };

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
    if (this.hasRtcRoomAcceptedCall(d.call_id, acceptedCalls)) {
      await this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls, {
        pendingChanged: false,
        acceptedChanged: true,
      });
      return true;
    }

    const pending = this.prepareRtcRoomPendingCallAcceptByCallId(
      pendingCalls,
      acceptedCalls,
      currentAttachment.clerk_user_id,
      d.call_id,
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
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      voice_channel_id: pending.channelId,
      voice_joined_at: this.resolveRtcRoomVoiceJoinedAt(pending.channelId, {
        controlAuthoritySnapshot: beforeControlSnapshot,
      }),
    };

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
    const pending = this.findRtcRoomPendingCallForUser(pendingCalls, currentAttachment.clerk_user_id);
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
        const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
          ...callerAttachment,
          socket_role: "control",
          voice_channel_id: undefined,
          voice_joined_at: undefined,
        };
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

    await this.persistRtcRoomControlAttachmentAndRehydrate(meetingRoom, ws, nextAttachment);
    const sessionEffects = meetingRoom.createRtcRoomControlSessionEffectsAdapter?.();
    if (sessionEffects) {
      applyRtcRoomControlProfileRefreshEffect(
        sessionEffects,
        ws,
        nextAttachment,
        verified,
      );
    }
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
    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      ...(options.intentional
        ? {
            voice_channel_id: undefined,
            voice_joined_at: undefined,
          }
        : {}),
    };
    const now = Date.now();
    this.rtcRoomProfileRefreshCooldowns.delete(currentAttachment.id);
    const disconnectCallCleanup =
      typeof currentAttachment.clerk_user_id === "string" && currentAttachment.clerk_user_id
        ? this.prepareRtcRoomDisconnectCallCleanup(
          sharedCallState?.pendingCalls ?? new Map<string, PendingCall>(),
          currentAttachment.clerk_user_id,
          "disconnected",
        )
        : null;

    if (options.intentional) {
      ws.serializeAttachment(nextAttachment);
    }

    await this.persistRtcRoomControlDisconnectState(nextAttachment, options.intentional, now);
    const disconnectEffects = meetingRoom.createRtcRoomControlDisconnectEffectsAdapter?.();
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
        },
      );
    } else {
      meetingRoom.applyRtcRoomControlDisconnectFromSocket?.(ws, {
        intentional: options.intentional,
        now,
        previousChannelId,
        closeSocket: options.closeSocket,
        closeCode: options.closeCode,
        closeReason: options.closeReason,
      });
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

    const nextAttachment: RtcRoomCommittedControlSessionAttachment = {
      ...currentAttachment,
      socket_role: "control",
      voice_channel_id: undefined,
      voice_joined_at: undefined,
    };
    const nextSession = await this.persistRtcRoomControlAttachmentAndRehydrate(
      meetingRoom,
      ws,
      nextAttachment,
    );
    if (!nextSession) return false;

    const afterControlSnapshot = await this.syncMeetingRoomControlAuthoritySnapshot();
    this.applyRtcRoomSharedVoiceTransitionEffects(meetingRoom, {
      clerkUserId: nextSession.clerk_user_id,
      beforeVoiceSnapshot,
      afterControlSnapshot,
    });
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
    this.getVoiceRoom().setRoomSlugFromRtcRoom(roomMatch[1]);

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
      const liveClerkUserIds = new Set<string>();
      const activeClerkUserIds = new Set<string>();
      const presenceByClerkUserId = new Map<string, SharedRtcMediaPresenceSnapshot>();
      let participantCount = 0;
      let pendingReconnectCount = 0;

      for (const row of this.ctx.storage.sql.exec(
        `SELECT
           p.id,
           p.clerk_user_id,
           p.pull_session_id,
           p.push_session_cam,
           p.push_session_screen,
           r.disconnected_at
         FROM participants p
         LEFT JOIN pending_reconnects r ON r.participant_id = p.id`,
      )) {
        participantCount += 1;

        const participantId = row.id as string | null;
        const clerkUserId = row.clerk_user_id as string | null;
        const disconnectedAt = row.disconnected_at as number | null;
        const withinReconnectGrace = typeof disconnectedAt === "number"
          && Number.isFinite(disconnectedAt)
          && disconnectedAt > now - RTC_MEDIA_RECONNECT_GRACE_MS;
        const hasLiveMediaSession = Boolean(
          row.pull_session_id || row.push_session_cam || row.push_session_screen,
        );

        if (typeof disconnectedAt === "number" && Number.isFinite(disconnectedAt)) {
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
        if (withinReconnectGrace) {
          activeClerkUserIds.add(clerkUserId);
          const reconnectPresence: SharedRtcMediaPresenceSnapshot = {
            connected: false,
            connection_state: "reconnecting",
            disconnected_at: disconnectedAt,
            reconnect_expires_at: disconnectedAt + RTC_MEDIA_RECONNECT_GRACE_MS,
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
      }

      const countRow = [...this.ctx.storage.sql.exec(
        "SELECT COUNT(*) AS demo_chat_message_count FROM demo_chat_messages",
      )][0] as { demo_chat_message_count?: number } | undefined;

      return {
        capturedAt: now,
        liveParticipantIds,
        liveClerkUserIds,
        activeClerkUserIds,
        presenceByClerkUserId,
        participantCount,
        pendingReconnectCount,
        demoChatMessageCount: countRow?.demo_chat_message_count ?? 0,
      };
    };

    try {
      return buildSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!allowBootstrap || !/no such table/i.test(message)) {
        throw error;
      }

      // Unified rooms still share VoiceRoom's SQLite schema today. If snapshot
      // reads race ahead of VoiceRoom construction, bootstrap the media schema
      // once and then answer from RtcRoom's own storage view.
      this.getVoiceRoom();
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
    return snapshot;
  }

  private buildSharedRtcVoiceAuthoritySnapshot(
    controlAuthoritySnapshot?: SharedRtcControlAuthoritySnapshot | null,
    mediaAuthoritySnapshot = this.tryReadSharedRtcMediaAuthoritySnapshot(),
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

  private async readCurrentSharedRtcVoiceAuthoritySnapshot(now = Date.now()) {
    const controlAuthoritySnapshot = await this.tryReadSharedRtcControlAuthoritySnapshot(now);
    return this.buildSharedRtcVoiceAuthoritySnapshot(
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
    const afterVoiceSnapshot = this.buildSharedRtcVoiceAuthoritySnapshot(
      options.afterControlSnapshot,
      this.tryReadSharedRtcMediaAuthoritySnapshot(
        options.afterControlSnapshot?.capturedAt ?? Date.now(),
      ),
    );
    const previousChannelId = options.beforeVoiceSnapshot?.channelIdByClerkUserId.get(options.clerkUserId);
    const nextChannelId = afterVoiceSnapshot?.channelIdByClerkUserId.get(options.clerkUserId);
    const changedChannelIds = new Set<string>();

    if (previousChannelId && previousChannelId !== nextChannelId) {
      changedChannelIds.add(previousChannelId);
      if (!afterVoiceSnapshot?.channels.has(previousChannelId)) {
        const pendingCalls = new Map(this.sharedRtcPendingCalls ?? []);
        const abandonedPending = this.prepareRtcRoomAbandonedPendingCallForChannel(
          pendingCalls,
          previousChannelId,
        );
        if (abandonedPending) {
          this.sharedRtcPendingCalls = pendingCalls;
          this.broadcastRtcRoomPendingCallStop(abandonedPending, "abandoned");
          this.ctx.waitUntil(this.persistRtcRoomSharedCallState(
            meetingRoom,
            pendingCalls,
            new Map(this.sharedRtcAcceptedCalls ?? []),
            {
              pendingChanged: true,
              acceptedChanged: false,
            },
          ));
        }
      }
    }

    if (nextChannelId && (options.rebroadcastCurrentChannel || nextChannelId !== previousChannelId)) {
      changedChannelIds.add(nextChannelId);
    }

    if (options.allowImplicitCallAccept && nextChannelId && nextChannelId !== previousChannelId) {
      const pendingCalls = new Map(this.sharedRtcPendingCalls ?? []);
      const acceptedCalls = new Map(this.sharedRtcAcceptedCalls ?? []);
      const acceptedPending = this.prepareRtcRoomPendingCallAcceptForVoiceJoin(
        pendingCalls,
        acceptedCalls,
        options.clerkUserId,
        nextChannelId,
      );
      if (acceptedPending) {
        this.sharedRtcPendingCalls = pendingCalls;
        this.sharedRtcAcceptedCalls = acceptedCalls;
        this.broadcastRtcRoomPendingCallStop(acceptedPending, "accepted");
        this.ctx.waitUntil(this.persistRtcRoomSharedCallState(meetingRoom, pendingCalls, acceptedCalls));
      }
    }

    if (changedChannelIds.size > 0) {
      meetingRoom.applyRtcRoomSharedProjectionCleanup?.(changedChannelIds);
      return true;
    }

    return false;
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
    if (url.pathname.endsWith("/ws")) {
      this.syncMeetingRoomMediaAuthoritySnapshot();
      return this.getMeetingRoom().fetch(request);
    }
    if (url.pathname.endsWith("/voice")) {
      return this.getVoiceRoom().fetch(request);
    }
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer) {
    const role = getRtcRoomSocketRole(ws) ?? inferRtcRoomSocketRole(rawMsg);
    if (role === "media") {
      const result = await this.getVoiceRoom().webSocketMessage(ws, rawMsg);
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
      await this.getVoiceRoom().webSocketClose(ws, code, reason);
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
      await this.getVoiceRoom().webSocketError(ws);
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
        await this.getVoiceRoom().alarm();
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
              meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
              now?: number,
              ) => Promise<boolean>;
          }
        ).pruneRtcRoomExpiredResumableControlSessions?.(meetingRoom, now);
        await (
          this as unknown as {
            runRtcRoomSharedCallStateAlarm?: (
              meetingRoom: RtcRoomMeetingRoomPersistenceBridge,
              now?: number,
            ) => Promise<boolean>;
          }
        ).runRtcRoomSharedCallStateAlarm?.(meetingRoom, now);
        await meetingRoom.runRtcRoomControlAlarm?.();
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
        this.getMeetingRoom().syncVoiceMemberConnectionStatesFromMedia();
        if (changedChannelIds.size > 0) {
          meetingRoom.applyRtcRoomSharedProjectionCleanup?.(changedChannelIds);
        } else {
          this.getMeetingRoom().reconcileVoiceMembersFromMedia();
        }
      } catch (err) {
        failures.push(err);
      }
    }

    if (failures.length > 0) {
      throw failures[0];
    }
  }
}
