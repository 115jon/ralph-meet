// ============================================================================
// MeetingRoom — Cloudflare Durable Object for room presence & state
//
// Discord-style Main Gateway: handles Identify, Heartbeat, Resume, Speaking,
// VoiceStateUpdate, ProfileUpdate/Refresh. Issues voice_token for VoiceRoom.
//
// Media signaling (SelectProtocol, SessionDescription, Video, StopTracks,
// Answer) is handled by the separate VoiceRoom DO.
// ============================================================================

import { DurableObject } from "cloudflare:workers";
import { extractAndProcessEmbeds } from "../src/services/embed-fetcher";
import {
  resolveVisibleChannelPermissions,
  type ChannelVisibilityOverride,
  type ChannelVisibilityRole,
} from "../src/lib/channel-visibility";
import { clog } from "../src/lib/console-logger";
import {
  isReconnectWithinGrace,
  shouldKeepResumableSession,
} from "../src/lib/voice/connection-generation";
import { getNextVoicePresenceAlarmTime, refreshVoiceMemberIdentity } from "../src/lib/voice-presence";
import type { RtcSocketRole } from "../src/lib/voice/rtc-room-routing";
import {
  RTC_CONTROL_HEARTBEAT_INTERVAL_MS,
  RTC_CONTROL_ZOMBIE_TIMEOUT_MS,
  RTC_MEDIA_RECONNECT_GRACE_MS,
  RTC_RECONNECT_GRACE_MS,
  parseVoiceSessionCheckRequest,
  resolveVoiceSessionCheckResponse,
  type VoiceSessionCheckRequest,
  type VoiceSessionCheckResponse,
} from "../src/lib/voice/rtc-room-session";
import { filterVoiceChannelStatesPayload } from "../src/lib/voice-channel-state-filter";
import {
  consumeRtcRoomProfileRefreshCooldown as consumeRtcRoomProfileRefreshCooldownValue,
  fetchRtcRoomProfileRefreshData as fetchRtcRoomProfileRefreshDataValue,
  fetchRtcRoomVoiceCredentials as fetchRtcRoomVoiceCredentialsValue,
  resolveRtcRoomControlIdentifySessionData as resolveRtcRoomControlIdentifySessionDataValue,
  type RtcRoomIdentifySessionData,
  type RtcRoomVoiceCredentials,
  type VerifiedClerkProfile,
} from "./rtc-control-identity";
import {
  applyRtcRoomChannelSubscribe,
  applyRtcRoomChannelUnsubscribe,
  applyRtcRoomPresenceUpdate,
  applyRtcRoomServerSubscribe,
  type RtcRoomControlPostWriteEffectsAdapter,
} from "./rtc-room-control-post-write-effects";
import {
  type RtcRoomControlDisconnectEffectsAdapter,
  type RtcRoomControlDisconnectEffectsSession,
} from "./rtc-room-control-disconnect-effects";
import {
  applyRtcRoomControlResumeEffects,
  applyRtcRoomProfileRefreshEffects,
  applyRtcRoomRefreshVoiceCredentialsEffects,
  applyRtcRoomVoiceStateUpdateEffects,
  sendRtcRoomResumedPayload as sendRtcRoomResumedPayloadValue,
  type RtcRoomControlSessionEffectsAdapter,
  type RtcRoomControlSessionEffectsSession,
} from "./rtc-room-control-session-effects";

const log = clog("ChatGW");
const meetingLog = clog("MeetingRoom");
const identifyLog = clog("handleIdentify");
const presenceLog = clog("handlePresenceUpdate");

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

// ── Opcodes ─────────────────────────────────────────────────────────────────

const enum Op {
  Identify = 0,
  Ready = 2,
  Heartbeat = 3,
  Speaking = 5,
  HeartbeatACK = 6,
  Resume = 7,
  Hello = 8,
  Resumed = 9,
  ClientDisconnect = 11,
  VoiceStateUpdate = 15,
  ProfileUpdate = 16,
  ProfileRefresh = 17,
  Error = 18,
  // Chat opcodes
  Dispatch = 19,
  MessageCreate = 20,
  MessageUpdate = 21,
  MessageDelete = 22,
  TypingStart = 23,
  ReactionAdd = 24,
  ReactionRemove = 25,
  PresenceUpdate = 26,
  ChannelSubscribe = 27,
  ChannelUnsubscribe = 28,
  ChannelUpdate = 29,
  ChannelDelete = 30,
  GuildMemberUpdate = 31,
  RelationshipUpdate = 32,
  VoiceChannelJoin = 33,
  VoiceChannelLeave = 34,
  ServerSubscribe = 35,
  // Call opcodes
  CallInitiate = 36,
  CallAccept = 37,
  CallDecline = 38,
  CallEnd = 39,
  RefreshVoiceCredentials = 40,
}

const enum CloseCode {
  UnknownOpcode = 4001,
  NotAuthenticated = 4003,
  AlreadyAuthenticated = 4005,
  SessionInvalid = 4006,
  SessionTimeout = 4009,
}

// ── Shared interfaces ───────────────────────────────────────────────────────

interface TrackInfo {
  participant_id: string;
  track_name: string;
  session_id: string;
  mid?: string;
  kind: "audio" | "video";
}

interface VoiceState {
  id: string;
  clerk_user_id?: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string;
  avatar_display?: string | null;
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
  push_session_id?: string;
  pull_session_id?: string;
  tracks: TrackInfo[];
}

// ── Gateway message shapes ──────────────────────────────────────────────────

interface GatewayMessage {
  op: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d: any;
}

type ServerMsg = GatewayMessage;

// Data stored on each WebSocket via serializeAttachment/deserializeAttachment
interface WsAttachment {
  socket_role?: RtcSocketRole;
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
  tracks: TrackInfo[];
  last_heartbeat?: number;
  seq: number;
  subscribed_channels: string[];
  subscribed_servers: string[];
  /** Channel ID the user is currently in voice for (global gateway only) */
  voice_channel_id?: string;
  /** First authoritative join timestamp for the current voice channel */
  voice_joined_at?: number;
}

interface RtcRoomControlSessionSnapshot extends RtcRoomControlSessionEffectsSession {
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
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
}

export interface VoiceChannelMember {
  clerk_user_id: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  stream_preview_url?: string | null;
  connected?: boolean;
  connection_state?: "connected" | "reconnecting";
  disconnected_at?: number | null;
  reconnect_expires_at?: number | null;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  self_stream_audio?: boolean;
  spatial_audio_enabled?: boolean;
  spatial_audio_high_fidelity?: boolean;
  joined_at?: number;
}

interface SpatialAudioState {
  enabled: boolean;
  placementMode: "line" | "arc" | "grid" | "manual";
  roomSize: number;
  distance: number;
  arcAngle: number;
  manualPositions: Record<string, { x: number; y: number }>;
  updatedBy?: string;
  updatedAt: number;
}

/** A pending (ringing) or active call between two users */
export interface PendingCall {
  callId: string;
  callerId: string;      // clerk_user_id of caller
  calleeId: string;      // clerk_user_id of callee
  channelId: string;     // DM channel ID
  voiceRoomId: string;   // SFU room slug for media
  expiresAt: number;
  callerName: string;
  callerUsername?: string;
  callerDisplayName?: string | null;
  callerAvatar?: string;
  calleeName?: string;
  calleeUsername?: string;
  calleeDisplayName?: string | null;
  calleeAvatar?: string;
}

export interface RtcRoomDisconnectCallCleanup {
  reason: string;
  notifications: Array<{
    userId: string;
    callId: string;
  }>;
}

export interface RtcRoomCallEffectsAdapter {
  sendCallRingStop(ws: WebSocket, callId: string | null, reason: string): void;
  broadcastIncomingCall(pending: PendingCall): void;
  broadcastOutgoingCallRinging(pending: PendingCall): void;
  broadcastPendingCallStop(pending: PendingCall, reason: string): void;
  syncSharedCallStateMirror(
    pendingCalls: Map<string, PendingCall>,
    acceptedCalls: Map<string, number>,
  ): void;
}

interface PendingPresenceWrite {
  status: string;
  dueAt: number;
}

export interface SharedRtcControlSessionSnapshot {
  id: string;
  name: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  avatar_display?: string | null;
  clerk_user_id: string;
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
  tracks: TrackInfo[];
  voice_channel_id?: string;
  voice_joined_at?: number;
}

export interface SharedRtcControlAuthoritySnapshot {
  capturedAt: number;
  sessionsByClerkUserId: ReadonlyMap<string, SharedRtcControlSessionSnapshot>;
  sessionsByParticipantId?: ReadonlyMap<string, SharedRtcControlSessionSnapshot>;
  liveSessionCount: number;
  resumableSessionCount: number;
}

export interface SharedRtcVoiceChannelTransition {
  previousChannelId?: string;
  nextChannelId?: string;
  candidateStartedAt?: number;
}

export interface SharedRtcStaleControlMembership {
  channelId: string;
  clerkUserId: string;
}

export interface SharedRtcMediaPresenceSnapshot {
  connected: boolean;
  connection_state: "connected" | "reconnecting";
  disconnected_at: number | null;
  reconnect_expires_at: number | null;
}

export interface SharedRtcMediaAuthoritySnapshot {
  capturedAt: number;
  liveParticipantIds: ReadonlySet<string>;
  liveClerkUserIds: ReadonlySet<string>;
  activeClerkUserIds: ReadonlySet<string>;
  presenceByClerkUserId: ReadonlyMap<string, SharedRtcMediaPresenceSnapshot>;
  participantCount: number;
  pendingReconnectCount: number;
  demoChatMessageCount: number;
}

export interface SharedRtcVoiceChannelAuthoritySnapshot {
  members: readonly VoiceChannelMember[];
  startedAt?: number;
}

export interface SharedRtcVoiceAuthoritySnapshot {
  capturedAt: number;
  channels: ReadonlyMap<string, SharedRtcVoiceChannelAuthoritySnapshot>;
  channelIdByClerkUserId: ReadonlyMap<string, string>;
}

export interface PendingStorageMutationBatch {
  puts: Record<string, unknown>;
  deletes: string[];
}

export interface VoiceChannelTransitionEffectsInput {
  clerk_user_id: string;
  from_channel_id?: string | null;
  to_channel_id?: string | null;
  joined_at?: number | null;
  candidate_started_at?: number | null;
  session?: SharedRtcControlSessionSnapshot | null;
}

export interface RtcRoomControlDisconnectEvent {
  intentional: boolean;
  now?: number;
  previousChannelId?: string;
  closeSocket?: boolean;
  closeCode?: number;
  closeReason?: string;
}

export interface RtcRoomControlDisconnectEffectsResult {
  keepResumable: boolean;
  participantId: string;
  disconnectedAt: number | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = RTC_CONTROL_HEARTBEAT_INTERVAL_MS;
const ZOMBIE_TIMEOUT_MS = RTC_CONTROL_ZOMBIE_TIMEOUT_MS; // 45s — 3 missed heartbeats
const PRUNE_ALARM_INTERVAL_MS = 300_000;                // 5 min safety-net — client zombie detection fires first
export const CALL_RING_TIMEOUT_MS = 30_000;            // auto-cancel after 30s
export const ACCEPTED_CALL_TTL_MS = 10_000;           // ignore late accept/join races for 10s
const PRESENCE_DEBOUNCE_MS = 2_000;
const RESUME_GRACE_PERIOD_MS = RTC_RECONNECT_GRACE_MS; // 2 min — keep session resumable after disconnect
const MEDIA_RECONNECT_GRACE_PERIOD_MS = RTC_MEDIA_RECONNECT_GRACE_MS; // 30s — keep media presence reconnecting after disconnect
const PRESENCE_PENDING_KEY_PREFIX = "presence:pending:";
const RESUME_SESSION_KEY_PREFIX = "resume:session:";
const RESUME_EXPIRY_KEY_PREFIX = "resume:expiry:";

// ── MeetingRoom Durable Object ──────────────────────────────────────────────

interface MeetingRoomOptions {
  sharedRtcAuthority?: boolean;
}

export class MeetingRoom extends DurableObject<Env> {
  private sessions: Map<WebSocket, WsAttachment> = new Map();
  private _roomSlug: string = "unknown";
  private profileRefreshCooldowns: Map<string, number> = new Map();
  private resumableSessions: Map<string, WsAttachment> = new Map();
  /** Channel → Set<WebSocket> — tracks which clients are subscribed to which channels (typing/presence only) */
  private channelSubscriptions: Map<string, Set<WebSocket>> = new Map();
  /** Server → Set<WebSocket> — tracks which clients are members of which servers (message delivery) */
  private serverSubscriptions: Map<string, Set<WebSocket>> = new Map();
  /** Voice channel presence: channelId → Map<clerkUserId, member info> */
  private voiceChannelMembers: Map<string, Map<string, VoiceChannelMember>> = new Map();
  /** Pending calls: calleeId → PendingCall (only one pending per callee) */
  private pendingCalls: Map<string, PendingCall> = new Map();
  /** Recently accepted calls (callId), acts as a TTL cache to prevent Op 33/Op 37 race conditions */
  private acceptedCalls: Map<string, number> = new Map();
  /** Voice channel started timestamps: channelId → epoch ms when first member joined */
  private voiceChannelStartedAt: Map<string, number> = new Map();
  /** Shared spatial audio layouts: room/channel id -> state */
  private spatialAudioStates: Map<string, SpatialAudioState> = new Map();
  /** True when MeetingRoom and VoiceRoom share one RTC_ROOM authority */
  private sharedRtcAuthority = false;
  /** Latest control-authority snapshot injected by RtcRoom for shared control read paths */
  private sharedRtcControlAuthoritySnapshot: SharedRtcControlAuthoritySnapshot | null = null;
  /** Latest media-authority snapshot injected by RtcRoom for shared voice projection */
  private sharedRtcMediaAuthoritySnapshot: SharedRtcMediaAuthoritySnapshot | null = null;
  /** Latest voice-authority snapshot injected by RtcRoom for shared voice roster reads */
  private sharedRtcVoiceAuthoritySnapshot: SharedRtcVoiceAuthoritySnapshot | null = null;
  /** Channel metadata cache used for permission-filtered voice state delivery */
  private channelMetaCache: Map<string, { server_id: string | null; channel_type: string }> = new Map();
  /** Resumable session expiry: participantId → epoch ms when disconnect happened */
  private resumableSessionExpiry: Map<string, number> = new Map();
  /** Alarm-backed pending D1 presence writes: clerkId → latest status + due time */
  private presenceD1Pending: Map<string, PendingPresenceWrite> = new Map();
  /** Dirty storage keys pending batch flush */
  private dirtyStorage: Map<string, unknown> = new Map();
  /** Storage keys scheduled for deletion during the next flush */
  private deletedStorageKeys: Set<string> = new Set();

  constructor(
    public ctx: DurableObjectState<{}>,
    public env: Env,
    options?: MeetingRoomOptions,
  ) {
    super(ctx, env);
    this.sharedRtcAuthority = options?.sharedRtcAuthority === true;

    // Cloudflare's auto-response absorbs messages at the edge, preventing the DO
    // from updating the `last_heartbeat` timestamp, which causes the zombie
    // pruning alarm to falsely evict active users after 5 minutes.

    // Restore sessions from hibernation-safe WebSocket attachments
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment() as WsAttachment | null;
        if (attachment?.id) {
          this.sessions.set(ws, attachment);

          // Rebuild channel subscriptions from session data
          if (attachment.subscribed_channels) {
            for (const chId of attachment.subscribed_channels) {
              let subs = this.channelSubscriptions.get(chId);
              if (!subs) {
                subs = new Set();
                this.channelSubscriptions.set(chId, subs);
              }
              subs.add(ws);
            }
          }
          // Rebuild server subscriptions from session data
          if (attachment.subscribed_servers) {
            for (const sId of attachment.subscribed_servers) {
              let subs = this.serverSubscriptions.get(sId);
              if (!subs) {
                subs = new Set();
                this.serverSubscriptions.set(sId, subs);
              }
              subs.add(ws);
            }
          }
        }
      } catch {
        // Corrupted attachment — skip
      }
    }

