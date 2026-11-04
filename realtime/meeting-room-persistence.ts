export const PENDING_CALLS_STORAGE_KEY = "pendingCalls";
export const ACTIVE_CALLS_STORAGE_KEY = "activeCalls";
export const SPATIAL_AUDIO_STORAGE_PREFIX = "spatialAudio:";
const MAX_SPATIAL_MANUAL_POSITIONS = 64;
const MAX_SPATIAL_AUDIO_STATE_BYTES = 32 * 1024;
const MAX_SPATIAL_DIMENSION = 10_000;

export interface StoredPendingCall {
  callId: string;
  callerId: string;
  calleeId: string;
  channelId: string;
  voiceRoomId: string;
  expiresAt: number;
  callerName: string;
  callerUsername?: string;
  callerDisplayName?: string | null;
  callerAvatar?: string | null;
  calleeName?: string;
  calleeUsername?: string;
  calleeDisplayName?: string | null;
  calleeAvatar?: string | null;
  /** The callee's phones were rung over FCM: the ring outlives their sockets. */
  pushed?: boolean;
}

/** An answered DM call, until its voice channel empties. */
export interface StoredActiveCall {
  callId: string;
  callerId: string;
  calleeId: string;
  channelId: string;
  acceptedAt: number;
}

export interface SpatialAudioState {
  enabled: boolean;
  placementMode: "line" | "arc" | "grid" | "manual";
  roomSize: number;
  distance: number;
  arcAngle: number;
  manualPositions: Record<string, { x: number; y: number }>;
  updatedBy?: string;
  updatedAt: number;
}

export type StoredSpatialAudioState = SpatialAudioState;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStoredPendingCall(value: unknown): value is StoredPendingCall {
  if (!isRecord(value)) return false;

  return (
    typeof value.callId === "string" &&
    typeof value.callerId === "string" &&
    typeof value.calleeId === "string" &&
    typeof value.channelId === "string" &&
    typeof value.voiceRoomId === "string" &&
    isFiniteNumber(value.expiresAt) &&
    typeof value.callerName === "string" &&
    isOptionalString(value.callerUsername) &&
    isOptionalString(value.callerDisplayName) &&
    isOptionalString(value.callerAvatar) &&
    isOptionalString(value.calleeName) &&
    isOptionalString(value.calleeUsername) &&
    isOptionalString(value.calleeDisplayName) &&
    isOptionalString(value.calleeAvatar) &&
    (value.pushed === undefined || typeof value.pushed === "boolean")
  );
}

export function serializePendingCall(
  call: StoredPendingCall,
): StoredPendingCall {
  return {
    callId: call.callId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    channelId: call.channelId,
    voiceRoomId: call.voiceRoomId,
    expiresAt: call.expiresAt,
    callerName: call.callerName,
    callerUsername: call.callerUsername,
    callerDisplayName: call.callerDisplayName,
    callerAvatar: call.callerAvatar,
    calleeName: call.calleeName,
    calleeUsername: call.calleeUsername,
    calleeDisplayName: call.calleeDisplayName,
    calleeAvatar: call.calleeAvatar,
    pushed: call.pushed,
  };
}

export function deserializePendingCalls(
  value: unknown,
  now: number,
): { valid: Record<string, StoredPendingCall>; expiredKeys: string[] } {
  const valid: Record<string, StoredPendingCall> = {};
  const expiredKeys: string[] = [];

  if (!isRecord(value)) return { valid, expiredKeys };

  for (const [calleeId, candidate] of Object.entries(value)) {
    if (!isStoredPendingCall(candidate) || candidate.calleeId !== calleeId) {
      continue;
    }
    if (candidate.expiresAt <= now) {
      expiredKeys.push(calleeId);
      continue;
    }
    valid[calleeId] = serializePendingCall(candidate);
  }

  return { valid, expiredKeys };
}

export function serializePendingCalls(
  calls: ReadonlyMap<string, StoredPendingCall>,
): Record<string, StoredPendingCall> {
  const serialized: Record<string, StoredPendingCall> = {};
  for (const [calleeId, call] of calls) {
    serialized[calleeId] = serializePendingCall(call);
  }
  return serialized;
}

export function restorePendingCalls(
  value: unknown,
  now: number,
): {
  calls: Map<string, StoredPendingCall>;
  hadInvalidEntries: boolean;
} {
  const restored = deserializePendingCalls(value, now);
  const source = isRecord(value) ? Object.keys(value) : [];
  const hadInvalidEntries =
    (value !== undefined && !isRecord(value)) ||
    source.length !== Object.keys(restored.valid).length ||
    restored.expiredKeys.length > 0;
  return {
    calls: new Map(Object.entries(restored.valid)),
    hadInvalidEntries,
  };
}

