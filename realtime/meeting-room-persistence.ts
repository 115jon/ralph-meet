export const PENDING_CALLS_STORAGE_KEY = "pendingCalls";
export const SPATIAL_AUDIO_STORAGE_PREFIX = "spatialAudio:";
export const MAX_SPATIAL_MANUAL_POSITIONS = 64;
export const MAX_SPATIAL_AUDIO_STATE_BYTES = 32 * 1024;
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

export function isStoredPendingCall(
  value: unknown,
): value is StoredPendingCall {
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
    isOptionalString(value.calleeAvatar)
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