    // Restore voice channel members from storage (async, blockConcurrencyWhile)
    this.ctx.blockConcurrencyWhile(async () => {
      // Restore roomSlug (survives hibernation)
      const storedSlug = await this.ctx.storage.get("roomSlug") as string | undefined;
      if (storedSlug) this.roomSlug = storedSlug;

      const shouldHydrateLocalResumableState = !this.sharedRtcAuthority;

      // Restore resumable sessions from per-session storage keys.
      const resumableEntries = await this.ctx.storage.list<WsAttachment>({ prefix: RESUME_SESSION_KEY_PREFIX });
      if (resumableEntries.size > 0) {
        for (const [key, attachment] of resumableEntries) {
          const participantId = key.slice(RESUME_SESSION_KEY_PREFIX.length);
          if (participantId && shouldHydrateLocalResumableState) {
            this.resumableSessions.set(participantId, attachment);
          }
        }
      } else {
        const storedResumable = await this.ctx.storage.get("resumableSessions") as Record<string, WsAttachment> | undefined;
        if (storedResumable) {
          const migratedEntries: Record<string, WsAttachment> = {};
          for (const [id, attachment] of Object.entries(storedResumable)) {
            if (shouldHydrateLocalResumableState) {
              this.resumableSessions.set(id, attachment);
            }
            migratedEntries[`${RESUME_SESSION_KEY_PREFIX}${id}`] = attachment;
          }
          if (Object.keys(migratedEntries).length > 0) {
            await this.ctx.storage.put(migratedEntries);
          }
          await this.ctx.storage.delete("resumableSessions");
        }
      }

      // Restore voice channel members from per-channel keys (vc:members:*)
      const vcEntries = await this.ctx.storage.list({ prefix: "vc:members:" });
      for (const [key, value] of vcEntries) {
        const channelId = key.slice("vc:members:".length);
        const memberList = value as VoiceChannelMember[];
        const memberMap = new Map<string, VoiceChannelMember>();
        for (const m of memberList) {
          memberMap.set(m.clerk_user_id, m);
        }
        if (memberMap.size > 0) {
          this.voiceChannelMembers.set(channelId, memberMap);
        }
      }

      // One-time migration: move old single-key format to per-channel keys
      if (vcEntries.size === 0) {
        const oldStored = await this.ctx.storage.get("voiceChannelMembers") as Record<string, VoiceChannelMember[]> | undefined;
        if (oldStored) {
          const migrationBatch: Record<string, VoiceChannelMember[]> = {};
          for (const channelId of Object.keys(oldStored)) {
            const memberList = oldStored[channelId] as VoiceChannelMember[];
            const memberMap = new Map<string, VoiceChannelMember>();
            for (const m of memberList) {
              memberMap.set(m.clerk_user_id, m);
            }
            if (memberMap.size > 0) {
              this.voiceChannelMembers.set(channelId, memberMap);
              migrationBatch[`vc:members:${channelId}`] = memberList;
            }
          }
          if (Object.keys(migrationBatch).length > 0) {
            await this.ctx.storage.put(migrationBatch);
          }
          await this.ctx.storage.delete("voiceChannelMembers");
          log.info(`Migrated voiceChannelMembers to per-channel keys (${Object.keys(migrationBatch).length} channels)`);
        }
      }

      // Restore voice channel started timestamps
      const storedStartedAt = await this.ctx.storage.get("voiceChannelStartedAt") as Record<string, number> | undefined;
      if (storedStartedAt) {
        for (const [channelId, ts] of Object.entries(storedStartedAt)) {
          this.voiceChannelStartedAt.set(channelId, ts);
        }
      }

      // Restore resumable session expiry timestamps from per-session storage keys.
      const resumableExpiryEntries = await this.ctx.storage.list<number>({ prefix: RESUME_EXPIRY_KEY_PREFIX });
      if (resumableExpiryEntries.size > 0) {
        for (const [key, ts] of resumableExpiryEntries) {
          const participantId = key.slice(RESUME_EXPIRY_KEY_PREFIX.length);
          if (participantId && shouldHydrateLocalResumableState) {
            this.resumableSessionExpiry.set(participantId, ts);
          }
        }
      } else {
        const storedExpiry = await this.ctx.storage.get("resumableSessionExpiry") as Record<string, number> | undefined;
        if (storedExpiry) {
          const migratedEntries: Record<string, number> = {};
          for (const [id, ts] of Object.entries(storedExpiry)) {
            if (shouldHydrateLocalResumableState) {
              this.resumableSessionExpiry.set(id, ts);
            }
            migratedEntries[`${RESUME_EXPIRY_KEY_PREFIX}${id}`] = ts;
          }
          if (Object.keys(migratedEntries).length > 0) {
            await this.ctx.storage.put(migratedEntries);
          }
          await this.ctx.storage.delete("resumableSessionExpiry");
        }
      }

      // Restore pending call deadlines so call ringing survives hibernation/restarts
      const storedPendingCalls = await this.ctx.storage.get("pendingCalls") as Record<string, PendingCall> | undefined;
      if (storedPendingCalls) {
        for (const [calleeId, pending] of Object.entries(storedPendingCalls)) {
          this.pendingCalls.set(calleeId, pending);
        }
      }

      // Restore accepted-call TTL cache so short race windows survive hibernation/restarts
      const storedAcceptedCalls = await this.ctx.storage.get("acceptedCallExpiry") as Record<string, number> | undefined;
      if (storedAcceptedCalls) {
        for (const [callId, expiresAt] of Object.entries(storedAcceptedCalls)) {
          this.acceptedCalls.set(callId, expiresAt);
        }
      }

      // Restore pending presence writes so the final debounced status survives restarts/hibernation
      const pendingPresenceEntries = await this.ctx.storage.list<PendingPresenceWrite>({ prefix: PRESENCE_PENDING_KEY_PREFIX });
      for (const [key, pending] of pendingPresenceEntries) {
        const clerkId = key.slice(PRESENCE_PENDING_KEY_PREFIX.length);
        if (clerkId) {
          this.presenceD1Pending.set(clerkId, pending);
        }
      }

      // Sync voice_channel_id on sessions from the stored voice members
      for (const [, session] of this.sessions) {
        if (session.clerk_user_id) {
          for (const [channelId, members] of this.voiceChannelMembers) {
            const member = members.get(session.clerk_user_id);
            if (member) {
              session.voice_channel_id = channelId;
              session.voice_joined_at = member.joined_at;
              break;
            }
          }
        }
      }

      // Reconcile: remove voice members that have no live session
      this.reconcileVoiceMembers();

      if (this.hasMeetingRoomAlarmWork()) {
        this.scheduleAlarm();
      }
    });
  }

  setSharedRtcAuthority(shared: boolean) {
    this.sharedRtcAuthority = shared;
    if (!shared) {
      this.sharedRtcControlAuthoritySnapshot = null;
      this.sharedRtcMediaAuthoritySnapshot = null;
      this.sharedRtcVoiceAuthoritySnapshot = null;
    }
  }

  setSharedRtcMediaAuthoritySnapshot(snapshot: SharedRtcMediaAuthoritySnapshot | null) {
    this.sharedRtcMediaAuthoritySnapshot = snapshot;
  }

  setSharedRtcControlAuthoritySnapshot(snapshot: SharedRtcControlAuthoritySnapshot | null) {
    this.sharedRtcControlAuthoritySnapshot = snapshot;
  }

  setSharedRtcVoiceAuthoritySnapshot(snapshot: SharedRtcVoiceAuthoritySnapshot | null) {
    this.sharedRtcVoiceAuthoritySnapshot = snapshot;
  }

  bootstrapRtcRoomSharedProjection(): boolean {
    if (!this.sharedRtcAuthority) return false;

    const cleared = this.clearProjectedVoiceChannelMemberCache();
    const reconciled = this.reconcileVoiceMembersFromMedia();
    return cleared || reconciled;
  }

  setRoomSlugFromRtcRoom(roomSlug: string) {
    this.roomSlug = roomSlug;
  }

  createRtcRoomControlPostWriteEffectsAdapter(): RtcRoomControlPostWriteEffectsAdapter {
    return {
      getSession: (ws) => this.getSession(ws),
      queuePresenceWrite: (clerkUserId, status) => {
        this.debouncePersistPresence(clerkUserId, status);
      },
      broadcastPresenceStatus: (clerkUserId, status) => {
        this.broadcast({
          op: Op.Dispatch,
          d: {
            event: "PRESENCE_UPDATE",
            data: {
              user_id: clerkUserId,
              status,
            },
          },
        });
      },
      addChannelSubscription: (channelId, ws) => {
        let subs = this.channelSubscriptions.get(channelId);
        if (!subs) {
          subs = new Set();
          this.channelSubscriptions.set(channelId, subs);
        }
        subs.add(ws);
      },
      removeChannelSubscription: (channelId, ws) => {
        const subs = this.channelSubscriptions.get(channelId);
        if (subs) {
          subs.delete(ws);
          if (subs.size === 0) this.channelSubscriptions.delete(channelId);
        }
      },
      addServerSubscription: (serverId, ws) => {
        let subs = this.serverSubscriptions.get(serverId);
        if (!subs) {
          subs = new Set();
          this.serverSubscriptions.set(serverId, subs);
        }
        subs.add(ws);
      },
      getOnlineClerkUserIds: () => {
        const onlineUserIds = new Set<string>();
        for (const session of this.sessions.values()) {
          if (session.clerk_user_id) {
            onlineUserIds.add(session.clerk_user_id);
          }
        }
        return Array.from(onlineUserIds);
      },
      sendPresenceList: (ws, userIds) => {
        this.sendTo(ws, {
          op: Op.Dispatch,
          d: {
            event: "PRESENCE_LIST",
            data: { user_ids: userIds },
          },
        });
      },
      queueVoiceChannelStates: (ws) => {
        this.ctx.waitUntil(this.sendVoiceChannelStates(ws));
      },
      logInfo: (message) => {
        log.info(message);
      },
    };
  }

  createRtcRoomControlSessionEffectsAdapter(): RtcRoomControlSessionEffectsAdapter<RtcRoomControlSessionEffectsSession, VoiceState> {
    return {
      restoreSubscriptions: (ws, session) => {
        this.restoreRtcRoomSubscriptions(ws, session);
      },
      restoreVoiceMembershipOnResume: (session) => this.restoreRtcRoomVoiceMembershipOnResume(session),
      materializeControlSession: (ws, session) => {
        const nextSession = {
          ...session,
          socket_role: "control" as const,
        };
        const wasEmpty = this.sessions.size === 0;
        this.sessions.set(ws, nextSession);
        if (!this.sharedRtcAuthority) {
          this.resumableSessions.set(nextSession.id, nextSession);
          if (wasEmpty) this.scheduleAlarm();
        }
        return nextSession;
      },
      buildControlParticipants: (excludedParticipantId) => this.buildRtcRoomControlParticipants(excludedParticipantId),
      buildVoiceState: (session) => this.buildVoiceState(session),
      getSpatialAudioState: (scopeId) => this.spatialAudioStates.get(scopeId),
      updateSpatialAudioState: (scopeId, spatialAudioState, session) => {
        if (spatialAudioState) {
          this.spatialAudioStates.set(scopeId, {
            ...(spatialAudioState as SpatialAudioState),
            updatedBy: session.clerk_user_id || session.id,
            updatedAt: Date.now(),
          });
        }
        return this.spatialAudioStates.get(scopeId);
      },
      sendTo: (ws, message) => {
        this.sendTo(ws, message);
      },
      broadcast: (message, excludeWs) => {
        this.broadcast(message, excludeWs);
      },
      sendVoiceChannelStates: (ws) => this.sendVoiceChannelStates(ws),
      queueBroadcastVoiceChannelState: (channelId, excludeWs) => {
        this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId, excludeWs));
      },
      syncVoiceStateProjection: (session) => {
        if (!session.voice_channel_id || !session.clerk_user_id) return;

        const liveMediaClerkIds = this.collectLiveMediaClerkIds();
        if (this.sharedRtcAuthority) {
          this.syncSharedRtcVoiceChannelProjection(
            session.voice_channel_id,
            session.clerk_user_id,
            liveMediaClerkIds,
          );
        } else if (this.shouldMaterializeVoiceMember(session.voice_channel_id, session.clerk_user_id, liveMediaClerkIds)) {
          this.markVoiceMemberConnected(session.voice_channel_id, session);
          this.ctx.waitUntil(this.broadcastVoiceChannelState(session.voice_channel_id));
        }
      },
      refreshVoiceProjectionIdentity: (session, ws) => {
        if (!session.clerk_user_id) return;
        for (const [channelId, members] of this.voiceChannelMembers) {
          const existing = members.get(session.clerk_user_id);
          if (!existing) continue;

          members.set(session.clerk_user_id, refreshVoiceMemberIdentity(existing, {
            name: session.name,
            username: session.username,
            display_name: session.display_name,
            avatar_url: session.avatar_url,
            avatar_display: session.avatar_display,
          }));
          this.persistVoiceChannelMembers();
          this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId, ws));
          break;
        }
      },
      applyProfileVoiceProjectionUpdate: (session, verified) => {
        if (!session.voice_channel_id || !session.clerk_user_id) return;
        if (this.sharedRtcAuthority) {
          this.syncSharedRtcVoiceChannelProjection(session.voice_channel_id, session.clerk_user_id);
          return;
        }

        const members = this.voiceChannelMembers.get(session.voice_channel_id);
        if (members?.has(session.clerk_user_id)) {
          const member = members.get(session.clerk_user_id)!;
          member.name = verified.name;
          member.username = verified.username;
          member.display_name = verified.displayName ?? null;
          member.avatar_url = verified.avatarUrl;
          member.avatar_display = verified.avatarDisplay ?? null;
          this.markVoiceMemberConnected(session.voice_channel_id, session, member.joined_at);
          this.ctx.waitUntil(this.broadcastVoiceChannelState(session.voice_channel_id));
        }
      },
      findPendingIncomingCall: (clerkUserId) => {
        const pending = this.findPendingCallForUser(clerkUserId);
        return pending && pending.calleeId === clerkUserId ? pending : null;
      },
      logInfo: (message) => {
        log.info(message);
      },
    };
  }

  createRtcRoomControlDisconnectEffectsAdapter():
    RtcRoomControlDisconnectEffectsAdapter<RtcRoomControlDisconnectEffectsSession> {
    return {
      hasConcurrentControlSession: (ws, clerkUserId) => {
        for (const [otherWs, otherSession] of this.sessions) {
          if (otherWs !== ws && otherSession.clerk_user_id === clerkUserId) {
            return true;
          }
        }
        return false;
      },
      broadcast: (message, excludeWs) => {
        this.broadcast(message, excludeWs);
      },
      buildVoiceState: (session) => this.buildVoiceState(session),
      cleanupChannelSubscriptions: (ws) => {
        this.cleanupChannelSubscriptions(ws);
      },
      cleanupServerSubscriptions: (ws) => {
        this.cleanupServerSubscriptions(ws);
      },
      deleteLiveControlSession: (ws, participantId) => {
        this.sessions.delete(ws);
        this.profileRefreshCooldowns.delete(participantId);
      },
      clearResumableControlState: (participantId) => {
        this.resumableSessions.delete(participantId);
        this.resumableSessionExpiry.delete(participantId);
      },
      closeSocket: (ws, code, reason) => {
        try { ws.close(code, reason); } catch { /* already closed */ }
      },
    };
  }

  createRtcRoomCallEffectsAdapter(): RtcRoomCallEffectsAdapter {
    return {
      sendCallRingStop: (ws, callId, reason) => {
        this.sendCallRingStop(ws, callId, reason);
      },
      broadcastIncomingCall: (pending) => {
        this.broadcastIncomingPendingCall(pending);
      },
      broadcastOutgoingCallRinging: (pending) => {
        this.broadcastOutgoingPendingCallRinging(pending);
      },
      broadcastPendingCallStop: (pending, reason) => {
        this.broadcastPendingCallStop(pending, reason);
      },
      syncSharedCallStateMirror: (pendingCalls, acceptedCalls) => {
        this.syncRtcRoomSharedCallState(pendingCalls, acceptedCalls);
      },
    };
  }

  syncRtcRoomSharedCallState(
    pendingCalls: Map<string, PendingCall>,
    acceptedCalls: Map<string, number>,
  ) {
    if (!this.sharedRtcAuthority) return false;
    this.pendingCalls = new Map(pendingCalls);
    this.acceptedCalls = new Map(acceptedCalls);
    return true;
  }

  rehydrateRtcRoomControlSessionFromSocket(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as WsAttachment | null;
    if (!attachment?.id) return null;

    const normalizedAttachment = {
      ...attachment,
      socket_role: "control" as const,
    };
    const wasEmpty = this.sessions.size === 0;
    this.sessions.set(ws, normalizedAttachment);
    if (!this.sharedRtcAuthority) {
      this.resumableSessions.set(normalizedAttachment.id, normalizedAttachment);
      if (wasEmpty) this.scheduleAlarm();
    }
    return this.toSharedRtcControlSessionSnapshot(normalizedAttachment);
  }

  async resolveRtcRoomControlIdentifySessionData(
    participantId: string,
    d: {
      name: string;
      username?: string;
      display_name?: string | null;
      avatar_url?: string;
      avatar_display?: string | null;
      clerk_user_id?: string;
    },
  ): Promise<RtcRoomIdentifySessionData> {
    return resolveRtcRoomControlIdentifySessionDataValue(this.env, this.roomSlug, participantId, d, identifyLog);
  }

  fetchRtcRoomVoiceCredentials(participantId: string, clerkUserId?: string): Promise<RtcRoomVoiceCredentials> {
    return fetchRtcRoomVoiceCredentialsValue(this.env, this.roomSlug, participantId, clerkUserId, meetingLog);
  }

  applyRtcRoomControlIdentifyFromSocket(
    ws: WebSocket,
    identifyData: RtcRoomIdentifySessionData,
  ) {
    const session = this.getSession(ws);
    if (!session) return false;

    if (session.clerk_user_id) {
      for (const [channelId, members] of this.voiceChannelMembers) {
        const existing = members.get(session.clerk_user_id);
        if (!existing) continue;

        members.set(session.clerk_user_id, refreshVoiceMemberIdentity(existing, {
          name: session.name,
          username: session.username,
          display_name: session.display_name,
          avatar_url: session.avatar_url,
          avatar_display: session.avatar_display,
        }));
        this.persistVoiceChannelMembers();
        this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId, ws));
        break;
      }
    }

    const participants = this.buildRtcRoomControlParticipants(session.id);

    this.sendTo(ws, {
      op: Op.Ready,
      d: {
        participant_id: session.id,
        ice_servers: identifyData.iceServers,
        participants,
        heartbeat_interval: HEARTBEAT_INTERVAL_MS,
        voice_token: identifyData.voiceToken,
        spatial_audio_state: this.spatialAudioStates.get(session.voice_channel_id || this.roomSlug),
      },
    });

    this.ctx.waitUntil(this.sendVoiceChannelStates(ws));
    if (session.voice_channel_id) {
      this.ctx.waitUntil(this.broadcastVoiceChannelState(session.voice_channel_id));
    }

    this.broadcast(
      {
        op: Op.VoiceStateUpdate,
        d: {
          participant: this.buildVoiceState(session),
          action: "join",
        },
      },
      ws,
    );

    if (!session.clerk_user_id) return true;

    this.broadcast(
      {
        op: Op.Dispatch,
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

    const pending = this.findPendingCallForUser(session.clerk_user_id);
    if (pending && pending.calleeId === session.clerk_user_id) {
      log.info(`Found pending call (as callee) for ${session.clerk_user_id}: callId=${pending.callId}`);
      this.sendTo(ws, {
        op: Op.Dispatch,
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

  async applyRtcRoomControlResumeFromSocket(
    ws: WebSocket,
    credentials: RtcRoomVoiceCredentials,
  ) {
    const session = this.getSession(ws);
    if (!session) return false;
    return applyRtcRoomControlResumeEffects(
      this.createRtcRoomControlSessionEffectsAdapter(),
      ws,
      session,
      credentials,
      this.roomSlug,
    );
  }

  applyRtcRoomRefreshVoiceCredentialsFromSocket(
    ws: WebSocket,
    credentials: RtcRoomVoiceCredentials,
  ) {
    const session = this.getSession(ws);
    if (!session) return false;
    return applyRtcRoomRefreshVoiceCredentialsEffects(
      this.createRtcRoomControlSessionEffectsAdapter(),
      ws,
      session,
      credentials,
      this.roomSlug,
    );
  }

  applyRtcRoomPresenceUpdateFromSocket(
    ws: WebSocket,
    status: "online" | "idle" | "dnd" | "offline",
  ) {
    return applyRtcRoomPresenceUpdate(this.createRtcRoomControlPostWriteEffectsAdapter(), ws, status);
  }

  applyRtcRoomChannelSubscribeFromSocket(
    ws: WebSocket,
    d: { channel_id: string },
  ) {
    return applyRtcRoomChannelSubscribe(this.createRtcRoomControlPostWriteEffectsAdapter(), ws, d);
  }

  applyRtcRoomChannelUnsubscribeFromSocket(
    ws: WebSocket,
    d: { channel_id: string },
  ) {
    return applyRtcRoomChannelUnsubscribe(this.createRtcRoomControlPostWriteEffectsAdapter(), ws, d);
  }

  applyRtcRoomServerSubscribeFromSocket(
    ws: WebSocket,
    d: { server_id: string },
  ) {
    return applyRtcRoomServerSubscribe(this.createRtcRoomControlPostWriteEffectsAdapter(), ws, d);
  }

  async prepareRtcRoomCallInitiateFromSocket(
    ws: WebSocket,
    d: { target_user_id: string; channel_id: string },
  ): Promise<PendingCall | null> {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id || !d.target_user_id || !d.channel_id) return null;

    const callerId = session.clerk_user_id;
    const calleeId = d.target_user_id;

    if (callerId === calleeId) {
      this.sendCallRingStop(ws, null, "invalid");
      return null;
    }

    if (this.findPendingCallForUser(callerId)) {
      this.sendCallRingStop(ws, null, "busy");
      return null;
    }

    if (this.pendingCalls.has(calleeId)) {
      this.sendCallRingStop(ws, null, "busy");
      return null;
    }

    try {
      const rel = await this.env.DB.prepare(
        "SELECT type FROM relationships WHERE user_id = ? AND target_user_id = ?"
      ).bind(calleeId, callerId).first<{ type: number }>();
      if (rel?.type === 1) {
        this.sendCallRingStop(ws, null, "unavailable");
        return null;
      }
    } catch (e) {
      log.error("Call relationship check failed:", e);
    }

    let calleeOnline = false;
    let calleeName: string | undefined;
    let calleeUsername: string | undefined;
    let calleeDisplayName: string | null | undefined;
    let calleeAvatar: string | undefined;
    for (const [, sess] of this.sessions) {
      if (sess.clerk_user_id === calleeId) {
        calleeOnline = true;
        calleeName = sess.name;
        calleeUsername = sess.username ?? sess.name;
        calleeDisplayName = sess.display_name ?? sess.name;
        calleeAvatar = sess.avatar_url ?? undefined;
        break;
      }
    }
    if (!calleeOnline) {
      this.sendCallRingStop(ws, null, "unavailable");
      return null;
    }

    const callId = crypto.randomUUID();
    const sortedIds = [callerId, calleeId].sort();
    const voiceRoomId = `dm-call-${sortedIds[0]}-${sortedIds[1]}`;
    const pendingCall: PendingCall = {
      callId,
      callerId,
      calleeId,
      channelId: d.channel_id,
      voiceRoomId,
      expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
      callerName: session.name,
      callerUsername: session.username ?? session.name,
      callerDisplayName: session.display_name ?? session.name,
      callerAvatar: session.avatar_url ?? undefined,
      calleeName,
      calleeUsername,
      calleeDisplayName,
      calleeAvatar,
    };

    this.pendingCalls.set(calleeId, pendingCall);
    this.persistPendingCalls();
    this.scheduleAlarm();

    this.broadcastIncomingPendingCall(pendingCall);

    return pendingCall;
  }

  applyRtcRoomCallInitiateFromSocket(
    ws: WebSocket,
    pending: PendingCall,
    previousChannelId?: string,
  ) {
    const session = this.getSession(ws);
    if (!session) return false;

    if (!this.sharedRtcAuthority) {
      this.addToVoiceChannelForCall(session, previousChannelId);
    }
    this.broadcastOutgoingPendingCallRinging(pending);

    log.info(`Call initiated: ${pending.callId}, ${session.name} → ${pending.calleeName}`);
    return true;
  }

  prepareRtcRoomCallAcceptFromSocket(
    ws: WebSocket,
    d: { call_id: string },
  ): PendingCall | null {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id || !d.call_id) return null;

    const calleeId = session.clerk_user_id;
    if (this.hasAcceptedCall(d.call_id)) {
      log.info(`Ignored Op 37 for ${d.call_id} — call was already implicitly/recently accepted.`);
      return null;
    }

    const pending = this.takePendingCallForAcceptance(
      calleeId,
      (candidate) => candidate.callId === d.call_id,
    );
    if (!pending) {
      this.sendCallRingStop(ws, d.call_id, "expired");
      return null;
    }
    return pending;
  }

  applyRtcRoomCallAcceptFromSocket(
    ws: WebSocket,
    pending: PendingCall,
    previousChannelId?: string,
  ) {
    const session = this.getSession(ws);
    if (!session) return false;

    if (!this.sharedRtcAuthority) {
      this.addToVoiceChannelForCall(session, previousChannelId);
    }
    return this.applyPendingCallAccepted(pending, `Call accepted: ${pending.callId}`);
  }

  prepareRtcRoomCallDeclineFromSocket(
    ws: WebSocket,
    d: { call_id: string },
  ): PendingCall | null {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id || !d.call_id) return null;

    const calleeId = session.clerk_user_id;
    const pending = this.pendingCalls.get(calleeId);
    if (!pending || pending.callId !== d.call_id) return null;

    this.pendingCalls.delete(calleeId);
    this.persistPendingCalls();
    return pending;
  }

  applyRtcRoomCallDeclineFromSocket(
    pending: PendingCall,
  ) {
    return this.applyPendingCallStop(pending, "declined", `Call declined: ${pending.callId}`);
  }

  prepareRtcRoomCallEndFromSocket(
    ws: WebSocket,
    _d: { call_id: string },
  ): PendingCall | null {
    const session = this.requireSession(ws);
    if (!session || !session.clerk_user_id) return null;

    const pending = this.findPendingCallForUser(session.clerk_user_id);
    if (!pending) return null;

    this.pendingCalls.delete(pending.calleeId);
    this.persistPendingCalls();
    return pending;
  }

  applyRtcRoomCallEndFromSocket(
    pending: PendingCall,
  ) {
    return this.applyPendingCallStop(pending, "cancelled", `Call cancelled by caller: ${pending.callId}`);
  }

  applyRtcRoomVoiceChannelTransition(
    session: SharedRtcControlSessionSnapshot,
    transition: SharedRtcVoiceChannelTransition,
  ) {
    if (!session.clerk_user_id) return;
    if (this.sharedRtcAuthority) return;

    this.applyVoiceChannelTransitionEffects({
      clerk_user_id: session.clerk_user_id,
      from_channel_id: transition.previousChannelId,
      to_channel_id: transition.nextChannelId ?? session.voice_channel_id,
      joined_at: session.voice_joined_at,
      candidate_started_at: transition.candidateStartedAt,
      session,
    });
  }

  applyRtcRoomVoiceStateUpdateFromSocket(
    ws: WebSocket,
    spatialAudioState?: SpatialAudioState,
  ) {
    const session = this.getSession(ws);
    if (!session) return false;
    return applyRtcRoomVoiceStateUpdateEffects(
      this.createRtcRoomControlSessionEffectsAdapter(),
      ws,
      session,
      this.roomSlug,
      spatialAudioState,
    );
  }

  consumeRtcRoomProfileRefreshCooldown(sessionId: string, now = Date.now()) {
    return consumeRtcRoomProfileRefreshCooldownValue(this.profileRefreshCooldowns, sessionId, now);
  }

  fetchRtcRoomProfileRefreshData(clerkUserId: string) {
    return fetchRtcRoomProfileRefreshDataValue(this.env, clerkUserId, meetingLog);
  }

  applyRtcRoomProfileRefreshFromSocket(
    ws: WebSocket,
    verified: VerifiedClerkProfile,
  ) {
    const session = this.getSession(ws);
    if (!session) return false;
    return applyRtcRoomProfileRefreshEffects(
      this.createRtcRoomControlSessionEffectsAdapter(),
      ws,
      session,
      verified,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const gatewayVersion = parseInt(url.searchParams.get("v") ?? "1", 10);

    // Extract channel ID or slug from URL path
    const channelMatch = url.pathname.match(/\/api\/channels\/([^/]+)\/ws/);
    if (channelMatch) {
      this.roomSlug = channelMatch[1];
      // Persist for hibernation survival
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => { });
    }
    // Also support /api/gateway (global gateway)
    if (url.pathname === "/api/gateway") {
      this.roomSlug = "global-gateway";
      this.ctx.storage.put("roomSlug", this.roomSlug).catch(() => { });
    }

    if (url.pathname.endsWith("/ws") || url.pathname === "/api/gateway") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ socket_role: "control" } satisfies Pick<WsAttachment, "socket_role">);

      log.info(`New connection, gateway_version=${gatewayVersion}`);

      this.sendTo(server, {
        op: Op.Hello,
        d: { heartbeat_interval: HEARTBEAT_INTERVAL_MS, gateway_version: gatewayVersion },
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // Internal broadcast endpoint — called by REST API routes after persisting to D1
    if (url.pathname === "/broadcast" && request.method === "POST") {
      try {
        const body = await request.json() as {
          channel_id?: string;
          server_id?: string;
          target_user_id?: string;
          event: string;
          data: unknown;
          broadcast_all?: boolean;
        };
        const dispatchMsg = {
          op: Op.Dispatch,
          d: { event: body.event, data: body.data },
        };
        log.info(`Internal broadcast: event=${body.event}, type=${body.broadcast_all ? 'all' : body.target_user_id ? 'user' : 'channel'}, recipient=${body.target_user_id || body.channel_id || 'all'}`);

        if (body.broadcast_all) {
          this.broadcast(dispatchMsg);
        } else if (body.target_user_id) {
          this.broadcastToUser(body.target_user_id, dispatchMsg);
        } else if (body.server_id) {
          this.broadcastToServerMembers(body.server_id, dispatchMsg);
        } else if (body.channel_id) {
          this.broadcastToChannel(body.channel_id, dispatchMsg);
        }
        return new Response("OK", { status: 200 });
      } catch (e) {
        return new Response(`Broadcast error: ${e}`, { status: 500 });
      }
    }

    if (url.pathname === "/voice-session-check" && request.method === "POST") {
      try {
        const body = await request.json() as VoiceSessionCheckRequest;
        return this.checkVoiceSession(body);
      } catch (error) {
        return Response.json({ error: `Voice session check error: ${error}` }, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  async checkVoiceSession(body: VoiceSessionCheckRequest): Promise<Response> {
    const parsed = parseVoiceSessionCheckRequest(body);
    if (!parsed) {
      return Response.json({ error: "Missing voice session lookup fields" }, { status: 400 });
    }

    let userMatchedScope = false;
    let exactSessionMatched = false;

    for (const attachment of this.sessions.values()) {
      if (attachment.clerk_user_id !== parsed.userId) continue;
      if (parsed.requireChannelMatch && attachment.voice_channel_id !== parsed.channelId) continue;

      userMatchedScope = true;
      if (parsed.sessionId && attachment.id === parsed.sessionId) {
        exactSessionMatched = true;
        break;
      }
    }

    return Response.json(resolveVoiceSessionCheckResponse(
      userMatchedScope,
      exactSessionMatched,
      parsed.requireExactSession,
    ) satisfies VoiceSessionCheckResponse);
  }

  async webSocketMessage(ws: WebSocket, rawMsg: string | ArrayBuffer) {
    if (typeof rawMsg !== "string") return;
    if (this.env.DEBUG) log.info(`webSocketMessage received: ${rawMsg.substring(0, 100)}`);

    let msg: GatewayMessage;
    try {
      msg = JSON.parse(rawMsg);
    } catch {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4002, message: "Invalid JSON" },
      });
      return;
    }

    if (typeof msg.op !== "number") {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.UnknownOpcode, message: "Missing opcode" },
      });
      return;
    }

    switch (msg.op) {
      case Op.Identify:
        await this.handleIdentify(ws, msg.d);
        break;

      case Op.Heartbeat:
        this.handleHeartbeat(ws, msg.d);
        break;

      case Op.Resume:
        this.handleResume(ws, msg.d);
        break;

      case Op.RefreshVoiceCredentials:
        await this.handleRefreshVoiceCredentials(ws);
        break;

      case Op.VoiceStateUpdate:
        this.handleVoiceStateUpdate(ws, msg.d);
        break;

      case Op.ProfileRefresh:
        await this.handleProfileRefresh(ws);
        break;

      case Op.ClientDisconnect:
        await this.handleLeave(ws, true);
        break;

      // ── Chat opcodes ───────────────────────────────────────────────

      case Op.MessageCreate:
        await this.handleMessageCreate(ws, msg.d);
        break;

      case Op.MessageUpdate:
        await this.handleMessageUpdate(ws, msg.d);
        break;

      case Op.MessageDelete:
        await this.handleMessageDelete(ws, msg.d);
        break;

      case Op.TypingStart:
        this.handleTypingStart(ws, msg.d);
        break;

      case Op.ReactionAdd:
        await this.handleReactionAdd(ws, msg.d);
        break;

      case Op.ReactionRemove:
        await this.handleReactionRemove(ws, msg.d);
        break;

      case Op.ChannelSubscribe:
        this.handleChannelSubscribe(ws, msg.d);
        break;

      case Op.ChannelUnsubscribe:
        this.handleChannelUnsubscribe(ws, msg.d);
        break;

      case Op.PresenceUpdate:
        this.handlePresenceUpdate(ws, msg.d);
        break;

      case Op.VoiceChannelJoin:
        this.handleVoiceChannelJoin(ws, msg.d);
        break;

      case Op.VoiceChannelLeave:
        this.handleVoiceChannelLeave(ws);
        break;

      case Op.ServerSubscribe:
        await this.handleServerSubscribe(ws, msg.d);
        break;

      case Op.CallInitiate:
        await this.handleCallInitiate(ws, msg.d);
        break;

      case Op.CallAccept:
        this.handleCallAccept(ws, msg.d);
        break;

      case Op.CallDecline:
        this.handleCallDecline(ws, msg.d);
        break;

      case Op.CallEnd:
        this.handleCallEnd(ws, msg.d);
        break;

      default:
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: CloseCode.UnknownOpcode, message: `Unknown opcode: ${msg.op}` },
        });
    }

    // Flush any dirty storage keys accumulated during this message cycle
    this.flushDirtyStorage();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    await this.handleLeave(ws, false, false);
    this.flushDirtyStorage();
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) {
    await this.handleLeave(ws, false, false);
    this.flushDirtyStorage();
  }

  // ── Alarm: zombie pruning ──────────────────────────────────────────────

  private async runAlarmMaintenance(now: number, includeVoiceReconcile: boolean) {
    try {
      const shouldPruneLocalControlZombies = includeVoiceReconcile || !this.sharedRtcAuthority;
      const shouldPruneLocalResumableExpiry = includeVoiceReconcile || !this.sharedRtcAuthority;
      const shouldPruneLocalCallState = includeVoiceReconcile || !this.sharedRtcAuthority;
      const zombies: WebSocket[] = [];

      if (shouldPruneLocalControlZombies) {
        for (const [ws, session] of this.sessions) {
          // Shared RTC control sockets are pruned authoritatively in RtcRoom.
          // MeetingRoom keeps this local liveness pass only for split-mode
          // control authority and its own standalone alarm path.
          const lastActivity = session.last_heartbeat ?? 0;

          if (lastActivity && now - lastActivity >= ZOMBIE_TIMEOUT_MS) {
            log.info(`Pruning zombie: ${session.id} (${session.name}), ` +
              `last_activity=${Math.round((now - lastActivity) / 1000)}s ago`);
            zombies.push(ws);
          }
        }
      }

      for (const ws of zombies) {
        try { await this.handleLeave(ws, false, true); } catch (e) {
          log.error(`alarm: handleLeave threw for zombie session:`, e);
        }
      }

      if (shouldPruneLocalResumableExpiry) {
        for (const [id, disconnectedAt] of this.resumableSessionExpiry) {
          if (now - disconnectedAt >= RESUME_GRACE_PERIOD_MS) {
            log.info(`Pruning expired resumable session: ${id} (disconnected ${Math.round((now - disconnectedAt) / 1000)}s ago)`);
            // Broadcast the deferred VoiceStateUpdate "leave" — the abrupt
            // disconnect path skips this to avoid premature removal from
            // other clients' participant lists during brief reconnects.
            const expiredSession = this.resumableSessions.get(id);
            if (expiredSession) {
              this.broadcast({
                op: Op.VoiceStateUpdate,
                d: {
                  participant: this.buildVoiceState(expiredSession),
                  action: "leave",
                },
              });
            }
            this.deleteResumableSession(id);
            this.deleteResumableSessionExpiry(id);
          }
        }
      }

      if (shouldPruneLocalCallState) {
        this.runPendingCallAlarmMaintenance(now);
      }

      await this.flushDuePresenceWrites(now);

      if (includeVoiceReconcile) {
        // Reconcile voice members against live sessions
        this.reconcileVoiceMembers();
      }

      // Flush any dirty storage accumulated during alarm processing
      this.flushDirtyStorage();
    } catch (e) {
      log.error(`alarm(): uncaught exception — state may be inconsistent:`, e);
    } finally {
      // Keep the local alarm alive only for work that still belongs to MeetingRoom.
      if (this.hasMeetingRoomAlarmWork()) {
        this.scheduleAlarm();
      }
    }
  }

  async runRtcRoomControlAlarm() {
    await this.runAlarmMaintenance(Date.now(), false);
  }

  expireRtcRoomResumableControlSession(sessionId: string, storedSession?: Partial<WsAttachment> | null) {
    const expiredSession = storedSession
      ?? (!this.sharedRtcAuthority ? this.resumableSessions.get(sessionId) : undefined);
    if (expiredSession) {
      this.broadcast({
        op: Op.VoiceStateUpdate,
        d: {
          participant: {
            id: expiredSession.id ?? sessionId,
            clerk_user_id: expiredSession.clerk_user_id,
            name: expiredSession.name ?? sessionId,
            username: expiredSession.username,
            display_name: expiredSession.display_name,
            avatar_url: expiredSession.avatar_url ?? undefined,
            avatar_display: expiredSession.avatar_display,
            stream_preview_url: expiredSession.stream_preview_url,
            self_mute: expiredSession.self_mute ?? false,
            self_deaf: expiredSession.self_deaf ?? false,
            self_stream: expiredSession.self_stream ?? false,
            self_stream_audio: expiredSession.self_stream_audio,
            self_video: expiredSession.self_video ?? false,
            spatial_audio_enabled: expiredSession.spatial_audio_enabled,
            spatial_audio_high_fidelity: expiredSession.spatial_audio_high_fidelity,
            suppress: expiredSession.suppress ?? false,
            status: expiredSession.status,
            tracks: [...(expiredSession.tracks ?? [])],
          },
          action: "leave",
        },
      });
    }

    this.resumableSessions.delete(sessionId);
    this.resumableSessionExpiry.delete(sessionId);
    return Boolean(expiredSession);
  }

  async alarm() {
    const now = Date.now();
    await this.runAlarmMaintenance(now, true);
  }

  private hasMeetingRoomAlarmWork() {
    if (
      this.pendingCalls.size > 0 ||
      this.acceptedCalls.size > 0 ||
      this.presenceD1Pending.size > 0
    ) {
      return true;
    }

    if (this.sharedRtcAuthority) {
      return false;
    }

    return this.sessions.size > 0 || this.resumableSessionExpiry.size > 0;
  }

  private getNextAlarmTime(now: number) {
    const deadlines: number[] = [];

    if (!this.sharedRtcAuthority) {
      for (const [, session] of this.sessions) {
        if (session.last_heartbeat) deadlines.push(session.last_heartbeat + ZOMBIE_TIMEOUT_MS);
      }
      for (const disconnectedAt of this.resumableSessionExpiry.values()) {
        deadlines.push(disconnectedAt + RESUME_GRACE_PERIOD_MS);
      }
    }
    for (const pending of this.pendingCalls.values()) {
      deadlines.push(pending.expiresAt);
    }
    for (const expiresAt of this.acceptedCalls.values()) {
      deadlines.push(expiresAt);
    }
    for (const pending of this.presenceD1Pending.values()) {
      deadlines.push(pending.dueAt);
    }

    return getNextVoicePresenceAlarmTime(now, PRUNE_ALARM_INTERVAL_MS, deadlines);
  }

  private scheduleAlarm() {
    const now = Date.now();
    const nextAlarm = this.getNextAlarmTime(now);

    this.ctx.storage.getAlarm().then((currentAlarm) => {
      if (currentAlarm === null || currentAlarm <= now || nextAlarm < currentAlarm) {
        return this.ctx.storage.setAlarm(nextAlarm);
      }
    }).catch(() => { });
  }

  // ── Batched storage writes ─────────────────────────────────────────────

  /** Mark a storage key as dirty — will be flushed in batch at end of message cycle */
  private markDirty(key: string, value: unknown) {
    this.dirtyStorage.set(key, value);
  }

  drainPendingStorageMutations(): PendingStorageMutationBatch {
    const batch: PendingStorageMutationBatch = {
      puts: this.dirtyStorage.size > 0 ? Object.fromEntries(this.dirtyStorage) : {},
      deletes: this.deletedStorageKeys.size > 0 ? [...this.deletedStorageKeys] : [],
    };
    this.dirtyStorage.clear();
    this.deletedStorageKeys.clear();
    return batch;
  }

  private writePendingStorageMutations(batch: PendingStorageMutationBatch) {
    if (batch.deletes.length > 0) {
      this.ctx.storage.delete(batch.deletes).catch(() => { });
    }
    if (Object.keys(batch.puts).length > 0) {
      this.ctx.storage.put(batch.puts).catch(() => { });
    }
  }

  /** Flush all dirty storage keys in a single batch put */
  private flushDirtyStorage() {
    this.writePendingStorageMutations(this.drainPendingStorageMutations());
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private persist(ws: WebSocket, data: WsAttachment) {
    const wasEmpty = this.sessions.size === 0;
    data.socket_role = "control";
    this.sessions.set(ws, data);
    ws.serializeAttachment(data);
    if (!this.sharedRtcAuthority) {
      this.resumableSessions.set(data.id, data);
    }
    this.persistResumableSession(data.id, data);
    if (wasEmpty && !this.sharedRtcAuthority) this.scheduleAlarm();
  }

  private deleteStorageKey(key: string) {
    this.deletedStorageKeys.add(key);
    this.dirtyStorage.delete(key);
  }

  /** Persist voice channel members to per-channel storage keys */
  private persistVoiceChannelMembers() {
    // Track which channels currently have entries
    const activeChannelIds = new Set<string>();
    for (const [channelId, members] of this.voiceChannelMembers) {
      if (members.size > 0) {
        activeChannelIds.add(channelId);
        this.markDirty(`vc:members:${channelId}`, Array.from(members.values()));
      }
    }
  }

  /** Mark a voice channel's storage key for deletion (called when channel becomes empty) */
  private deleteVoiceChannelStorage(channelId: string) {
    this.deleteStorageKey(`vc:members:${channelId}`);
  }

  /** Persist voice channel started-at timestamps to storage */
  private persistVoiceChannelStartedAt() {
    const serialized: Record<string, number> = {};
    for (const [channelId, ts] of this.voiceChannelStartedAt) {
      serialized[channelId] = ts;
    }
    this.markDirty("voiceChannelStartedAt", serialized);
  }

  private clearProjectedVoiceChannelMemberCache() {
    if (this.voiceChannelMembers.size === 0) return false;

    for (const channelId of this.voiceChannelMembers.keys()) {
      this.deleteVoiceChannelStorage(channelId);
    }
    this.voiceChannelMembers.clear();
    return true;
  }

  private collectSharedRtcVoiceStateChannelIds(now = Date.now()) {
    const channelIds = new Set<string>();
    const activeMediaClerkIds = this.collectActiveMediaClerkIds(now);

    const maybeAdd = (session: WsAttachment | SharedRtcControlSessionSnapshot) => {
      const clerkUserId = session.clerk_user_id;
      const channelId = session.voice_channel_id;
      if (!clerkUserId || !channelId || !activeMediaClerkIds.has(clerkUserId)) return;
      channelIds.add(channelId);
    };

    for (const session of this.getSharedRtcControlSessionCandidates().values()) {
      maybeAdd(session);
    }

    return channelIds;
  }

  private collectSharedRtcVoiceStateSessions(
    channelId: string,
    activeMediaClerkIds: Set<string>,
  ) {
    const sessionsByClerkUserId = new Map<string, SharedRtcControlSessionSnapshot | WsAttachment>();
    for (const session of this.getSharedRtcControlSessionCandidates().values()) {
      const clerkUserId = session.clerk_user_id;
      if (!clerkUserId || session.voice_channel_id !== channelId || !activeMediaClerkIds.has(clerkUserId)) {
        continue;
      }
      sessionsByClerkUserId.set(clerkUserId, session);
    }

    return sessionsByClerkUserId;
  }

  private getSharedRtcControlParticipantCandidates() {
    const sessionsByParticipantId = new Map<string, SharedRtcControlSessionSnapshot | WsAttachment>();

    const remember = (
      session: SharedRtcControlSessionSnapshot | WsAttachment,
      overwrite: boolean,
    ) => {
      const participantId = session.id;
      if (!participantId) return;
      if (!overwrite && sessionsByParticipantId.has(participantId)) return;
      sessionsByParticipantId.set(participantId, session);
    };

    const snapshotSessions = this.sharedRtcControlAuthoritySnapshot?.sessionsByParticipantId;
    if (snapshotSessions) {
      for (const session of snapshotSessions.values()) {
        remember(session, false);
      }
    } else if (this.sharedRtcControlAuthoritySnapshot) {
      for (const session of this.sharedRtcControlAuthoritySnapshot.sessionsByClerkUserId.values()) {
        remember(session, false);
      }
    }

    if (this.sharedRtcAuthority) {
      for (const session of this.sessions.values()) {
        remember(session, true);
      }
      return sessionsByParticipantId;
    }

    for (const session of this.resumableSessions.values()) {
      remember(session, true);
    }
    for (const session of this.sessions.values()) {
      remember(session, true);
    }

    return sessionsByParticipantId;
  }

  private getSharedRtcControlSessionCandidates() {
    const sessionsByClerkUserId = new Map<string, SharedRtcControlSessionSnapshot | WsAttachment>();

    const remember = (
      session: SharedRtcControlSessionSnapshot | WsAttachment,
      overwrite: boolean,
    ) => {
      const clerkUserId = session.clerk_user_id;
      if (!clerkUserId) return;
      if (!overwrite && sessionsByClerkUserId.has(clerkUserId)) return;
      sessionsByClerkUserId.set(clerkUserId, session);
    };

    const snapshotSessions = this.sharedRtcControlAuthoritySnapshot?.sessionsByParticipantId;
    if (snapshotSessions) {
      for (const session of snapshotSessions.values()) {
        remember(session, false);
      }
    } else if (this.sharedRtcControlAuthoritySnapshot) {
      for (const session of this.sharedRtcControlAuthoritySnapshot.sessionsByClerkUserId.values()) {
        remember(session, false);
      }
    }

    if (this.sharedRtcAuthority) {
      for (const session of this.sessions.values()) {
        remember(session, true);
      }
      return sessionsByClerkUserId;
    }

    for (const session of this.resumableSessions.values()) {
      remember(session, true);
    }
    for (const session of this.sessions.values()) {
      remember(session, true);
    }

    return sessionsByClerkUserId;
  }

  private buildSharedRtcVoiceChannelMembers(channelId: string, now = Date.now()) {
    const activeMediaClerkIds = this.collectActiveMediaClerkIds(now);
    const liveMediaClerkIds = this.collectLiveMediaClerkIds(now);
    const startedAt = this.voiceChannelStartedAt.get(channelId) ?? now;
    const membersByClerkUserId = new Map<string, VoiceChannelMember>();
    const controlSessions = this.collectSharedRtcVoiceStateSessions(channelId, activeMediaClerkIds);

    for (const [clerkUserId, session] of controlSessions) {
      const joinedAt = session.voice_joined_at ?? startedAt;
      const connectionState = this.resolveVoiceMemberConnectionState(
        clerkUserId,
        undefined,
        joinedAt,
        liveMediaClerkIds,
      );
      membersByClerkUserId.set(clerkUserId, {
        clerk_user_id: clerkUserId,
        name: session.name,
        username: session.username,
        display_name: session.display_name,
        avatar_url: session.avatar_url,
        avatar_display: session.avatar_display,
        stream_preview_url: session.stream_preview_url,
        ...connectionState,
        self_mute: session.self_mute,
        self_deaf: session.self_deaf,
        self_video: session.self_video,
        self_stream: session.self_stream,
        self_stream_audio: session.self_stream_audio,
        spatial_audio_enabled: session.spatial_audio_enabled,
        spatial_audio_high_fidelity: session.spatial_audio_high_fidelity,
        joined_at: joinedAt,
      });
    }

    return Array.from(membersByClerkUserId.values()).sort((a, b) => {
      const joinedDiff = (a.joined_at ?? startedAt) - (b.joined_at ?? startedAt);
      if (joinedDiff !== 0) return joinedDiff;
      return a.clerk_user_id.localeCompare(b.clerk_user_id);
    });
  }

  private buildVoiceChannelStateSnapshot(channelId: string, now = Date.now()) {
    const sharedVoiceChannelSnapshot = this.sharedRtcAuthority
      ? this.sharedRtcVoiceAuthoritySnapshot?.channels.get(channelId) ?? null
      : null;
    const members = this.sharedRtcAuthority
      ? sharedVoiceChannelSnapshot
        ? sharedVoiceChannelSnapshot.members.map((member) => ({ ...member }))
        : []
      : Array.from(this.voiceChannelMembers.get(channelId)?.values() ?? []);
    const startedAt = this.voiceChannelStartedAt.get(channelId)
      ?? sharedVoiceChannelSnapshot?.startedAt
      ?? members.reduce<number | null>((earliest, member) => {
        const joinedAt = typeof member.joined_at === "number" && Number.isFinite(member.joined_at)
          ? member.joined_at
          : null;
        if (joinedAt === null) return earliest;
        return earliest === null ? joinedAt : Math.min(earliest, joinedAt);
      }, null);
    return { members, startedAt };
  }

  private buildVoiceChannelStatesPayload() {
    const voiceStates: Record<string, VoiceChannelMember[]> = {};
    const voiceStartedAt: Record<string, number> = {};
    const spatialAudioStates: Record<string, SpatialAudioState> = {};
    const now = Date.now();
    const channelIds = this.sharedRtcAuthority
      ? new Set(this.sharedRtcVoiceAuthoritySnapshot?.channels.keys() ?? [])
      : new Set(this.voiceChannelMembers.keys());
    for (const channelId of channelIds) {
      const snapshot = this.buildVoiceChannelStateSnapshot(channelId, now);
      if (snapshot.members.length === 0) continue;
      voiceStates[channelId] = snapshot.members;
      if (snapshot.startedAt) {
        voiceStartedAt[channelId] = snapshot.startedAt;
      }
      const spatial = this.spatialAudioStates.get(channelId);
      if (spatial) spatialAudioStates[channelId] = spatial;
    }
    return { voice_states: voiceStates, voice_started_at: voiceStartedAt, spatial_audio_states: spatialAudioStates };
  }

  private buildVoiceChannelStateUpdateMessage(channelId: string): ServerMsg {
    const snapshot = this.buildVoiceChannelStateSnapshot(channelId);
    return {
      op: Op.Dispatch,
      d: {
        event: "VOICE_CHANNEL_STATE_UPDATE",
        data: {
          channel_id: channelId,
          members: snapshot.members,
          started_at: snapshot.startedAt ?? null,
          spatial_audio_state: this.spatialAudioStates.get(channelId),
        },
      },
    };
  }

  private async getChannelMeta(channelId: string): Promise<{ server_id: string | null; channel_type: string } | null> {
    const cached = this.channelMetaCache.get(channelId);
    if (cached) return cached;

    const channel = await this.env.DB.prepare(
      "SELECT server_id, channel_type FROM channels WHERE id = ? LIMIT 1",
    )
      .bind(channelId)
      .first<{ server_id: string | null; channel_type: string }>()
      .catch(() => null);

    if (!channel) return null;
    this.channelMetaCache.set(channelId, channel);
    return channel;
  }

  private async fetchServerMemberRolesForUser(serverId: string, userId: string): Promise<ChannelVisibilityRole[]> {
    const { results } = await this.env.DB.prepare(
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

  private async canUserAccessVoiceChannel(channelId: string, userId: string): Promise<boolean> {
    const channel = await this.getChannelMeta(channelId);
    if (!channel) return false;

    if (channel.channel_type === "dm" || channel.server_id === null) {
      const recipient = await this.env.DB.prepare(
        "SELECT 1 FROM dm_recipients WHERE channel_id = ? AND user_id = ? LIMIT 1",
      )
        .bind(channelId, userId)
        .first()
        .catch(() => null);

      return !!recipient;
    }

    const userRoles = await this.fetchServerMemberRolesForUser(channel.server_id, userId);
    if (userRoles.length === 0) return false;

    const roleIds = userRoles.map((role) => role.id);
    const placeholders = roleIds.length > 0 ? roleIds.map(() => "?").join(",") : "''";
    const { results: overrides } = await this.env.DB.prepare(
      `SELECT channel_id, target_id, target_type, allow, deny
       FROM channel_permission_overrides
       WHERE channel_id = ?
         AND (
           (target_type = 'user' AND target_id = ?) OR
           (target_type = 'role' AND target_id IN (${placeholders}))
         )`,
    )
      .bind(channelId, userId, ...roleIds)
      .all()
      .catch(() => ({ results: [] }));

    const visiblePermissions = resolveVisibleChannelPermissions(
      [{ id: channelId }],
      userId,
      userRoles,
      (overrides ?? []) as ChannelVisibilityOverride[],
    );

    return visiblePermissions[channelId] !== undefined;
  }

  private async sendVoiceChannelStates(ws: WebSocket) {
    const session = this.getSession(ws);
    if (!session?.clerk_user_id) return;

    const data = this.buildVoiceChannelStatesPayload();
    const visibleChannelIds = new Set<string>();

    for (const channelId of Object.keys(data.voice_states)) {
      if (await this.canUserAccessVoiceChannel(channelId, session.clerk_user_id)) {
        visibleChannelIds.add(channelId);
      }
    }

    const filtered = filterVoiceChannelStatesPayload(data, visibleChannelIds);
    if (Object.keys(filtered.voice_states).length === 0) return;

    this.sendTo(ws, {
      op: Op.Dispatch,
      d: {
        event: "VOICE_CHANNEL_STATES",
        data: filtered,
      },
    });
  }

  private async broadcastVoiceChannelState(channelId: string, excludeWs?: WebSocket) {
    const message = this.buildVoiceChannelStateUpdateMessage(channelId);

    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs || !session.clerk_user_id) continue;
      if (!(await this.canUserAccessVoiceChannel(channelId, session.clerk_user_id))) continue;

      this.sendTo(ws, message);
    }
  }

  private ensureVoiceChannelMembers(channelId: string, startedAt = Date.now()) {
    let members = this.voiceChannelMembers.get(channelId);
    if (!members) {
      members = new Map();
      this.voiceChannelMembers.set(channelId, members);
      this.voiceChannelStartedAt.set(channelId, startedAt);
      this.persistVoiceChannelStartedAt();
    }
    return members;
  }

  private getSharedRtcVoiceAuthorityChannelSnapshot(channelId: string) {
    if (!this.sharedRtcAuthority) return null;
    return this.sharedRtcVoiceAuthoritySnapshot?.channels.get(channelId) ?? null;
  }

  private shouldMaterializeVoiceMember(
    channelId: string,
    clerkUserId: string,
    liveMediaClerkIds = this.collectLiveMediaClerkIds(),
  ) {
    if (!this.sharedRtcAuthority) return true;
    void liveMediaClerkIds;
    const channelSnapshot = this.getSharedRtcVoiceAuthorityChannelSnapshot(channelId);
    if (channelSnapshot) {
      return channelSnapshot.members.some((member) => member.clerk_user_id === clerkUserId);
    }
    return this.collectActiveMediaClerkIds(Date.now()).has(clerkUserId);
  }

  private syncSharedRtcVoiceChannelProjection(
    channelId: string,
    clerkUserId: string,
    liveMediaClerkIds = this.collectLiveMediaClerkIds(),
  ) {
    if (
      !this.sharedRtcAuthority ||
      !this.shouldMaterializeVoiceMember(channelId, clerkUserId, liveMediaClerkIds)
    ) {
      return false;
    }

    this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));
    return true;
  }

  private invalidateSharedRtcVoiceChannelState(channelId: string) {
    if (!this.sharedRtcAuthority) return false;
    this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));
    return true;
  }

  private pruneSharedRtcVoiceChannelIfEmpty(channelId: string) {
    if (!this.sharedRtcAuthority) return false;

    const snapshot = this.buildVoiceChannelStateSnapshot(channelId);
    if (snapshot.members.length > 0) return false;

    const removedMembers = this.voiceChannelMembers.delete(channelId);
    if (removedMembers) {
      this.deleteVoiceChannelStorage(channelId);
      this.persistVoiceChannelMembers();
    }

    if (this.voiceChannelStartedAt.delete(channelId)) {
      this.persistVoiceChannelStartedAt();
    }

    return true;
  }

  private resolveVoiceJoinedAt(
    channelId: string,
    candidateJoinedAt?: number | null,
    existingJoinedAt?: number | null,
  ) {
    if (typeof candidateJoinedAt === "number" && Number.isFinite(candidateJoinedAt)) {
      return typeof existingJoinedAt === "number" && Number.isFinite(existingJoinedAt)
        ? Math.min(existingJoinedAt, candidateJoinedAt)
        : candidateJoinedAt;
    }
    if (typeof existingJoinedAt === "number" && Number.isFinite(existingJoinedAt)) {
      return existingJoinedAt;
    }
    return this.voiceChannelStartedAt.get(channelId) ?? Date.now();
  }

  private findVoiceMemberControlSession(
    clerkUserId: string,
  ): SharedRtcControlSessionSnapshot | WsAttachment | undefined {
    const session = this.getSharedRtcControlSessionCandidates().get(clerkUserId);
    return session && session.voice_channel_id
      ? session
      : undefined;
  }

  private backfillVoiceMemberFromControlSession(
    clerkUserId: string,
    liveMediaClerkIds = this.collectLiveMediaClerkIds(),
  ): string | null {
    if (!this.sharedRtcAuthority || !liveMediaClerkIds.has(clerkUserId)) return null;

    for (const members of this.voiceChannelMembers.values()) {
      if (members.has(clerkUserId)) return null;
    }

    const session = this.findVoiceMemberControlSession(clerkUserId);
    const channelId = session?.voice_channel_id;
    if (!session || !channelId) return null;

    this.markVoiceMemberConnected(
      channelId,
      session,
      this.voiceChannelStartedAt.get(channelId) ?? Date.now(),
    );
    return channelId;
  }

  private markVoiceMemberConnected(
    channelId: string,
    session: RtcRoomControlSessionEffectsSession,
    joinedAt?: number,
  ) {
    if (!session.clerk_user_id) return;

    const members = this.ensureVoiceChannelMembers(channelId, joinedAt ?? Date.now());
    const existing = members.get(session.clerk_user_id);
    const connectionState = this.resolveVoiceMemberConnectionState(
      session.clerk_user_id,
      existing,
      joinedAt,
    );
    members.set(session.clerk_user_id, {
      ...existing,
      clerk_user_id: session.clerk_user_id,
      name: session.name,
      username: session.username,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      avatar_display: session.avatar_display,
      stream_preview_url: session.stream_preview_url,
      ...connectionState,
      self_mute: session.self_mute,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
      spatial_audio_enabled: session.spatial_audio_enabled,
      spatial_audio_high_fidelity: session.spatial_audio_high_fidelity,
      joined_at: existing?.joined_at ?? joinedAt ?? this.voiceChannelStartedAt.get(channelId) ?? Date.now(),
    });
    this.persistVoiceChannelMembers();
  }

  private resolveVoiceMemberConnectionState(
    clerkUserId: string,
    existing?: VoiceChannelMember,
    disconnectedAtFallback?: number,
    liveMediaClerkIds = this.collectLiveMediaClerkIds(),
  ): Pick<VoiceChannelMember, "connected" | "connection_state" | "disconnected_at" | "reconnect_expires_at"> {
    const sharedPresence = this.sharedRtcAuthority
      ? this.sharedRtcMediaAuthoritySnapshot?.presenceByClerkUserId.get(clerkUserId)
      : null;
    if (sharedPresence) {
      return sharedPresence;
    }

    if (!this.sharedRtcAuthority || liveMediaClerkIds.has(clerkUserId)) {
      return {
        connected: true,
        connection_state: "connected",
        disconnected_at: null,
        reconnect_expires_at: null,
      };
    }

    const disconnectedAt = existing?.disconnected_at ?? disconnectedAtFallback ?? Date.now();
    const reconnectGraceMs = this.sharedRtcAuthority
      ? MEDIA_RECONNECT_GRACE_PERIOD_MS
      : RESUME_GRACE_PERIOD_MS;
    const nextReconnectExpiresAt = disconnectedAt + reconnectGraceMs;
    const existingReconnectExpiresAt = existing?.reconnect_expires_at;
    return {
      connected: false,
      connection_state: "reconnecting",
      disconnected_at: disconnectedAt,
      reconnect_expires_at:
        this.sharedRtcAuthority && typeof existingReconnectExpiresAt === "number" && Number.isFinite(existingReconnectExpiresAt)
          ? Math.min(existingReconnectExpiresAt, nextReconnectExpiresAt)
          : existingReconnectExpiresAt ?? nextReconnectExpiresAt,
    };
  }

  private markVoiceMemberReconnecting(session: WsAttachment, disconnectedAt: number, excludeWs?: WebSocket) {
    if (!session.voice_channel_id || !session.clerk_user_id) return;

    if (this.sharedRtcAuthority) {
      void disconnectedAt;
      void excludeWs;
      return;
    }

    const members = this.ensureVoiceChannelMembers(session.voice_channel_id);
    const existing = members.get(session.clerk_user_id);
    const reconnectGraceMs = this.sharedRtcAuthority
      ? MEDIA_RECONNECT_GRACE_PERIOD_MS
      : RESUME_GRACE_PERIOD_MS;
    members.set(session.clerk_user_id, {
      ...existing,
      clerk_user_id: session.clerk_user_id,
      name: session.name,
      username: session.username,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      avatar_display: session.avatar_display,
      stream_preview_url: session.stream_preview_url,
      connected: false,
      connection_state: "reconnecting",
      disconnected_at: disconnectedAt,
      reconnect_expires_at: disconnectedAt + reconnectGraceMs,
      self_mute: session.self_mute,
      self_deaf: session.self_deaf,
      self_video: session.self_video,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
      spatial_audio_enabled: session.spatial_audio_enabled,
      spatial_audio_high_fidelity: session.spatial_audio_high_fidelity,
      joined_at: existing?.joined_at ?? this.voiceChannelStartedAt.get(session.voice_channel_id) ?? disconnectedAt,
    });
    this.persistVoiceChannelMembers();
    this.ctx.waitUntil(this.broadcastVoiceChannelState(session.voice_channel_id, excludeWs));
  }

  private collectLiveMediaClerkIds(now = Date.now()): Set<string> {
    if (this.sharedRtcAuthority && this.sharedRtcMediaAuthoritySnapshot) {
      return new Set(this.sharedRtcMediaAuthoritySnapshot.liveClerkUserIds);
    }

    const liveClerkIds = new Set<string>();

    if (!this.sharedRtcAuthority) {
      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as (
          Partial<WsAttachment> & { participant_id?: string }
        ) | null;

        if (attachment?.socket_role === "media" && attachment.clerk_user_id) {
          liveClerkIds.add(attachment.clerk_user_id);
        }
      }

      return liveClerkIds;
    }

    let activeMediaClerkIds: Set<string> | null = null;
    try {
      activeMediaClerkIds = new Set<string>();
      for (const row of this.ctx.storage.sql.exec(
        `SELECT DISTINCT p.clerk_user_id
         FROM participants p
         LEFT JOIN pending_reconnects r ON r.participant_id = p.id
         WHERE p.clerk_user_id IS NOT NULL
           AND (
             p.pull_session_id IS NOT NULL
             OR p.push_session_cam IS NOT NULL
             OR p.push_session_screen IS NOT NULL
             OR (r.disconnected_at IS NOT NULL AND r.disconnected_at > ?)
           )`,
        now - MEDIA_RECONNECT_GRACE_PERIOD_MS,
      )) {
        const clerkUserId = row.clerk_user_id as string | null;
        if (clerkUserId) {
          activeMediaClerkIds.add(clerkUserId);
        }
      }
    } catch {
      activeMediaClerkIds = null;
    }

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as (
        Partial<WsAttachment> & { participant_id?: string }
      ) | null;

      if (attachment?.socket_role !== "media" || !attachment.clerk_user_id) continue;
      if (activeMediaClerkIds && !activeMediaClerkIds.has(attachment.clerk_user_id)) continue;
      liveClerkIds.add(attachment.clerk_user_id);
    }

    return liveClerkIds;
  }

  private collectActiveMediaClerkIds(now: number): Set<string> {
    if (this.sharedRtcAuthority && this.sharedRtcMediaAuthoritySnapshot) {
      return new Set(this.sharedRtcMediaAuthoritySnapshot.activeClerkUserIds);
    }

    const activeClerkIds = new Set<string>();

    for (const clerkUserId of this.collectLiveMediaClerkIds(now)) {
      activeClerkIds.add(clerkUserId);
    }

    try {
      for (const row of this.ctx.storage.sql.exec(
        `SELECT p.clerk_user_id
         FROM pending_reconnects r
         JOIN participants p ON p.id = r.participant_id
         WHERE p.clerk_user_id IS NOT NULL
           AND r.disconnected_at > ?`,
        now - MEDIA_RECONNECT_GRACE_PERIOD_MS,
      )) {
        const clerkUserId = row.clerk_user_id as string | null;
        if (clerkUserId) activeClerkIds.add(clerkUserId);
      }
    } catch {
      // Split-mode MeetingRoom instances do not own VoiceRoom's SQLite tables.
    }

    return activeClerkIds;
  }

  syncVoiceMemberConnectionStatesFromMedia(clerkUserId?: string): boolean {
    if (!this.sharedRtcAuthority) return false;

    const changedChannelIds = new Set<string>();
    const sharedVoiceAuthoritySnapshot = this.sharedRtcVoiceAuthoritySnapshot;
    if (sharedVoiceAuthoritySnapshot) {
      if (clerkUserId) {
        const channelId = sharedVoiceAuthoritySnapshot.channelIdByClerkUserId.get(clerkUserId);
        if (channelId) {
          changedChannelIds.add(channelId);
        }
      } else {
        for (const channelId of sharedVoiceAuthoritySnapshot.channels.keys()) {
          changedChannelIds.add(channelId);
        }
      }
    } else {
      const activeMediaClerkIds = this.collectActiveMediaClerkIds(Date.now());
      const maybeAdd = (session: SharedRtcControlSessionSnapshot | WsAttachment) => {
        if (!session.clerk_user_id || !session.voice_channel_id) return;
        if (clerkUserId && session.clerk_user_id !== clerkUserId) return;
        if (!activeMediaClerkIds.has(session.clerk_user_id)) return;
        changedChannelIds.add(session.voice_channel_id);
      };

      // Fallback for transitional states before RtcRoom has injected the shared
      // voice-authority snapshot. Once present, shared voice roster reads and
      // rebroadcasts should come from that authority snapshot instead.
      for (const session of this.getSharedRtcControlSessionCandidates().values()) {
        maybeAdd(session);
      }
    }

    if (changedChannelIds.size === 0) return false;

    for (const channelId of changedChannelIds) {
      this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));
    }

    return true;
  }

  applyRtcRoomSharedProjectionCleanup(channelIds: Iterable<string>): boolean {
    if (!this.sharedRtcAuthority) return false;

    let changed = false;
    for (const channelId of channelIds) {
      this.pruneSharedRtcVoiceChannelIfEmpty(channelId);
      this.invalidateSharedRtcVoiceChannelState(channelId);
      changed = true;
    }

    return changed;
  }

  prepareRtcRoomPendingCallAcceptForVoiceJoin(clerkUserId: string, channelId: string) {
    if (!this.sharedRtcAuthority) return null;
    return this.preparePendingCallAcceptForVoiceJoin(clerkUserId, channelId);
  }

  applyRtcRoomPendingCallAccepted(pending: PendingCall) {
    if (!this.sharedRtcAuthority) return false;
    return this.applyPendingCallAccepted(
      pending,
      `Implicitly accepted call ${pending.callId} via voice join for ${pending.calleeId}`,
    );
  }

  prepareRtcRoomPendingCallAbandonedForChannel(channelId: string) {
    if (!this.sharedRtcAuthority) return null;
    return this.prepareAbandonedPendingCallForChannel(channelId);
  }

  applyRtcRoomPendingCallAbandoned(pending: PendingCall) {
    if (!this.sharedRtcAuthority) return false;
    return this.applyPendingCallAbandoned(pending);
  }

  applyRtcRoomPendingCallTimedOut(pending: PendingCall) {
    if (!this.sharedRtcAuthority) return false;
    return this.applyPendingCallStop(
      pending,
      "timeout",
      `Call ${pending.callId} ring timed out (caller stays in voice channel)`,
    );
  }

  reconcileVoiceMembersFromMedia(): boolean {
    if (!this.sharedRtcAuthority) return false;

    const authoritativeChannelIds = new Set(this.sharedRtcVoiceAuthoritySnapshot?.channels.keys() ?? []);
    const staleChannelIds = new Set<string>();

    for (const channelId of this.voiceChannelMembers.keys()) {
      if (!authoritativeChannelIds.has(channelId)) {
        staleChannelIds.add(channelId);
      }
    }
    const clearedProjectedCache = this.clearProjectedVoiceChannelMemberCache();

    let prunedStartedAt = false;
    for (const channelId of [...this.voiceChannelStartedAt.keys()]) {
      if (authoritativeChannelIds.has(channelId)) continue;
      this.voiceChannelStartedAt.delete(channelId);
      staleChannelIds.add(channelId);
      prunedStartedAt = true;
    }
    if (prunedStartedAt) {
      this.persistVoiceChannelStartedAt();
    }

    const rebroadcasted = this.sharedRtcVoiceAuthoritySnapshot
      ? this.syncVoiceMemberConnectionStatesFromMedia()
      : false;
    for (const channelId of staleChannelIds) {
      this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));
    }

    return clearedProjectedCache || prunedStartedAt || rebroadcasted || staleChannelIds.size > 0;
  }

  /** Remove voice channel members that no longer have authoritative presence backing */
  private reconcileVoiceMembers() {
    const now = Date.now();
    // Build a set of clerk_user_ids that have authoritative media truth.
    // In split mode we still keep resumable control sessions alive for
    // backward compatibility. In shared RTC mode, voice membership should be
    // bounded by the media reconnect lease instead of the longer control
    // resume window so stale control truth cannot outlive dead media.
    const activeClerkIds = new Set<string>();
    if (!this.sharedRtcAuthority) {
      for (const [, session] of this.sessions) {
        if (session.clerk_user_id) {
          activeClerkIds.add(session.clerk_user_id);
        }
      }
    }
    // Also include resumable sessions (disconnected but within grace period)
    if (!this.sharedRtcAuthority) {
      for (const [sessionId, disconnectedAt] of this.resumableSessionExpiry) {
        if (now - disconnectedAt >= RESUME_GRACE_PERIOD_MS) continue;
        const resumable = this.resumableSessions.get(sessionId);
        if (resumable?.clerk_user_id) {
          activeClerkIds.add(resumable.clerk_user_id);
        }
      }
    }
    for (const clerkUserId of this.collectActiveMediaClerkIds(now)) {
      activeClerkIds.add(clerkUserId);
    }

    let changed = false;
    const changedChannelIds = new Set<string>();
    for (const [channelId, members] of this.voiceChannelMembers) {
      for (const [clerkId, member] of members) {
        if (activeClerkIds.has(clerkId)) continue;

        if (this.sharedRtcAuthority) {
          const reconnectExpiresAt = member.reconnect_expires_at;
          if (typeof reconnectExpiresAt === "number" && Number.isFinite(reconnectExpiresAt) && reconnectExpiresAt > now) {
            continue;
          }
        }

        members.delete(clerkId);
        changed = true;
        changedChannelIds.add(channelId);
        log.info(`Reconcile: removed stale voice member ${clerkId} from channel ${channelId}`);
      }
      if (members.size === 0) {
        this.voiceChannelMembers.delete(channelId);
        this.deleteVoiceChannelStorage(channelId);
        this.voiceChannelStartedAt.delete(channelId);
        this.persistVoiceChannelStartedAt();
        changed = true;
        changedChannelIds.add(channelId);
      }
    }

    if (changed) {
      this.persistVoiceChannelMembers();
      for (const channelId of changedChannelIds) {
        this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));
      }
    }
  }

  /**
   * Clears stale control-side voice membership so resume cannot resurrect
   * a shared-RTC member after media authority has expired.
   */
  private clearVoiceChannelControlMembership(clerkUserId: string, channelId: string) {
    for (const [ws, session] of this.sessions) {
      if (session.clerk_user_id !== clerkUserId || session.voice_channel_id !== channelId) continue;
      session.voice_channel_id = undefined;
      session.voice_joined_at = undefined;
      this.persist(ws, session);
    }

    if (this.sharedRtcAuthority) return;

    for (const [sessionId, attachment] of this.resumableSessions) {
      if (attachment.clerk_user_id !== clerkUserId || attachment.voice_channel_id !== channelId) continue;
      attachment.voice_channel_id = undefined;
      attachment.voice_joined_at = undefined;
      this.resumableSessions.set(sessionId, attachment);
      this.persistResumableSession(sessionId, attachment);
    }
  }

  private getSession(ws: WebSocket): WsAttachment | undefined {
    return this.sessions.get(ws);
  }

  private toSharedRtcControlSessionSnapshot(session: WsAttachment): SharedRtcControlSessionSnapshot {
    return {
      id: session.id,
      name: session.name,
      username: session.username,
      display_name: session.display_name ?? null,
      avatar_url: session.avatar_url ?? null,
      avatar_display: session.avatar_display ?? null,
      clerk_user_id: session.clerk_user_id ?? "",
      stream_preview_url: session.stream_preview_url ?? null,
      self_mute: session.self_mute,
      self_deaf: session.self_deaf,
      self_stream: session.self_stream,
      self_stream_audio: session.self_stream_audio,
      self_video: session.self_video,
      spatial_audio_enabled: session.spatial_audio_enabled,
      spatial_audio_high_fidelity: session.spatial_audio_high_fidelity,
      suppress: session.suppress ?? false,
      tracks: [...(session.tracks ?? [])],
      voice_channel_id: session.voice_channel_id,
      voice_joined_at: session.voice_joined_at,
    };
  }

  private requireSession(ws: WebSocket): WsAttachment | null {
    const session = this.getSession(ws);
    if (!session) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.NotAuthenticated, message: "Not identified" },
      });
      return null;
    }
    return session;
  }

  private buildVoiceState(data: RtcRoomControlSessionEffectsSession): VoiceState {
    return {
      id: data.id,
      clerk_user_id: data.clerk_user_id,
      name: data.name,
      username: data.username,
      display_name: data.display_name,
      avatar_url: data.avatar_url ?? undefined,
      avatar_display: data.avatar_display,
      stream_preview_url: data.stream_preview_url,
      self_mute: data.self_mute,
      self_deaf: data.self_deaf,
      self_stream: data.self_stream,
      self_stream_audio: data.self_stream_audio,
      self_video: data.self_video,
      spatial_audio_enabled: data.spatial_audio_enabled,
      spatial_audio_high_fidelity: data.spatial_audio_high_fidelity,
      suppress: data.suppress,
      status: data.status,
      tracks: [...data.tracks],
    };
  }

  private buildRtcRoomControlParticipants(excludedParticipantId?: string) {
    const participants: VoiceState[] = [];

    if (!this.sharedRtcAuthority) {
      for (const data of this.sessions.values()) {
        if (excludedParticipantId && data.id === excludedParticipantId) continue;
        participants.push(this.buildVoiceState(data));
      }
      return participants;
    }

    for (const data of this.getSharedRtcControlParticipantCandidates().values()) {
      if (excludedParticipantId && data.id === excludedParticipantId) continue;
      participants.push(this.buildVoiceState(data));
    }

    return participants;
  }

  private buildRtcRoomInitialControlAttachment(
    clerkUserId: string | undefined,
    identifyData: RtcRoomIdentifySessionData,
    now = Date.now(),
  ): WsAttachment {
    return {
      socket_role: "control",
      id: identifyData.participantId,
      name: identifyData.name,
      username: identifyData.username,
      display_name: identifyData.displayName ?? null,
      avatar_url: identifyData.avatarUrl,
      avatar_display: identifyData.avatarDisplay ?? null,
      clerk_user_id: clerkUserId,
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
      last_heartbeat: now,
      seq: 0,
      subscribed_channels: [],
      subscribed_servers: [],
    };
  }

  private restoreRtcRoomSubscriptions(
    ws: WebSocket,
    session: RtcRoomControlSessionEffectsSession,
  ) {
    if (session.subscribed_channels) {
      for (const chId of session.subscribed_channels) {
        let subs = this.channelSubscriptions.get(chId);
        if (!subs) {
          subs = new Set();
          this.channelSubscriptions.set(chId, subs);
        }
        subs.add(ws);
      }
    }
    if (session.subscribed_servers) {
      for (const sId of session.subscribed_servers) {
        let subs = this.serverSubscriptions.get(sId);
        if (!subs) {
          subs = new Set();
          this.serverSubscriptions.set(sId, subs);
        }
        subs.add(ws);
      }
    }
  }

  private async restoreRtcRoomVoiceMembershipOnResume(
    session: RtcRoomControlSessionEffectsSession,
  ) {
    const resumeVoiceChannelId = session.voice_channel_id;
    const resumeClerkUserId = session.clerk_user_id;
    if (!resumeVoiceChannelId || !resumeClerkUserId) return;

    if (this.sharedRtcAuthority) {
      return;
    }

    this.markVoiceMemberConnected(resumeVoiceChannelId, session);
    await this.broadcastVoiceChannelState(resumeVoiceChannelId);
  }

  private sendRtcRoomResumedPayload(
    ws: WebSocket,
    session: WsAttachment,
    credentials: RtcRoomVoiceCredentials,
    includeSpatialAudioState: boolean,
  ) {
    sendRtcRoomResumedPayloadValue(
      this.createRtcRoomControlSessionEffectsAdapter(),
      ws,
      session,
      credentials,
      {
        includeSpatialAudioState,
        spatialAudioScopeId: session.voice_channel_id || this.roomSlug,
      },
    );
  }

  private get roomSlug(): string { return this._roomSlug; }
  private set roomSlug(val: string) { this._roomSlug = val; }

  private getResumableSessionStorageKey(id: string) {
    return `${RESUME_SESSION_KEY_PREFIX}${id}`;
  }

  private getResumableSessionExpiryStorageKey(id: string) {
    return `${RESUME_EXPIRY_KEY_PREFIX}${id}`;
  }

  /** Persist a single resumable control-session snapshot for hibernation/restart survival */
  private persistResumableSession(id: string, attachment: WsAttachment) {
    this.markDirty(this.getResumableSessionStorageKey(id), attachment);
  }

  /** Persist a single resumable-session expiry timestamp for alarm-driven pruning */
  private persistResumableSessionExpiryEntry(id: string, ts: number) {
    this.markDirty(this.getResumableSessionExpiryStorageKey(id), ts);
  }

  private deleteResumableSession(id: string) {
    this.resumableSessions.delete(id);
    this.deleteStorageKey(this.getResumableSessionStorageKey(id));
  }

  private deleteResumableSessionExpiry(id: string) {
    this.resumableSessionExpiry.delete(id);
    this.deleteStorageKey(this.getResumableSessionExpiryStorageKey(id));
  }

  private getPendingPresenceStorageKey(clerkId: string) {
    return `${PRESENCE_PENDING_KEY_PREFIX}${clerkId}`;
  }

  private persistPendingPresence(clerkId: string, pending: PendingPresenceWrite) {
    this.markDirty(this.getPendingPresenceStorageKey(clerkId), pending);
  }

  private deletePendingPresence(clerkId: string) {
    this.presenceD1Pending.delete(clerkId);
    this.deleteStorageKey(this.getPendingPresenceStorageKey(clerkId));
  }

  private async persistPresenceStatusToD1(clerkId: string, status: string) {
    await this.env.DB.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, new Date().toISOString(), clerkId)
      .run();

    const { results } = await this.env.DB.prepare("SELECT server_id FROM server_members WHERE user_id = ?")
      .bind(clerkId)
      .all();

    if (!results) return;

    await Promise.allSettled(results.map((row) => {
      const serverId = row.server_id as string;
      return this.env.CACHE.delete(`v1:server:members:${serverId}`);
    }));
  }

  private async flushDuePresenceWrites(now: number) {
    const dueWrites: Array<{ clerkId: string; status: string }> = [];
    for (const [clerkId, pending] of this.presenceD1Pending) {
      if (pending.dueAt > now) continue;
      dueWrites.push({ clerkId, status: pending.status });
      this.deletePendingPresence(clerkId);
    }

    for (const dueWrite of dueWrites) {
      try {
        await this.persistPresenceStatusToD1(dueWrite.clerkId, dueWrite.status);
      } catch (e) {
        presenceLog.error("D1 update failed:", e);
      }
    }
  }

  /** Persist pending call deadlines so ring expiry survives hibernation/restarts */
  private persistPendingCalls() {
    const serialized: Record<string, PendingCall> = {};
    for (const [calleeId, pending] of this.pendingCalls) {
      serialized[calleeId] = pending;
    }
    this.markDirty("pendingCalls", serialized);
  }

  /** Persist accepted-call TTL cache so short late-arrival races survive restarts */
  private persistAcceptedCalls() {
    const serialized: Record<string, number> = {};
    for (const [callId, expiresAt] of this.acceptedCalls) {
      serialized[callId] = expiresAt;
    }
    this.markDirty("acceptedCallExpiry", serialized);
  }

  private markAcceptedCall(callId: string, expiresAt = Date.now() + ACCEPTED_CALL_TTL_MS) {
    this.acceptedCalls.set(callId, expiresAt);
    this.persistAcceptedCalls();
    this.scheduleAlarm();
  }

  private hasAcceptedCall(callId: string, now = Date.now()) {
    const expiresAt = this.acceptedCalls.get(callId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.acceptedCalls.delete(callId);
      this.persistAcceptedCalls();
      return false;
    }
    return true;
  }

  private pruneExpiredAcceptedCalls(now: number) {
    let changed = false;
    for (const [callId, expiresAt] of this.acceptedCalls) {
      if (expiresAt > now) continue;
      this.acceptedCalls.delete(callId);
      changed = true;
    }
    return changed;
  }

  private expirePendingCalls(now: number) {
    const expired: PendingCall[] = [];
    for (const [calleeId, pending] of this.pendingCalls) {
      if (pending.expiresAt > now) continue;
      this.pendingCalls.delete(calleeId);
      expired.push(pending);
    }
    return expired;
  }

  private runPendingCallAlarmMaintenance(now: number) {
    const expiredPendingCalls = this.expirePendingCalls(now);
    if (expiredPendingCalls.length > 0) {
      this.persistPendingCalls();
      for (const pending of expiredPendingCalls) {
        this.broadcastPendingCallStop(pending, "timeout");
        log.info(`Call ${pending.callId} ring timed out (caller stays in voice channel)`);
      }
    }

    if (this.pruneExpiredAcceptedCalls(now)) {
      this.persistAcceptedCalls();
    }
  }

  // ── Op 0: Identify ────────────────────────────────────────────────────

  private async handleIdentify(
    ws: WebSocket,
    d: { name: string; username?: string; display_name?: string | null; avatar_url?: string; avatar_display?: string | null; clerk_user_id?: string }
  ) {
    if (this.getSession(ws)) {
      log.info(`AlreadyAuthenticated — session exists for this WS`);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.AlreadyAuthenticated, message: "Already identified" },
      });
      return;
    }

    try {
      const participantId = crypto.randomUUID();
      const identifyData = await this.resolveRtcRoomControlIdentifySessionData(participantId, d);
      const attachment = this.buildRtcRoomInitialControlAttachment(
        d.clerk_user_id,
        identifyData,
      );

      this.persist(ws, attachment);
      this.applyRtcRoomControlIdentifyFromSocket(ws, identifyData);
    } catch (err) {
      meetingLog.error("handleIdentify crashed:", err);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: `Identify failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
      });
    }
  }

  // ── Op 3: Heartbeat ────────────────────────────────────────────────────

  private handleHeartbeat(ws: WebSocket, d: { seq_ack: number }) {
    const session = this.getSession(ws);

    // Always ACK the heartbeat — even for unidentified sessions.
    // When the DO is awake (e.g. woken by a broadcast), heartbeats arrive
    // through webSocketMessage instead of the auto-response path. Dropping
    // them (i.e. returning early) starves the client of ACKs, causing the
    // client-side HeartbeatManager to declare a zombie and disconnect after
    // 3 missed beats (135s). The ACK is cheap; never suppress it.
    if (!session) {
      this.sendTo(ws, { op: Op.HeartbeatACK, d: { seq: 0 } });
      return;
    }

    session.last_heartbeat = Date.now();
    session.seq = (session.seq ?? 0) + 1;
    this.persist(ws, session);

    this.sendTo(ws, {
      op: Op.HeartbeatACK,
      d: { seq: session.seq },
    });
  }

  // ── Op 7: Resume ──────────────────────────────────────────────────────

  private async handleResume(ws: WebSocket, d: { session_id: string; seq_ack: number }) {
    const oldAttachment = this.resumableSessions.get(d.session_id);
    if (!oldAttachment) {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.SessionInvalid, message: "Session not found for resume" },
      });
      return;
    }

    const disconnectedAt = this.resumableSessionExpiry.get(d.session_id);
    if (
      typeof disconnectedAt === "number" &&
      !isReconnectWithinGrace(disconnectedAt, Date.now(), RESUME_GRACE_PERIOD_MS)
    ) {
      this.deleteResumableSession(d.session_id);
      this.deleteResumableSessionExpiry(d.session_id);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: CloseCode.SessionInvalid, message: "Session expired for resume" },
      });
      return;
    }

    // Clear the expiry — session is alive again
    this.deleteResumableSessionExpiry(d.session_id);

    oldAttachment.last_heartbeat = Date.now();
    this.persist(ws, oldAttachment);
    const credentials = await this.fetchRtcRoomVoiceCredentials(oldAttachment.id, oldAttachment.clerk_user_id);
    await this.applyRtcRoomControlResumeFromSocket(ws, credentials);
  }

  private async handleRefreshVoiceCredentials(ws: WebSocket) {
    const session = this.requireSession(ws);
    if (!session) return;
    const credentials = await this.fetchRtcRoomVoiceCredentials(session.id, session.clerk_user_id);
    this.applyRtcRoomRefreshVoiceCredentialsFromSocket(ws, credentials);
  }

  // ── Op 15: VoiceStateUpdate (C→S) — mute/camera state changes ──────

  private handleVoiceStateUpdate(
    ws: WebSocket,
    d: {
      self_mute?: boolean;
      self_deaf?: boolean;
      self_video?: boolean;
      self_stream?: boolean;
      self_stream_audio?: boolean;
      stream_preview_url?: string | null;
      spatial_audio_enabled?: boolean;
      spatial_audio_high_fidelity?: boolean;
      spatial_audio_state?: SpatialAudioState;
    }
  ) {
    const session = this.requireSession(ws);
    if (!session) return;

    if (d.self_mute !== undefined) session.self_mute = d.self_mute;
    if (d.self_deaf !== undefined) session.self_deaf = d.self_deaf;
    if (d.self_video !== undefined) session.self_video = d.self_video;
    if (d.self_stream !== undefined) session.self_stream = d.self_stream;
    if (d.self_stream_audio !== undefined) session.self_stream_audio = d.self_stream_audio;
    if (d.stream_preview_url !== undefined) session.stream_preview_url = d.stream_preview_url;
    if (d.spatial_audio_enabled !== undefined) session.spatial_audio_enabled = d.spatial_audio_enabled;
    if (d.spatial_audio_high_fidelity !== undefined) session.spatial_audio_high_fidelity = d.spatial_audio_high_fidelity;
    this.persist(ws, session);
    this.applyRtcRoomVoiceStateUpdateFromSocket(ws, d.spatial_audio_state);
  }

  // ── Op 26: PresenceUpdate (C→S) ──────────────────────────────────────────

  private handlePresenceUpdate(ws: WebSocket, d: { status: "online" | "idle" | "dnd" | "offline" }) {
    const session = this.requireSession(ws);
    if (!session) return;

    if (!["online", "idle", "dnd", "offline"].includes(d.status)) return;

    session.status = d.status;
    this.persist(ws, session);
    this.applyRtcRoomPresenceUpdateFromSocket(ws, d.status);
  }

  /** Debounce D1 presence writes durably — only the final status is flushed after the quiet period */
  private debouncePersistPresence(clerkId: string, status: string) {
    const pending: PendingPresenceWrite = {
      status,
      dueAt: Date.now() + PRESENCE_DEBOUNCE_MS,
    };
    this.presenceD1Pending.set(clerkId, pending);
    this.persistPendingPresence(clerkId, pending);
    this.scheduleAlarm();
  }

  // ── Op 17: ProfileRefresh ──────────────────────────────────────────────

  private async handleProfileRefresh(ws: WebSocket) {
    const session = this.requireSession(ws);
    if (!session?.clerk_user_id) return;

    if (!this.consumeRtcRoomProfileRefreshCooldown(session.id)) return;

    const verified = await this.fetchRtcRoomProfileRefreshData(session.clerk_user_id);
    if (verified) {
      session.name = verified.name;
      session.username = verified.username;
      session.display_name = verified.displayName ?? null;
      session.avatar_url = verified.avatarUrl;
      session.avatar_display = verified.avatarDisplay ?? null;
      this.persist(ws, session);
      this.applyProfileRefreshEffects(ws, session, verified);
    }
  }

  private applyProfileRefreshEffects(
    ws: WebSocket,
    session: WsAttachment,
    verified: VerifiedClerkProfile,
  ) {
    return applyRtcRoomProfileRefreshEffects(
      this.createRtcRoomControlSessionEffectsAdapter(),
      ws,
      session,
      verified,
    );
  }

  // ── Leave / Disconnect ─────────────────────────────────────────────────

  private async handleLeave(ws: WebSocket, intentional: boolean = false, closeSocket: boolean = true) {
    this.applyControlDisconnectLifecycle(ws, {
      intentional,
      closeSocket,
      closeCode: 1000,
      closeReason: "Left room",
      persistControlStorage: true,
    });
  }

  private applyControlDisconnectLifecycle(
    ws: WebSocket,
    options: {
      intentional: boolean;
      now?: number;
      previousChannelId?: string;
      closeSocket?: boolean;
      closeCode?: number;
      closeReason?: string;
      persistControlStorage: boolean;
    },
  ): RtcRoomControlDisconnectEffectsResult | null {
    if (!this.getSession(ws)) {
      this.rehydrateRtcRoomControlSessionFromSocket(ws);
    }

    const session = this.getSession(ws);
    if (!session) return null;

    const intentional = options.intentional === true;
    const now = options.now ?? Date.now();
    const closeSocket = options.closeSocket ?? true;
    const closeCode = options.closeCode ?? 1000;
    const closeReason = options.closeReason ?? "Left room";
    const persistControlStorage = options.persistControlStorage !== false;

    if (session.clerk_user_id) {
      let otherSessionExists = false;
      for (const [otherWs, otherSession] of this.sessions) {
        if (otherWs !== ws && otherSession.clerk_user_id === session.clerk_user_id) {
          otherSessionExists = true;
          break;
        }
      }
      if (!otherSessionExists) {
        this.broadcast(
          {
            op: Op.Dispatch,
            d: {
              event: "PRESENCE_UPDATE",
              data: {
                user_id: session.clerk_user_id,
                status: "offline",
              },
            },
          },
          ws,
        );
      }
    }

    const previousChannelId = options.previousChannelId ?? session.voice_channel_id;
    if (previousChannelId) {
      if (intentional) {
        session.voice_channel_id = undefined;
        session.voice_joined_at = undefined;
        if (session.clerk_user_id && !this.sharedRtcAuthority) {
          this.applyRtcRoomVoiceChannelTransition(
            this.toSharedRtcControlSessionSnapshot(session),
            { previousChannelId },
          );
        }
      } else if (!this.sharedRtcAuthority) {
        this.markVoiceMemberReconnecting(session, now, ws);
      }
    }

    if (session.clerk_user_id && !this.sharedRtcAuthority) {
      this.cleanupCallsForUser(session.clerk_user_id, "disconnected");
    }

    this.cleanupChannelSubscriptions(ws);
    this.cleanupServerSubscriptions(ws);

    const participantId = session.id;
    this.sessions.delete(ws);
    this.profileRefreshCooldowns.delete(participantId);

    if (shouldKeepResumableSession(intentional)) {
      if (!this.sharedRtcAuthority || persistControlStorage) {
        this.resumableSessions.set(participantId, session);
      }
      if (!this.sharedRtcAuthority) {
        this.resumableSessionExpiry.set(participantId, now);
        if (persistControlStorage) {
          this.persistResumableSessionExpiryEntry(participantId, now);
        }
      }
      if (!this.sharedRtcAuthority) {
        this.scheduleAlarm();
      }
    } else if (persistControlStorage) {
      this.deleteResumableSession(participantId);
      this.deleteResumableSessionExpiry(participantId);
    } else {
      this.resumableSessions.delete(participantId);
      this.resumableSessionExpiry.delete(participantId);
    }

    if (intentional) {
      this.broadcast(
        {
          op: Op.VoiceStateUpdate,
          d: {
            participant: this.buildVoiceState(session),
            action: "leave",
          },
        },
        ws,
      );
    }

    if (closeSocket) {
      try { ws.close(closeCode, closeReason); } catch { /* already closed */ }
    }

    return {
      keepResumable: shouldKeepResumableSession(intentional),
      participantId,
      disconnectedAt: shouldKeepResumableSession(intentional) ? now : null,
    };
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  private sendTo(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* closed */ }
  }

  private broadcast(msg: ServerMsg, excludeWs?: WebSocket) {
    const json = JSON.stringify(msg);
    for (const [ws, session] of this.sessions) {
      if (ws === excludeWs) continue;
      try { ws.send(json); } catch { /* skip dead */ }
    }
  }

  /** Send a message to all clients subscribed to a specific channel */
  private broadcastToChannel(channelId: string, msg: ServerMsg, excludeWs?: WebSocket) {
    const subscribers = this.channelSubscriptions.get(channelId);
    if (!subscribers) return;

    const json = JSON.stringify(msg);
    for (const ws of subscribers) {
      if (ws === excludeWs) continue;
      try { ws.send(json); } catch { /* skip dead */ }
    }
  }

  /** Send a message to all sessions that are members of a server */
  private broadcastToServerMembers(serverId: string, msg: ServerMsg, excludeWs?: WebSocket) {
    const subscribers = this.serverSubscriptions.get(serverId);
    if (!subscribers) return;

    const json = JSON.stringify(msg);
    for (const ws of subscribers) {
      if (ws === excludeWs) continue;
      try { ws.send(json); } catch { /* skip dead */ }
    }
  }

  /** Send a message to all sessions of a specific user */
  private broadcastToUser(userId: string, msg: ServerMsg) {
    const json = JSON.stringify(msg);
    let count = 0;
    for (const [ws, session] of this.sessions) {
      if (session.clerk_user_id === userId) {
        try {
          ws.send(json);
          count++;
        } catch { /* skip dead */ }
      }
    }
    log.info(`broadcastToUser ${userId}: sent to ${count} sessions`);
  }

  // ── Op 27: ChannelSubscribe ───────────────────────────────────────────

  private handleChannelSubscribe(ws: WebSocket, d: { channel_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id) return;

    if (!session.subscribed_channels.includes(d.channel_id)) {
      session.subscribed_channels.push(d.channel_id);
      this.persist(ws, session);
    }
    this.applyRtcRoomChannelSubscribeFromSocket(ws, d);
  }

  // ── Op 28: ChannelUnsubscribe ─────────────────────────────────────────

  private handleChannelUnsubscribe(ws: WebSocket, d: { channel_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id) return;

    session.subscribed_channels = session.subscribed_channels.filter(
      (id) => id !== d.channel_id
    );
    this.persist(ws, session);
    this.applyRtcRoomChannelUnsubscribeFromSocket(ws, d);
  }

  // ── Op 33: VoiceChannelJoin ────────────────────────────────────────────

  applyVoiceChannelTransitionEffects(
    transition: VoiceChannelTransitionEffectsInput,
  ) {
    const clerkUserId = transition.clerk_user_id;
    const fromChannelId = transition.from_channel_id ?? undefined;
    const toChannelId = transition.to_channel_id ?? undefined;
    if (!clerkUserId || (!fromChannelId && !toChannelId)) return false;

    const liveMediaClerkIds = this.collectLiveMediaClerkIds();
    const changedChannelIds = new Set<string>();
    const normalizedJoinedAt = this.normalizeVoiceChannelStartedAt(transition.joined_at);
    const normalizedCandidateStartedAt = this.normalizeVoiceChannelStartedAt(
      transition.candidate_started_at,
    );
    const session = transition.session ?? this.findVoiceMemberControlSession(clerkUserId);

    if (fromChannelId && fromChannelId !== toChannelId) {
      this.applyVoiceChannelDepartureEffects(fromChannelId, clerkUserId);
      changedChannelIds.add(fromChannelId);
    }

    if (toChannelId) {
      const joinedAt = this.resolveVoiceJoinedAt(
        toChannelId,
        normalizedJoinedAt ?? normalizedCandidateStartedAt,
        session?.voice_joined_at,
      );
      this.maintainVoiceChannelStartedAt(
        toChannelId,
        normalizedCandidateStartedAt ?? joinedAt,
      );

      if (
        this.applyVoiceChannelArrivalEffects(
          toChannelId,
          clerkUserId,
          joinedAt,
          session,
          liveMediaClerkIds,
        )
      ) {
        changedChannelIds.add(toChannelId);
      }

      if (fromChannelId !== toChannelId) {
        this.handleImplicitVoiceChannelJoinCallAccept(clerkUserId, toChannelId);
      }
    }

    for (const channelId of changedChannelIds) {
      this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));
    }

    return changedChannelIds.size > 0;
  }

  private maintainVoiceChannelStartedAt(channelId: string, candidateStartedAt?: number | null) {
    const currentStartedAt = this.voiceChannelStartedAt.get(channelId);
    const nextStartedAt = this.normalizeVoiceChannelStartedAt(candidateStartedAt)
      ?? currentStartedAt
      ?? Date.now();

    if (
      currentStartedAt === undefined ||
      nextStartedAt < currentStartedAt
    ) {
      this.voiceChannelStartedAt.set(channelId, nextStartedAt);
      this.persistVoiceChannelStartedAt();
    }

    return this.voiceChannelStartedAt.get(channelId) ?? nextStartedAt;
  }

  private applyVoiceChannelArrivalEffects(
    channelId: string,
    clerkUserId: string,
    joinedAt: number,
    session: SharedRtcControlSessionSnapshot | WsAttachment | undefined | null,
    liveMediaClerkIds: Set<string>,
  ) {
    if (
      this.sharedRtcAuthority &&
      !this.shouldMaterializeVoiceMember(channelId, clerkUserId, liveMediaClerkIds)
    ) {
      return false;
    }

    if (this.sharedRtcAuthority) {
      return true;
    }

    if (!session) return false;

    this.markVoiceMemberConnected(channelId, session, joinedAt);
    return true;
  }

  private applyVoiceChannelDepartureEffects(channelId: string, clerkUserId: string) {
    if (this.sharedRtcAuthority) {
      const channelEmptied = this.pruneSharedRtcVoiceChannelIfEmpty(channelId);
      if (channelEmptied) {
        this.cancelAbandonedPendingVoiceCall(channelId);
      } else {
        this.invalidateSharedRtcVoiceChannelState(channelId);
      }
      return;
    }

    const members = this.voiceChannelMembers.get(channelId);
    if (members) {
      members.delete(clerkUserId);
      if (members.size === 0) {
        this.voiceChannelMembers.delete(channelId);
        this.deleteVoiceChannelStorage(channelId);
        this.voiceChannelStartedAt.delete(channelId);
        this.persistVoiceChannelStartedAt();
        this.cancelAbandonedPendingVoiceCall(channelId);
      }
    }

    this.persistVoiceChannelMembers();
  }

  private takePendingCallForAcceptance(
    calleeId: string,
    matches: (pending: PendingCall) => boolean,
  ): PendingCall | null {
    const pending = this.pendingCalls.get(calleeId);
    if (!pending || !matches(pending)) return null;

    this.markAcceptedCall(pending.callId);
    this.pendingCalls.delete(calleeId);
    this.persistPendingCalls();
    return pending;
  }

  private preparePendingCallAcceptForVoiceJoin(clerkUserId: string, channelId: string) {
    return this.takePendingCallForAcceptance(
      clerkUserId,
      (pending) => pending.channelId === channelId,
    );
  }

  private prepareAbandonedPendingCallForChannel(channelId: string): PendingCall | null {
    for (const [calleeId, pending] of this.pendingCalls) {
      if (pending.channelId !== channelId) continue;

      this.pendingCalls.delete(calleeId);
      this.persistPendingCalls();
      return pending;
    }

    return null;
  }

  private applyPendingCallStop(
    pending: PendingCall,
    reason: string,
    logMessage: string,
  ) {
    this.broadcastPendingCallStop(pending, reason);
    log.info(logMessage);
    return true;
  }

  private applyPendingCallAccepted(pending: PendingCall, logMessage: string) {
    return this.applyPendingCallStop(pending, "accepted", logMessage);
  }

  private applyPendingCallAbandoned(pending: PendingCall) {
    return this.applyPendingCallStop(
      pending,
      "abandoned",
      `Ended ringing DM ${pending.callId} because the channel emptied`,
    );
  }

  private handleImplicitVoiceChannelJoinCallAccept(clerkUserId: string, channelId: string) {
    const pending = this.preparePendingCallAcceptForVoiceJoin(clerkUserId, channelId);
    if (!pending) return false;

    return this.applyPendingCallAccepted(
      pending,
      `Implicitly accepted call ${pending.callId} via voice join for ${clerkUserId}`,
    );
  }

  private cancelAbandonedPendingVoiceCall(channelId: string) {
    const abandonedPendingCall = this.prepareAbandonedPendingCallForChannel(channelId);
    if (!abandonedPendingCall) return false;
    return this.applyPendingCallAbandoned(abandonedPendingCall);
  }

  private normalizeVoiceChannelStartedAt(startedAt: unknown): number | undefined {
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return undefined;
    const now = Date.now();
    const maxRestoreAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (startedAt < now - maxRestoreAgeMs || startedAt > now + 60_000) return undefined;
    return startedAt;
  }

  private handleVoiceChannelJoin(
    ws: WebSocket,
    d: { channel_id: string; self_mute?: boolean; started_at?: number }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !session.clerk_user_id) return;
    const candidateStartedAt = this.normalizeVoiceChannelStartedAt(d.started_at);
    const previousChannelId = session.voice_channel_id;

    // If already in the same channel (e.g. server added us during handleCallInitiate
    // and now the SFU join fires sendVoiceChannelJoin for the same channel), just
    // update in-place without a redundant transition.
    if (session.voice_channel_id === d.channel_id) {
      // Already in this channel — just update self_mute and broadcast
      session.self_mute = d.self_mute ?? true;
      session.voice_joined_at = this.resolveVoiceJoinedAt(
        d.channel_id,
        candidateStartedAt,
        session.voice_joined_at,
      );
      this.persist(ws, session);
      this.applyRtcRoomVoiceChannelTransition(
        this.toSharedRtcControlSessionSnapshot(session),
        {
          previousChannelId,
          nextChannelId: d.channel_id,
          candidateStartedAt,
        },
      );
      return;
    }

    // Add to new voice channel
    session.voice_channel_id = d.channel_id;
    session.voice_joined_at = this.resolveVoiceJoinedAt(d.channel_id, candidateStartedAt);
    session.self_video = false;
    session.self_stream = false;
    session.stream_preview_url = null;
    this.persist(ws, session);
    this.applyRtcRoomVoiceChannelTransition(
      this.toSharedRtcControlSessionSnapshot(session),
      {
        previousChannelId,
        nextChannelId: d.channel_id,
        candidateStartedAt,
      },
    );
  }

  // ── Op 34: VoiceChannelLeave ───────────────────────────────────────────

  private handleVoiceChannelLeave(ws: WebSocket, d?: { channel_id?: string }) {
    const session = this.requireSession(ws);
    if (!session) return;
    const previousChannelId = session.voice_channel_id;

    // Protection against race conditions (e.g., leaving a previous channel after
    // already successfully connecting to a new one or initiating a call).
    if (d?.channel_id && session.voice_channel_id && session.voice_channel_id !== d.channel_id) {
      log.info(`Ignored stale VoiceChannelLeave for ${d.channel_id}; currently in ${session.voice_channel_id}`);
      return;
    }

    session.voice_channel_id = undefined;
    session.voice_joined_at = undefined;
    this.persist(ws, session);
    this.applyRtcRoomVoiceChannelTransition(
      this.toSharedRtcControlSessionSnapshot(session),
      {
        previousChannelId,
      },
    );
  }

  /** Remove a user from their current voice channel and broadcast the update */
  private removeFromVoiceChannel(session: WsAttachment) {
    const channelId = session.voice_channel_id;
    if (!channelId || !session.clerk_user_id) return;

    if (this.sharedRtcAuthority) {
      this.clearVoiceChannelControlMembership(session.clerk_user_id, channelId);
      const channelEmptied = this.pruneSharedRtcVoiceChannelIfEmpty(channelId);

      if (!channelEmptied) {
        this.invalidateSharedRtcVoiceChannelState(channelId);
      }

      if (channelEmptied) {
        // If the channel is fully empty, check if there's a pending call ringing
        // that we should also cancel (e.g., caller abandoned before answer)
        let abandonedPendingCall: PendingCall | null = null;
        for (const [calleeId, call] of this.pendingCalls) {
          if (call.channelId === channelId) {
            abandonedPendingCall = call;
            this.pendingCalls.delete(calleeId);
            break;
          }
        }

        if (abandonedPendingCall) {
          this.persistPendingCalls();
          const endMsg = { op: Op.Dispatch, d: { event: "CALL_RING_STOP", data: { call_id: abandonedPendingCall.callId, reason: "abandoned" } } };
          this.broadcastToUser(abandonedPendingCall.callerId, endMsg);
          this.broadcastToUser(abandonedPendingCall.calleeId, endMsg);
          log.info(`Ended ringing DM ${abandonedPendingCall.callId} because the channel emptied`);
        }
      }

      return;
    }

    const members = this.voiceChannelMembers.get(channelId);
    if (members) {
      members.delete(session.clerk_user_id);
      if (members.size === 0) {
        this.voiceChannelMembers.delete(channelId);
        this.deleteVoiceChannelStorage(channelId);
        // Channel is now empty — clear the started_at timestamp
        this.voiceChannelStartedAt.delete(channelId);
        this.persistVoiceChannelStartedAt();
      }
    }

    // Broadcast updated state (even if empty — so clients know the channel is empty)
    this.ctx.waitUntil(this.broadcastVoiceChannelState(channelId));

    if (members && members.size === 0) {
      // If the channel is fully empty, check if there's a pending call ringing
      // that we should also cancel (e.g., caller abandoned before answer)
      let abandonedPendingCall: PendingCall | null = null;
      for (const [calleeId, call] of this.pendingCalls) {
        if (call.channelId === channelId) {
          abandonedPendingCall = call;
          break;
        }
      }
      if (abandonedPendingCall) {
        log.info(`DM Call ${abandonedPendingCall.callId} emptied during ring, cancelling pending...`);
        this.pendingCalls.delete(abandonedPendingCall.calleeId);
        this.persistPendingCalls();

        // Tell both parties the ring stopped
        const endMsg = { op: Op.Dispatch, d: { event: "CALL_RING_STOP", data: { call_id: abandonedPendingCall.callId, reason: "abandoned" } } };
        this.broadcastToUser(abandonedPendingCall.callerId, endMsg);
        this.broadcastToUser(abandonedPendingCall.calleeId, endMsg);
      }
    }

    // Persist to storage for hibernation resilience
    this.persistVoiceChannelMembers();

    log.info(`${session.name} left voice channel ${channelId}`);
  }


  private async handleMessageCreate(
    ws: WebSocket,
    d: { channel_id: string; content: string; reply_to_id?: string; nonce?: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !d.content) return;

    if (this.roomSlug !== "global-gateway") {
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 4000, message: "This gateway cannot create persisted channel messages" },
      });
      return;
    }

    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Persist to D1
    try {
      await this.env.DB.prepare(
        `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(messageId, d.channel_id, session.clerk_user_id ?? session.id, d.content, d.reply_to_id ?? null, now)
        .run();
    } catch (err) {
      log.error("Failed to insert message:", err);
      this.sendTo(ws, {
        op: Op.Error,
        d: { code: 5000, message: "Failed to save message" },
      });
      return;
    }

    // Build message object for dispatch
    const message = {
      id: messageId,
      channel_id: d.channel_id,
      author_id: session.clerk_user_id ?? session.id,
      author: {
        id: session.clerk_user_id ?? session.id,
        username: session.username ?? session.name,
        display_name: session.display_name ?? session.name,
        avatar_url: session.avatar_url,
        avatar_display: session.avatar_display,
      },
      content: d.content,
      reply_to_id: d.reply_to_id,
      is_pinned: false,
      created_at: now,
      nonce: d.nonce,
      attachments: [],
      reactions: [],
    };

    // Dispatch to all subscribers of this channel (including sender for confirmation)
    this.broadcastToChannel(d.channel_id, {
      op: Op.Dispatch,
      d: { event: "MESSAGE_CREATE", data: message },
    });

    // Asynchronously fetch embeds without blocking the initial send
    this.ctx.waitUntil((async () => {
      const embeds = await extractAndProcessEmbeds(d.content);
      if (embeds.length > 0) {
        try {
          // Store embeds in the database
          await this.env.DB.prepare(
            `UPDATE messages SET embeds = ? WHERE id = ?`
          ).bind(JSON.stringify(embeds), messageId).run();

          // Dispatch update event to clients
          this.broadcastToChannel(d.channel_id, {
            op: Op.Dispatch,
            d: {
              event: "MESSAGE_UPDATE",
              data: {
                id: messageId,
                channel_id: d.channel_id,
                embeds: embeds
              }
            }
          });
        } catch (e) {
          log.error("Failed to update message with embeds:", e);
        }
      }
    })());
  }

  // ── Op 21: MessageUpdate ──────────────────────────────────────────────

  private async handleMessageUpdate(
    ws: WebSocket,
    d: { message_id: string; content: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.message_id || !d.content) return;

    const now = new Date().toISOString();
    const authorId = session.clerk_user_id ?? session.id;

    // Only allow editing own messages
    try {
      const result = await this.env.DB.prepare(
        `UPDATE messages SET content = ?, updated_at = ?
         WHERE id = ? AND author_id = ?`
      )
        .bind(d.content, now, d.message_id, authorId)
        .run();

      if (!result.meta.changes || result.meta.changes === 0) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4004, message: "Message not found or not owner" },
        });
        return;
      }
    } catch (err) {
      log.error("Failed to update message:", err);
      return;
    }

    // Look up channel_id for the message to dispatch
    const row = await this.env.DB.prepare(
      `SELECT channel_id FROM messages WHERE id = ?`
    ).bind(d.message_id).first<{ channel_id: string }>();

    if (row) {
      this.broadcastToChannel(row.channel_id, {
        op: Op.Dispatch,
        d: {
          event: "MESSAGE_UPDATE",
          data: {
            id: d.message_id,
            channel_id: row.channel_id,
            content: d.content,
            updated_at: now,
          },
        },
      });

      // Asynchronously fetch new embeds if content changed
      this.ctx.waitUntil((async () => {
        const embeds = await extractAndProcessEmbeds(d.content);
        if (embeds.length > 0) {
          try {
            await this.env.DB.prepare(
              `UPDATE messages SET embeds = ? WHERE id = ?`
            ).bind(JSON.stringify(embeds), d.message_id).run();

            this.broadcastToChannel(row.channel_id, {
              op: Op.Dispatch,
              d: {
                event: "MESSAGE_UPDATE",
                data: {
                  id: d.message_id,
                  channel_id: row.channel_id,
                  embeds: embeds
                }
              }
            });
          } catch (e) {
            log.error("Failed to update message with new embeds:", e);
          }
        }
      })());
    }
  }

  // ── Op 22: MessageDelete ──────────────────────────────────────────────

  private async handleMessageDelete(
    ws: WebSocket,
    d: { message_id: string; channel_id: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.message_id || !d.channel_id) return;

    const authorId = session.clerk_user_id ?? session.id;

    try {
      // Delete only if author (or could add server admin check later)
      const result = await this.env.DB.prepare(
        `DELETE FROM messages WHERE id = ? AND author_id = ?`
      )
        .bind(d.message_id, authorId)
        .run();

      if (!result.meta.changes || result.meta.changes === 0) {
        this.sendTo(ws, {
          op: Op.Error,
          d: { code: 4004, message: "Message not found or not owner" },
        });
        return;
      }
    } catch (err) {
      log.error("Failed to delete message:", err);
      return;
    }

    this.broadcastToChannel(d.channel_id, {
      op: Op.Dispatch,
      d: {
        event: "MESSAGE_DELETE",
        data: { id: d.message_id, channel_id: d.channel_id },
      },
    });
  }

  // ── Op 23: TypingStart ────────────────────────────────────────────────

  private handleTypingStart(ws: WebSocket, d: { channel_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id) return;

    this.broadcastToChannel(
      d.channel_id,
      {
        op: Op.Dispatch,
        d: {
          event: "TYPING_START",
          data: {
            channel_id: d.channel_id,
            user_id: session.clerk_user_id ?? session.id,
            username: session.username ?? session.name,
            display_name: session.display_name ?? session.name,
            timestamp: Date.now(),
          },
        },
      },
      ws // exclude sender
    );
  }

  // ── Op 24: ReactionAdd ────────────────────────────────────────────────

  private async handleReactionAdd(
    ws: WebSocket,
    d: { channel_id: string; message_id: string; emoji: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !d.message_id || !d.emoji) return;

    const userId = session.clerk_user_id ?? session.id;
    const now = new Date().toISOString();

    try {
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?)`
      )
        .bind(d.message_id, userId, d.emoji, now)
        .run();
    } catch (err) {
      log.error("Failed to add reaction:", err);
      return;
    }

    this.broadcastToChannel(d.channel_id, {
      op: Op.Dispatch,
      d: {
        event: "REACTION_ADD",
        data: {
          channel_id: d.channel_id,
          message_id: d.message_id,
          user_id: userId,
          emoji: d.emoji,
        },
      },
    });
  }

  // ── Op 25: ReactionRemove ─────────────────────────────────────────────

  private async handleReactionRemove(
    ws: WebSocket,
    d: { channel_id: string; message_id: string; emoji: string }
  ) {
    const session = this.requireSession(ws);
    if (!session || !d.channel_id || !d.message_id || !d.emoji) return;

    const userId = session.clerk_user_id ?? session.id;

    try {
      await this.env.DB.prepare(
        `DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`
      )
        .bind(d.message_id, userId, d.emoji)
        .run();
    } catch (err) {
      log.error("Failed to remove reaction:", err);
      return;
    }

    this.broadcastToChannel(d.channel_id, {
      op: Op.Dispatch,
      d: {
        event: "REACTION_REMOVE",
        data: {
          channel_id: d.channel_id,
          message_id: d.message_id,
          user_id: userId,
          emoji: d.emoji,
        },
      },
    });
  }

  // ── Channel subscription cleanup on leave ─────────────────────────────

  private cleanupChannelSubscriptions(ws: WebSocket) {
    const session = this.getSession(ws);
    if (!session) return;

    for (const channelId of session.subscribed_channels) {
      const subs = this.channelSubscriptions.get(channelId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) this.channelSubscriptions.delete(channelId);
      }
    }
  }

  // ── Server subscription cleanup on leave ──────────────────────────────

  private cleanupServerSubscriptions(ws: WebSocket) {
    const session = this.getSession(ws);
    if (!session) return;

    for (const serverId of session.subscribed_servers ?? []) {
      const subs = this.serverSubscriptions.get(serverId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) this.serverSubscriptions.delete(serverId);
      }
    }
  }

  // ── Op 35: ServerSubscribe ────────────────────────────────────────────

  private async handleServerSubscribe(ws: WebSocket, d: { server_id: string }) {
    const session = this.requireSession(ws);
    if (!session || !d.server_id || !session.clerk_user_id) return;

    // Already subscribed?
    if (session.subscribed_servers?.includes(d.server_id)) return;

    // Validate membership against D1
    try {
      const row = await this.env.DB.prepare(
        "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?"
      ).bind(d.server_id, session.clerk_user_id).first();

      if (!row) {
        log.info(`ServerSubscribe denied: ${session.name} is not member of ${d.server_id}`);
        return;
      }
    } catch (e) {
      log.error(`ServerSubscribe D1 error:`, e);
      return;
    }

    if (!session.subscribed_servers) session.subscribed_servers = [];
    session.subscribed_servers.push(d.server_id);
    this.persist(ws, session);
    this.applyRtcRoomServerSubscribeFromSocket(ws, d);
  }

  // ── Op 36: CallInitiate ──────────────────────────────────────────────

  private async handleCallInitiate(
    ws: WebSocket,
    d: { target_user_id: string; channel_id: string }
  ) {
    const pendingCall = await this.prepareRtcRoomCallInitiateFromSocket(ws, d);
    if (!pendingCall) return;

    const session = this.getSession(ws);
    if (!session) return;

    const previousChannelId = session.voice_channel_id;
    session.voice_channel_id = pendingCall.channelId;
    session.voice_joined_at = this.resolveVoiceJoinedAt(pendingCall.channelId);
    this.persist(ws, session);
    this.applyRtcRoomCallInitiateFromSocket(ws, pendingCall, previousChannelId);
  }

  // ── Op 37: CallAccept ────────────────────────────────────────────────

  private handleCallAccept(ws: WebSocket, d: { call_id: string }) {
    const pending = this.prepareRtcRoomCallAcceptFromSocket(ws, d);
    if (!pending) return;

    const session = this.getSession(ws);
    if (!session) return;

    const previousChannelId = session.voice_channel_id;
    session.voice_channel_id = pending.channelId;
    session.voice_joined_at = this.resolveVoiceJoinedAt(pending.channelId);
    this.persist(ws, session);
    this.applyRtcRoomCallAcceptFromSocket(ws, pending, previousChannelId);
  }

  // ── Op 38: CallDecline ───────────────────────────────────────────────

  private handleCallDecline(ws: WebSocket, d: { call_id: string }) {
    const pending = this.prepareRtcRoomCallDeclineFromSocket(ws, d);
    if (!pending) return;
    this.applyRtcRoomCallDeclineFromSocket(pending);
  }

  private handleCallEnd(ws: WebSocket, d: { call_id: string }) {
    const pending = this.prepareRtcRoomCallEndFromSocket(ws, d);
    if (!pending) return;

    const callerWs = this.findWsByClerkUserId(pending.callerId);
    if (callerWs) {
      const callerSession = this.getSession(callerWs);
      if (callerSession) {
        const previousChannelId = callerSession.voice_channel_id;
        callerSession.voice_channel_id = undefined;
        callerSession.voice_joined_at = undefined;
        this.persist(callerWs, callerSession);
        if (previousChannelId) {
          this.applyRtcRoomVoiceChannelTransition(
            this.toSharedRtcControlSessionSnapshot(callerSession),
            { previousChannelId },
          );
        }
      }
    }

    this.applyRtcRoomCallEndFromSocket(pending);
  }

  // ── Call helpers ──────────────────────────────────────────────────────

  /** Find a pending call where the user is the caller */
  private findPendingCallForUser(userId: string): PendingCall | null {
    for (const [, call] of this.pendingCalls) {
      if (call.callerId === userId || call.calleeId === userId) {
        return call;
      }
    }
    return null;
  }

  private buildCallRingStopMessage(callId: string | null, reason: string) {
    return {
      op: Op.Dispatch,
      d: { event: "CALL_RING_STOP", data: { call_id: callId, reason } },
    };
  }

  private sendCallRingStop(ws: WebSocket, callId: string | null, reason: string) {
    this.sendTo(ws, this.buildCallRingStopMessage(callId, reason));
  }

  private broadcastPendingCallStop(pending: PendingCall, reason: string) {
    const msg = this.buildCallRingStopMessage(pending.callId, reason);
    this.broadcastToUser(pending.callerId, msg);
    this.broadcastToUser(pending.calleeId, msg);
  }

  private broadcastIncomingPendingCall(pending: PendingCall) {
    this.broadcastToUser(pending.calleeId, {
      op: Op.Dispatch,
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
        },
      },
    });
  }

  private broadcastOutgoingPendingCallRinging(pending: PendingCall) {
    this.broadcastToUser(pending.callerId, {
      op: Op.Dispatch,
      d: {
        event: "CALL_RINGING",
        data: {
          call_id: pending.callId,
          callee_id: pending.calleeId,
          callee_name: pending.calleeName,
          callee_username: pending.calleeUsername,
          callee_display_name: pending.calleeDisplayName,
          callee_avatar: pending.calleeAvatar,
          channel_id: pending.channelId,
        },
      },
    });
  }

  /** Clean up all calls for a user (called on disconnect/leave) */
  private cleanupCallsForUser(userId: string, reason: string) {
    log.info(`cleanupCallsForUser(${userId}, ${reason}): pendingCalls.size=${this.pendingCalls.size}`);
    const notifications = this.prepareCallCleanupForUser(userId);
    if (notifications.length > 0) {
      this.broadcastRtcRoomDisconnectCallCleanup({ reason, notifications });
    }

    // Active calls purely live in voice channel presence now, and `handleLeave`
    // natively removes users from `voiceChannelMembers`. We don't need any more manually teardown logic!
    log.info(`cleanupCallsForUser done.`);
  }

  private broadcastRtcRoomDisconnectCallCleanup(
    cleanup: RtcRoomDisconnectCallCleanup,
  ) {
    for (const notification of cleanup.notifications) {
      this.broadcastToUser(
        notification.userId,
        this.buildCallRingStopMessage(notification.callId, cleanup.reason),
      );
    }
    return true;
  }

  private prepareCallCleanupForUser(userId: string) {
    const notifications: Array<{ userId: string; callId: string }> = [];
    let changed = false;

    const pendingAsCallee = this.pendingCalls.get(userId);
    if (pendingAsCallee) {
      log.info(`Cleaning up pending call as callee: callId=${pendingAsCallee.callId}`);
      this.pendingCalls.delete(userId);
      changed = true;
      notifications.push({
        userId: pendingAsCallee.callerId,
        callId: pendingAsCallee.callId,
      });
    }

    for (const [calleeId, call] of this.pendingCalls) {
      if (call.callerId === userId) {
        log.info(`Cleaning up pending call as caller: callId=${call.callId}`);
        this.pendingCalls.delete(calleeId);
        changed = true;
        notifications.push({
          userId: calleeId,
          callId: call.callId,
        });
      }
    }

    if (changed) {
      this.persistPendingCalls();
    }

    return notifications;
  }

  /** Add a user to voiceChannelMembers for a call (reuses voice channel infra) */
  private addToVoiceChannelForCall(session: WsAttachment, previousChannelId?: string) {
    const channelId = session.voice_channel_id;
    if (!channelId || !session.clerk_user_id) return;

    this.applyRtcRoomVoiceChannelTransition(
      this.toSharedRtcControlSessionSnapshot(session),
      {
        previousChannelId,
        nextChannelId: channelId,
      },
    );
  }

  /** Find a WebSocket by clerk_user_id */
  private findWsByClerkUserId(clerkUserId: string): WebSocket | null {
    for (const [ws, session] of this.sessions) {
      if (session.clerk_user_id === clerkUserId) return ws;
    }
    return null;
  }
}
