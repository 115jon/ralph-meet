import { describe, expect, it } from "vitest";
import {
  PENDING_CALLS_STORAGE_KEY,
  SPATIAL_AUDIO_STORAGE_PREFIX,
  deserializePendingCalls,
  getSpatialAudioStorageKey,
  isSpatialAudioState,
  serializePendingCall,
  type StoredPendingCall,
} from "../meeting-room-persistence";

const pendingCall: StoredPendingCall = {
  callId: "call-1",
  callerId: "caller-1",
  calleeId: "callee-1",
  channelId: "channel-1",
  voiceRoomId: "voice-1",
  expiresAt: 2_000,
  callerName: "Caller",
  callerUsername: "caller",
  callerDisplayName: "Caller Display",
  callerAvatar: "caller.png",
  calleeName: "Callee",
  calleeUsername: "callee",
  calleeDisplayName: "Callee Display",
  calleeAvatar: "callee.png",
};

describe("MeetingRoom durable state serialization", () => {
  it("uses stable keys and excludes runtime timeout handles", () => {
    const serialized = serializePendingCall(pendingCall);

    expect(PENDING_CALLS_STORAGE_KEY).toBe("pendingCalls");
    expect(serialized).toEqual(pendingCall);
    expect(JSON.stringify(serialized)).not.toContain("timeout");
    expect(getSpatialAudioStorageKey("channel-1")).toBe(
      `${SPATIAL_AUDIO_STORAGE_PREFIX}channel-1`,
    );
  });

  it("restores only non-expired pending calls", () => {
    const restored = deserializePendingCalls(
      {
        "callee-1": pendingCall,
        "callee-2": {
          ...pendingCall,
          callId: "call-2",
          calleeId: "callee-2",
          expiresAt: 1_000,
        },
      },
      1_000,
    );

    expect(restored.valid).toEqual({ "callee-1": pendingCall });
    expect(restored.expiredKeys).toEqual(["callee-2"]);
  });

  it("accepts only serializable spatial audio layouts", () => {
    expect(
      isSpatialAudioState({
        enabled: true,
        placementMode: "manual",
        roomSize: 10,
        distance: 4,
        arcAngle: 90,
        manualPositions: { "user-1": { x: 1, y: -1 } },
        updatedBy: "user-1",
        updatedAt: 2_000,
      }),
    ).toBe(true);
    expect(
      isSpatialAudioState({
        enabled: true,
        placementMode: "manual",
        roomSize: 10,
        distance: 4,
        arcAngle: 90,
        manualPositions: { "user-1": { x: "bad", y: 0 } },
        updatedAt: 2_000,
      }),
    ).toBe(false);
    expect(
      isSpatialAudioState({
        enabled: true,
        placementMode: "manual",
        roomSize: 10,
        distance: 4,
        arcAngle: 90,
        manualPositions: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [
            `user-${index}`,
            { x: 1, y: 1 },
          ]),
        ),
        updatedAt: 2_000,
      }),
    ).toBe(false);
    expect(
      isSpatialAudioState({
        enabled: true,
        placementMode: "manual",
        roomSize: 10,
        distance: 4,
        arcAngle: 90,
        manualPositions: { "user-1": { x: 10_001, y: 0 } },
        updatedAt: 2_000,
      }),
    ).toBe(false);
  });
});
