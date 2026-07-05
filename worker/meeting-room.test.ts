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
import { ACCEPTED_CALL_TTL_MS, MeetingRoom } from "./meeting-room";
import { applyRtcRoomControlDisconnectEffects } from "./rtc-room-control-disconnect-effects";
import {
  applyRtcRoomControlResumeEffects,
  applyRtcRoomProfileRefreshEffects,
} from "./rtc-room-control-session-effects";
import {
  buildSharedRtcVoiceChannelStateUpdateMessage,
  buildSharedRtcVoiceChannelStatesPayload,
  planRtcRoomSharedVoiceTransition,
} from "./rtc-room-voice-projection";

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

  it("skips shared RTC voice projection hydration and leaves live sessions on attachment truth", async () => {
    const projectedMember = {
      clerk_user_id: "user-1",
      name: "Alice",
      connected: true,
      connection_state: "connected",
      disconnected_at: null,
      reconnect_expires_at: null,
      joined_at: 123_000,
      self_mute: false,
      self_deaf: false,
      self_video: false,
      self_stream: false,
    };
    const ws = {
      deserializeAttachment: vi.fn(() => ({
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
      })),
    } as unknown as WebSocket;
    let blockPromise: Promise<void> | undefined;
    const deleteStorage = vi.fn(async () => undefined);
    const ctx = {
      getWebSockets: () => [ws],
      blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => {
        blockPromise = callback();
      }),
      storage: {
        get: vi.fn(async (key: string) => {
          if (key === "roomSlug") return undefined;
          if (key === "voiceChannelMembers") {
            return { "legacy-vc": [projectedMember] };
          }
          if (key === "voiceChannelStartedAt") {
            return { "vc-1": 123_000 };
          }
          return undefined;
        }),
        list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => {
          if (prefix === "vc:members:") {
            return new Map([["vc:members:vc-1", [projectedMember]]]);
          }
          return new Map();
        }),
        put: vi.fn(async () => undefined),
        delete: deleteStorage,
      },
    };

    const room = new MeetingRoom(ctx as any, {} as any, { sharedRtcAuthority: true }) as unknown as {
      sessions: Map<WebSocket, { voice_channel_id?: string; voice_joined_at?: number }>;
      voiceChannelMembers: Map<string, Map<string, unknown>>;
      voiceChannelStartedAt: Map<string, number>;
    };
    await blockPromise;

    expect(room.sessions.get(ws)?.voice_channel_id).toBeUndefined();
    expect(room.sessions.get(ws)?.voice_joined_at).toBeUndefined();
    expect(room.voiceChannelMembers.size).toBe(0);
    expect(room.voiceChannelStartedAt.size).toBe(0);
    expect(deleteStorage).toHaveBeenCalledWith(["vc:members:vc-1"]);
    expect(deleteStorage).toHaveBeenCalledWith("voiceChannelMembers");
    expect(deleteStorage).toHaveBeenCalledWith("voiceChannelStartedAt");
  });

  it("does not stage shared RTC projected voice caches for durable writes", () => {
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
              },
            ],
          ]),
        ],
      ]),
      voiceChannelStartedAt: new Map([["vc-1", 123_000]]),
      dirtyStorage: new Map<string, unknown>(),
      markDirty: (MeetingRoom.prototype as any).markDirty,
    };

    (MeetingRoom.prototype as any).persistVoiceChannelMembers.call(fakeMeetingRoom);
    (MeetingRoom.prototype as any).persistVoiceChannelStartedAt.call(fakeMeetingRoom);

    expect(fakeMeetingRoom.dirtyStorage.size).toBe(0);
  });

  it("skips shared RTC call-state hydration while leaving authoritative storage untouched", async () => {
    let blockPromise: Promise<void> | undefined;
    const deleteStorage = vi.fn(async () => undefined);
    const put = vi.fn(async () => undefined);
    const ctx = {
      getWebSockets: () => [],
      blockConcurrencyWhile: vi.fn((callback: () => Promise<void>) => {
        blockPromise = callback();
      }),
      storage: {
        get: vi.fn(async (key: string) => {
          if (key === "roomSlug") return undefined;
          if (key === "pendingCalls") {
            return {
              "callee-1": {
                callId: "call-1",
                callerId: "caller-1",
                calleeId: "callee-1",
                channelId: "dm-1",
                voiceRoomId: "voice-1",
                expiresAt: 1_000,
                callerName: "Alice",
              },
            };
          }
          if (key === "acceptedCallExpiry") {
            return { "call-1": 2_000 };
          }
          return undefined;
        }),
        list: vi.fn(async () => new Map()),
        put,
        delete: deleteStorage,
      },
    };

    const room = new MeetingRoom(ctx as any, {} as any, { sharedRtcAuthority: true }) as unknown as {
      pendingCalls: Map<string, unknown>;
      acceptedCalls: Map<string, number>;
    };
    await blockPromise;

    expect(room.pendingCalls.size).toBe(0);
    expect(room.acceptedCalls.size).toBe(0);
    expect(put).not.toHaveBeenCalled();
    expect(deleteStorage).not.toHaveBeenCalledWith("pendingCalls");
    expect(deleteStorage).not.toHaveBeenCalledWith("acceptedCallExpiry");
  });

  it("does not stage shared RTC call-state mirrors for durable writes", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
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
      ]),
      acceptedCalls: new Map([["call-1", 2_000]]),
      dirtyStorage: new Map<string, unknown>(),
      markDirty: (MeetingRoom.prototype as any).markDirty,
    };

    (MeetingRoom.prototype as any).persistPendingCalls.call(fakeMeetingRoom);
    (MeetingRoom.prototype as any).persistAcceptedCalls.call(fakeMeetingRoom);

    expect(fakeMeetingRoom.dirtyStorage.size).toBe(0);
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

  it("does not fall back to raw media reads in shared mode when no RTC_ROOM media snapshot is injected", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sharedRtcMediaAuthoritySnapshot: null,
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

    expect([...liveIds]).toEqual([]);
    expect([...activeIds]).toEqual([]);
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
    sharedRtcSpatialAudioSnapshot: null,
    collectActiveMediaClerkIds: () => new Set<string>(),
    collectLiveMediaClerkIds: () => new Set<string>(),
    collectSharedRtcVoiceStateChannelIds: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateChannelIds,
    collectSharedRtcVoiceStateSessions: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateSessions,
    buildSharedRtcVoiceChannelMembers: (MeetingRoom.prototype as any).buildSharedRtcVoiceChannelMembers,
    buildVoiceChannelStateSnapshot: (MeetingRoom.prototype as any).buildVoiceChannelStateSnapshot,
    buildVoiceChannelStatesPayload: (MeetingRoom.prototype as any).buildVoiceChannelStatesPayload,
    resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
    resolveVoiceJoinedAt: (MeetingRoom.prototype as any).resolveVoiceJoinedAt,
    ...overrides,
  });

  const buildSharedRtcPayload = (room: Record<string, any>) =>
    buildSharedRtcVoiceChannelStatesPayload(
      room.sharedRtcVoiceAuthoritySnapshot,
      room.sharedRtcSpatialAudioSnapshot ?? null,
    );

  const buildSharedRtcMessage = (room: Record<string, any>, channelId: string) =>
    buildSharedRtcVoiceChannelStateUpdateMessage(channelId, {
      voiceSnapshot: room.sharedRtcVoiceAuthoritySnapshot,
      spatialAudioSnapshot: room.sharedRtcSpatialAudioSnapshot ?? null,
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

  it("keeps shared MeetingRoom local voice transitions inert", () => {
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
      acceptedCalls: new Map<string, number>(),
      collectLiveMediaClerkIds: () => new Set<string>(),
      normalizeVoiceChannelStartedAt: (MeetingRoom.prototype as any).normalizeVoiceChannelStartedAt,
      resolveVoiceJoinedAt: vi.fn(() => 123_456),
      maintainVoiceChannelStartedAt: vi.fn(() => 123_456),
      applyVoiceChannelArrivalEffects: vi.fn(() => true),
      applyVoiceChannelDepartureEffects: vi.fn(),
      handleImplicitVoiceChannelJoinCallAccept:
        (MeetingRoom.prototype as any).handleImplicitVoiceChannelJoinCallAccept,
      persistPendingCalls: vi.fn(),
      persistAcceptedCalls: vi.fn(),
      scheduleAlarm: vi.fn(),
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

    expect(changed).toBe(false);
    expect(fakeMeetingRoom.pendingCalls.has("user-1")).toBe(true);
    expect(fakeMeetingRoom.acceptedCalls.size).toBe(0);
    expect(fakeMeetingRoom.persistPendingCalls).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.persistAcceptedCalls).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.broadcastToUser).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.broadcastVoiceChannelState).not.toHaveBeenCalled();
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

  it("plans shared RTC pending-call acceptance from authoritative voice transition snapshots", () => {
    const pendingCall = {
      callId: "call-1",
      callerId: "caller-1",
      calleeId: "user-1",
      channelId: "dm-1",
      voiceRoomId: "voice-1",
      expiresAt: 123_000,
      callerName: "Alice",
    };
    const joinedSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      username: "alice",
      display_name: "Alice",
      avatar_url: null,
      avatar_display: null,
      stream_preview_url: null,
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      spatial_audio_enabled: false,
      spatial_audio_high_fidelity: false,
      suppress: false,
      tracks: [],
      voice_channel_id: "dm-1",
      voice_joined_at: 123_456,
    };
    const result = planRtcRoomSharedVoiceTransition({
      clerkUserId: "user-1",
      beforeVoiceSnapshot: {
        capturedAt: 100,
        channels: new Map(),
        channelIdByClerkUserId: new Map(),
      },
      afterControlSnapshot: {
        capturedAt: 200,
        sessionsByClerkUserId: new Map([["user-1", joinedSession]]),
        sessionsByParticipantId: new Map([["participant-1", joinedSession]]),
      },
      mediaAuthoritySnapshot: {
        capturedAt: 200,
        activeClerkUserIds: new Set(["user-1"]),
        presenceByClerkUserId: new Map([[
          "user-1",
          {
            connected: true,
            connection_state: "connected",
            disconnected_at: null,
            reconnect_expires_at: null,
          },
        ]]),
      },
      allowImplicitCallAccept: true,
      pendingCalls: new Map([["user-1", pendingCall]]),
      acceptedCalls: new Map(),
      acceptedCallTtlMs: ACCEPTED_CALL_TTL_MS,
    });

    expect(result.acceptedPending).toBe(pendingCall);
    expect(result.abandonedPending).toBeNull();
    expect(result.nextPendingCalls?.size).toBe(0);
    expect(result.nextAcceptedCalls?.has("call-1")).toBe(true);
    expect(result.changedChannelIds).toEqual(new Set(["dm-1"]));
  });

  it("plans shared RTC pending-call abandonment from authoritative voice transition snapshots", () => {
    const pendingCall = {
      callId: "call-1",
      callerId: "caller-1",
      calleeId: "callee-1",
      channelId: "dm-1",
      voiceRoomId: "voice-1",
      expiresAt: 123_000,
      callerName: "Alice",
    };
    const leftSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      username: "alice",
      display_name: "Alice",
      avatar_url: null,
      avatar_display: null,
      stream_preview_url: null,
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      spatial_audio_enabled: false,
      spatial_audio_high_fidelity: false,
      suppress: false,
      tracks: [],
      voice_channel_id: undefined,
      voice_joined_at: undefined,
    };
    const result = planRtcRoomSharedVoiceTransition({
      clerkUserId: "user-1",
      beforeVoiceSnapshot: {
        capturedAt: 100,
        channels: new Map([["dm-1", { members: [], startedAt: 123_000 }]]),
        channelIdByClerkUserId: new Map([["user-1", "dm-1"]]),
      },
      afterControlSnapshot: {
        capturedAt: 200,
        sessionsByClerkUserId: new Map([["user-1", leftSession]]),
        sessionsByParticipantId: new Map([["participant-1", leftSession]]),
      },
      mediaAuthoritySnapshot: {
        capturedAt: 200,
        activeClerkUserIds: new Set(["user-1"]),
        presenceByClerkUserId: new Map([[
          "user-1",
          {
            connected: true,
            connection_state: "connected",
            disconnected_at: null,
            reconnect_expires_at: null,
          },
        ]]),
      },
      pendingCalls: new Map([["callee-1", pendingCall]]),
      acceptedCalls: new Map(),
      acceptedCallTtlMs: ACCEPTED_CALL_TTL_MS,
    });

    expect(result.abandonedPending).toBe(pendingCall);
    expect(result.acceptedPending).toBeNull();
    expect(result.nextPendingCalls?.size).toBe(0);
    expect(result.changedChannelIds).toEqual(new Set(["dm-1"]));
  });

  it("does not recover a shared RTC control session implicitly for voice transitions", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      collectLiveMediaClerkIds: () => new Set<string>(),
      normalizeVoiceChannelStartedAt: (MeetingRoom.prototype as any).normalizeVoiceChannelStartedAt,
      resolveVoiceJoinedAt: vi.fn(() => 123_456),
      maintainVoiceChannelStartedAt: vi.fn(() => 123_456),
      applyVoiceChannelArrivalEffects: vi.fn((_channelId, _clerkUserId, _joinedAt, session) => {
        expect(session).toBeUndefined();
        return false;
      }),
      applyVoiceChannelDepartureEffects: vi.fn(),
      handleImplicitVoiceChannelJoinCallAccept: vi.fn(),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const changed = (MeetingRoom.prototype as any).applyVoiceChannelTransitionEffects.call(
      fakeMeetingRoom,
      {
        clerk_user_id: "user-1",
        to_channel_id: "room-1",
      },
    );

    expect(changed).toBe(false);
    expect(fakeMeetingRoom.resolveVoiceJoinedAt).toHaveBeenCalledWith(
      "room-1",
      undefined,
      undefined,
    );
    expect(fakeMeetingRoom.applyVoiceChannelArrivalEffects).toHaveBeenCalledWith(
      "room-1",
      "user-1",
      123_456,
      undefined,
      expect.any(Set),
    );
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("does not persist shared RTC channel-start cache during local transition effects", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      voiceChannelStartedAt: new Map<string, number>(),
      normalizeVoiceChannelStartedAt: (MeetingRoom.prototype as any).normalizeVoiceChannelStartedAt,
      maintainVoiceChannelStartedAt: (MeetingRoom.prototype as any).maintainVoiceChannelStartedAt,
      persistVoiceChannelStartedAt: vi.fn(),
    };

    const startedAt = (MeetingRoom.prototype as any).maintainVoiceChannelStartedAt.call(
      fakeMeetingRoom,
      "vc-1",
      Date.now(),
    );

    expect(typeof startedAt).toBe("number");
    expect(fakeMeetingRoom.voiceChannelStartedAt.size).toBe(0);
    expect(fakeMeetingRoom.persistVoiceChannelStartedAt).not.toHaveBeenCalled();
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
      sharedRtcSpatialAudioSnapshot: null,
      voiceChannelMembers: new Map<string, Map<string, unknown>>(),
      requireSession: () => session,
      getSession: () => session,
      persist: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: session.id })),
      broadcast: vi.fn(),
      collectActiveMediaClerkIds: () => new Set<string>(),
      collectLiveMediaClerkIds: () => new Set<string>(),
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      createRtcRoomControlSessionEffectsAdapter: (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter,
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
    expect(fakeMeetingRoom.sharedRtcSpatialAudioSnapshot).toBeNull();
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
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      createRtcRoomControlSessionEffectsAdapter: (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter,
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      markVoiceMemberConnected: vi.fn(),
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    applyRtcRoomProfileRefreshEffects(
      (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter.call(fakeMeetingRoom),
      ws,
      session,
      {
      name: "Alice Updated",
      username: "alice",
      displayName: "Alice Updated",
      avatarUrl: "/avatar.png",
      avatarDisplay: "avatar",
      },
    );

    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.markVoiceMemberConnected).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("keeps the base MeetingRoom RTC adapters from performing shared-mode voice and spatial side effects", () => {
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
      spatialAudioStates: new Map(),
      voiceChannelMembers: new Map([
        [
          "vc-1",
          new Map([
            [
              "user-1",
              {
                clerk_user_id: "user-1",
                name: "Alice",
                joined_at: 123_000,
              },
            ],
          ]),
        ],
      ]),
      sendVoiceChannelStatesForClerkUserId: vi.fn(async () => undefined),
      broadcastVoiceChannelState: vi.fn(() => Promise.resolve()),
      collectLiveMediaClerkIds: () => new Set(["user-1"]),
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
      markVoiceMemberConnected: vi.fn(),
      persistVoiceChannelMembers: vi.fn(),
      createRtcRoomControlPostWriteEffectsAdapter:
        (MeetingRoom.prototype as any).createRtcRoomControlPostWriteEffectsAdapter,
      createRtcRoomControlSessionEffectsAdapter:
        (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter,
      ctx: {
        waitUntil: vi.fn(),
      },
    };

    const postWriteEffects = (MeetingRoom.prototype as any).createRtcRoomControlPostWriteEffectsAdapter.call(
      fakeMeetingRoom,
    );
    const sessionEffects = (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter.call(
      fakeMeetingRoom,
    );

    postWriteEffects.queueVoiceChannelStates(ws, "user-1");

    expect(sessionEffects.getSpatialAudioState("vc-1")).toBeUndefined();
    expect(
      sessionEffects.updateSpatialAudioState("vc-1", { enabled: false }, session),
    ).toBeUndefined();

    sessionEffects.syncVoiceStateProjection(session);
    sessionEffects.refreshVoiceProjectionIdentity(session, ws);
    sessionEffects.applyProfileVoiceProjectionUpdate(session, {
      name: "Alice Updated",
      username: "alice",
      displayName: "Alice Updated",
      avatarUrl: "/avatar.png",
      avatarDisplay: "avatar",
    });

    expect(fakeMeetingRoom.sendVoiceChannelStatesForClerkUserId).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.markVoiceMemberConnected).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.broadcastVoiceChannelState).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.persistVoiceChannelMembers).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("broadcasts shared RTC voice updates from authoritative control attachments even when the local session mirror is cold", async () => {
    const sent: Array<{ op: number; d: unknown }> = [];
    const ws = {
      deserializeAttachment: () => ({
        id: "participant-1",
        socket_role: "control",
        clerk_user_id: "user-1",
      }),
      send: vi.fn((payload: string) => {
        sent.push(JSON.parse(payload));
      }),
    } as unknown as WebSocket;
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map(),
      ctx: {
        getWebSockets: () => [ws],
      },
      canUserAccessVoiceChannel: vi.fn(async () => true),
      sendTo: (MeetingRoom.prototype as any).sendTo,
      broadcastVoiceChannelStateMessage: (MeetingRoom.prototype as any).broadcastVoiceChannelStateMessage,
    };

    await (MeetingRoom.prototype as any).broadcastVoiceChannelStateMessage.call(
      fakeMeetingRoom,
      "vc-1",
      {
        op: 19,
        d: {
          event: "VOICE_CHANNEL_STATE_UPDATE",
          data: {
            channel_id: "vc-1",
            members: [],
            started_at: null,
          },
        },
      },
    );

    expect(fakeMeetingRoom.canUserAccessVoiceChannel).toHaveBeenCalledWith("vc-1", "user-1");
    expect(sent).toEqual([
      {
        op: 19,
        d: {
          event: "VOICE_CHANNEL_STATE_UPDATE",
          data: {
            channel_id: "vc-1",
            members: [],
            started_at: null,
          },
        },
      },
    ]);
  });

  it("keeps shared MeetingRoom disconnect lifecycle from rehydrating control sessions out of socket attachments", () => {
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
      getSession: (MeetingRoom.prototype as any).getSession,
      applyControlDisconnectLifecycle: (MeetingRoom.prototype as any).applyControlDisconnectLifecycle,
    };

    const result =
      (MeetingRoom.prototype as any).applyControlDisconnectLifecycle.call(
        fakeMeetingRoom,
        ws,
        {
          intentional: false,
          closeSocket: false,
          persistControlStorage: false,
        },
      );

    expect(result).toBeNull();
    expect(fakeMeetingRoom.sessions.size).toBe(0);
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
      mirrorRtcRoomControlSession: (MeetingRoom.prototype as any).mirrorRtcRoomControlSession,
      materializeRtcRoomControlSessionFromSocketAttachment:
        (MeetingRoom.prototype as any).materializeRtcRoomControlSessionFromSocketAttachment,
      toSharedRtcControlSessionSnapshot: (MeetingRoom.prototype as any).toSharedRtcControlSessionSnapshot,
    };

    const snapshot =
      (MeetingRoom.prototype as any).materializeRtcRoomControlSessionFromSocketAttachment.call(
        fakeMeetingRoom,
        ws,
      );

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

  it("does not arm a local control alarm, keep a shared local resumable mirror, or duplicate durable control writes when shared RTC persists a session", () => {
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
    expect(fakeMeetingRoom.persistResumableSession).not.toHaveBeenCalled();
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

  it("still persists split-mode heartbeat state through MeetingRoom local control storage", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123_456);
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
      seq: 4,
      last_heartbeat: 100,
    };
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      sessions: new Map([[ws, session]]),
      resumableSessions: new Map<string, typeof session>(),
      sendTo: vi.fn(),
      scheduleAlarm: vi.fn(),
      persistResumableSession: vi.fn(),
      getSession: (MeetingRoom.prototype as any).getSession,
      persist: (MeetingRoom.prototype as any).persist,
      handleHeartbeat: (MeetingRoom.prototype as any).handleHeartbeat,
    };

    try {
      (MeetingRoom.prototype as any).handleHeartbeat.call(fakeMeetingRoom, ws, { seq_ack: 4 });
    } finally {
      nowSpy.mockRestore();
    }

    expect(session.last_heartbeat).toBe(123_456);
    expect(session.seq).toBe(5);
    expect(fakeMeetingRoom.persistResumableSession).toHaveBeenCalledWith(
      "participant-1",
      expect.objectContaining({
        id: "participant-1",
        seq: 5,
        last_heartbeat: 123_456,
        socket_role: "control",
      }),
    );
    expect(fakeMeetingRoom.sendTo).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        op: 6,
        d: { seq: 5 },
      }),
    );
  });

  it("applies intentional shared RTC control disconnect adapter effects without keeping resumable state", () => {
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
      createRtcRoomControlDisconnectEffectsAdapter:
        (MeetingRoom.prototype as any).createRtcRoomControlDisconnectEffectsAdapter,
      cleanupChannelSubscriptions: vi.fn(),
      cleanupServerSubscriptions: vi.fn(),
      broadcast: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: session.id })),
    };

    applyRtcRoomControlDisconnectEffects(
      (MeetingRoom.prototype as any).createRtcRoomControlDisconnectEffectsAdapter.call(fakeMeetingRoom),
      ws,
      session,
      {
        intentional: true,
        closeSocket: true,
        closeCode: 1000,
        closeReason: "Left room",
      },
    );

    expect(fakeMeetingRoom.cleanupChannelSubscriptions).toHaveBeenCalledWith(ws);
    expect(fakeMeetingRoom.cleanupServerSubscriptions).toHaveBeenCalledWith(ws);
    expect(fakeMeetingRoom.sessions.has(ws)).toBe(false);
    expect(fakeMeetingRoom.resumableSessions.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.resumableSessionExpiry.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.profileRefreshCooldowns.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledTimes(2);
    expect((ws as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledWith(1000, "Left room");
  });

  it("applies abrupt shared RTC control disconnect adapter effects without reviving local expiry alarms", () => {
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
      createRtcRoomControlDisconnectEffectsAdapter:
        (MeetingRoom.prototype as any).createRtcRoomControlDisconnectEffectsAdapter,
      cleanupChannelSubscriptions: vi.fn(),
      cleanupServerSubscriptions: vi.fn(),
      broadcast: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: session.id })),
    };

    applyRtcRoomControlDisconnectEffects(
      (MeetingRoom.prototype as any).createRtcRoomControlDisconnectEffectsAdapter.call(fakeMeetingRoom),
      ws,
      session,
      {
        intentional: false,
        closeSocket: false,
      },
    );

    expect(fakeMeetingRoom.sessions.has(ws)).toBe(false);
    expect(fakeMeetingRoom.resumableSessions.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.resumableSessionExpiry.has(session.id)).toBe(false);
    expect(fakeMeetingRoom.broadcast).toHaveBeenCalledTimes(1);
    expect((ws as { close: ReturnType<typeof vi.fn> }).close).not.toHaveBeenCalled();
  });

  it("does not fan out offline presence for shared RTC disconnect adapter effects while another clerk session remains", () => {
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
      createRtcRoomControlDisconnectEffectsAdapter:
        (MeetingRoom.prototype as any).createRtcRoomControlDisconnectEffectsAdapter,
      cleanupChannelSubscriptions: vi.fn(),
      cleanupServerSubscriptions: vi.fn(),
      broadcast: vi.fn(),
      buildVoiceState: vi.fn(() => ({ id: session.id })),
    };

    applyRtcRoomControlDisconnectEffects(
      (MeetingRoom.prototype as any).createRtcRoomControlDisconnectEffectsAdapter.call(fakeMeetingRoom),
      ws,
      session,
      {
        intentional: false,
        closeSocket: false,
      },
    );

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

  it("does not build shared RTC voice-state payloads through the legacy helper when RTC_ROOM owns that path", async () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      buildVoiceChannelStatesPayload: vi.fn(() => ({
        voice_states: {
          "vc-1": [
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
        voice_started_at: { "vc-1": 123_000 },
        spatial_audio_states: {},
      })),
      sendTo: vi.fn(),
      sendVoiceChannelStatesPayloadForClerkUserId:
        (MeetingRoom.prototype as any).sendVoiceChannelStatesPayloadForClerkUserId,
      sendVoiceChannelStatesForClerkUserId:
        (MeetingRoom.prototype as any).sendVoiceChannelStatesForClerkUserId,
    };

    await (MeetingRoom.prototype as any).sendVoiceChannelStatesForClerkUserId.call(
      fakeMeetingRoom,
      {} as WebSocket,
      "user-1",
    );

    expect(fakeMeetingRoom.buildVoiceChannelStatesPayload).not.toHaveBeenCalled();
    expect(fakeMeetingRoom.sendTo).not.toHaveBeenCalled();
  });

  it("sends an empty VOICE_CHANNEL_STATES payload so reconnects clear stale gateway voice state", async () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: false,
      canUserAccessVoiceChannel: vi.fn(async () => false),
      sendTo: vi.fn(),
    };

    await (MeetingRoom.prototype as any).sendVoiceChannelStatesPayloadForClerkUserId.call(
      fakeMeetingRoom,
      {} as WebSocket,
      "user-1",
      {
        voice_states: {},
        voice_started_at: {},
        spatial_audio_states: {},
      },
    );

    expect(fakeMeetingRoom.sendTo).toHaveBeenCalledWith(
      {} as WebSocket,
      {
        op: 19,
        d: {
          event: "VOICE_CHANNEL_STATES",
          data: {
            voice_states: {},
            voice_started_at: {},
            spatial_audio_states: {},
          },
        },
      },
    );
  });

  it("requires live media truth before shared rebroadcast helpers consider a member materialized", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      collectActiveMediaClerkIds: () => new Set<string>(),
      collectLiveMediaClerkIds: () => new Set<string>(),
      shouldMaterializeVoiceMember: (MeetingRoom.prototype as any).shouldMaterializeVoiceMember,
    };

    const shouldBroadcast = (MeetingRoom.prototype as any).shouldMaterializeVoiceMember.call(
      fakeMeetingRoom,
      "vc-1",
      "user-1",
      new Set<string>(),
    );

    expect(shouldBroadcast).toBe(false);
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

  it("clears stale shared RTC cached voice channels after control truth is cleared", () => {
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
      clearRtcRoomSharedProjectionChannels: (MeetingRoom.prototype as any).clearRtcRoomSharedProjectionChannels,
      deleteVoiceChannelStorage: vi.fn(),
      persistVoiceChannelMembers: vi.fn(),
      persistVoiceChannelStartedAt: vi.fn(),
    };

    const pruned = (MeetingRoom.prototype as any).clearRtcRoomSharedProjectionChannels.call(
      fakeMeetingRoom,
      ["vc-1"],
    );

    expect(pruned).toBe(true);
    expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.voiceChannelStartedAt.has("vc-1")).toBe(false);
    expect(fakeMeetingRoom.deleteVoiceChannelStorage).toHaveBeenCalledWith("vc-1");
    expect(fakeMeetingRoom.persistVoiceChannelMembers).toHaveBeenCalledTimes(1);
    expect(fakeMeetingRoom.persistVoiceChannelStartedAt).toHaveBeenCalledTimes(1);
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

    const payload = buildSharedRtcPayload(fakeMeetingRoom);

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

    const payload = buildSharedRtcPayload(fakeMeetingRoom);

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

    const payload = buildSharedRtcPayload(fakeMeetingRoom);

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

    const payload = buildSharedRtcPayload(fakeMeetingRoom);

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

    const payload = buildSharedRtcPayload(fakeMeetingRoom);

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
      sharedRtcMediaAuthoritySnapshot: {
        capturedAt: 200_000,
        liveParticipantIds: new Set(["participant-1"]),
        liveClerkUserIds: new Set(["live-user"]),
        activeClerkUserIds: new Set(["live-user"]),
        presenceByClerkUserId: new Map([
          ["live-user", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
        ]),
        participantCount: 1,
        pendingReconnectCount: 0,
        demoChatMessageCount: 0,
      },
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

  it("scrubs stale control-backed projected member caches without mutating control intent when shared RTC authority turns on", () => {
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
      clearProjectedVoiceChannelMemberCache: (MeetingRoom.prototype as any).clearProjectedVoiceChannelMemberCache,
      resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
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

      const changed = (MeetingRoom.prototype as any).clearProjectedVoiceChannelMemberCache.call(fakeMeetingRoom);

      expect(changed).toBe(true);
      expect(fakeMeetingRoom.voiceChannelMembers.has("vc-1")).toBe(false);
      expect(fakeMeetingRoom.voiceChannelStartedAt.get("vc-1")).toBe(123_000);
      expect(fakeMeetingRoom.sessions.get(ws)?.voice_channel_id).toBe("vc-1");
      expect((fakeMeetingRoom.resumableSessions.get("participant-stale") as { voice_channel_id?: string }).voice_channel_id).toBe("vc-1");
      expect(fakeMeetingRoom.deleteVoiceChannelStorage).toHaveBeenCalledWith("vc-1");
      expect(fakeMeetingRoom.persist).not.toHaveBeenCalled();
      expect(fakeMeetingRoom.persistResumableSession).not.toHaveBeenCalled();

      const secondChanged = (MeetingRoom.prototype as any).clearProjectedVoiceChannelMemberCache.call(fakeMeetingRoom);

      expect(secondChanged).toBe(false);
      expect(fakeMeetingRoom.deleteVoiceChannelStorage).toHaveBeenCalledTimes(1);
      expect(fakeMeetingRoom.ctx.waitUntil).not.toHaveBeenCalled();
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
      sendVoiceChannelStatesForClerkUserId: vi.fn(async () => undefined),
      getSession: (MeetingRoom.prototype as any).getSession,
      buildRtcRoomControlParticipants: (MeetingRoom.prototype as any).buildRtcRoomControlParticipants,
      restoreRtcRoomSubscriptions: (MeetingRoom.prototype as any).restoreRtcRoomSubscriptions,
      restoreRtcRoomVoiceMembershipOnResume: (MeetingRoom.prototype as any).restoreRtcRoomVoiceMembershipOnResume,
      createRtcRoomControlSessionEffectsAdapter: (MeetingRoom.prototype as any).createRtcRoomControlSessionEffectsAdapter,
      fetchRtcRoomVoiceCredentials: vi.fn(async () => ({
        voiceToken: "voice-token",
        iceServers: [],
      })),
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
      buildSharedRtcVoiceChannelMembers: (MeetingRoom.prototype as any).buildSharedRtcVoiceChannelMembers,
      buildVoiceChannelStateSnapshot: (MeetingRoom.prototype as any).buildVoiceChannelStateSnapshot,
      resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
    };

    const payload = buildSharedRtcPayload(fakeMeetingRoom);

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

  it("prefers authoritative shared voice snapshot startedAt over local projected started-at cache", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      sessions: new Map<WebSocket, any>(),
      resumableSessions: new Map<string, any>(),
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            startedAt: 123_000,
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
      voiceChannelMembers: new Map<string, Map<string, any>>(),
      voiceChannelStartedAt: new Map([["vc-1", 5_000]]),
      spatialAudioStates: new Map(),
      collectActiveMediaClerkIds: () => new Set(["user-1"]),
      collectLiveMediaClerkIds: () => new Set(["user-1"]),
      collectSharedRtcVoiceStateChannelIds: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateChannelIds,
      collectSharedRtcVoiceStateSessions: (MeetingRoom.prototype as any).collectSharedRtcVoiceStateSessions,
      buildSharedRtcVoiceChannelMembers: (MeetingRoom.prototype as any).buildSharedRtcVoiceChannelMembers,
      buildVoiceChannelStateSnapshot: (MeetingRoom.prototype as any).buildVoiceChannelStateSnapshot,
      resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
    };

    const payload = buildSharedRtcPayload(fakeMeetingRoom);

    expect(payload.voice_started_at["vc-1"]).toBe(123_000);
  });

  it("reads shared RTC spatial-audio state from the injected shared snapshot instead of the local map", () => {
    const fakeMeetingRoom = createSharedRtcReadPathRoom({
      sharedRtcVoiceAuthoritySnapshot: createSharedRtcVoiceAuthoritySnapshot([
        [
          "vc-1",
          {
            startedAt: 123_000,
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
      spatialAudioStates: new Map([
        [
          "vc-1",
          {
            enabled: false,
            placementMode: "grid",
            roomSize: 1,
            distance: 1,
            arcAngle: 1,
            manualPositions: {},
            updatedAt: 1,
          },
        ],
      ]),
      sharedRtcSpatialAudioSnapshot: new Map([
        [
          "vc-1",
          {
            enabled: true,
            placementMode: "line",
            roomSize: 10,
            distance: 4,
            arcAngle: 90,
            manualPositions: {},
            updatedAt: 123,
          },
        ],
      ]),
    });

    const payload = buildSharedRtcPayload(fakeMeetingRoom);
    const message = buildSharedRtcMessage(fakeMeetingRoom, "vc-1");

    expect(payload.spatial_audio_states["vc-1"]).toEqual({
      enabled: true,
      placementMode: "line",
      roomSize: 10,
      distance: 4,
      arcAngle: 90,
      manualPositions: {},
      updatedAt: 123,
    });
    expect(message.d.data.spatial_audio_state).toEqual({
      enabled: true,
      placementMode: "line",
      roomSize: 10,
      distance: 4,
      arcAngle: 90,
      manualPositions: {},
      updatedAt: 123,
    });
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
      buildSharedRtcVoiceChannelMembers: (MeetingRoom.prototype as any).buildSharedRtcVoiceChannelMembers,
      buildVoiceChannelStateSnapshot: (MeetingRoom.prototype as any).buildVoiceChannelStateSnapshot,
      resolveVoiceMemberConnectionState: (MeetingRoom.prototype as any).resolveVoiceMemberConnectionState,
    };

    const message = buildSharedRtcMessage(fakeMeetingRoom, "vc-1");

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

  it("fans out shared RTC pending-call timeout stops through the shared room stop helper", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      broadcastToUser: vi.fn(),
      buildCallRingStopMessage: (MeetingRoom.prototype as any).buildCallRingStopMessage,
      broadcastPendingCallStop: (MeetingRoom.prototype as any).broadcastPendingCallStop,
      applyPendingCallStop: (MeetingRoom.prototype as any).applyPendingCallStop,
    };

    const pending = {
      callId: "call-1",
      callerId: "caller-1",
      calleeId: "callee-1",
      channelId: "dm-1",
      voiceRoomId: "voice-1",
      expiresAt: 1_000,
      callerName: "Alice",
    };
    const result = (MeetingRoom.prototype as any).applyPendingCallStop.call(
      fakeMeetingRoom,
      pending,
      "timeout",
      `Call ${pending.callId} ring timed out (caller stays in voice channel)`,
    );

    expect(result).toBe(true);
    expect(fakeMeetingRoom.broadcastToUser).toHaveBeenCalledTimes(2);
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
      pendingCalls: new Map<string, unknown>([
        [
          "callee-1",
          {
            callId: "call-1",
            callerId: "caller-1",
            calleeId: "callee-1",
            channelId: "dm-1",
            voiceRoomId: "voice-1",
            expiresAt: 500,
            callerName: "Alice",
          },
        ],
      ]),
      acceptedCalls: new Map<string, number>([["accepted-1", 750]]),
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
      await (MeetingRoom.prototype as any).runAlarmMaintenance.call(
        fakeMeetingRoom,
        1_000 + RTC_RECONNECT_GRACE_MS,
        false,
      );
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

  it("does not treat mirrored shared call state as MeetingRoom-local alarm work", () => {
    const fakeMeetingRoom = {
      sharedRtcAuthority: true,
      pendingCalls: new Map<string, { expiresAt: number }>([
        ["callee-1", { expiresAt: 2_000 }],
      ]),
      acceptedCalls: new Map<string, number>([["accepted-1", 3_000]]),
      presenceD1Pending: new Map<string, { dueAt: number }>(),
      sessions: new Map(),
      resumableSessionExpiry: new Map(),
      hasMeetingRoomAlarmWork: (MeetingRoom.prototype as any).hasMeetingRoomAlarmWork,
    };

    const hasWork = (MeetingRoom.prototype as any).hasMeetingRoomAlarmWork.call(fakeMeetingRoom);

    expect(hasWork).toBe(false);
  });

  it("ignores local resumable and mirrored call deadlines when choosing the next shared RTC alarm", () => {
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
      presenceD1Pending: new Map<string, { dueAt: number }>([[
        "presence-1",
        { dueAt: disconnectedAt + RTC_RECONNECT_GRACE_MS + 750 },
      ]]),
      getNextAlarmTime: (MeetingRoom.prototype as any).getNextAlarmTime,
    };

    const nextAlarm = (MeetingRoom.prototype as any).getNextAlarmTime.call(fakeMeetingRoom, now);

    expect(nextAlarm).toBe(now + 300_000);
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
      await (MeetingRoom.prototype as any).runAlarmMaintenance.call(
        fakeMeetingRoom,
        1_000 + RTC_RECONNECT_GRACE_MS,
        false,
      );
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