function isStoredActiveCall(value: unknown): value is StoredActiveCall {
  return (
    isRecord(value) &&
    typeof value.callId === "string" &&
    typeof value.callerId === "string" &&
    typeof value.calleeId === "string" &&
    typeof value.channelId === "string" &&
    isFiniteNumber(value.acceptedAt)
  );
}

/** Active calls as stored: by channel id. */
export interface StoredActiveCalls {
  [channelId: string]: StoredActiveCall;
}

export function serializeActiveCalls(
  calls: ReadonlyMap<string, StoredActiveCall>,
): StoredActiveCalls {
  const serialized: StoredActiveCalls = {};
  for (const [channelId, call] of calls) {
    serialized[channelId] = {
      callId: call.callId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      channelId: call.channelId,
      acceptedAt: call.acceptedAt,
    };
  }
  return serialized;
}

/** Active calls by channel id; malformed entries are dropped. */
export function restoreActiveCalls(
  value: unknown,
): Map<string, StoredActiveCall> {
  const calls = new Map<string, StoredActiveCall>();
  if (!isRecord(value)) return calls;
  for (const [channelId, candidate] of Object.entries(value)) {
    if (isStoredActiveCall(candidate) && candidate.channelId === channelId) {
      calls.set(channelId, candidate);
    }
  }
  return calls;
}

export function getSpatialAudioStorageKey(roomOrChannelId: string): string {
  return `${SPATIAL_AUDIO_STORAGE_PREFIX}${roomOrChannelId}`;
}

export function isSpatialAudioState(
  value: unknown,
): value is SpatialAudioState {
  if (!isRecord(value) || !isRecord(value.manualPositions)) return false;
  if (
    typeof value.enabled !== "boolean" ||
    !["line", "arc", "grid", "manual"].includes(
      value.placementMode as string,
    ) ||
    !isFiniteNumber(value.roomSize) ||
    value.roomSize <= 0 ||
    value.roomSize > MAX_SPATIAL_DIMENSION ||
    !isFiniteNumber(value.distance) ||
    value.distance < 0 ||
    value.distance > MAX_SPATIAL_DIMENSION ||
    !isFiniteNumber(value.arcAngle) ||
    value.arcAngle < 0 ||
    value.arcAngle > 360 ||
    !isFiniteNumber(value.updatedAt) ||
    (value.updatedBy !== undefined && typeof value.updatedBy !== "string")
  ) {
    return false;
  }

  if (
    Object.keys(value.manualPositions).length > MAX_SPATIAL_MANUAL_POSITIONS ||
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MAX_SPATIAL_AUDIO_STATE_BYTES
  ) {
    return false;
  }

  for (const position of Object.values(value.manualPositions)) {
    if (
      !isRecord(position) ||
      !isFiniteNumber(position.x) ||
      !isFiniteNumber(position.y) ||
      Math.abs(position.x) > MAX_SPATIAL_DIMENSION ||
      Math.abs(position.y) > MAX_SPATIAL_DIMENSION
    ) {
      return false;
    }
  }

  return true;
}

// ── Stored session state ──────────────────────────────────────────────────
// WebSocket attachments, resumable session snapshots and the vc:members:*
// lists outlive deploys and hibernation. These readers are the only code that
// reads them back; malformed entries are dropped.

/** What the readers check of a stored WebSocket attachment. */
interface IdentifiedAttachment {
  id: string;
  user_id?: string;
}

/**
 * A WebSocket attachment (ws.deserializeAttachment()) or the attachment of a
 * resumable snapshot. Null until Identify has run (only `admission` is set).
 */
export function normalizeStoredWsAttachment<A extends IdentifiedAttachment>(
  stored: unknown,
): A | null {
  if (!isRecord(stored) || typeof stored.id !== "string") return null;
  return stored as unknown as A;
}

export interface StoredResumableSession<A, R> {
  attachment: A;
  replay: R[];
  /** Unchecked here; the room treats anything but a count as the write cap. */
  persistWrites: unknown;
}

/** One entry of the `resumableSessions` key: `{ attachment, replay, persist_writes }`. */
export function normalizeStoredResumableSession<
  A extends IdentifiedAttachment,
  R,
>(stored: unknown): StoredResumableSession<A, R> | null {
  if (
    !isRecord(stored) ||
    !isRecord(stored.attachment) ||
    !Array.isArray(stored.replay)
  ) {
    return null;
  }
  const attachment = normalizeStoredWsAttachment<A>(stored.attachment);
  return attachment
    ? {
        attachment,
        replay: stored.replay as R[],
        persistWrites: stored.persist_writes,
      }
    : null;
}

/**
 * The members of one `vc:members:<channel>` list. Entries without a user id
 * are dropped.
 */
export function normalizeStoredVoiceChannelMembers<
  M extends { user_id: string },
>(stored: unknown): M[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (entry) => isRecord(entry) && typeof entry.user_id === "string",
  ) as M[];
}
