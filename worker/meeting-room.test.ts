import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

import {
  isReconnectWithinGrace,
  shouldKeepResumableSession,
} from "../src/lib/voice/connection-generation";
import {
  RTC_MEDIA_RECONNECT_GRACE_MS,
  RTC_RECONNECT_GRACE_MS,
} from "../src/lib/voice/rtc-room-session";
import { filterVoiceChannelStatesPayload } from "../src/lib/voice-channel-state-filter";
import { MeetingRoom } from "./meeting-room";

describe("filterVoiceChannelStatesPayload", () => {
  it("keeps only visible voice channels in the snapshot", () => {
    const filtered = filterVoiceChannelStatesPayload(
      {
        voice_states: {
          "vc-visible": [
            {
              clerk_user_id: "user-1",
              name: "Alice",
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
          ],
          "vc-hidden": [
            {
              clerk_user_id: "user-2",
              name: "Bob",
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
          ],
        },
        voice_started_at: {
          "vc-visible": 123,
          "vc-hidden": 456,
        },
        spatial_audio_states: {
          "vc-visible": {
            enabled: true,
            placementMode: "line",
            roomSize: 10,
            distance: 4,
            arcAngle: 90,
            manualPositions: {},
            updatedAt: 123,
          },
          "vc-hidden": {
            enabled: true,
            placementMode: "grid",
            roomSize: 8,
            distance: 3,
            arcAngle: 60,
            manualPositions: {},
            updatedAt: 456,
          },
        },
      },
      ["vc-visible"],
    );

    expect(filtered).toEqual({
      voice_states: {
        "vc-visible": [
          {
            clerk_user_id: "user-1",
            name: "Alice",
            self_mute: false,
            self_deaf: false,
            self_video: false,
            self_stream: false,
          },
        ],
      },
      voice_started_at: {
        "vc-visible": 123,
      },
      spatial_audio_states: {
        "vc-visible": {
          enabled: true,
          placementMode: "line",
          roomSize: 10,
          distance: 4,
          arcAngle: 90,
          manualPositions: {},
          updatedAt: 123,
        },
      },
    });
  });
});

describe("meeting room resume helpers", () => {
  it("expires resumable sessions at the grace boundary", () => {
    expect(isReconnectWithinGrace(10_000, 10_000 + RTC_RECONNECT_GRACE_MS - 1, RTC_RECONNECT_GRACE_MS)).toBe(true);
    expect(isReconnectWithinGrace(10_000, 10_000 + RTC_RECONNECT_GRACE_MS, RTC_RECONNECT_GRACE_MS)).toBe(false);
  });

  it("keeps resumable sessions only for non-intentional disconnects", () => {
    expect(shouldKeepResumableSession(false)).toBe(true);
    expect(shouldKeepResumableSession(true)).toBe(false);
  });

  it("skips local resumable hydration when constructed for shared RTC authority", async () => {
    const storedSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    let blockPromise: Promise<void> | undefined;
    const put = vi.fn(async () => undefined);
    const deleteStorage = vi.fn(async () => undefined);
    const ctx = {
      getWebSockets: () => [],
      blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => {
        blockPromise = callback();
      }),
      storage: {
        get: vi.fn(async (key: string) => {
          if (key === "roomSlug") return undefined;
          if (key === "resumableSessions") return { "participant-1": storedSession };
          if (key === "resumableSessionExpiry") return { "participant-1": 1_000 };
          return undefined;
        }),
        list: vi.fn(async () => new Map()),
        put,
        delete: deleteStorage,
      },
    };

    const room = new MeetingRoom(ctx as any, {} as any, { sharedRtcAuthority: true }) as unknown as {
      resumableSessions: Map<string, unknown>;
      resumableSessionExpiry: Map<string, number>;
      sharedRtcAuthority: boolean;
    };
    await blockPromise;

    expect(room.sharedRtcAuthority).toBe(true);
    expect(room.resumableSessions.size).toBe(0);
    expect(room.resumableSessionExpiry.size).toBe(0);
    expect(put).toHaveBeenCalledWith({
      "resume:session:participant-1": storedSession,
    });
    expect(put).toHaveBeenCalledWith({
      "resume:expiry:participant-1": 1_000,
    });
    expect(deleteStorage).toHaveBeenCalledWith("resumableSessions");
    expect(deleteStorage).toHaveBeenCalledWith("resumableSessionExpiry");
  });

  it("hydrates local resumable state for split-mode MeetingRoom construction", async () => {
    const storedSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    let blockPromise: Promise<void> | undefined;
    const ctx = {
      getWebSockets: () => [],
      blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => {
        blockPromise = callback();
      }),
      storage: {
        get: vi.fn(async (key: string) => {
          if (key === "roomSlug") return undefined;
          if (key === "resumableSessions") return { "participant-1": storedSession };
          if (key === "resumableSessionExpiry") return { "participant-1": 1_000 };
          return undefined;
        }),
        list: vi.fn(async () => new Map()),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        getAlarm: vi.fn(async () => null),
        setAlarm: vi.fn(async () => undefined),
      },
    };

    const room = new MeetingRoom(ctx as any, {} as any) as unknown as {
      resumableSessions: Map<string, typeof storedSession>;
      resumableSessionExpiry: Map<string, number>;
      sharedRtcAuthority: boolean;
    };
    await blockPromise;

    expect(room.sharedRtcAuthority).toBe(false);
    expect(room.resumableSessions.get("participant-1")).toBe(storedSession);
    expect(room.resumableSessionExpiry.get("participant-1")).toBe(1_000);
  });
});

describe("meeting room media-aware reconciliation helpers", () => {
  it("treats live media sockets and pending media reconnects as active voice presence", () => {
    const fakeMeetingRoom = {
      ctx: {
        getWebSockets: () => [
          { deserializeAttachment: () => ({ socket_role: "media", clerk_user_id: "media-live" }) },
          { deserializeAttachment: () => ({ socket_role: "control", clerk_user_id: "control-only" }) },
          { deserializeAttachment: () => ({ socket_role: "media" }) },
        ],
        storage: {
          sql: {
            exec: vi.fn(() => [
              { clerk_user_id: "media-reconnecting" },
            ]),
          },
        },
      },
      collectLiveMediaClerkIds: (MeetingRoom.prototype as any).collectLiveMediaClerkIds,
    };

    const ids = (MeetingRoom.prototype as any).collectActiveMediaClerkIds.call(fakeMeetingRoom, 200_000);
    expect([...ids].sort()).toEqual(["media-live", "media-reconnecting"]);
  });

  it("gracefully ignores missing media tables in split mode", () => {
    const fakeMeetingRoom = {
      ctx: {
        getWebSockets: () => [
          { deserializeAttachment: () => ({ socket_role: "media", clerk_user_id: "media-live" }) },
        ],
        storage: {
          sql: {
            exec: vi.fn(() => {
              throw new Error("no such table: pending_reconnects");
            }),
          },
        },
      },
      collectLiveMediaClerkIds: (MeetingRoom.prototype as any).collectLiveMediaClerkIds,
    };

    const ids = (MeetingRoom.prototype as any).collectActiveMediaClerkIds.call(fakeMeetingRoom, 200_000);
    expect([...ids]).toEqual(["media-live"]);
  });

  it("prefers an injected RTC_ROOM media snapshot over raw media reads", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sharedRtcMediaAuthoritySnapshot: {
        capturedAt: 200_000,
        liveParticipantIds: new Set(["participant-1"]),
        liveClerkUserIds: new Set(["media-live"]),
        activeClerkUserIds: new Set(["media-live", "media-reconnecting"]),
        presenceByClerkUserId: new Map([
          ["media-live", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
          ["media-reconnecting", { connected: false, connection_state: "reconnecting", disconnected_at: 170_000, reconnect_expires_at: 200_000 }],
        ]),
        participantCount: 1,
        pendingReconnectCount: 1,
        demoChatMessageCount: 0,
      },
      ctx: {
        getWebSockets: () => {
          throw new Error("should not inspect raw media sockets");
        },
        storage: {
          sql: {
            exec: vi.fn(() => {
              throw new Error("should not inspect raw media SQL");
            }),
          },
        },
      },
    };

    const liveIds = (MeetingRoom.prototype as any).collectLiveMediaClerkIds.call(fakeMeetingRoom, 200_000);
    const activeIds = (MeetingRoom.prototype as any).collectActiveMediaClerkIds.call(fakeMeetingRoom, 200_000);

    expect([...liveIds]).toEqual(["media-live"]);
    expect([...activeIds].sort()).toEqual(["media-live", "media-reconnecting"]);
  });
});

describe("meeting room RTC_ROOM control wrapper helpers", () => {
  it("drains both dirty puts and deletes without writing them", () => {
    const fakeMeetingRoom = {
      dirtyStorage: new Map<string, unknown>([
        ["resume:session:participant-1", { id: "participant-1" }],
        ["pendingCalls", { "callee-1": { callId: "call-1" } }],
      ]),
      deletedStorageKeys: new Set<string>([
        "vc:members:stale-channel",
        "resume:expiry:participant-stale",
      ]),
    };

    const batch = (MeetingRoom.prototype as any).drainPendingStorageMutations.call(fakeMeetingRoom);

    expect(batch).toEqual({
      puts: {
        "resume:session:participant-1": { id: "participant-1" },
        pendingCalls: { "callee-1": { callId: "call-1" } },
      },
      deletes: ["vc:members:stale-channel", "resume:expiry:participant-stale"],
    });
    expect(fakeMeetingRoom.dirtyStorage.size).toBe(0);
    expect(fakeMeetingRoom.deletedStorageKeys.size).toBe(0);
  });

  it("preserves the legacy flush path for MeetingRoom-owned writes", () => {
    const storageDelete = vi.fn(() => Promise.resolve());
    const storagePut = vi.fn(() => Promise.resolve());
    const fakeMeetingRoom = {
      dirtyStorage: new Map<string, unknown>([
        ["resume:session:participant-1", { id: "participant-1" }],
      ]),
      deletedStorageKeys: new Set<string>(["vc:members:stale-channel"]),
      ctx: {
        storage: {
          delete: storageDelete,
          put: storagePut,
        },
      },
      drainPendingStorageMutations: (MeetingRoom.prototype as any).drainPendingStorageMutations,
      writePendingStorageMutations: (MeetingRoom.prototype as any).writePendingStorageMutations,
    };

    (MeetingRoom.prototype as any).flushDirtyStorage.call(fakeMeetingRoom);

    expect(storageDelete).toHaveBeenCalledWith(["vc:members:stale-channel"]);
    expect(storagePut).toHaveBeenCalledWith({
      "resume:session:participant-1": { id: "participant-1" },
    });
    expect(fakeMeetingRoom.dirtyStorage.size).toBe(0);
    expect(fakeMeetingRoom.deletedStorageKeys.size).toBe(0);
  });

});

describe("meeting room shared RTC member-state helpers", () => {
  const createSharedRtcVoiceAuthoritySnapshot = (
    channels: Array<[string, { members: any[]; startedAt?: number }]>,
    capturedAt = 200_000,
  ) => ({
    capturedAt,
    channels: new Map(channels),
    channelIdByClerkUserId: new Map(
      channels.flatMap(([channelId, snapshot]) => snapshot.members.map((member) => [member.clerk_user_id, channelId] as const)),
    ),
  });

  const createSharedRtcReadPathRoom = (overrides: Record<string, unknown> = {}) => ({
    sharedRtcAuthority: true,
    sessions: new Map(),
    resumableSessions: new Map(),
    voiceChannelMembers: new Map<string, Map<string, any>>(),
    voiceChannelStartedAt: new Map<string, number>(),
    spatialAudioStates: new Map(),
    collectActiveMediaClerkIds: () => new Set<string>(),
    collectLiveMediaClerkIds: () => new Set<string>(),
    collectSharedRtcVoiceStateChannelIds: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateChannelIds,
    collectSharedRtcVoiceStateSessions: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateSessions,
    getSharedRtcControlSessionCandidates: (MeetingRoom.prototype as any).getSharedRtcControlSessionCandidates,
    buildSharedRtcVoiceChannelMembers: (MeetingRoom.prototype as any).buildSharedRtcVoiceChannelMembers,
    getSharedRtcVoiceAuthorityChannelSnapshot: (MeetingRoom.prototype as any).getSharedRtcVoiceAuthorityChannelSnapshot,
    buildVoiceChannelStateSnapshot: (MeetingRoom.prototype as any).buildVoiceChannelStateSnapshot,
    buildVoiceChannelStatesPayload: (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload,
    resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
    resolveVoiceJoinedAt: (MeetingRoom.prototype as any).resolveVoiceJoinedAt,
    ...overrides,
  });

  it("keeps shared RTC control joins out of voiceChannelMembers until media truth exists", () => {
    const ws = {} as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: undefined,
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
      stream_preview_url: null,
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      voiceChannelMembers: new Map<string, Map<string, unknown>>(),
      voiceChannelStartedAt: new Map<string, number>(),
      pendingCalls: new Map<string, unknown>(),
      requireSession: () => session,
      removeFromVoiceChannel: vi.fn(),
      persist: vi.fn(),
      collectActiveMediaClerkIds: () => new Set<string>(),
      collectLiveMediaClerkIds: () => new Set<string>(),
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      normalizeVoiceChannelStartedAt: (MeetingRoom.prototype as any).normalizeVoiceChannelStartedAt,
      resolveVoiceJoinedAt: (MeetingRoom.prototype as any).resolveVoiceJoinedAt,
      toSharedRtcControlSessionSnapshot: (MeetingRoom.prototype as any).toSharedRtcControlSessionSnapshot,
      applyRtcRoomVoiceChannelTransition: (MeetingRoom.prototype as any).applyRtcRoomVoiceChannelTransition,
      applyVoiceChannelTransitionEffects: vi.fn(),
      persistVoiceChannelStartedAt: vi.fn(),
      markVoiceMemberConnected: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      broadcastToUser: vi.fn(),
      persistPendingCalls: vi.fn(),
      markAcceptedCall: vi.fn(),
      ctx: {
        waitUntil: vi.fn(),
      },
      applyRtcRoomVoiceStateUpdateFromSocket: (MeetingRoom.prototype as any).applyRtcRoomVoiceStateUpdateFromSocket,
    };

    (MeetingRoom.prototype as any).handleVoiceChannelJoin.call(fakeMeetingRoom, ws, {
      channel_id: "vc-1",
      self_mute: true,
    });

    expect(session.voice_channel_id).toBe("vc-1");
    expect(session.self_video).toBe(false);
    expect(session.self_stream).toBe(false);
    expect(fakeMeetingRoom.persist).toHaveBeenCalledWith(ws, session);
    expect(fakeMeetingRoom.markVoiceMemberConnected).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("implicitly accepts a shared RTC pending call when a voice transition joins its channel", () => {
    const pendingCall = {
      callId: "call-1",
      callerId: "caller-1",
      calleeId: "user-1",
      channelId: "dm-1",
      voiceRoomId: "voice-1",
      expiresAt: 123_000,
      callerName: "Alice",
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      pendingCalls: new Map([["user-1", pendingCall]]),
      collectLiveMediaClerkIds: () => new Set<string>(),
      findVoiceMemberControlSession: vi.fn(() => null),
      normalizeVoiceChannelStartedAt: (MeetingRoom.prototype as any).normalizeVoiceChannelStartedAt,
      resolveVoiceJoinedAt: vi.fn(() => 123_456),
      maintainVoiceChannelStartedAt: vi.fn(() => 123_456),
      applyVoiceChannelArrivalEffects: vi.fn(() => true),
      applyVoiceChannelDepartureEffects: vi.fn(),
      takePendingCallForAcceptance: (MeetingRoom.prototype as any).takePendingCallForAcceptance,
      preparePendingCallAcceptForVoiceJoin:
        (MeetingRoom.prototype as any).preparePendingCallAcceptForVoiceJoin,
      handleImplicitVoiceChannelJoinCallAccept:
        (MeetingRoom.prototype as any).handleImplicitVoiceChannelJoinCallAccept,
      applyPendingCallAccepted: (MeetingRoom.prototype as any).applyPendingCallAccepted,
      applyPendingCallStop: (MeetingRoom.prototype as any).applyPendingCallStop,
      broadcastPendingCallStop: (MeetingRoom.prototype as any).broadcastPendingCallStop,
      buildCallRingStopMessage: (MeetingRoom.prototype as any).buildCallRingStopMessage,
      markAcceptedCall: vi.fn(),
      persistPendingCalls: vi.fn(),
      broadcastToUser: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const changed = (MeetingRoom.prototype as any).applyVoiceChannelTransitionEffects.call(
      fakeMeetingRoom,
      {
        clerk_user_id: "user-1",
        to_channel_id: "dm-1",
      },
    );

    expect(changed).toBe(true);
    expect(fakeMeetingRoom.pendingCalls.has("user-1")).toBe(false);
    expect(fakeMeetingRoom.markAcceptedCall).toHaveBeenCalledWith("call-1");
    expect(fakeMeetingRoom.persistPendingCalls).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.broadcastToUser).toHaveBeenNthCalledWith(
      1,
      "caller-1",
      expect.objectContaining({
        d: {
          event: "CALL_RING_STOP",
          data: {
            call_id: "call-1",
            reason: "accepted",
          },
        },
      }),
    );
    expect(fakeMeetingRoom.broadcastToUser).toHaveBeenNthCalledWith(
      2,
      "user-1",
      expect.objectContaining({
        d: {
          event: "CALL_RING_STOP",
          data: {
            call_id: "call-1",
            reason: "accepted",
          },
        },
      }),
    );
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.broadcastVoiceChannelState).toHaveBeenCalledWith("dm-1");
  });

  it("ignores stale shared RTC control leave events after a channel handoff", () => {
    const ws = {} as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-2",
      voice_joined_at: 124_000,
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      requireSession: () => session,
      persist: vi.fn(),
      applyRtcRoomVoiceChannelTransition: vi.fn(),
    };

    (MeetingRoom.prototype as any).handleVoiceChannelLeave.call(fakeMeetingRoom, ws, {
      channel_id: "vc-1",
    });

    expect(session.voice_channel_id).toBe("vc-2");
    expect(session.voice_joined_at).toBe(124_000);
    expect(fakeMeetingRoom.persist).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.applyRtcRoomVoiceChannelTransition).not.toHaveBeenCalled();
  });

  it("abandons a shared RTC pending call when a voice transition empties its channel", () => {
    const pendingCall = {
      callId: "call-1",
      callerId: "caller-1",
      calleeId: "callee-1",
      channelId: "dm-1",
      voiceRoomId: "voice-1",
      expiresAt: 123_000,
      callerName: "Alice",
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      pendingCalls: new Map([["callee-1", pendingCall]]),
      collectLiveMediaClerkIds: () => new Set<string>(),
      findVoiceMemberControlSession: vi.fn(() => null),
      normalizeVoiceChannelStartedAt: (MeetingRoom.prototype as any).normalizeVoiceChannelStartedAt,
      applyVoiceChannelDepartureEffects: (MeetingRoom.prototype as any).applyVoiceChannelDepartureEffects,
      cancelAbandonedPendingVoiceCall: (MeetingRoom.prototype as any).cancelAbandonedPendingVoiceCall,
      takePendingCallForAcceptance: (MeetingRoom.prototype as any).takePendingCallForAcceptance,
      prepareAbandonedPendingCallForChannel:
        (MeetingRoom.prototype as any).prepareAbandonedPendingCallForChannel,
      applyPendingCallAbandoned: (MeetingRoom.prototype as any).applyPendingCallAbandoned,
      applyPendingCallStop: (MeetingRoom.prototype as any).applyPendingCallStop,
      broadcastPendingCallStop: (MeetingRoom.prototype as any).broadcastPendingCallStop,
      buildCallRingStopMessage: (MeetingRoom.prototype as any).buildCallRingStopMessage,
      pruneSharedRtcVoiceChannelIfEmpty: vi.fn(() => true),
      persistPendingCalls: vi.fn(),
      broadcastToUser: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const changed = (MeetingRoom.prototype as any).applyVoiceChannelTransitionEffects.call(
      fakeMeetingRoom,
      {
        clerk_user_id: "user-1",
        from_channel_id: "dm-1",
      },
    );

    expect(changed).toBe(true);
    expect(fakeMeetingRoom.pruneSharedRtcVoiceChannelIfEmpty).toHaveBeenCalledWith("dm-1");
    expect(fakeMeetingRoom.pendingCalls.has("callee-1")).toBe(false);
    expect(fakeMeetingRoom.persistPendingCalls).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.broadcastToUser).toHaveBeenNthCalledWith(
      1,
      "caller-1",
      expect.objectContaining({
        d: {
          event: "CALL_RING_STOP",
          data: {
            call_id: "call-1",
            reason: "abandoned",
          },
        },
      }),
    );
    expect(fakeMeetingRoom.broadcastToUser).toHaveBeenNthCalledWith(
      2,
      "callee-1",
      expect.objectContaining({
        d: {
          event: "CALL_RING_STOP",
          data: {
            call_id: "call-1",
            reason: "abandoned",
          },
        },
      }),
    );
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.broadcastVoiceChannelState).toHaveBeenCalledWith("dm-1");
  });

  it("keeps shared RTC control voice-state updates out of voiceChannelMembers until media truth exists", () => {
    const ws = {} as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      roomSlug: "room-1",
      spatialAudioStates: new Map(),
      voiceChannelMembers: new Map<string, Map<string, unknown>>(),
      requireSession: () => session,
      getSession: () => session,
      persist: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: session.id })),
      broadcast: vi.fn(),
      collectActiveMediaClerkIds: () => new Set<string>(),
      collectLiveMediaClerkIds: () => new Set<string>(),
      getSharedRtcVoiceAuthorityChannelSnapshot: (MeetingRoom.prototype as any).getSharedRtcVoiceAuthorityChannelSnapshot,
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      syncSharedRtcVoiceChannelProjection: (MeetingRoom.prototype as any).syncSharedRtcVoiceChannelProjection,
      createRtcRoomControlSessionEffectsAdapter: (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter,
      applyRtcRoomVoiceStateUpdateFromSocket: (MeetingRoom.prototype as any).applyRtcRoomVoiceStateUpdateFromSocket,
      syncVoiceMemberConnectionStatesFromMedia: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      markVoiceMemberConnected: vi.fn(),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    (MeetingRoom.prototype as any).handleVoiceStateUpdate.call(fakeMeetingRoom, ws, {
      self_mute: true,
      self_video: true,
    });

    expect(session.self_mute).toBe(true);
    expect(session.self_video).toBe(true);
    expect(fakeMeetingRoom.persist).toHaveBeenCalledWith(ws, session);
    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.spatialAudioStates.get("vc-1")).toBeUndefined();
    expect(fakeMeetingRoom.markVoiceMemberConnected).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("keeps shared RTC profile refresh side effects out of voiceChannelMembers until media truth exists", () => {
    const ws = {} as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      name: "Alice Updated",
      username: "alice",
      display_name: "Alice Updated",
      avatar_url: "/avatar.png",
      avatar_display: "avatar",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      roomSlug: "room-1",
      voiceChannelMembers: new Map<string, Map<string, unknown>>(),
      getSession: () => session,
      broadcast: vi.fn(),
      collectActiveMediaClerkIds: () => new Set<string>(),
      collectLiveMediaClerkIds: () => new Set<string>(),
      getSharedRtcVoiceAuthorityChannelSnapshot: (MeetingRoom.prototype as any).getSharedRtcVoiceAuthorityChannelSnapshot,
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      syncSharedRtcVoiceChannelProjection: (MeetingRoom.prototype as any).syncSharedRtcVoiceChannelProjection,
      createRtcRoomControlSessionEffectsAdapter: (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter,
      applyRtcRoomProfileRefreshFromSocket: (MeetingRoom.prototype as any).applyRtcRoomProfileRefreshFromSocket,
      applyProfileRefreshEffects: (MeetingRoom.prototype as any).applyProfileRefreshEffects,
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      markVoiceMemberConnected: vi.fn(),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    (MeetingRoom.prototype as any).applyRtcRoomProfileRefreshFromSocket.call(fakeMeetingRoom, ws, {
      name: "Alice Updated",
      username: "alice",
      displayName: "Alice Updated",
      avatarUrl: "/avatar.png",
      avatarDisplay: "avatar",
    });

    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.markVoiceMemberConnected).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("rehydrates shared RTC control sockets into live sessions without local resumable mirrors", () => {
    const attachment = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const ws = {
      deserializeAttachment: vi.fn(() => attachment),
    } as unknown as WebSocket;
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map(),
      resumableSessions: new Map<string, typeof attachment>(),
      scheduleAlarm: vi.fn(),
      rehydrateRtcRoomControlSessionFromSocket: (MeetingRoom.prototype as any).rehydrateRtcRoomControlSessionFromSocket,
      toSharedRtcControlSessionSnapshot: (MeetingRoom.prototype as any).toSharedRtcControlSessionSnapshot,
    };

    const snapshot = (MeetingRoom.prototype as any).rehydrateRtcRoomControlSessionFromSocket.call(fakeMeetingRoom, ws);

    expect(snapshot).toEqual(expect.objectContaining({
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
    }));
    expect(fakeMeetingRoom.sessions.get(ws)).toEqual(expect.objectContaining({
      id: "participant-1",
      clerk_user_id: "user-1",
      socket_role: "control",
    }));
    expect(fakeMeetingRoom.resumableSessions.size).toBe(0);
    expect(fakeMeetingRoom.scheduleAlarm).not.toHaveBeenCalled();
  });

  it("still rehydrates split-mode control sockets into resumable mirrors and arms the first control alarm", () => {
    const attachment = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const ws = {
      deserializeAttachment: vi.fn(() => attachment),
    } as unknown as WebSocket;
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      sessions: new Map(),
      resumableSessions: new Map<string, typeof attachment>(),
      scheduleAlarm: vi.fn(),
      rehydrateRtcRoomControlSessionFromSocket: (MeetingRoom.prototype as any).rehydrateRtcRoomControlSessionFromSocket,
      toSharedRtcControlSessionSnapshot: (MeetingRoom.prototype as any).toSharedRtcControlSessionSnapshot,
    };

    const snapshot = (MeetingRoom.prototype as any).rehydrateRtcRoomControlSessionFromSocket.call(fakeMeetingRoom, ws);

    expect(snapshot).toEqual(expect.objectContaining({
      id: "participant-1",
      clerk_user_id: "user-1",
    }));
    expect(fakeMeetingRoom.sessions.get(ws)).toEqual(expect.objectContaining({
      id: "participant-1",
      clerk_user_id: "user-1",
      socket_role: "control",
    }));
    expect(fakeMeetingRoom.resumableSessions.get("participant-1")).toEqual(expect.objectContaining({
      id: "participant-1",
      clerk_user_id: "user-1",
      socket_role: "control",
    }));
    expect(fakeMeetingRoom.scheduleAlarm).toHaveBeenCalledTimes(1);
  });

  it("builds shared RTC Ready participants from authoritative participant snapshots", () => {
    const ws = {} as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      username: "alice",
      display_name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      status: "online" as const,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const remoteSnapshot = {
      id: "participant-2",
      clerk_user_id: "user-2",
      name: "Bob",
      username: "bob",
      display_name: "Bob",
      self_mute: true,
      self_deaf: false,
      self_stream: false,
      self_video: true,
      suppress: false,
      status: "idle" as const,
      tracks: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([[ws, session]]),
      sharedRtcControlAuthoritySnapshot: {
        capturedAt: 1,
        sessionsByClerkUserId: new Map([
          ["user-1", session],
          ["user-2", remoteSnapshot],
        ]),
        sessionsByParticipantId: new Map([
          ["participant-1", session],
          ["participant-2", remoteSnapshot],
        ]),
        liveSessionCount: 1,
        resumableSessionCount: 1,
      },
      voiceChannelMembers: new Map(),
      spatialAudioStates: new Map(),
      roomSlug: "room-1",
      ctx: {
        waitUntil: vi.fn(),
      },
      getSession: (MeetingRoom.prototype as any).getSession,
      buildVoiceState: (MeetingRoom.prototype as any).buildVoiceState,
      buildRtcRoomControlParticipants: (MeetingRoom.prototype as any).buildRtcRoomControlParticipants,
      getSharedRtcControlParticipantCandidates: (MeetingRoom.prototype as any).getSharedRtcControlParticipantCandidates,
      applyRtcRoomControlIdentifyFromSocket: (MeetingRoom.prototype as any).applyRtcRoomControlIdentifyFromSocket,
      sendVoiceChannelStates: vi.fn(async () => undefined),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      sendTo: vi.fn(),
      broadcast: vi.fn(),
      findPendingCallForUser: vi.fn(() => null),
    };

    (MeetingRoom.prototype as any).applyRtcRoomControlIdentifyFromSocket.call(fakeMeetingRoom, ws, {
      participantId: "participant-1",
      name: "Alice",
      username: "alice",
      displayName: "Alice",
      avatarUrl: undefined,
      avatarDisplay: null,
      status: "online",
      iceServers: [],
      voiceToken: "voice-token",
    });

    expect(fakeMeetingRoom.sendTo).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        op: 2,
        d: expect.objectContaining({
          participants: [
            expect.objectContaining({
              id: "participant-2",
              clerk_user_id: "user-2",
              name: "Bob",
              self_mute: true,
              self_video: true,
              status: "idle",
            }),
          ],
        }),
      }),
    );
  });

  it("builds shared RTC Resumed participants from authoritative participant snapshots plus live overlays", () => {
    const ws = {} as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      username: "alice",
      display_name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      spatial_audio_enabled: false,
      spatial_audio_high_fidelity: false,
      suppress: false,
      status: "online" as const,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const remoteSnapshot = {
      id: "participant-2",
      clerk_user_id: "user-2",
      name: "Bob",
      username: "bob",
      display_name: "Bob",
      self_mute: true,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: true,
      spatial_audio_enabled: false,
      spatial_audio_high_fidelity: false,
      suppress: false,
      status: "dnd" as const,
      tracks: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([[ws, session]]),
      sharedRtcControlAuthoritySnapshot: {
        capturedAt: 1,
        sessionsByClerkUserId: new Map([["user-2", remoteSnapshot]]),
        sessionsByParticipantId: new Map([["participant-2", remoteSnapshot]]),
        liveSessionCount: 0,
        resumableSessionCount: 1,
      },
      spatialAudioStates: new Map(),
      roomSlug: "room-1",
      sendTo: vi.fn(),
      buildVoiceState: (MeetingRoom.prototype as any).buildVoiceState,
      buildRtcRoomControlParticipants: (MeetingRoom.prototype as any).buildRtcRoomControlParticipants,
      createRtcRoomControlSessionEffectsAdapter: (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter,
      getSharedRtcControlParticipantCandidates: (MeetingRoom.prototype as any).getSharedRtcControlParticipantCandidates,
      sendRtcRoomResumedPayload: (MeetingRoom.prototype as any).sendRtcRoomResumedPayload,
    };

    (MeetingRoom.prototype as any).sendRtcRoomResumedPayload.call(
      fakeMeetingRoom,
      ws,
      session,
      { voiceToken: "voice-token", iceServers: [] },
      false,
    );

    expect(fakeMeetingRoom.sendTo).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        op: 9,
        d: expect.objectContaining({
          participants: expect.arrayContaining([
            expect.objectContaining({ id: "participant-1", clerk_user_id: "user-1", status: "online" }),
            expect.objectContaining({ id: "participant-2", clerk_user_id: "user-2", status: "dnd" }),
          ]),
        }),
      }),
    );
  });

  it("does not arm a local control alarm or keep a shared local resumable mirror when shared RTC persists a session", () => {
    const ws = {
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map(),
      resumableSessions: new Map<string, typeof session>(),
      scheduleAlarm: vi.fn(),
      persistResumableSession: vi.fn(),
      persist: (MeetingRoom.prototype as any).persist,
    };

    (MeetingRoom.prototype as any).persist.call(fakeMeetingRoom, ws, session);

    expect(fakeMeetingRoom.sessions.get(ws)).toEqual(expect.objectContaining({
      id: "participant-1",
      clerk_user_id: "user-1",
      socket_role: "control",
    }));
    expect(fakeMeetingRoom.resumableSessions.has("participant-1")).toBe(false);
    expect(fakeMeetingRoom.persistResumableSession).toHaveBeenCalledWith("participant-1", expect.objectContaining({
      id: "participant-1",
      clerk_user_id: "user-1",
      socket_role: "control",
    }));
    expect(fakeMeetingRoom.scheduleAlarm).not.toHaveBeenCalled();
  });

  it("still arms the first local control alarm when split-mode persist stores a session", () => {
    const ws = {
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      sessions: new Map(),
      resumableSessions: new Map<string, typeof session>(),
      scheduleAlarm: vi.fn(),
      persistResumableSession: vi.fn(),
      persist: (MeetingRoom.prototype as any).persist,
    };

    (MeetingRoom.prototype as any).persist.call(fakeMeetingRoom, ws, session);

    expect(fakeMeetingRoom.scheduleAlarm).toHaveBeenCalledTimes(1);
  });

  it("applies intentional shared RTC control disconnect effects without keeping resumable state", () => {
    const ws = {
      close: vi.fn(),
    } as unknown as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([[ws, session]]),
      resumableSessions: new Map([[session.id, session]]),
      resumableSessionExpiry: new Map<string, number>(),
      profileRefreshCooldowns: new Map([[session.id, 1_000]]),
      getSession: (MeetingRoom.prototype as any).getSession,
      applyControlDisconnectLifecycle: (MeetingRoom.prototype as any).applyControlDisconnectLifecycle,
      applyRtcRoomControlDisconnectFromSocket: (MeetingRoom.prototype as any).applyRtcRoomControlDisconnectFromSocket,
      toSharedRtcControlSessionSnapshot: (MeetingRoom.prototype as any).toSharedRtcControlSessionSnapshot,
      applyRtcRoomVoiceChannelTransition: vi.fn(),
      cleanupCallsForUser: vi.fn(),
      cleanupChannelSubscriptions: vi.fn(),
      cleanupServerSubscriptions: vi.fn(),
      broadcast: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: session.id })),
      scheduleAlarm: vi.fn(),
      persistResumableSessionExpiryEntry: vi.fn(),
      deleteResumableSession: vi.fn(),
      deleteResumableSessionExpiry: vi.fn(),
    };

    (MeetingRoom.prototype as any).applyRtcRoomControlDisconnectFromSocket.call(fakeMeetingRoom, ws, {
      intentional: true,
      now: 200_000,
      previousChannelId: "vc-1",
      closeSocket: true,
      closeCode: 1000,
      closeReason: "Left room",
    });

    expect(fakeMeetingRoom.applyRtcRoomVoiceChannelTransition).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.cleanupCallsForUser).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.cleanupChannelSubscriptions).toHaveBeenCalledWith(ws);
    expect(fakeMeetingRoom.cleanupServerSubscriptions).toHaveBeenCalledWith(ws);
    expect(fakeMeetingRoom.sessions.has(ws)).toBe(false);
    expect(fakeMeetingRoom.resumableSessions.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.resumableSessionExpiry.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.profileRefreshCooldowns.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.persistResumableSessionExpiryEntry).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.deleteResumableSession).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.deleteResumableSessionExpiry).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledTimes(2);
    expect((ws as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledWith(1000, "Left room");
  });

  it("applies abrupt shared RTC control disconnect effects without reviving local expiry alarms", () => {
    const ws = {
      close: vi.fn(),
    } as unknown as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([[ws, session]]),
      resumableSessions: new Map<string, typeof session>(),
      resumableSessionExpiry: new Map<string, number>(),
      profileRefreshCooldowns: new Map([[session.id, 1_000]]),
      getSession: (MeetingRoom.prototype as any).getSession,
      applyControlDisconnectLifecycle: (MeetingRoom.prototype as any).applyControlDisconnectLifecycle,
      applyRtcRoomControlDisconnectFromSocket: (MeetingRoom.prototype as any).applyRtcRoomControlDisconnectFromSocket,
      applyRtcRoomVoiceChannelTransition: vi.fn(),
      markVoiceMemberReconnecting: vi.fn(),
      cleanupCallsForUser: vi.fn(),
      cleanupChannelSubscriptions: vi.fn(),
      cleanupServerSubscriptions: vi.fn(),
      broadcast: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: session.id })),
      scheduleAlarm: vi.fn(),
      persistResumableSessionExpiryEntry: vi.fn(),
      deleteResumableSession: vi.fn(),
      deleteResumableSessionExpiry: vi.fn(),
    };

    (MeetingRoom.prototype as any).applyRtcRoomControlDisconnectFromSocket.call(fakeMeetingRoom, ws, {
      intentional: false,
      now: 200_000,
      previousChannelId: "vc-1",
      closeSocket: false,
    });

    expect(fakeMeetingRoom.markVoiceMemberReconnecting).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.applyRtcRoomVoiceChannelTransition).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.cleanupCallsForUser).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.sessions.has(ws)).toBe(false);
    expect(fakeMeetingRoom.resumableSessions.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.resumableSessionExpiry.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.scheduleAlarm).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.persistResumableSessionExpiryEntry).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.deleteResumableSession).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.deleteResumableSessionExpiry).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledTimes(1);
    expect((ws as { close: ReturnType<typeof vi.fn> }).close).not.toHaveBeenCalled();
  });

  it("does not fan out offline presence for shared RTC disconnects while another clerk session remains", () => {
    const ws = {} as WebSocket;
    const otherWs = {} as WebSocket;
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const otherSession = {
      ...session,
      id: "participant-2",
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([
        [ws, session],
        [otherWs, otherSession],
      ]),
      resumableSessions: new Map<string, typeof session>(),
      resumableSessionExpiry: new Map<string, number>(),
      profileRefreshCooldowns: new Map([[session.id, 1_000]]),
      getSession: (MeetingRoom.prototype as any).getSession,
      applyControlDisconnectLifecycle: (MeetingRoom.prototype as any).applyControlDisconnectLifecycle,
      applyRtcRoomControlDisconnectFromSocket: (MeetingRoom.prototype as any).applyRtcRoomControlDisconnectFromSocket,
      applyRtcRoomVoiceChannelTransition: vi.fn(),
      markVoiceMemberReconnecting: vi.fn(),
      cleanupCallsForUser: vi.fn(),
      cleanupChannelSubscriptions: vi.fn(),
      cleanupServerSubscriptions: vi.fn(),
      broadcast: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: session.id })),
      scheduleAlarm: vi.fn(),
    };

    (MeetingRoom.prototype as any).applyRtcRoomControlDisconnectFromSocket.call(fakeMeetingRoom, ws, {
      intentional: false,
      now: 200_000,
      closeSocket: false,
    });

    expect(fakeMeetingRoom.broadcast).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.sessions.has(ws)).toBe(false);
    expect(fakeMeetingRoom.sessions.has(otherWs)).toBe(true);
    expect(fakeMeetingRoom.resumableSessionExpiry.has(session.id)).toBe(false);
  });

  it("keeps shared RTC DM call lobby joins out of voiceChannelMembers until media truth exists", () => {
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "dm-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
      stream_preview_url: null,
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      voiceChannelMembers: new Map<string, Map<string, unknown>>(),
      collectActiveMediaClerkIds: () => new Set<string>(),
      collectLiveMediaClerkIds: () => new Set<string>(),
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      syncSharedRtcVoiceChannelProjection: (MeetingRoom.prototype as any).syncSharedRtcVoiceChannelProjection,
      toSharedRtcControlSessionSnapshot: (MeetingRoom.prototype as any).toSharedRtcControlSessionSnapshot,
      applyRtcRoomVoiceChannelTransition: vi.fn(),
      syncVoiceMemberConnectionStatesFromMedia: vi.fn(),
      ctx: {
        waitUntil: vi.fn(),
      },
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
    };

    (MeetingRoom.prototype as any).addToVoiceChannelForCall.call(fakeMeetingRoom, session);

    expect(fakeMeetingRoom.voiceChannelMembers.has("dm-1")).toBe(false);
    expect(fakeMeetingRoom.syncVoiceMemberConnectionStatesFromMedia).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("does not materialize shared RTC reconnect placeholders from control disconnects without media truth", () => {
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
      stream_preview_url: null,
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      voiceChannelMembers: new Map<string, Map<string, unknown>>(),
      collectActiveMediaClerkIds: () => new Set<string>(),
      collectLiveMediaClerkIds: () => new Set<string>(),
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    (MeetingRoom.prototype as any).markVoiceMemberReconnecting.call(fakeMeetingRoom, session, 123_000);

    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("uses the shared RTC projection helper as a broadcast invalidation path", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      voiceChannelMembers: new Map([
        ["vc-1", new Map([["user-1", { clerk_user_id: "user-1" }]])],
      ]),
      collectActiveMediaClerkIds: () => new Set(["user-1"]),
      getSharedRtcVoiceAuthorityChannelSnapshot: (MeetingRoom.prototype as any).getSharedRtcVoiceAuthorityChannelSnapshot,
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const projected = (MeetingRoom.prototype as any).syncSharedRtcVoiceChannelProjection.call(
      fakeMeetingRoom,
      "vc-1",
      "user-1",
      new Set<string>(),
    );

    expect(projected).toBe(true);
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("rebroadcasts shared RTC channels directly from authority without relying on local projected-member state", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      voiceChannelMembers: new Map<string, Map<string, unknown>>(),
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            startedAt: 123_000,
            members: [
              {
                clerk_user_id: "user-1",
                name: "Alice",
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
                self_stream_audio: false,
                spatial_audio_enabled: false,
                spatial_audio_high_fidelity: false,
                joined_at: 123_000,
              },
            ],
          },
        ],
      ]),
      getSharedRtcVoiceAuthorityChannelSnapshot: (MeetingRoom.prototype as any).getSharedRtcVoiceAuthorityChannelSnapshot,
      invalidateSharedRtcVoiceChannelState: (MeetingRoom.prototype as any).invalidateSharedRtcVoiceChannelState,
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const changed = (MeetingRoom.prototype as any).invalidateSharedRtcVoiceChannelState.call(
      fakeMeetingRoom,
      "vc-1",
    );

    expect(changed).toBe(true);
    expect(fakeMeetingRoom.broadcastVoiceChannelState).toHaveBeenCalledWith("vc-1");
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("prefers injected shared voice authority snapshots when deciding whether shared rebroadcasts are valid", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            startedAt: 123_000,
            members: [
              {
                clerk_user_id: "user-1",
                name: "Alice",
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
                self_stream_audio: false,
                spatial_audio_enabled: false,
                spatial_audio_high_fidelity: false,
                joined_at: 123_000,
              },
            ],
          },
        ],
      ]),
      collectActiveMediaClerkIds: () => new Set<string>(),
      getSharedRtcVoiceAuthorityChannelSnapshot: (MeetingRoom.prototype as any).getSharedRtcVoiceAuthorityChannelSnapshot,
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
    };

    const shouldBroadcast = (MeetingRoom.prototype as any).shouldMaterializeVoiceMember.call(
      fakeMeetingRoom,
      "vc-1",
      "user-1",
      new Set<string>(),
    );

    expect(shouldBroadcast).toBe(true);
  });

  it("clamps stale shared RTC reconnect windows back to media grace", () => {
    const reconnecting = (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState.call(
      {
        sharedRtcAuthority: true,
        collectLiveMediaClerkIds: () => new Set<string>(),
      },
      "user-1",
      {
        disconnected_at: 1_000,
        reconnect_expires_at: 121_000,
      },
      undefined,
    );

    expect(reconnecting).toEqual({
      connected: false,
      connection_state: "reconnecting",
      disconnected_at: 1_000,
      reconnect_expires_at: 1_000 + RTC_MEDIA_RECONNECT_GRACE_MS,
    });
  });

  it("uses the shorter media grace for shared RTC reconnect windows", () => {
    const reconnecting = (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState.call(
      {
        sharedRtcAuthority: true,
        collectLiveMediaClerkIds: () => new Set<string>(),
      },
      "user-1",
      undefined,
      1_000,
    );

    expect(reconnecting).toEqual({
      connected: false,
      connection_state: "reconnecting",
      disconnected_at: 1_000,
      reconnect_expires_at: 1_000 + RTC_MEDIA_RECONNECT_GRACE_MS,
    });
  });

  it("broadcasts shared RTC channel state when live media is visible again", () => {
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([[{} as WebSocket, session]]),
      resumableSessions: new Map<string, typeof session>(),
      collectActiveMediaClerkIds: () => new Set(["user-1"]),
      getSharedRtcControlSessionCandidates: (MeetingRoom.prototype as any).getSharedRtcControlSessionCandidates,
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const changed = (MeetingRoom.prototype as any).syncVoiceMemberConnectionStatesFromMedia.call(fakeMeetingRoom, "user-1");
    expect(changed).toBe(true);
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("rebroadcasts shared RTC channel invalidation from injected control snapshots even before a shared voice snapshot is present", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map<WebSocket, unknown>(),
      resumableSessions: new Map<string, unknown>(),
      sharedRtcControlAuthoritySnapshot: {
        capturedAt: 200_000,
        sessionsByClerkUserId: new Map([
          [
            "user-1",
            {
              id: "participant-1",
              clerk_user_id: "user-1",
              voice_channel_id: "vc-1",
              voice_joined_at: 123_000,
              name: "Alice",
              self_mute: false,
              self_deaf: false,
              self_stream: false,
              self_stream_audio: false,
              self_video: true,
            },
          ],
        ]),
        liveSessionCount: 1,
        resumableSessionCount: 0,
      },
      collectActiveMediaClerkIds: () => new Set(["user-1"]),
      getSharedRtcControlSessionCandidates: (MeetingRoom.prototype as any).getSharedRtcControlSessionCandidates,
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const changed = (MeetingRoom.prototype as any).syncVoiceMemberConnectionStatesFromMedia.call(fakeMeetingRoom, "user-1");
    expect(changed).toBe(true);
    expect(fakeMeetingRoom.broadcastVoiceChannelState).toHaveBeenCalledWith("vc-1");
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);

    const payload = (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload.call(fakeMeetingRoom);
    expect(payload).toEqual({
      voice_states: {},
      voice_started_at: {},
      spatial_audio_states: {},
    });
  });

  it("prunes empty shared RTC cached voice channels after control truth is cleared", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      voiceChannelMembers: new Map([
        [
          "vc-1",
          new Map([
            [
              "user-1",
              {
                clerk_user_id: "user-1",
                name: "Alice",
                connected: false,
                connection_state: "reconnecting",
              },
            ],
          ]),
        ],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
      buildVoiceChannelStateSnapshot: vi.fn(() => ({ members: [], startedAt: null })),
      deleteVoiceChannelStorage: vi.fn(),
      persistVoiceChannelMembers: vi.fn(),
      persistVoiceChannelStartedAt: vi.fn(),
    };

    const pruned = (MeetingRoom.prototype as any).pruneSharedRtcVoiceChannelIfEmpty.call(
      fakeMeetingRoom,
      "vc-1",
    );

    expect(pruned).toBe(true);
    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.voiceChannelStartedAt.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.deleteVoiceChannelStorage).toHaveBeenCalledWith("vc-1");
    expect(fakeMeetingRoom.persistVoiceChannelMembers).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.persistVoiceChannelStartedAt).toHaveBeenCalledTimes(1);
  });

  it("rebroadcasts every changed shared RTC channel during projection cleanup even when local caches remain", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      pruneSharedRtcVoiceChannelIfEmpty: vi.fn(() => false),
      invalidateSharedRtcVoiceChannelState: vi.fn(() => true),
    };

    const changed = (MeetingRoom.prototype as any).applyRtcRoomSharedProjectionCleanup.call(
      fakeMeetingRoom,
      new Set(["vc-1", "vc-2"]),
    );

    expect(changed).toBe(true);
    expect(fakeMeetingRoom.pruneSharedRtcVoiceChannelIfEmpty).toHaveBeenCalledTimes(2);
    expect(fakeMeetingRoom.pruneSharedRtcVoiceChannelIfEmpty).toHaveBeenNthCalledWith(1, "vc-1");
    expect(fakeMeetingRoom.pruneSharedRtcVoiceChannelIfEmpty).toHaveBeenNthCalledWith(2, "vc-2");
    expect(fakeMeetingRoom.invalidateSharedRtcVoiceChannelState).toHaveBeenNthCalledWith(1, "vc-1");
    expect(fakeMeetingRoom.invalidateSharedRtcVoiceChannelState).toHaveBeenNthCalledWith(2, "vc-2");
  });

  it("reprojects shared RTC voice membership from control session data when media appears", () => {
    const session = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: true,
      self_deaf: false,
      self_stream: false,
      self_video: true,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([[{} as WebSocket, session]]),
      resumableSessions: new Map<string, typeof session>(),
      voiceChannelMembers: new Map<string, Map<string, any>>(),
      collectActiveMediaClerkIds: () => new Set(["user-1"]),
      getSharedRtcControlSessionCandidates: (MeetingRoom.prototype as any).getSharedRtcControlSessionCandidates,
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const changed = (MeetingRoom.prototype as any).syncVoiceMemberConnectionStatesFromMedia.call(fakeMeetingRoom, "user-1");

    expect(changed).toBe(true);
    expect(fakeMeetingRoom.voiceChannelMembers.size).toBe(0);
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("omits stale cached shared RTC members from voice-state payloads without media or control truth", () => {
    const fakeMeetingRoom = createSharedRtcReadPathRoom({
      voiceChannelMembers: new Map<string, Map<string, any>>([
        [
          "vc-1",
          new Map([
            [
              "stale-user",
              {
                clerk_user_id: "stale-user",
                name: "Stale",
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
                joined_at: 123_000,
              },
            ],
          ]),
        ],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
    });

    const payload = (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload.call(fakeMeetingRoom);

    expect(payload).toEqual({
      voice_states: {},
      voice_started_at: {},
      spatial_audio_states: {},
    });
  });

  it("does not derive shared RTC voice-state payload members from local resumable control metadata without an authoritative control snapshot", () => {
    const resumableSession = {
      id: "participant-2",
      clerk_user_id: "user-2",
      voice_channel_id: "vc-2",
      name: "Bob",
      username: "bob",
      display_name: "Bobby",
      avatar_url: "https://example.com/avatar.png",
      avatar_display: "avatar",
      stream_preview_url: "https://example.com/preview.png",
      self_mute: true,
      self_deaf: false,
      self_stream: true,
      self_stream_audio: true,
      self_video: true,
      spatial_audio_enabled: true,
      spatial_audio_high_fidelity: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = createSharedRtcReadPathRoom({
      resumableSessions: new Map<string, typeof resumableSession>([["participant-2", resumableSession]]),
      voiceChannelStartedAt: new Map([["vc-2", 456_000]]),
      collectActiveMediaClerkIds: () => new Set(["user-2"]),
      collectLiveMediaClerkIds: () => new Set(["user-2"]),
    });

    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-2")).toBe(false);

    const payload = (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload.call(fakeMeetingRoom);

    expect(payload).toEqual({
      voice_states: {},
      voice_started_at: {},
      spatial_audio_states: {},
    });
  });

  it("builds shared RTC voice-state payloads from injected snapshots instead of local session, resumable, or cached member mirrors", () => {
    const fakeMeetingRoom = createSharedRtcReadPathRoom({
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            startedAt: 123_000,
            members: [
              {
                clerk_user_id: "user-1",
                name: "Snapshot Alice",
                username: "snapshot-alice",
                display_name: "Snapshot Alice",
                avatar_url: null,
                avatar_display: null,
                stream_preview_url: null,
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: true,
                self_stream: false,
                self_stream_audio: false,
                spatial_audio_enabled: false,
                spatial_audio_high_fidelity: false,
                joined_at: 123_000,
              },
            ],
          },
        ],
      ]),
      sessions: new Map<WebSocket, any>([
        [
          {} as WebSocket,
          {
            id: "participant-live",
            clerk_user_id: "user-live-local",
            voice_channel_id: "vc-live-local",
            voice_joined_at: 456_000,
            name: "Live Local",
            username: "live-local",
            display_name: "Live Local",
            avatar_url: null,
            avatar_display: null,
            stream_preview_url: null,
            self_mute: true,
            self_deaf: false,
            self_stream: true,
            self_stream_audio: true,
            self_video: false,
            spatial_audio_enabled: true,
            spatial_audio_high_fidelity: false,
            suppress: false,
            tracks: [],
            subscribed_channels: [],
            subscribed_servers: [],
          },
        ],
      ]),
      resumableSessions: new Map<string, any>([
        [
          "participant-resumable",
          {
            id: "participant-resumable",
            clerk_user_id: "user-resumable-local",
            voice_channel_id: "vc-resumable-local",
            voice_joined_at: 789_000,
            name: "Resumable Local",
            username: "resumable-local",
            display_name: "Resumable Local",
            avatar_url: null,
            avatar_display: null,
            stream_preview_url: null,
            self_mute: true,
            self_deaf: false,
            self_stream: true,
            self_stream_audio: true,
            self_video: false,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
            suppress: false,
            tracks: [],
            subscribed_channels: [],
            subscribed_servers: [],
          },
        ],
      ]),
      voiceChannelMembers: new Map<string, Map<string, any>>([
        [
          "vc-cached-local",
          new Map([
            [
              "user-cached-local",
              {
                clerk_user_id: "user-cached-local",
                name: "Cached Local",
                username: "cached-local",
                display_name: "Cached Local",
                avatar_url: null,
                avatar_display: null,
                stream_preview_url: null,
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: true,
                self_deaf: false,
                self_video: false,
                self_stream: true,
                joined_at: 999_000,
              },
            ],
          ]),
        ],
      ]),
      voiceChannelStartedAt: new Map([
        ["vc-1", 123_000],
        ["vc-live-local", 456_000],
        ["vc-resumable-local", 789_000],
        ["vc-cached-local", 999_000],
      ]),
    });

    const payload = (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload.call(fakeMeetingRoom);

    expect(payload.voice_states["vc-1"]).toEqual([
      expect.objectContaining({
        clerk_user_id: "user-1",
        name: "Snapshot Alice",
        self_mute: false,
        self_stream: false,
        self_video: true,
        connected: true,
        connection_state: "connected",
      }),
    ]);
    expect(payload.voice_started_at["vc-1"]).toBe(123_000);
    expect(payload.voice_states["vc-live-local"]).toBeUndefined();
    expect(payload.voice_states["vc-resumable-local"]).toBeUndefined();
    expect(payload.voice_states["vc-cached-local"]).toBeUndefined();
  });

  it("prefers injected shared voice snapshots over local resumable control metadata in shared RTC read paths", () => {
    const fakeMeetingRoom = createSharedRtcReadPathRoom({
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            startedAt: 123_000,
            members: [
              {
                clerk_user_id: "user-1",
                name: "Snapshot Alice",
                username: "snapshot-alice",
                display_name: "Snapshot Alice",
                avatar_url: null,
                avatar_display: null,
                stream_preview_url: null,
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: true,
                self_stream: false,
                self_stream_audio: false,
                spatial_audio_enabled: false,
                spatial_audio_high_fidelity: false,
                joined_at: 123_000,
              },
            ],
          },
        ],
      ]),
      resumableSessions: new Map<string, any>([
        [
          "participant-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-stale",
            voice_joined_at: 1_000,
            name: "Stale Alice",
            self_mute: true,
            self_deaf: false,
            self_stream: true,
            self_stream_audio: true,
            self_video: false,
          },
        ],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000], ["vc-stale", 1_000]]),
    });

    const payload = (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload.call(fakeMeetingRoom);

    expect(payload.voice_states["vc-1"]).toEqual([
      expect.objectContaining({
        clerk_user_id: "user-1",
        name: "Snapshot Alice",
        self_mute: false,
        self_video: true,
      }),
    ]);
    expect(payload.voice_states["vc-stale"]).toBeUndefined();
  });

  it("prefers injected shared voice snapshots over live local control metadata for the same shared RTC user", () => {
    const liveSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_500,
      name: "Live Alice",
      username: "live-alice",
      display_name: "Live Alice",
      avatar_url: null,
      avatar_display: null,
      stream_preview_url: null,
      self_mute: true,
      self_deaf: false,
      self_stream: true,
      self_stream_audio: true,
      self_video: false,
      spatial_audio_enabled: true,
      spatial_audio_high_fidelity: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = createSharedRtcReadPathRoom({
      sessions: new Map<WebSocket, any>([[{} as WebSocket, liveSession]]),
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            startedAt: 123_000,
            members: [
              {
                clerk_user_id: "user-1",
                name: "Snapshot Alice",
                username: "snapshot-alice",
                display_name: "Snapshot Alice",
                avatar_url: null,
                avatar_display: null,
                stream_preview_url: null,
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: true,
                self_stream: false,
                self_stream_audio: false,
                spatial_audio_enabled: false,
                spatial_audio_high_fidelity: false,
                joined_at: 123_000,
              },
            ],
          },
        ],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
    });

    const payload = (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload.call(fakeMeetingRoom);

    expect(payload.voice_states["vc-1"]).toEqual([
      expect.objectContaining({
        clerk_user_id: "user-1",
        name: "Snapshot Alice",
        self_mute: false,
        self_stream: false,
        self_video: true,
        spatial_audio_enabled: false,
      }),
    ]);
  });

  it("ignores stale media sockets that no longer have backing session truth", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      ctx: {
        getWebSockets: () => [
          { deserializeAttachment: () => ({ socket_role: "media", clerk_user_id: "live-user" }) },
          { deserializeAttachment: () => ({ socket_role: "media", clerk_user_id: "stale-user" }) },
          { deserializeAttachment: () => ({ socket_role: "control", clerk_user_id: "control-user" }) },
        ],
        storage: {
          sql: {
            exec: vi.fn(() => [
              { clerk_user_id: "live-user" },
            ]),
          },
        },
      },
    };

    const ids = (MeetingRoom.prototype as any).collectLiveMediaClerkIds.call(fakeMeetingRoom, 200_000);
    expect([...ids]).toEqual(["live-user"]);
  });

  it("removes stale shared RTC projected voice members when media authority is gone", () => {
    const persistVoiceChannelMembers = vi.fn();
    const persistVoiceChannelStartedAt = vi.fn();
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map<WebSocket, unknown>(),
      resumableSessionExpiry: new Map<string, number>(),
      resumableSessions: new Map<string, unknown>(),
      voiceChannelMembers: new Map([
        [
          "vc-1",
          new Map([
            [
              "control-only",
              {
                clerk_user_id: "control-only",
                name: "Alice",
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
              },
            ],
          ]),
        ],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
      collectActiveMediaClerkIds: () => new Set<string>(),
      persistVoiceChannelMembers,
      persistVoiceChannelStartedAt,
      deleteVoiceChannelStorage: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    (MeetingRoom.prototype as any).reconcileVoiceMembers.call(fakeMeetingRoom);

    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.voiceChannelStartedAt.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.deleteVoiceChannelStorage).toHaveBeenCalledWith("vc-1");
    expect(persistVoiceChannelMembers).toHaveBeenCalledTimes(1);
    expect(persistVoiceChannelStartedAt).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("removes only stale shared RTC projected members while preserving active ones", () => {
    const persistVoiceChannelMembers = vi.fn();
    const persistVoiceChannelStartedAt = vi.fn();
    const members = new Map([
      [
        "live-user",
        {
          clerk_user_id: "live-user",
          name: "Live",
          connected: true,
          connection_state: "connected",
          disconnected_at: null,
          reconnect_expires_at: null,
          self_mute: false,
          self_deaf: false,
          self_video: false,
          self_stream: false,
        },
      ],
      [
        "stale-user",
        {
          clerk_user_id: "stale-user",
          name: "Stale",
          connected: false,
          connection_state: "reconnecting",
          disconnected_at: 1_000,
          reconnect_expires_at: 2_000,
          self_mute: false,
          self_deaf: false,
          self_video: false,
          self_stream: false,
        },
      ],
    ]);
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map<WebSocket, unknown>(),
      resumableSessionExpiry: new Map<string, number>(),
      resumableSessions: new Map<string, unknown>(),
      voiceChannelMembers: new Map([["vc-1", members]]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
      collectActiveMediaClerkIds: () => new Set<string>(["live-user"]),
      persistVoiceChannelMembers,
      persistVoiceChannelStartedAt,
      deleteVoiceChannelStorage: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    (MeetingRoom.prototype as any).reconcileVoiceMembers.call(fakeMeetingRoom);

    expect(fakeMeetingRoom.voiceChannelMembers.get("vc-1")).toEqual(
      new Map([["live-user", members.get("live-user")]]),
    );
    expect(fakeMeetingRoom.voiceChannelStartedAt.get("vc-1")).toBe(123_000);
    expect(fakeMeetingRoom.deleteVoiceChannelStorage).not.toHaveBeenCalled();
    expect(persistVoiceChannelMembers).toHaveBeenCalledTimes(1);
    expect(persistVoiceChannelStartedAt).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("removes shared RTC voice members once only control resumability remains past media grace", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(90_000);
    const ws = {
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;
    const liveSession = {
      id: "participant-live",
      clerk_user_id: "control-and-media-stale",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const resumableOnlySession = {
      id: "participant-stale",
      clerk_user_id: "control-and-media-stale",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([[ws, liveSession]]),
      voiceChannelMembers: new Map([
        [
          "vc-1",
          new Map([
            [
              "control-and-media-stale",
              {
                clerk_user_id: "control-and-media-stale",
                name: "Alice",
                connected: false,
                connection_state: "reconnecting",
                disconnected_at: 1_000,
                reconnect_expires_at: 1_000 + RTC_MEDIA_RECONNECT_GRACE_MS,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
              },
            ],
          ]),
        ],
      ]),
      resumableSessionExpiry: new Map<string, number>([
        ["participant-1", 1_000],
      ]),
      resumableSessions: new Map<string, unknown>([
        ["participant-live", liveSession],
        ["participant-stale", resumableOnlySession],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
      collectActiveMediaClerkIds: () => new Set<string>(),
      persistVoiceChannelMembers: vi.fn(),
      persistVoiceChannelStartedAt: vi.fn(),
      deleteVoiceChannelStorage: vi.fn(),
      persist: vi.fn((targetWs: WebSocket, session: typeof liveSession) => {
        fakeMeetingRoom.sessions.set(targetWs, session);
        fakeMeetingRoom.resumableSessions.set(session.id, session);
      }),
      persistResumableSession: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    (MeetingRoom.prototype as any).reconcileVoiceMembers.call(fakeMeetingRoom);

    expect(fakeMeetingRoom.sessions.get(ws)?.voice_channel_id).toBe("vc-1");
    expect((fakeMeetingRoom.resumableSessions.get("participant-stale") as { voice_channel_id?: string }).voice_channel_id).toBe("vc-1");
    expect(fakeMeetingRoom.persist).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.persistResumableSession).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.deleteVoiceChannelStorage).toHaveBeenCalledWith("vc-1");
    expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("scrubs stale control-backed voice state when shared RTC bootstrap is applied", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(90_000);
    const ws = {
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;
    const liveSession = {
      id: "participant-live",
      clerk_user_id: "control-and-media-stale",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const resumableOnlySession = {
      id: "participant-stale",
      clerk_user_id: "control-and-media-stale",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      sessions: new Map([[ws, liveSession]]),
      voiceChannelMembers: new Map([
        [
          "vc-1",
          new Map([
            [
              "control-and-media-stale",
              {
                clerk_user_id: "control-and-media-stale",
                name: "Alice",
                connected: false,
                connection_state: "reconnecting",
                disconnected_at: 1_000,
                reconnect_expires_at: 1_000 + RTC_MEDIA_RECONNECT_GRACE_MS,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
              },
            ],
          ]),
        ],
      ]),
      resumableSessionExpiry: new Map<string, number>([
        ["participant-1", 1_000],
      ]),
      resumableSessions: new Map<string, unknown>([
        ["participant-live", liveSession],
        ["participant-stale", resumableOnlySession],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
      collectLiveMediaClerkIds: () => new Set<string>(),
      collectActiveMediaClerkIds: () => new Set<string>(),
      getSharedRtcControlSessionCandidates: (MeetingRoom.prototype as any).getSharedRtcControlSessionCandidates,
      clearProjectedVoiceChannelMemberCache: (MeetingRoom.prototype as any).clearProjectedVoiceChannelMemberCache,
      resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
      syncVoiceMemberConnectionStatesFromMedia: (MeetingRoom.prototype as any).syncVoiceMemberConnectionStatesFromMedia,
      reconcileVoiceMembersFromMedia: (MeetingRoom.prototype as any).reconcileVoiceMembersFromMedia,
      reconcileVoiceMembers: (MeetingRoom.prototype as any).reconcileVoiceMembers,
      persistVoiceChannelMembers: vi.fn(),
      persistVoiceChannelStartedAt: vi.fn(),
      persist: vi.fn((targetWs: WebSocket, session: typeof liveSession) => {
        fakeMeetingRoom.sessions.set(targetWs, session);
        fakeMeetingRoom.resumableSessions.set(session.id, session);
      }),
      persistResumableSession: vi.fn(),
      deleteVoiceChannelStorage: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    try {
      (MeetingRoom.prototype as any).setSharedRtcAuthority.call(fakeMeetingRoom, true);

      expect(fakeMeetingRoom.sharedRtcAuthority).toBe(true);
      expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(true);
      expect(fakeMeetingRoom.deleteVoiceChannelStorage).not.toHaveBeenCalled();
      expect(fakeMeetingRoom.persist).not.toHaveBeenCalled();
      expect(fakeMeetingRoom.persistResumableSession).not.toHaveBeenCalled();

      const changed = (MeetingRoom.prototype as any).bootstrapRtcRoomSharedProjection.call(fakeMeetingRoom);

      expect(changed).toBe(true);
      expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
      expect(fakeMeetingRoom.sessions.get(ws)?.voice_channel_id).toBe("vc-1");
      expect((fakeMeetingRoom.resumableSessions.get("participant-stale") as { voice_channel_id?: string }).voice_channel_id).toBe("vc-1");
      expect(fakeMeetingRoom.deleteVoiceChannelStorage).toHaveBeenCalledWith("vc-1");
      expect(fakeMeetingRoom.persist).not.toHaveBeenCalled();
      expect(fakeMeetingRoom.persistResumableSession).not.toHaveBeenCalled();
      expect(fakeMeetingRoom.broadcastVoiceChannelState).toHaveBeenCalledWith("vc-1");
      expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);

      const secondChanged = (MeetingRoom.prototype as any).bootstrapRtcRoomSharedProjection.call(fakeMeetingRoom);

      expect(secondChanged).toBe(false);
      expect(fakeMeetingRoom.deleteVoiceChannelStorage).toHaveBeenCalledTimes(1);
      expect(fakeMeetingRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("keeps control-only voice members in split mode for backward compatibility", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      sessions: new Map([
        [
          {},
          {
            clerk_user_id: "control-only",
          },
        ],
      ]),
      resumableSessionExpiry: new Map<string, number>(),
      resumableSessions: new Map<string, unknown>(),
      voiceChannelMembers: new Map([
        [
          "vc-1",
          new Map([
            [
              "control-only",
              {
                clerk_user_id: "control-only",
                name: "Alice",
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
              },
            ],
          ]),
        ],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
      collectActiveMediaClerkIds: () => new Set<string>(),
      persistVoiceChannelMembers: vi.fn(),
      persistVoiceChannelStartedAt: vi.fn(),
      deleteVoiceChannelStorage: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      ctx: {
        getWebSockets: () => [],
        storage: {
          sql: {
            exec: vi.fn(() => []),
          },
        },
        waitUntil: vi.fn(),
      },
    };

    (MeetingRoom.prototype as any).reconcileVoiceMembers.call(fakeMeetingRoom);

    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(true);
    expect(fakeMeetingRoom.persistVoiceChannelMembers).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.deleteVoiceChannelStorage).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("does not materialize shared RTC voice membership on resume after media authority expires", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(90_000);
    const ws = {
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;
    const resumedWs = {
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;
    const resumableSession = {
      id: "participant-1",
      clerk_user_id: "control-and-media-stale",
      voice_channel_id: "vc-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
      seq: 0,
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      roomSlug: "room-1",
      sessions: new Map<WebSocket, typeof resumableSession>(),
      channelSubscriptions: new Map(),
      serverSubscriptions: new Map(),
      voiceChannelMembers: new Map([
        [
          "vc-1",
          new Map([
            [
              "control-and-media-stale",
              {
                clerk_user_id: "control-and-media-stale",
                name: "Alice",
                connected: false,
                connection_state: "reconnecting",
                disconnected_at: 1_000,
                reconnect_expires_at: 1_000 + RTC_MEDIA_RECONNECT_GRACE_MS,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
              },
            ],
          ]),
        ],
      ]),
      resumableSessionExpiry: new Map<string, number>([
        ["participant-1", 1_000],
      ]),
      resumableSessions: new Map<string, typeof resumableSession>([
        ["participant-1", resumableSession],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
      spatialAudioStates: new Map(),
      collectActiveMediaClerkIds: () => new Set<string>(),
      persist: vi.fn((targetWs: WebSocket, session: typeof resumableSession) => {
        fakeMeetingRoom.sessions.set(targetWs, session);
        fakeMeetingRoom.resumableSessions.set(session.id, session);
        targetWs.serializeAttachment(session);
      }),
      persistResumableSession: vi.fn(),
      persistVoiceChannelMembers: vi.fn(),
      persistVoiceChannelStartedAt: vi.fn(),
      deleteVoiceChannelStorage: vi.fn(),
      deleteResumableSession: vi.fn(),
      deleteResumableSessionExpiry: vi.fn((id: string) => {
        fakeMeetingRoom.resumableSessionExpiry.delete(id);
      }),
      markVoiceMemberConnected: vi.fn(),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      buildVoiceState: vi.fn((data: typeof resumableSession) => ({
        id: data.id,
        clerk_user_id: data.clerk_user_id,
        name: data.name,
        self_mute: data.self_mute,
        self_deaf: data.self_deaf,
        self_stream: data.self_stream,
        self_video: data.self_video,
        suppress: data.suppress,
        tracks: data.tracks,
      })),
      sendTo: vi.fn(),
      sendVoiceChannelStates: vi.fn(async () => undefined),
      getSession: (MeetingRoom.prototype as any).getSession,
      createRtcRoomControlSessionEffectsAdapter: (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter,
      fetchRtcRoomVoiceCredentials: vi.fn(async () => ({
        voiceToken: "voice-token",
        iceServers: [],
      })),
      applyRtcRoomControlResumeFromSocket: (MeetingRoom.prototype as any).applyRtcRoomControlResumeFromSocket,
      restoreRtcRoomSubscriptions: vi.fn(),
      restoreRtcRoomVoiceMembershipOnResume: vi.fn(async () => undefined),
      sendRtcRoomResumedPayload: (MeetingRoom.prototype as any).sendRtcRoomResumedPayload,
      buildRtcRoomControlParticipants: (MeetingRoom.prototype as any).buildRtcRoomControlParticipants,
      getSharedRtcControlParticipantCandidates: (MeetingRoom.prototype as any).getSharedRtcControlParticipantCandidates,
      getSharedRtcControlSessionCandidates: (MeetingRoom.prototype as any).getSharedRtcControlSessionCandidates,
      applyRtcRoomSharedProjectionCleanup: (MeetingRoom.prototype as any).applyRtcRoomSharedProjectionCleanup,
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    try {
      (MeetingRoom.prototype as any).reconcileVoiceMembers.call(fakeMeetingRoom);
      expect(resumableSession.voice_channel_id).toBe("vc-1");

      fakeMeetingRoom.markVoiceMemberConnected.mockClear();
      fakeMeetingRoom.broadcastVoiceChannelState.mockClear();

      await (MeetingRoom.prototype as any).handleResume.call(fakeMeetingRoom, resumedWs, {
        session_id: "participant-1",
        seq_ack: 0,
      });
    } finally {
      nowSpy.mockRestore();
    }

    expect(fakeMeetingRoom.markVoiceMemberConnected).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.broadcastVoiceChannelState).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.sessions.get(resumedWs)?.voice_channel_id).toBe("vc-1");
    expect(fakeMeetingRoom.sendTo).toHaveBeenCalledWith(
      resumedWs,
      expect.objectContaining({ op: 9 }),
    );
  });

  it("builds shared RTC voice-state payload from the injected shared voice authority snapshot", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map<WebSocket, any>([
        [
          {} as WebSocket,
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            name: "Alice",
            username: "alice",
            display_name: "Alice",
            avatar_url: null,
            avatar_display: null,
            stream_preview_url: null,
            self_mute: false,
            self_deaf: false,
            self_video: true,
            self_stream: false,
            self_stream_audio: false,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
          },
        ],
      ]),
      resumableSessions: new Map<string, any>(),
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            startedAt: 5_000,
            members: [
              {
                clerk_user_id: "user-1",
                name: "Alice",
                username: "alice",
                display_name: "Alice",
                avatar_url: null,
                avatar_display: null,
                stream_preview_url: null,
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                self_mute: false,
                self_deaf: false,
                self_video: true,
                self_stream: false,
                self_stream_audio: false,
                spatial_audio_enabled: false,
                spatial_audio_high_fidelity: false,
                joined_at: 5_000,
              },
            ],
          },
        ],
      ]),
      voiceChannelMembers: new Map<string, Map<string, any>>([
        [
          "vc-1",
          new Map([
            [
              "stale-user",
              {
                clerk_user_id: "stale-user",
                name: "Stale",
                connected: true,
                connection_state: "connected",
                disconnected_at: null,
                reconnect_expires_at: null,
                joined_at: 1_000,
                self_mute: false,
                self_deaf: false,
                self_video: false,
                self_stream: false,
              },
            ],
          ]),
        ],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 5_000]]),
      spatialAudioStates: new Map(),
      collectActiveMediaClerkIds: () => new Set(["user-1"]),
      collectLiveMediaClerkIds: () => new Set(["user-1"]),
      collectSharedRtcVoiceStateChannelIds: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateChannelIds,
      collectSharedRtcVoiceStateSessions: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateSessions,
      getSharedRtcControlSessionCandidates: (MeetingRoom.prototype as any).getSharedRtcControlSessionCandidates,
      buildSharedRtcVoiceChannelMembers: (MeetingRoom.prototype as any).buildSharedRtcVoiceChannelMembers,
      getSharedRtcVoiceAuthorityChannelSnapshot: (MeetingRoom.prototype as any).getSharedRtcVoiceAuthorityChannelSnapshot,
      buildVoiceChannelStateSnapshot: (MeetingRoom.prototype as any).buildVoiceChannelStateSnapshot,
      resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
    };

    const payload = (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload.call(fakeMeetingRoom);

    expect(payload.voice_states["vc-1"]).toEqual([
      expect.objectContaining({
        clerk_user_id: "user-1",
        name: "Alice",
        connected: true,
        connection_state: "connected",
        self_video: true,
      }),
    ]);
    expect(payload.voice_states["vc-1"]).toHaveLength(1);
    expect(payload.voice_started_at["vc-1"]).toBe(5_000);
  });

  it("can emit shared RTC voice-state output before the cache is materialized", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map<WebSocket, any>(),
      resumableSessions: new Map<string, any>(),
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            members: [
              {
                clerk_user_id: "user-1",
                name: "Alice",
                username: "alice",
                display_name: "Alice",
                avatar_url: null,
                avatar_display: null,
                stream_preview_url: null,
                connected: false,
                connection_state: "reconnecting",
                disconnected_at: 199_000,
                reconnect_expires_at: 229_000,
                self_mute: true,
                self_deaf: false,
                self_video: false,
                self_stream: true,
                self_stream_audio: true,
                spatial_audio_enabled: false,
                spatial_audio_high_fidelity: false,
                joined_at: 200_000,
              },
            ],
          },
        ],
      ]),
      voiceChannelMembers: new Map<string, Map<string, any>>(),
      voiceChannelStartedAt: new Map<string, number>(),
      spatialAudioStates: new Map(),
      collectActiveMediaClerkIds: () => new Set(["user-1"]),
      collectLiveMediaClerkIds: () => new Set<string>(),
      collectSharedRtcVoiceStateSessions: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateSessions,
      getSharedRtcControlSessionCandidates: (MeetingRoom.prototype as any).getSharedRtcControlSessionCandidates,
      buildSharedRtcVoiceChannelMembers: (MeetingRoom.prototype as any).buildSharedRtcVoiceChannelMembers,
      getSharedRtcVoiceAuthorityChannelSnapshot: (MeetingRoom.prototype as any).getSharedRtcVoiceAuthorityChannelSnapshot,
      buildVoiceChannelStateSnapshot: (MeetingRoom.prototype as any).buildVoiceChannelStateSnapshot,
      resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
    };

    const message = (MeetingRoom.prototype as any).buildVoiceChannelStateUpdateMessage.call(
      fakeMeetingRoom,
      "vc-1",
    );

    expect(message.d.event).toBe("VOICE_CHANNEL_STATE_UPDATE");
    expect(message.d.data).toEqual({
      channel_id: "vc-1",
      members: [
        expect.objectContaining({
          clerk_user_id: "user-1",
          name: "Alice",
          connected: false,
          connection_state: "reconnecting",
          self_stream: true,
          self_stream_audio: true,
        }),
      ],
      started_at: expect.any(Number),
      spatial_audio_state: undefined,
    });
  });
});

describe("meeting room resumable session persistence", () => {
  it("persists the latest resumable snapshot whenever a live control session changes", () => {
    const markDirty = vi.fn();
    const scheduleAlarm = vi.fn();
    const ws = {
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;
    const session = {
      id: "participant-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
      subscribed_channels: [],
      subscribed_servers: [],
    };
    const fakeMeetingRoom = {
      sessions: new Map(),
      resumableSessions: new Map<string, unknown>(),
      markDirty,
      scheduleAlarm,
      getResumableSessionStorageKey: (MeetingRoom.prototype as any).getResumableSessionStorageKey,
      persistResumableSession: (MeetingRoom.prototype as any).persistResumableSession,
    };

    (MeetingRoom.prototype as any).persist.call(fakeMeetingRoom, ws, session);

    expect(fakeMeetingRoom.resumableSessions.get("participant-1")).toBe(session);
    expect(ws.serializeAttachment).toHaveBeenCalledWith({
      ...session,
      socket_role: "control",
    });
    expect(markDirty).toHaveBeenCalledWith("resume:session:participant-1", {
      ...session,
      socket_role: "control",
    });
    expect(scheduleAlarm).toHaveBeenCalledTimes(1);
  });
});

describe("meeting room alarm-backed presence persistence", () => {
  it("queues the latest presence update durably and schedules alarm-backed flushes", () => {
    const markDirty = vi.fn();
    const scheduleAlarm = vi.fn();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const fakeMeetingRoom = {
      presenceD1Pending: new Map<string, unknown>(),
      markDirty,
      scheduleAlarm,
      getPendingPresenceStorageKey: (MeetingRoom.prototype as any).getPendingPresenceStorageKey,
      persistPendingPresence: (MeetingRoom.prototype as any).persistPendingPresence,
    };

    try {
      (MeetingRoom.prototype as any).debouncePersistPresence.call(fakeMeetingRoom, "user-1", "idle");
    } finally {
      nowSpy.mockRestore();
    }

    expect(fakeMeetingRoom.presenceD1Pending.get("user-1")).toEqual({
      status: "idle",
      dueAt: 3_000,
    });
    expect(markDirty).toHaveBeenCalledWith("presence:pending:user-1", {
      status: "idle",
      dueAt: 3_000,
    });
    expect(scheduleAlarm).toHaveBeenCalledTimes(1);
  });

  it("flushes due presence writes from alarm-backed storage", async () => {
    const updateRun = vi.fn(async () => undefined);
    const membershipAll = vi.fn(async () => ({
      results: [{ server_id: "server-1" }, { server_id: "server-2" }],
    }));
    const cacheDelete = vi.fn(async () => undefined);
    const deletePendingPresence = vi.fn((clerkId: string) => {
      fakeMeetingRoom.presenceD1Pending.delete(clerkId);
    });
    const fakeMeetingRoom = {
      presenceD1Pending: new Map([
        ["user-due", { status: "idle", dueAt: 1_000 }],
        ["user-later", { status: "dnd", dueAt: 5_000 }],
      ]),
      env: {
        DB: {
          prepare: vi.fn((query: string) => {
            if (query.startsWith("UPDATE users SET status")) {
              return {
                bind: vi.fn(() => ({ run: updateRun })),
              };
            }
            if (query.startsWith("SELECT server_id FROM server_members")) {
              return {
                bind: vi.fn(() => ({ all: membershipAll })),
              };
            }
            throw new Error(`Unexpected query: ${query}`);
          }),
        },
        CACHE: {
          delete: cacheDelete,
        },
      },
      deletePendingPresence,
      persistPresenceStatusToD1: (MeetingRoom.prototype as any).persistPresenceStatusToD1,
    };

    await (MeetingRoom.prototype as any).flushDuePresenceWrites.call(fakeMeetingRoom, 2_000);

    expect(deletePendingPresence).toHaveBeenCalledWith("user-due");
    expect(deletePendingPresence).not.toHaveBeenCalledWith("user-later");
    expect(updateRun).toHaveBeenCalledTimes(1);
    expect(membershipAll).toHaveBeenCalledTimes(1);
    expect(cacheDelete).toHaveBeenCalledWith("v1:server:members:server-1");
    expect(cacheDelete).toHaveBeenCalledWith("v1:server:members:server-2");
    expect(fakeMeetingRoom.presenceD1Pending.has("user-later")).toBe(true);
  });
});

describe("meeting room alarm-backed call state helpers", () => {
  it("expires pending call rings and accepted-call ttl entries during alarm processing", async () => {
    const fakeMeetingRoom = {
      sessions: new Map(),
      resumableSessions: new Map(),
      resumableSessionExpiry: new Map(),
      presenceD1Pending: new Map(),
      pendingCalls: new Map([
        [
          "callee-1",
          {
            callId: "call-1",
            callerId: "caller-1",
            calleeId: "callee-1",
            channelId: "dm-1",
            voiceRoomId: "voice-1",
            expiresAt: 1_000,
            callerName: "Alice",
          },
        ],
        [
          "callee-2",
          {
            callId: "call-2",
            callerId: "caller-2",
            calleeId: "callee-2",
            channelId: "dm-2",
            voiceRoomId: "voice-2",
            expiresAt: 5_000,
            callerName: "Bob",
          },
        ],
      ]),
      acceptedCalls: new Map([
        ["accepted-stale", 1_000],
        ["accepted-live", 5_000],
      ]),
      expirePendingCalls: (MeetingRoom.prototype as any).expirePendingCalls,
      pruneExpiredAcceptedCalls: (MeetingRoom.prototype as any).pruneExpiredAcceptedCalls,
      persistPendingCalls: vi.fn(),
      persistAcceptedCalls: vi.fn(),
      deleteResumableSession: vi.fn(),
      deleteResumableSessionExpiry: vi.fn(),
      flushDuePresenceWrites: vi.fn(async () => undefined),
      reconcileVoiceMembers: vi.fn(),
      flushDirtyStorage: vi.fn(),
      broadcast: vi.fn(),
      broadcastToUser: vi.fn(),
      buildCallRingStopMessage: (MeetingRoom.prototype as any).buildCallRingStopMessage,
      broadcastPendingCallStop: (MeetingRoom.prototype as any).broadcastPendingCallStop,
      runPendingCallAlarmMaintenance: (MeetingRoom.prototype as any).runPendingCallAlarmMaintenance,
      scheduleAlarm: vi.fn(),
      hasMeetingRoomAlarmWork: (MeetingRoom.prototype as any).hasMeetingRoomAlarmWork,
      runAlarmMaintenance: (MeetingRoom.prototype as any).runAlarmMaintenance,
    };
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000);

    try {
      await (MeetingRoom.prototype as any).alarm.call(fakeMeetingRoom);
    } finally {
      nowSpy.mockRestore();
    }

    expect(fakeMeetingRoom.pendingCalls.has("callee-1")).toBe(false);
    expect(fakeMeetingRoom.pendingCalls.has("callee-2")).toBe(true);
    expect(fakeMeetingRoom.acceptedCalls.has("accepted-stale")).toBe(false);
    expect(fakeMeetingRoom.acceptedCalls.has("accepted-live")).toBe(true);
    expect(fakeMeetingRoom.persistPendingCalls).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.persistAcceptedCalls).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.broadcastToUser).toHaveBeenCalledTimes(2);
    expect(fakeMeetingRoom.flushDirtyStorage).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.scheduleAlarm).toHaveBeenCalledTimes(1);
  });

  it("keeps RTC_ROOM control alarm maintenance separate from shared voice reconciliation", async () => {
    const fakeMeetingRoom = {
      runAlarmMaintenance: vi.fn(async () => undefined),
    };

    await (MeetingRoom.prototype as any).runRtcRoomControlAlarm.call(fakeMeetingRoom);

    expect(fakeMeetingRoom.runAlarmMaintenance).toHaveBeenCalledWith(expect.any(Number), false);
  });

  it("fans out shared RTC pending-call timeout stops as a pure room effect helper", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      broadcastToUser: vi.fn(),
      buildCallRingStopMessage: (MeetingRoom.prototype as any).buildCallRingStopMessage,
      broadcastPendingCallStop: (MeetingRoom.prototype as any).broadcastPendingCallStop,
      applyPendingCallStop: (MeetingRoom.prototype as any).applyPendingCallStop,
      applyRtcRoomPendingCallTimedOut: (MeetingRoom.prototype as any).applyRtcRoomPendingCallTimedOut,
    };

    const result = (MeetingRoom.prototype as any).applyRtcRoomPendingCallTimedOut.call(fakeMeetingRoom, {
      callId: "call-1",
      callerId: "caller-1",
      calleeId: "callee-1",
      channelId: "dm-1",
      voiceRoomId: "voice-1",
      expiresAt: 1_000,
      callerName: "Alice",
    });

    expect(result).toBe(true);
    expect(fakeMeetingRoom.broadcastToUser).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to local shared resumable mirrors when RTC_ROOM expiry arrives without a stored session", () => {
    const localSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      resumableSessions: new Map([["participant-1", localSession]]),
      resumableSessionExpiry: new Map([["participant-1", 1_000]]),
      broadcast: vi.fn(),
      expireRtcRoomResumableControlSession: (MeetingRoom.prototype as any).expireRtcRoomResumableControlSession,
    };

    const expired = (MeetingRoom.prototype as any).expireRtcRoomResumableControlSession.call(
      fakeMeetingRoom,
      "participant-1",
      null,
    );

    expect(expired).toBe(false);
    expect(fakeMeetingRoom.broadcast).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.resumableSessions.has("participant-1")).toBe(false);
    expect(fakeMeetingRoom.resumableSessionExpiry.has("participant-1")).toBe(false);
  });

  it("still falls back to local resumable mirrors when split-mode control expiry runs locally", () => {
    const localSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      suppress: false,
      tracks: [],
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      resumableSessions: new Map([["participant-1", localSession]]),
      resumableSessionExpiry: new Map([["participant-1", 1_000]]),
      broadcast: vi.fn(),
      expireRtcRoomResumableControlSession: (MeetingRoom.prototype as any).expireRtcRoomResumableControlSession,
    };

    const expired = (MeetingRoom.prototype as any).expireRtcRoomResumableControlSession.call(
      fakeMeetingRoom,
      "participant-1",
      null,
    );

    expect(expired).toBe(true);
    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledWith({
      op: 15,
      d: {
        participant: expect.objectContaining({
          id: "participant-1",
          clerk_user_id: "user-1",
          name: "Alice",
        }),
        action: "leave",
      },
    });
    expect(fakeMeetingRoom.resumableSessions.has("participant-1")).toBe(false);
    expect(fakeMeetingRoom.resumableSessionExpiry.has("participant-1")).toBe(false);
  });

  it("leaves local resumable expiry pruning to RtcRoom during shared RTC control alarm maintenance", async () => {
    const ws = {} as WebSocket;
    const expiredSession = {
      id: "participant-expired",
      name: "Expired Alice",
    };
    const liveSession = {
      id: "participant-live",
      name: "Live Bob",
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map([
        [
          ws,
          {
            id: "participant-1",
            name: "Alice",
            last_heartbeat: 1_000,
          },
        ],
      ]),
      resumableSessions: new Map<string, typeof expiredSession>([
        [expiredSession.id, expiredSession],
        [liveSession.id, liveSession],
      ]),
      resumableSessionExpiry: new Map<string, number>([
        [expiredSession.id, 1_000],
        [liveSession.id, 1_001],
      ]),
      pendingCalls: new Map<string, unknown>(),
      acceptedCalls: new Map<string, number>(),
      presenceD1Pending: new Map<string, unknown>(),
      handleLeave: vi.fn(async () => undefined),
      expirePendingCalls: vi.fn(() => []),
      pruneExpiredAcceptedCalls: vi.fn(() => false),
      deleteResumableSession: vi.fn((id: string) => {
        fakeMeetingRoom.resumableSessions.delete(id);
      }),
      deleteResumableSessionExpiry: vi.fn((id: string) => {
        fakeMeetingRoom.resumableSessionExpiry.delete(id);
      }),
      flushDuePresenceWrites: vi.fn(async () => undefined),
      reconcileVoiceMembers: vi.fn(),
      flushDirtyStorage: vi.fn(),
      buildVoiceState: vi.fn((session: typeof expiredSession) => ({ id: session.id })),
      broadcast: vi.fn(),
      runPendingCallAlarmMaintenance: vi.fn(),
      scheduleAlarm: vi.fn(),
      hasMeetingRoomAlarmWork: (MeetingRoom.prototype as any).hasMeetingRoomAlarmWork,
      runAlarmMaintenance: (MeetingRoom.prototype as any).runAlarmMaintenance,
    };
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000 + RTC_RECONNECT_GRACE_MS);

    try {
      await (MeetingRoom.prototype as any).runRtcRoomControlAlarm.call(fakeMeetingRoom);
    } finally {
      nowSpy.mockRestore();
    }

    expect(fakeMeetingRoom.handleLeave).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.deleteResumableSession).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.deleteResumableSessionExpiry).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.expirePendingCalls).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.pruneExpiredAcceptedCalls).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.resumableSessions.get("participant-expired")).toBe(expiredSession);
    expect(fakeMeetingRoom.resumableSessions.get("participant-live")).toBe(liveSession);
    expect(fakeMeetingRoom.resumableSessionExpiry.get("participant-expired")).toBe(1_000);
    expect(fakeMeetingRoom.resumableSessionExpiry.get("participant-live")).toBe(1_001);
    expect(fakeMeetingRoom.buildVoiceState).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.broadcast).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.flushDuePresenceWrites).toHaveBeenCalledWith(1_000 + RTC_RECONNECT_GRACE_MS);
    expect(fakeMeetingRoom.reconcileVoiceMembers).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.scheduleAlarm).not.toHaveBeenCalled();
  });

  it("ignores local resumable control deadlines when choosing the next shared RTC alarm", () => {
    const now = 10_000;
    const disconnectedAt = 1_000;
    const ws = {} as WebSocket;
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map<WebSocket, { last_heartbeat?: number }>([
        [ws, { last_heartbeat: 100 }],
      ]),
      resumableSessionExpiry: new Map<string, number>([["participant-1", disconnectedAt]]),
      pendingCalls: new Map<string, { expiresAt: number }>([
        ["callee-1", { expiresAt: disconnectedAt + RTC_RECONNECT_GRACE_MS + 500 }],
      ]),
      acceptedCalls: new Map<string, number>([["accepted-1", disconnectedAt + RTC_RECONNECT_GRACE_MS + 1_000]]),
      presenceD1Pending: new Map<string, { dueAt: number }>([["presence-1", disconnectedAt + RTC_RECONNECT_GRACE_MS + 750]]),
      getNextAlarmTime: (MeetingRoom.prototype as any).getNextAlarmTime,
    };

    const nextAlarm = (MeetingRoom.prototype as any).getNextAlarmTime.call(fakeMeetingRoom, now);

    expect(nextAlarm).toBe(disconnectedAt + RTC_RECONNECT_GRACE_MS + 500);
  });

  it("still uses local resumable control deadlines when choosing the next split-mode alarm", () => {
    const now = 10_000;
    const disconnectedAt = 1_000;
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      sessions: new Map<WebSocket, { last_heartbeat?: number }>(),
      resumableSessionExpiry: new Map<string, number>([["participant-1", disconnectedAt]]),
      pendingCalls: new Map<string, { expiresAt: number }>([
        ["callee-1", { expiresAt: disconnectedAt + RTC_RECONNECT_GRACE_MS + 500 }],
      ]),
      acceptedCalls: new Map<string, number>([["accepted-1", disconnectedAt + RTC_RECONNECT_GRACE_MS + 1_000]]),
      presenceD1Pending: new Map<string, { dueAt: number }>([["presence-1", disconnectedAt + RTC_RECONNECT_GRACE_MS + 750]]),
      getNextAlarmTime: (MeetingRoom.prototype as any).getNextAlarmTime,
    };

    const nextAlarm = (MeetingRoom.prototype as any).getNextAlarmTime.call(fakeMeetingRoom, now);

    expect(nextAlarm).toBe(disconnectedAt + RTC_RECONNECT_GRACE_MS);
  });

  it("still prunes local zombie sessions and resumable expiries in split-mode control alarm maintenance", async () => {
    const ws = {} as WebSocket;
    const expiredSession = {
      id: "participant-expired",
      name: "Expired Alice",
    };
    const liveSession = {
      id: "participant-live",
      name: "Live Bob",
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      sessions: new Map([
        [
          ws,
          {
            id: "participant-1",
            name: "Alice",
            last_heartbeat: 1_000,
          },
        ],
      ]),
      resumableSessions: new Map<string, typeof expiredSession>([
        [expiredSession.id, expiredSession],
        [liveSession.id, liveSession],
      ]),
      resumableSessionExpiry: new Map<string, number>([
        [expiredSession.id, 1_000],
        [liveSession.id, 1_001],
      ]),
      pendingCalls: new Map<string, unknown>(),
      acceptedCalls: new Map<string, number>(),
      presenceD1Pending: new Map<string, unknown>(),
      handleLeave: vi.fn(async () => undefined),
      expirePendingCalls: vi.fn(() => []),
      pruneExpiredAcceptedCalls: vi.fn(() => false),
      deleteResumableSession: vi.fn((id: string) => {
        fakeMeetingRoom.resumableSessions.delete(id);
      }),
      deleteResumableSessionExpiry: vi.fn((id: string) => {
        fakeMeetingRoom.resumableSessionExpiry.delete(id);
      }),
      flushDuePresenceWrites: vi.fn(async () => undefined),
      reconcileVoiceMembers: vi.fn(),
      flushDirtyStorage: vi.fn(),
      buildVoiceState: vi.fn((session: typeof expiredSession) => ({ id: session.id })),
      broadcast: vi.fn(),
      runPendingCallAlarmMaintenance: (MeetingRoom.prototype as any).runPendingCallAlarmMaintenance,
      scheduleAlarm: vi.fn(),
      hasMeetingRoomAlarmWork: (MeetingRoom.prototype as any).hasMeetingRoomAlarmWork,
      runAlarmMaintenance: (MeetingRoom.prototype as any).runAlarmMaintenance,
    };
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000 + RTC_RECONNECT_GRACE_MS);

    try {
      await (MeetingRoom.prototype as any).runRtcRoomControlAlarm.call(fakeMeetingRoom);
    } finally {
      nowSpy.mockRestore();
    }

    expect(fakeMeetingRoom.handleLeave).toHaveBeenCalledWith(ws, false, true);
    expect(fakeMeetingRoom.deleteResumableSession).toHaveBeenCalledWith("participant-expired");
    expect(fakeMeetingRoom.deleteResumableSessionExpiry).toHaveBeenCalledWith("participant-expired");
    expect(fakeMeetingRoom.resumableSessions.has("participant-expired")).toBe(false);
    expect(fakeMeetingRoom.resumableSessionExpiry.has("participant-expired")).toBe(false);
    expect(fakeMeetingRoom.resumableSessions.get("participant-live")).toBe(liveSession);
    expect(fakeMeetingRoom.resumableSessionExpiry.get("participant-live")).toBe(1_001);
    expect(fakeMeetingRoom.buildVoiceState).toHaveBeenCalledWith(expiredSession);
    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledWith({
      op: 15,
      d: {
        participant: { id: "participant-expired" },
        action: "leave",
      },
    });
    expect(fakeMeetingRoom.scheduleAlarm).toHaveBeenCalledTimes(1);
  });
});
