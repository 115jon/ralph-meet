import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

vi.mock("./rtc-control-identity", () => ({
  consumeRtcRoomProfileRefreshCooldown: vi.fn(() => true),
  fetchRtcRoomProfileRefreshData: vi.fn(),
  fetchRtcRoomVoiceCredentials: vi.fn(),
  resolveRtcRoomControlIdentifySessionData: vi.fn(),
}));

import {
  RtcRoom,
  getRtcRoomSocketRole,
  inferRtcRoomSocketRole,
} from "./rtc-room";
import {
  consumeRtcRoomProfileRefreshCooldown,
  fetchRtcRoomProfileRefreshData,
  fetchRtcRoomVoiceCredentials,
  resolveRtcRoomControlIdentifySessionData,
} from "./rtc-control-identity";
import { applyRtcRoomControlDisconnectEffects } from "./rtc-room-control-disconnect-effects";
import {
  canRtcRoomClerkUserAccessVoiceChannel,
  filterRtcRoomSharedVoiceStatesForClerkUserId,
} from "./rtc-room-shared-visibility";
import { RTC_RECONNECT_GRACE_MS } from "../src/lib/voice/rtc-room-session";

describe("RtcRoom socket routing helpers", () => {
  it("uses persisted socket roles when present", () => {
    const controlWs = {
      deserializeAttachment: () => ({ socket_role: "control" }),
    } as unknown as WebSocket;
    const mediaWs = {
      deserializeAttachment: () => ({ socket_role: "media" }),
    } as unknown as WebSocket;

    expect(getRtcRoomSocketRole(controlWs)).toBe("control");
    expect(getRtcRoomSocketRole(mediaWs)).toBe("media");
  });

  it("falls back to attachment identity shape when role is missing", () => {
    const controlWs = {
      deserializeAttachment: () => ({ id: "session-1" }),
    } as unknown as WebSocket;
    const mediaWs = {
      deserializeAttachment: () => ({ participant_id: "participant-1" }),
    } as unknown as WebSocket;

    expect(getRtcRoomSocketRole(controlWs)).toBe("control");
    expect(getRtcRoomSocketRole(mediaWs)).toBe("media");
  });

  it("infers initial control and media messages by opcode", () => {
    expect(inferRtcRoomSocketRole(JSON.stringify({ op: 0 }))).toBe("control");
    expect(inferRtcRoomSocketRole(JSON.stringify({ op: 27 }))).toBe("control");
    expect(inferRtcRoomSocketRole(JSON.stringify({ op: 39 }))).toBe("control");
    expect(inferRtcRoomSocketRole(JSON.stringify({ op: 40 }))).toBe("control");
    expect(inferRtcRoomSocketRole(JSON.stringify({ op: 100 }))).toBe("media");
  });

  it("returns null for unparseable or unknown messages", () => {
    expect(inferRtcRoomSocketRole("not-json")).toBeNull();
    expect(inferRtcRoomSocketRole(JSON.stringify({ op: 999 }))).toBeNull();
  });

  it("routes media websocket messages through the RTC-owned media handler", async () => {
    const mediaHandler = {
      webSocketMessage: vi.fn(async () => "media-result"),
    };
    const fakeRtcRoom = {
      getRtcRoomMedia: vi.fn(() => mediaHandler),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(),
      getMeetingRoom: vi.fn(),
    };
    const mediaWs = {
      deserializeAttachment: () => ({ socket_role: "media", participant_id: "participant-1" }),
    } as unknown as WebSocket;

    const result = await RtcRoom.prototype.webSocketMessage.call(
      fakeRtcRoom,
      mediaWs,
      JSON.stringify({ op: 3, d: 123 }),
    );

    expect(result).toBe("media-result");
    expect(fakeRtcRoom.getRtcRoomMedia).toHaveBeenCalledTimes(1);
    expect(mediaHandler.webSocketMessage).toHaveBeenCalledWith(
      mediaWs,
      JSON.stringify({ op: 3, d: 123 }),
    );
    expect(fakeRtcRoom.getMeetingRoom).not.toHaveBeenCalled();
  });
});

describe("RtcRoom shared authority coordination", () => {
  it("builds canonical RTC session records from control and media truth", () => {
    const fakeRtcRoom = {
      ctx: {
        storage: {
          sql: {
            exec: vi.fn(() => [
              {
                id: "participant-1",
                clerk_user_id: "user-1",
                connection_id: "media-connection-1",
                pull_session_id: "pull-1",
                push_session_cam: "push-cam-1",
                push_session_screen: "push-screen-1",
                disconnected_at: 9_000,
              },
            ]),
          },
        },
      },
      canonicalRtcSessions: new Map(),
    };
    const controlSnapshot = {
      capturedAt: 10_000,
      sessionsByClerkUserId: new Map(),
      sessionsByParticipantId: new Map([
        ["participant-1", {
          id: "participant-1",
          name: "Alice",
          clerk_user_id: "user-1",
          voice_channel_id: "voice-1",
        }],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 0,
    };

    const records = (RtcRoom.prototype as any).syncRtcRoomCanonicalSessionRecords.call(
      fakeRtcRoom,
      controlSnapshot,
      10_000,
    );

    expect(records.get("user-1")).toEqual({
      participantId: "participant-1",
      clerkUserId: "user-1",
      controlSessionId: "participant-1",
      mediaConnectionId: "media-connection-1",
      voiceChannelId: "voice-1",
      mediaReconnectExpiresAt: 39_000,
      pullSessionId: "pull-1",
      pushSessionCam: "push-cam-1",
      pushSessionScreen: "push-screen-1",
    });
  });

  it("drains MeetingRoom pending storage batches through RTC_ROOM storage", async () => {
    const events: string[] = [];
    const fakeRtcRoom = {
      ctx: {
        storage: {
          delete: vi.fn(async (keys: string[]) => {
            events.push(`delete:${keys.join(",")}`);
          }),
          put: vi.fn(async (entries: Record<string, unknown>) => {
            events.push(`put:${JSON.stringify(entries)}`);
          }),
        },
      },
    };
    const meetingRoom = {
      drainPendingStorageMutations: vi.fn(() => {
        events.push("drain");
        return {
          deletes: ["resume:session:participant-1"],
          puts: {
            "presence:pending:user-1": { status: "idle", dueAt: 2_000 },
          },
        };
      }),
    };

    await (RtcRoom.prototype as any).persistMeetingRoomPendingControlBatch.call(fakeRtcRoom, meetingRoom);

    expect(meetingRoom.drainPendingStorageMutations).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.ctx.storage.delete).toHaveBeenCalledWith(["resume:session:participant-1"]);
    expect(fakeRtcRoom.ctx.storage.put).toHaveBeenCalledWith({
      "presence:pending:user-1": { status: "idle", dueAt: 2_000 },
    });
    expect(events).toEqual([
      "drain",
      "delete:resume:session:participant-1",
      'put:{"presence:pending:user-1":{"status":"idle","dueAt":2000}}',
    ]);
  });

  it("persists the drained MeetingRoom batch before syncing the control snapshot", async () => {
    const events: string[] = [];
    const fakeRtcRoom = {
      persistMeetingRoomPendingControlBatch: vi.fn(async () => {
        events.push("persist");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("sync");
      }),
    };

    await (RtcRoom.prototype as any).persistMeetingRoomPendingControlBatchAndSyncSnapshot.call(
      fakeRtcRoom,
      {},
    );

    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatch).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.syncMeetingRoomControlAuthoritySnapshot).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["persist", "sync"]);
  });

  it("builds shared control participants for pipeline effects from live RTC control sockets only", () => {
    const authoritativeSnapshot = {
      capturedAt: 123_000,
      sessionsByClerkUserId: new Map([
        ["user-1", { id: "participant-1", clerk_user_id: "user-1", name: "Alice" }],
        ["user-2", { id: "participant-2", clerk_user_id: "user-2", name: "Bob" }],
        ["user-3", { id: "participant-stored", clerk_user_id: "user-3", name: "Carol (stored)" }],
      ]),
      sessionsByParticipantId: new Map([
        ["participant-1", { id: "participant-1", clerk_user_id: "user-1", name: "Alice" }],
        ["participant-2", { id: "participant-2", clerk_user_id: "user-2", name: "Bob" }],
        ["participant-stored", { id: "participant-stored", clerk_user_id: "user-3", name: "Carol (stored)" }],
      ]),
      liveSessionCount: 2,
      resumableSessionCount: 1,
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [
          {
            deserializeAttachment: () => ({
              socket_role: "control",
              id: "participant-1",
              clerk_user_id: "user-1",
              name: "Alice",
            }),
          } as unknown as WebSocket,
          {
            deserializeAttachment: () => ({
              socket_role: "control",
              id: "participant-2",
              clerk_user_id: "user-2",
              name: "Bob",
            }),
          } as unknown as WebSocket,
        ],
      },
      latestSharedRtcControlAuthoritySnapshot: authoritativeSnapshot,
      toSharedRtcControlSessionSnapshot: vi.fn((session: { id: string; clerk_user_id?: string; name: string }) => ({
        id: session.id,
        clerk_user_id: session.clerk_user_id,
        name: session.name,
      })),
    });
    const meetingRoom = {
      addRtcRoomChannelSubscription: vi.fn(),
      addRtcRoomServerSubscription: vi.fn(),
    };

    const sessionEffects = (RtcRoom.prototype as any).createRtcRoomSharedControlSessionEffectsAdapter.call(
      fakeRtcRoom,
      meetingRoom,
    );
    const participants = sessionEffects.buildControlParticipants("participant-2");

    expect(participants).toEqual([
      {
        id: "participant-1",
        clerk_user_id: "user-1",
        name: "Alice",
      },
    ]);
    expect(fakeRtcRoom.toSharedRtcControlSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.toSharedRtcControlSessionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        clerk_user_id: "user-1",
      }),
    );
  });

  it("does not expose stored RTC participants when no live control sockets remain", () => {
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [],
      },
      latestSharedRtcControlAuthoritySnapshot: {
        capturedAt: 123_000,
        sessionsByClerkUserId: new Map([
          ["user-1", { id: "participant-stored", clerk_user_id: "user-1", name: "Alice (stored)" }],
        ]),
        sessionsByParticipantId: new Map([
          ["participant-stored", { id: "participant-stored", clerk_user_id: "user-1", name: "Alice (stored)" }],
        ]),
        liveSessionCount: 0,
        resumableSessionCount: 1,
      },
      toSharedRtcControlSessionSnapshot: vi.fn(),
    });
    const meetingRoom = {
      addRtcRoomChannelSubscription: vi.fn(),
      addRtcRoomServerSubscription: vi.fn(),
    };

    const sessionEffects = (RtcRoom.prototype as any).createRtcRoomSharedControlSessionEffectsAdapter.call(
      fakeRtcRoom,
      meetingRoom,
    );
    const participants = sessionEffects.buildControlParticipants("participant-2");

    expect(participants).toEqual([]);
    expect(fakeRtcRoom.toSharedRtcControlSessionSnapshot).not.toHaveBeenCalled();
  });

  it("uses RtcRoom-projected shared voice snapshots for shared identity/profile rebroadcasts", async () => {
    const authoritativeSnapshot = {
      capturedAt: 123_000,
      sessionsByClerkUserId: new Map([
        [
          "user-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            voice_joined_at: 123_000,
            name: "Alice Old",
            username: "alice-old",
            display_name: "Alice Old",
            avatar_url: "/old.png",
            avatar_display: "old",
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: false,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
            suppress: false,
            tracks: [],
          },
        ],
      ]),
      sessionsByParticipantId: new Map([
        [
          "participant-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            voice_joined_at: 123_000,
            name: "Alice Old",
            username: "alice-old",
            display_name: "Alice Old",
            avatar_url: "/old.png",
            avatar_display: "old",
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: false,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
            suppress: false,
            tracks: [],
          },
        ],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 0,
    };
    const mediaSnapshot = {
      capturedAt: 123_100,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const recipientWs = {
      deserializeAttachment: vi.fn(() => ({
        socket_role: "control",
        clerk_user_id: "user-1",
      })),
      send: vi.fn(),
    } as unknown as WebSocket;
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      latestSharedRtcControlAuthoritySnapshot: authoritativeSnapshot,
      findRtcRoomPendingIncomingCall: vi.fn(() => null),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => mediaSnapshot),
      env: {
        DB: {
          prepare: vi.fn((query: string) => {
            if (query.includes("SELECT server_id, channel_type FROM channels")) {
              return {
                bind: vi.fn(() => ({
                  first: vi.fn(async () => ({ server_id: null, channel_type: "dm" })),
                })),
              };
            }
            if (query.includes("SELECT 1 FROM dm_recipients")) {
              return {
                bind: vi.fn(() => ({
                  first: vi.fn(async () => ({ 1: 1 })),
                })),
              };
            }
            throw new Error(`Unexpected query: ${query}`);
          }),
        },
      },
      sharedRtcChannelMetaCache: new Map(),
      ctx: {
        waitUntil: vi.fn(),
        getWebSockets: () => [recipientWs],
      },
      toSharedRtcControlSessionSnapshot: vi.fn((session: unknown) => session),
    });
    const meetingRoom = {
      addRtcRoomChannelSubscription: vi.fn(),
      addRtcRoomServerSubscription: vi.fn(),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
    };
    const sessionEffects = (RtcRoom.prototype as any).createRtcRoomSharedControlSessionEffectsAdapter.call(
      fakeRtcRoom,
      meetingRoom,
    );
    const ws = {} as WebSocket;
    const refreshedSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
      name: "Alice New",
      username: "alice-new",
      display_name: "Alice New",
      avatar_url: "/new.png",
      avatar_display: "avatar",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      spatial_audio_enabled: false,
      spatial_audio_high_fidelity: false,
      suppress: false,
      tracks: [],
    };

    sessionEffects.refreshVoiceProjectionIdentity(refreshedSession, ws);
    sessionEffects.applyProfileVoiceProjectionUpdate(refreshedSession, {
      name: "Alice New",
      username: "alice-new",
      displayName: "Alice New",
      avatarUrl: "/new.png",
      avatarDisplay: "avatar",
    });
    await Promise.all(fakeRtcRoom.ctx.waitUntil.mock.calls.map(([promise]) => promise));

    expect(fakeRtcRoom.ctx.waitUntil).toHaveBeenCalledTimes(2);
    expect(recipientWs.send).toHaveBeenCalledTimes(2);
    const projectedVoiceSnapshot = fakeRtcRoom.latestSharedRtcVoiceAuthoritySnapshot;
    expect(projectedVoiceSnapshot.channels.get("vc-1").members[0]).toEqual(
      expect.objectContaining({
        clerk_user_id: "user-1",
        name: "Alice New",
        username: "alice-new",
        avatar_url: "/new.png",
        avatar_display: "avatar",
      }),
    );
  });

  it("sends shared VOICE_CHANNEL_STATES directly from RtcRoom after RTC-owned visibility filtering", async () => {
    const dbPrepare = vi.fn((query: string) => {
      if (query.includes("SELECT server_id, channel_type FROM channels")) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(async () => ({ server_id: null, channel_type: "dm" })),
          })),
        };
      }
      if (query.includes("SELECT 1 FROM dm_recipients")) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(async () => ({ 1: 1 })),
          })),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      env: {
        DB: {
          prepare: dbPrepare,
        },
      },
      sharedRtcChannelMetaCache: new Map(),
    });
    const ws = {
      send: vi.fn(),
    } as unknown as WebSocket;

    const sent = await (RtcRoom.prototype as any).sendRtcRoomSharedVoiceChannelStatesPayload.call(
      fakeRtcRoom,
      ws,
      "user-1",
      {
        voice_states: {
          "vc-1": [],
        },
        voice_started_at: {},
        spatial_audio_states: {},
      },
      {} as never,
    );

    expect(sent).toBe(true);
    expect(dbPrepare).toHaveBeenCalledTimes(2);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        op: 19,
        d: {
          event: "VOICE_CHANNEL_STATES",
          data: {
            voice_states: {
              "vc-1": [],
            },
            voice_started_at: {},
            spatial_audio_states: {},
          },
        },
      }),
    );
  });

  it("sends an empty shared VOICE_CHANNEL_STATES payload so reconnects clear stale client presence", async () => {
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      env: {
        DB: {
          prepare: vi.fn(),
        },
      },
      sharedRtcChannelMetaCache: new Map(),
    });
    const ws = {
      send: vi.fn(),
    } as unknown as WebSocket;

    const sent = await (RtcRoom.prototype as any).sendRtcRoomSharedVoiceChannelStatesPayload.call(
      fakeRtcRoom,
      ws,
      "user-1",
      {
        voice_states: {},
        voice_started_at: {},
        spatial_audio_states: {},
      },
      {} as never,
    );

    expect(sent).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        op: 19,
        d: {
          event: "VOICE_CHANNEL_STATES",
          data: {
            voice_states: {},
            voice_started_at: {},
            spatial_audio_states: {},
          },
        },
      }),
    );
  });

  it("broadcasts shared VOICE_CHANNEL_STATE_UPDATE directly from RtcRoom after RTC-owned visibility checks", async () => {
    const ws = {
      send: vi.fn(),
      deserializeAttachment: vi.fn(() => ({
        socket_role: "control",
        clerk_user_id: "user-1",
      })),
    } as unknown as WebSocket;
    const dbPrepare = vi.fn((query: string) => {
      if (query.includes("SELECT server_id, channel_type FROM channels")) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(async () => ({ server_id: null, channel_type: "dm" })),
          })),
        };
      }
      if (query.includes("SELECT 1 FROM dm_recipients")) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(async () => ({ 1: 1 })),
          })),
        };
      }
      throw new Error(`Unexpected query: ${query}`);
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      env: {
        DB: {
          prepare: dbPrepare,
        },
      },
      sharedRtcChannelMetaCache: new Map(),
      ctx: {
        getWebSockets: () => [ws],
      },
    });

    const sent = await (RtcRoom.prototype as any).broadcastRtcRoomSharedVoiceStateMessage.call(
      fakeRtcRoom,
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
      {} as never,
    );

    expect(sent).toBe(true);
    expect(dbPrepare).toHaveBeenCalledTimes(2);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        op: 19,
        d: {
          event: "VOICE_CHANNEL_STATE_UPDATE",
          data: {
            channel_id: "vc-1",
            members: [],
            started_at: null,
          },
        },
      }),
    );
  });

  it("uses RtcRoom-projected shared voice snapshots for shared voice-state rebroadcasts", async () => {
    const authoritativeSnapshot = {
      capturedAt: 123_000,
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
            self_video: false,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
            suppress: false,
            tracks: [],
          },
        ],
      ]),
      sessionsByParticipantId: new Map([
        [
          "participant-1",
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
            self_video: false,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
            suppress: false,
            tracks: [],
          },
        ],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 0,
    };
    const mediaSnapshot = {
      capturedAt: 123_100,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const recipientWs = {
      deserializeAttachment: vi.fn(() => ({
        socket_role: "control",
        clerk_user_id: "user-1",
      })),
      send: vi.fn(),
    } as unknown as WebSocket;
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      latestSharedRtcControlAuthoritySnapshot: authoritativeSnapshot,
      findRtcRoomPendingIncomingCall: vi.fn(() => null),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => mediaSnapshot),
      env: {
        DB: {
          prepare: vi.fn((query: string) => {
            if (query.includes("SELECT server_id, channel_type FROM channels")) {
              return {
                bind: vi.fn(() => ({
                  first: vi.fn(async () => ({ server_id: null, channel_type: "dm" })),
                })),
              };
            }
            if (query.includes("SELECT 1 FROM dm_recipients")) {
              return {
                bind: vi.fn(() => ({
                  first: vi.fn(async () => ({ 1: 1 })),
                })),
              };
            }
            throw new Error(`Unexpected query: ${query}`);
          }),
        },
      },
      sharedRtcChannelMetaCache: new Map(),
      ctx: {
        waitUntil: vi.fn(),
        getWebSockets: () => [recipientWs],
      },
      toSharedRtcControlSessionSnapshot: vi.fn((session: unknown) => session),
    });
    const meetingRoom = {
      addRtcRoomChannelSubscription: vi.fn(),
      addRtcRoomServerSubscription: vi.fn(),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
    };
    const sessionEffects = (RtcRoom.prototype as any).createRtcRoomSharedControlSessionEffectsAdapter.call(
      fakeRtcRoom,
      meetingRoom,
    );
    const updatedSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
      name: "Alice",
      self_mute: true,
      self_deaf: true,
      self_stream: true,
      self_stream_audio: true,
      self_video: true,
      spatial_audio_enabled: true,
      spatial_audio_high_fidelity: true,
      suppress: false,
      tracks: [],
    };

    sessionEffects.syncVoiceStateProjection(updatedSession);
    await Promise.all(fakeRtcRoom.ctx.waitUntil.mock.calls.map(([promise]) => promise));

    expect(fakeRtcRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(recipientWs.send).toHaveBeenCalledTimes(1);
    const projectedVoiceSnapshot = fakeRtcRoom.latestSharedRtcVoiceAuthoritySnapshot;
    expect(projectedVoiceSnapshot.channels.get("vc-1").members[0]).toEqual(
      expect.objectContaining({
        clerk_user_id: "user-1",
        self_mute: true,
        self_deaf: true,
        self_stream: true,
        self_stream_audio: true,
        self_video: true,
        spatial_audio_enabled: true,
        spatial_audio_high_fidelity: true,
      }),
    );
  });

  it("does not fall back to MeetingRoom shared projection helpers when the authoritative voice snapshot omits the user", () => {
    const authoritativeSnapshot = {
      capturedAt: 123_000,
      sessionsByClerkUserId: new Map([
        [
          "user-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            voice_joined_at: 123_000,
            name: "Alice Old",
            username: "alice-old",
            display_name: "Alice Old",
            avatar_url: "/old.png",
            avatar_display: "old",
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: false,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
            suppress: false,
            tracks: [],
          },
        ],
      ]),
      sessionsByParticipantId: new Map([
        [
          "participant-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            voice_joined_at: 123_000,
            name: "Alice Old",
            username: "alice-old",
            display_name: "Alice Old",
            avatar_url: "/old.png",
            avatar_display: "old",
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: false,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
            suppress: false,
            tracks: [],
          },
        ],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 0,
    };
    const mediaSnapshot = {
      capturedAt: 123_100,
      liveParticipantIds: new Set<string>(),
      liveClerkUserIds: new Set<string>(),
      activeClerkUserIds: new Set<string>(),
      presenceByClerkUserId: new Map(),
      participantCount: 0,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      latestSharedRtcControlAuthoritySnapshot: authoritativeSnapshot,
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => mediaSnapshot),
      toSharedRtcControlSessionSnapshot: vi.fn((session: unknown) => session),
    });
    const meetingRoom = {
      addRtcRoomChannelSubscription: vi.fn(),
      addRtcRoomServerSubscription: vi.fn(),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
    };
    const sessionEffects = (RtcRoom.prototype as any).createRtcRoomSharedControlSessionEffectsAdapter.call(
      fakeRtcRoom,
      meetingRoom,
    );
    const ws = {} as WebSocket;
    const refreshedSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
      name: "Alice New",
      username: "alice-new",
      display_name: "Alice New",
      avatar_url: "/new.png",
      avatar_display: "avatar",
      self_mute: true,
      self_deaf: true,
      self_stream: true,
      self_stream_audio: true,
      self_video: true,
      spatial_audio_enabled: true,
      spatial_audio_high_fidelity: true,
      suppress: false,
      tracks: [],
    };

    sessionEffects.refreshVoiceProjectionIdentity(refreshedSession, ws);
    sessionEffects.applyProfileVoiceProjectionUpdate(refreshedSession, {
      name: "Alice New",
      username: "alice-new",
      displayName: "Alice New",
      avatarUrl: "/new.png",
      avatarDisplay: "avatar",
    });
    sessionEffects.syncVoiceStateProjection(refreshedSession);

    expect(fakeRtcRoom.latestSharedRtcControlAuthoritySnapshot?.sessionsByParticipantId.get("participant-1")).toEqual(
      expect.objectContaining({
        id: "participant-1",
        clerk_user_id: "user-1",
        name: "Alice New",
      }),
    );
    const projectedVoiceSnapshot = fakeRtcRoom.latestSharedRtcVoiceAuthoritySnapshot;
    expect(projectedVoiceSnapshot.channels.size).toBe(0);
    expect(projectedVoiceSnapshot.channelIdByClerkUserId.size).toBe(0);
  });

  it("uses authoritative RtcRoom control attachments for shared disconnect concurrency checks", () => {
    const closingWs = {
      send: vi.fn(),
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-1",
        clerk_user_id: "user-1",
      }),
    } as unknown as WebSocket;
    const concurrentWs = {
      send: vi.fn(),
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-2",
        clerk_user_id: "user-1",
      }),
    } as unknown as WebSocket;
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [closingWs, concurrentWs],
      },
      hasRtcRoomConcurrentControlSession:
        (RtcRoom.prototype as any).hasRtcRoomConcurrentControlSession,
      toSharedRtcControlSessionSnapshot: vi.fn((session: unknown) => session),
    });
    const meetingRoom = {
      cleanupRtcRoomChannelSubscriptions: vi.fn(),
      cleanupRtcRoomServerSubscriptions: vi.fn(),
      deleteRtcRoomLiveControlSession: vi.fn(),
      clearRtcRoomLocalResumableControlState: vi.fn(),
    };

    const disconnectEffects =
      (RtcRoom.prototype as any).createRtcRoomSharedControlDisconnectEffectsAdapter.call(
        fakeRtcRoom,
        meetingRoom,
      );

    expect(disconnectEffects.hasConcurrentControlSession(closingWs, "user-1")).toBe(true);

    applyRtcRoomControlDisconnectEffects(
      disconnectEffects,
      closingWs,
      {
        id: "participant-1",
        clerk_user_id: "user-1",
        name: "Alice",
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        spatial_audio_enabled: false,
        spatial_audio_high_fidelity: false,
        suppress: false,
        tracks: [],
      },
      {
        intentional: false,
        closeSocket: false,
      },
    );

    expect(fakeRtcRoom.toSharedRtcControlSessionSnapshot).not.toHaveBeenCalled();
  });

  it("treats pending call deadlines as control-side alarm work", async () => {
    const fakeRtcRoom = {
      ctx: {
        storage: {
          list: vi.fn(async () => new Map()),
          get: vi.fn(async (key: string) => {
            if (key === "pendingCalls") {
              return {
                "callee-1": {
                  callId: "call-1",
                },
              };
            }
            return undefined;
          }),
        },
      },
    };

    await expect((RtcRoom.prototype as any).hasPendingControlAlarmWork.call(fakeRtcRoom)).resolves.toBe(true);
  });

  it("treats resumable expiry keys as control-side alarm work", async () => {
    const fakeRtcRoom = {
      ctx: {
        storage: {
          list: vi.fn(async ({ prefix }: { prefix: string }) => {
            if (prefix === "resume:expiry:") {
              return new Map([["resume:expiry:participant-1", 123_456]]);
            }
            return new Map();
          }),
          get: vi.fn(async () => undefined),
        },
      },
    };

    await expect((RtcRoom.prototype as any).hasPendingControlAlarmWork.call(fakeRtcRoom)).resolves.toBe(true);
  });

  it("treats pending presence flushes as control-side alarm work", async () => {
    const fakeRtcRoom = {
      ctx: {
        storage: {
          list: vi.fn(async ({ prefix }: { prefix: string }) => {
            if (prefix === "presence:pending:") {
              return new Map([["presence:pending:user-1", { status: "idle", dueAt: 123_456 }]]);
            }
            return new Map();
          }),
          get: vi.fn(async () => undefined),
        },
      },
    };

    await expect((RtcRoom.prototype as any).hasPendingControlAlarmWork.call(fakeRtcRoom)).resolves.toBe(true);
  });

  it("treats legacy resumable session expiry as control-side alarm work", async () => {
    const fakeRtcRoom = {
      ctx: {
        storage: {
          list: vi.fn(async () => new Map()),
          get: vi.fn(async (key: string) => {
            if (key === "resumableSessionExpiry") {
              return {
                "participant-1": 123_456,
              };
            }
            return undefined;
          }),
        },
      },
    };

    await expect((RtcRoom.prototype as any).hasPendingControlAlarmWork.call(fakeRtcRoom)).resolves.toBe(true);
  });

  it("treats accepted call expiries as control-side alarm work", async () => {
    const fakeRtcRoom = {
      ctx: {
        storage: {
          list: vi.fn(async () => new Map()),
          get: vi.fn(async (key: string) => {
            if (key === "acceptedCallExpiry") {
              return {
                "call-1": 123_456,
              };
            }
            return undefined;
          }),
        },
      },
    };

    await expect((RtcRoom.prototype as any).hasPendingControlAlarmWork.call(fakeRtcRoom)).resolves.toBe(true);
  });

  it("builds shared control snapshots from resumable storage plus live control sockets", async () => {
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        storage: {
          list: vi.fn(async ({ prefix }: { prefix: string }) => {
            if (prefix === "resume:session:") {
              return new Map([
                [
                  "resume:session:participant-1",
                  {
                    id: "participant-1",
                    clerk_user_id: "user-1",
                    voice_channel_id: "vc-resumable",
                    name: "Alice (stale)",
                    self_mute: false,
                    self_deaf: false,
                    self_stream: false,
                    self_stream_audio: false,
                    self_video: false,
                  },
                ],
                [
                  "resume:session:participant-3",
                  {
                    id: "participant-3",
                    clerk_user_id: "user-1",
                    voice_channel_id: "vc-alt",
                    name: "Alice (tablet)",
                    self_mute: false,
                    self_deaf: true,
                    self_stream: false,
                    self_stream_audio: false,
                    self_video: false,
                  },
                ],
              ]);
            }
            if (prefix === "resume:expiry:") {
              return new Map([
                ["resume:expiry:participant-1", 190_000],
                ["resume:expiry:participant-3", 195_000],
              ]);
            }
            return new Map();
          }),
        },
        getWebSockets: () => [
          {
            deserializeAttachment: () => ({
              socket_role: "control",
              id: "participant-1",
              clerk_user_id: "user-1",
              voice_channel_id: "vc-live",
              voice_joined_at: 123_000,
              name: "Alice",
              self_mute: true,
              self_deaf: false,
              self_stream: false,
              self_stream_audio: false,
              self_video: true,
            }),
          } as unknown as WebSocket,
          {
            deserializeAttachment: () => ({
              socket_role: "control",
              id: "participant-2",
              clerk_user_id: "user-2",
              voice_channel_id: "vc-2",
              name: "Bob",
              self_mute: false,
              self_deaf: true,
              self_stream: false,
              self_stream_audio: false,
              self_video: false,
            }),
          } as unknown as WebSocket,
          {
            deserializeAttachment: () => ({
              socket_role: "media",
              participant_id: "media-1",
              clerk_user_id: "user-3",
            }),
          } as unknown as WebSocket,
        ],
      },
    });

    const snapshot = await (RtcRoom.prototype as any).readSharedRtcControlAuthoritySnapshot.call(
      fakeRtcRoom,
      200_000,
    );

    expect(snapshot.capturedAt).toBe(200_000);
    expect(snapshot.liveSessionCount).toBe(2);
    expect(snapshot.resumableSessionCount).toBe(2);
    expect(snapshot.sessionsByClerkUserId.size).toBe(2);
    expect(snapshot.sessionsByParticipantId.size).toBe(3);
    expect(snapshot.sessionsByClerkUserId.get("user-1")).toEqual(
      expect.objectContaining({
        id: "participant-1",
        clerk_user_id: "user-1",
        voice_channel_id: "vc-live",
        voice_joined_at: 123_000,
        name: "Alice",
        self_mute: true,
        self_video: true,
      }),
    );
    expect(snapshot.sessionsByClerkUserId.get("user-2")).toEqual(
      expect.objectContaining({
        id: "participant-2",
        clerk_user_id: "user-2",
        voice_channel_id: "vc-2",
        name: "Bob",
        self_deaf: true,
      }),
    );
    expect(snapshot.sessionsByParticipantId.get("participant-3")).toEqual(
      expect.objectContaining({
        id: "participant-3",
        clerk_user_id: "user-1",
        voice_channel_id: "vc-alt",
        name: "Alice (tablet)",
        self_deaf: true,
      }),
    );
  });

  it("filters expired resumable control sessions out of shared control snapshots before alarms run", async () => {
    const now = 200_000;
    const freshDisconnectedAt = now - RTC_RECONNECT_GRACE_MS + 1_000;
    const expiredDisconnectedAt = now - RTC_RECONNECT_GRACE_MS - 1_000;
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        storage: {
          list: vi.fn(async ({ prefix }: { prefix: string }) => {
            if (prefix === "resume:session:") {
              return new Map([
                [
                  "resume:session:participant-fresh",
                  {
                    id: "participant-fresh",
                    clerk_user_id: "user-1",
                    voice_channel_id: "vc-fresh",
                    name: "Alice (fresh)",
                  },
                ],
                [
                  "resume:session:participant-expired",
                  {
                    id: "participant-expired",
                    clerk_user_id: "user-2",
                    voice_channel_id: "vc-expired",
                    name: "Bob (expired)",
                  },
                ],
              ]);
            }
            if (prefix === "resume:expiry:") {
              return new Map([
                ["resume:expiry:participant-fresh", freshDisconnectedAt],
                ["resume:expiry:participant-expired", expiredDisconnectedAt],
              ]);
            }
            return new Map();
          }),
        },
        getWebSockets: () => [],
      },
    });

    const snapshot = await (RtcRoom.prototype as any).readSharedRtcControlAuthoritySnapshot.call(
      fakeRtcRoom,
      now,
    );

    expect(snapshot.liveSessionCount).toBe(0);
    expect(snapshot.resumableSessionCount).toBe(1);
    expect(snapshot.sessionsByParticipantId.size).toBe(1);
    expect(snapshot.sessionsByParticipantId.get("participant-fresh")).toEqual(
      expect.objectContaining({
        id: "participant-fresh",
        clerk_user_id: "user-1",
        voice_channel_id: "vc-fresh",
        name: "Alice (fresh)",
      }),
    );
    expect(snapshot.sessionsByParticipantId.has("participant-expired")).toBe(false);
  });

  it("bootstraps MeetingRoom shared projection only after both snapshots exist", async () => {
    const events: string[] = [];
    const controlSnapshot = {
      capturedAt: 123_000,
      sessionsByClerkUserId: new Map<string, unknown>(),
      sessionsByParticipantId: new Map<string, unknown>(),
      liveSessionCount: 0,
      resumableSessionCount: 0,
    };
    const mediaSnapshot = {
      capturedAt: 123_000,
      liveParticipantIds: new Set<string>(),
      liveClerkUserIds: new Set<string>(),
      activeClerkUserIds: new Set<string>(),
      presenceByClerkUserId: new Map(),
      participantCount: 0,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const meetingRoom = {
      clearRtcRoomSharedProjectionChannels: vi.fn((value) => {
        events.push(`clear-stale:${Array.from(value).join(",")}`);
        return true;
      }),
    };
    let currentMediaSnapshot: typeof mediaSnapshot | null = null;
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        waitUntil: vi.fn((promise) => {
          events.push("queue");
          return promise;
        }),
        getWebSockets: () => [],
      },
      meetingRoomSharedProjectionBootstrapped: false,
      sharedRtcProjectedChannelIds: new Set(["vc-stale"]),
      getMeetingRoom: () => meetingRoom,
      tryReadSharedRtcControlAuthoritySnapshot: vi.fn(async () => controlSnapshot),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => currentMediaSnapshot),
      bootstrapMeetingRoomSharedProjectionIfReady:
        (RtcRoom.prototype as any).bootstrapMeetingRoomSharedProjectionIfReady,
      queueRtcRoomSharedVoiceStateBroadcasts:
        (RtcRoom.prototype as any).queueRtcRoomSharedVoiceStateBroadcasts,
      broadcastRtcRoomSharedVoiceStateMessage:
        (RtcRoom.prototype as any).broadcastRtcRoomSharedVoiceStateMessage,
    });

    await (RtcRoom.prototype as any).syncMeetingRoomControlAuthoritySnapshot.call(fakeRtcRoom);
    currentMediaSnapshot = mediaSnapshot;
    await (RtcRoom.prototype as any).syncMeetingRoomControlAuthoritySnapshot.call(fakeRtcRoom);
    await (RtcRoom.prototype as any).syncMeetingRoomControlAuthoritySnapshot.call(fakeRtcRoom);

    expect(fakeRtcRoom.latestSharedRtcControlAuthoritySnapshot).toBe(controlSnapshot);
    expect(meetingRoom.clearRtcRoomSharedProjectionChannels).toHaveBeenCalledWith(new Set(["vc-stale"]));
    expect(fakeRtcRoom.sharedRtcProjectedChannelIds).toEqual(new Set());
    expect(events).toEqual([
      "clear-stale:vc-stale",
      "queue",
    ]);
  });

  it("resyncs meeting-room media state after a media identify", async () => {
    const rtcRoomMedia = {
      webSocketMessage: vi.fn(async () => undefined),
    };
    const syncMeetingRoomMediaState = vi.fn();
    const fakeRtcRoom = {
      getRtcRoomMedia: () => rtcRoomMedia,
      syncMeetingRoomMediaState,
    };
    const ws = {
      deserializeAttachment: () => ({ socket_role: "media", clerk_user_id: "user-1" }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 100, d: { participant_id: "participant-1" } }),
    );

    expect(rtcRoomMedia.webSocketMessage).toHaveBeenCalledTimes(1);
    expect(syncMeetingRoomMediaState).toHaveBeenCalledWith("user-1");
  });

  it("intercepts control identify in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const randomIdSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue("participant-1");
    vi.mocked(resolveRtcRoomControlIdentifySessionData).mockImplementationOnce(async () => {
      events.push("identify-data");
      return {
        participantId: "participant-1",
        name: "Alice",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "/avatar.png",
        avatarDisplay: "cover",
        status: "online",
        iceServers: [],
        voiceToken: "voice-token",
      };
    });
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      sharedRtcProjectedChannelIds: new Set<string>(),
      ctx: {
        getWebSockets: () => [ws],
        storage: {
          get: vi.fn(async () => undefined),
        },
      },
      getMeetingRoom: () => meetingRoom,
      rtcRoomProfileRefreshCooldowns: new Map<string, number>(),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      sendRtcRoomSharedVoiceChannelStates: vi.fn(async () => true),
      getStoredRoomSlug: vi.fn(async () => "room-1"),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("control-sync");
        return null;
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      findRtcRoomPendingIncomingCall: vi.fn(() => null),
      toSharedRtcControlSessionSnapshot: vi.fn((session) => session),
      env: {} as any,
    });
    const ws = {
      deserializeAttachment: () => ({ socket_role: "control" }),
      serializeAttachment: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 0, d: { name: "alice", clerk_user_id: "user-1" } }),
    );
    randomIdSpy.mockRestore();

    expect(fakeRtcRoom.syncMeetingRoomMediaAuthoritySnapshot).toHaveBeenCalledTimes(1);
    expect(resolveRtcRoomControlIdentifySessionData).toHaveBeenCalledWith({}, "room-1", "participant-1", {
      name: "alice",
      clerk_user_id: "user-1",
    });
    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        name: "Alice",
        clerk_user_id: "user-1",
        seq: 0,
      }),
    );
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        op: 2,
        d: {
          participant_id: "participant-1",
          ice_servers: [],
          participants: [],
          heartbeat_interval: 45_000,
          voice_token: "voice-token",
        },
      }),
    );
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "identify-data", "persist-session", "control-sync", "materialize", "persist-sync"]);
  });

  it("intercepts control resume in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    vi.mocked(fetchRtcRoomVoiceCredentials).mockImplementationOnce(async () => {
      events.push("credentials");
      return {
        voiceToken: "voice-token",
        iceServers: [],
      };
    });
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      addRtcRoomChannelSubscription: vi.fn(() => {
        events.push("resume");
      }),
      addRtcRoomServerSubscription: vi.fn(),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      sharedRtcPendingCalls: null,
      sharedRtcAcceptedCalls: null,
      readStoredRtcRoomControlSessionAttachment: vi.fn(async () => ({
        socket_role: "control",
        id: "session-1",
        clerk_user_id: "user-1",
        name: "Alice",
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        suppress: false,
        tracks: [],
        seq: 12,
        subscribed_channels: [],
        subscribed_servers: [],
      })),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("control-sync");
        return null;
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      sendRtcRoomSharedVoiceChannelStates: vi.fn(async () => true),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => null),
      setRtcRoomSharedVoiceAuthoritySnapshot: vi.fn(),
      applyRtcRoomSharedProjectionChannelUpdates: vi.fn(() => false),
      ctx: {
        storage: {
          get: vi.fn(async () => undefined),
          delete: vi.fn(async () => undefined),
          put: vi.fn(async () => undefined),
          getAlarm: vi.fn(async () => null),
          setAlarm: vi.fn(async () => undefined),
        },
        waitUntil: vi.fn(),
      },
      getStoredRoomSlug: vi.fn(async () => "room-1"),
      toSharedRtcControlSessionSnapshot: vi.fn((session) => session),
      env: {} as any,
    });
    const ws = {
      deserializeAttachment: () => ({ socket_role: "control" }),
      serializeAttachment: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 7, d: { session_id: "session-1", seq_ack: 12 } }),
    );

    expect(fakeRtcRoom.syncMeetingRoomMediaAuthoritySnapshot).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.readStoredRtcRoomControlSessionAttachment).toHaveBeenCalledWith("session-1");
    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "session-1",
        clerk_user_id: "user-1",
      }),
    );
    expect(fetchRtcRoomVoiceCredentials).toHaveBeenCalledWith({}, "room-1", "session-1", "user-1");
    expect(meetingRoom.addRtcRoomChannelSubscription).not.toHaveBeenCalled();
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual([
      "snapshot",
      "persist-session",
      "control-sync",
      "materialize",
      "credentials",
      "control-sync",
      "persist-sync",
    ]);
  });

  it("intercepts control heartbeat in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      persistMeetingRoomPendingControlBatch: vi.fn(async () => {
        events.push("persist");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    const ws = {
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-1",
        name: "Alice",
        seq: 4,
      }),
      serializeAttachment: vi.fn(),
      send: vi.fn(() => {
        events.push("ack");
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 3, d: { seq_ack: 4 } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        seq: 5,
      }),
    );
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatch).toHaveBeenCalledWith(meetingRoom);
    expect(fakeRtcRoom.syncMeetingRoomControlAuthoritySnapshot).not.toHaveBeenCalled();
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "persist-session", "materialize", "ack", "persist"]);
  });

  it("intercepts control refresh-credentials in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    vi.mocked(fetchRtcRoomVoiceCredentials).mockImplementationOnce(async () => {
      events.push("credentials");
      return {
        voiceToken: "voice-token",
        iceServers: [],
      };
    });
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      addRtcRoomChannelSubscription: vi.fn(),
      addRtcRoomServerSubscription: vi.fn(),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      getStoredRoomSlug: vi.fn(async () => "room-1"),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("control-sync");
        return null;
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      toSharedRtcControlSessionSnapshot: vi.fn((session) => session),
      env: {} as any,
    });
    const ws = {
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-1",
        clerk_user_id: "user-1",
        name: "Alice",
      }),
      send: vi.fn(),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 40, d: {} }),
    );

    expect(fetchRtcRoomVoiceCredentials).toHaveBeenCalledWith({}, "room-1", "participant-1", "user-1");
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        op: 9,
        d: {
          voice_token: "voice-token",
          ice_servers: [],
          participants: [],
        },
      }),
    );
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "credentials", "control-sync", "materialize"]);
  });

  it("intercepts control client-disconnect in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const meetingRoom = {
      handleRtcRoomControlIdentify: vi.fn(),
      handleRtcRoomControlHeartbeat: vi.fn(),
      handleRtcRoomControlResume: vi.fn(),
      handleRtcRoomControlRefreshVoiceCredentials: vi.fn(),
      cleanupRtcRoomChannelSubscriptions: vi.fn(() => {
        events.push("cleanup-channels");
      }),
      cleanupRtcRoomServerSubscriptions: vi.fn(() => {
        events.push("cleanup-servers");
      }),
      deleteRtcRoomLiveControlSession: vi.fn(() => {
        events.push("delete-live");
      }),
      clearRtcRoomLocalResumableControlState: vi.fn(() => {
        events.push("clear-resume");
      }),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const pendingCalls = new Map([
      [
        "user-2",
        {
          callId: "call-1",
          callerId: "user-1",
          calleeId: "user-2",
          channelId: "vc-1",
          voiceRoomId: "dm-call-user-1-user-2",
          expiresAt: 999_999,
        },
      ],
    ]);
    const acceptedCalls = new Map<string, number>();
    const counterpartSend = vi.fn((raw: string) => {
      const parsed = JSON.parse(raw) as {
        op: number;
        d?: {
          event?: string;
          data?: Record<string, unknown>;
        };
      };
      if (parsed.d?.event === "PRESENCE_UPDATE") {
        events.push("presence-offline");
        expect(parsed).toEqual({
          op: 19,
          d: {
            event: "PRESENCE_UPDATE",
            data: {
              user_id: "user-1",
              status: "offline",
            },
          },
        });
        return;
      }

      events.push("ring-stop");
      expect(parsed).toEqual({
        op: 19,
        d: {
          event: "CALL_RING_STOP",
          data: {
            call_id: "call-1",
            reason: "disconnected",
          },
        },
      });
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [
          ws,
          {
            deserializeAttachment: () => ({
              socket_role: "control",
              clerk_user_id: "user-2",
            }),
            send: counterpartSend,
          },
        ],
      },
      getMeetingRoom: () => meetingRoom,
      rtcRoomProfileRefreshCooldowns: new Map<string, number>(),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      syncRtcRoomSharedCallStateMirror: vi.fn(async () => {
        events.push("sync-call-state");
        return { pendingCalls, acceptedCalls };
      }),
      persistRtcRoomControlDisconnectState: vi.fn(async () => {
        events.push("persist-disconnect");
      }),
      persistRtcRoomSharedCallState: vi.fn(async (_meetingRoom, nextPendingCalls, nextAcceptedCalls) => {
        events.push("persist-call-state");
        expect(Array.from(nextPendingCalls.entries())).toEqual([]);
        expect(nextAcceptedCalls).toBe(acceptedCalls);
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      toSharedRtcControlSessionSnapshot: vi.fn(() => ({ id: "participant-1" })),
    });
    const applySharedTransition = vi.fn(() => {
      events.push("shared-transition");
      return true;
    });
    (fakeRtcRoom as any).applyRtcRoomSharedVoiceTransitionEffects = applySharedTransition;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 11, d: {} }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlDisconnectState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      }),
      true,
      expect.any(Number),
    );
    expect(fakeRtcRoom.syncRtcRoomSharedCallStateMirror).toHaveBeenCalledWith(meetingRoom);
    expect(fakeRtcRoom.persistRtcRoomSharedCallState).toHaveBeenCalledWith(
      meetingRoom,
      pendingCalls,
      acceptedCalls,
      expect.objectContaining({
        pendingChanged: true,
        acceptedChanged: false,
        now: expect.any(Number),
      }),
    );
    expect(counterpartSend).toHaveBeenCalledTimes(2);
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual([
      "snapshot",
      "before-voice",
      "sync-call-state",
      "persist-disconnect",
      "presence-offline",
      "cleanup-channels",
      "cleanup-servers",
      "delete-live",
      "clear-resume",
      "ring-stop",
      "persist-call-state",
      "after-control",
      "shared-transition",
      "persist-sync",
    ]);
  });

  it("intercepts control voice-state updates in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const recipientWs = {
      deserializeAttachment: vi.fn(() => ({
        socket_role: "control",
        clerk_user_id: "user-2",
      })),
      send: vi.fn(() => {
        events.push("voice-state");
      }),
    } as unknown as WebSocket;
    const sessionEffects = {
      materializeControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      restoreSubscriptions: vi.fn(),
      restoreVoiceMembershipOnResume: vi.fn(async () => undefined),
      buildControlParticipants: vi.fn(() => []),
      buildVoiceState: vi.fn(() => {
        events.push("build-voice");
        return { id: "participant-1" };
      }),
      getSpatialAudioState: vi.fn(() => ({ room: "state" })),
      updateSpatialAudioState: vi.fn((_scopeId, spatialAudioState) => {
        events.push("spatial");
        return spatialAudioState ?? { room: "state" };
      }),
      sendTo: vi.fn(),
      broadcast: vi.fn(),
      sendVoiceChannelStates: vi.fn(async () => undefined),
      queueBroadcastVoiceChannelState: vi.fn(),
      syncVoiceStateProjection: vi.fn(() => {
        events.push("projection");
      }),
      refreshVoiceProjectionIdentity: vi.fn(),
      applyProfileVoiceProjectionUpdate: vi.fn(),
      findPendingIncomingCall: vi.fn(() => null),
      logInfo: vi.fn(),
    };
    const meetingRoom = {
      handleRtcRoomControlIdentify: vi.fn(),
      handleRtcRoomControlHeartbeat: vi.fn(),
      handleRtcRoomControlResume: vi.fn(),
      handleRtcRoomControlClientDisconnect: vi.fn(),
      handleRtcRoomControlProfileRefresh: vi.fn(),
      handleRtcRoomControlVoiceChannelJoin: vi.fn(),
      handleRtcRoomControlVoiceChannelLeave: vi.fn(),
      handleRtcRoomControlRefreshVoiceCredentials: vi.fn(),
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      sharedRtcSpatialAudioSnapshot: null,
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      getStoredRoomSlug: vi.fn(async () => "room-1"),
      toSharedRtcControlSessionSnapshot: vi.fn((session) => {
        events.push("build-voice");
        return session;
      }),
      ctx: {
        getWebSockets: () => [ws, recipientWs],
      },
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: true,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 15, d: { self_mute: false, self_video: true } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        self_mute: false,
        self_video: true,
      }),
    );
    expect(fakeRtcRoom.sharedRtcSpatialAudioSnapshot).toBeNull();
    expect(recipientWs.send).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual([
      "snapshot",
      "persist-session",
      "materialize",
      "build-voice",
      "voice-state",
      "persist-sync",
    ]);
  });

  it("routes shared RTC spatial-audio updates through RtcRoom-owned snapshot state", async () => {
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => session),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      addRtcRoomChannelSubscription: vi.fn(),
      addRtcRoomServerSubscription: vi.fn(),
      webSocketMessage: vi.fn(),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      sharedRtcSpatialAudioSnapshot: null,
      persistRtcRoomControlSessionAttachment: vi.fn(async () => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => ({ snapshot: "after" })),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      getStoredRoomSlug: vi.fn(async () => "room-1"),
      toSharedRtcControlSessionSnapshot: vi.fn((session) => session),
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({
        op: 15,
        d: {
          spatial_audio_state: {
            enabled: true,
            placementMode: "line",
            roomSize: 10,
            distance: 4,
            arcAngle: 90,
            manualPositions: {},
          },
        },
      }),
    );
    expect(fakeRtcRoom.sharedRtcSpatialAudioSnapshot).toEqual(
      new Map([
        [
          "room-1",
          {
            enabled: true,
            placementMode: "line",
            roomSize: 10,
            distance: 4,
            arcAngle: 90,
            manualPositions: {},
            updatedBy: "user-1",
            updatedAt: expect.any(Number),
          },
        ],
      ]),
    );
  });

  it("intercepts control presence updates in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const peerWs = {
      deserializeAttachment: vi.fn(() => ({
        socket_role: "control",
        clerk_user_id: "user-2",
      })),
      send: vi.fn(() => {
        events.push("presence-send");
      }),
    } as unknown as WebSocket;
    const postWriteEffects = {
      queuePresenceWrite: vi.fn(() => {
        events.push("presence");
      }),
      broadcastPresenceStatus: vi.fn(),
      addChannelSubscription: vi.fn(),
      removeChannelSubscription: vi.fn(),
      addServerSubscription: vi.fn(),
      getOnlineClerkUserIds: vi.fn(() => []),
      sendPresenceList: vi.fn(),
      queueVoiceChannelStates: vi.fn(),
      logInfo: vi.fn(),
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      addRtcRoomChannelSubscription: postWriteEffects.addChannelSubscription,
      removeRtcRoomChannelSubscription: postWriteEffects.removeChannelSubscription,
      addRtcRoomServerSubscription: postWriteEffects.addServerSubscription,
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      queueRtcRoomPendingPresenceWrite: vi.fn(() => {
        events.push("presence");
        return true;
      }),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      ctx: {
        getWebSockets: () => [ws, peerWs],
      },
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      username: "alice",
      display_name: "Alice",
      avatar_url: "/avatar.png",
      avatar_display: "avatar",
      status: "online",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
      send: vi.fn(),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 26, d: { status: "idle" } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        status: "idle",
      }),
    );
    expect(fakeRtcRoom.queueRtcRoomPendingPresenceWrite).toHaveBeenCalledWith("user-1", "idle");
    expect(postWriteEffects.broadcastPresenceStatus).not.toHaveBeenCalled();
    expect(peerWs.send).toHaveBeenCalledTimes(0);
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "persist-session", "materialize", "presence", "persist-sync"]);
  });

  it("intercepts control profile refresh in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const verified = {
      name: "Alice Updated",
      username: "alice",
      displayName: "Alice Updated",
      avatarUrl: "/avatar.png",
      avatarDisplay: "avatar",
    };
    vi.mocked(consumeRtcRoomProfileRefreshCooldown).mockImplementationOnce(() => true);
    vi.mocked(fetchRtcRoomProfileRefreshData).mockImplementationOnce(async () => {
      events.push("fetch-profile");
      return verified;
    });
    const meetingRoom = {
      handleRtcRoomControlIdentify: vi.fn(),
      handleRtcRoomControlHeartbeat: vi.fn(),
      handleRtcRoomControlResume: vi.fn(),
      handleRtcRoomControlClientDisconnect: vi.fn(),
      handleRtcRoomControlVoiceStateUpdate: vi.fn(),
      handleRtcRoomControlVoiceChannelJoin: vi.fn(),
      handleRtcRoomControlVoiceChannelLeave: vi.fn(),
      handleRtcRoomControlRefreshVoiceCredentials: vi.fn(),
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => session),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      addRtcRoomChannelSubscription: vi.fn(),
      addRtcRoomServerSubscription: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      ctx: {
        getWebSockets: () => [ws],
      },
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      toSharedRtcControlSessionSnapshot: vi.fn((session) => session),
      env: {} as any,
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      username: "alice-old",
      display_name: "Alice Old",
      avatar_url: "/old.png",
      avatar_display: "old",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 17, d: {} }),
    );

    expect(consumeRtcRoomProfileRefreshCooldown).toHaveBeenCalledWith(
      fakeRtcRoom.rtcRoomProfileRefreshCooldowns,
      "participant-1",
    );
    expect(fetchRtcRoomProfileRefreshData).toHaveBeenCalledWith({}, "user-1");
    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        name: "Alice Updated",
        username: "alice",
        display_name: "Alice Updated",
        avatar_url: "/avatar.png",
        avatar_display: "avatar",
      }),
    );
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "fetch-profile", "persist-session", "persist-sync"]);
  });

  it("intercepts control channel subscribe in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const postWriteEffects = {
      queuePresenceWrite: vi.fn(),
      broadcastPresenceStatus: vi.fn(),
      addChannelSubscription: vi.fn(() => {
        events.push("channel-subscribe");
      }),
      removeChannelSubscription: vi.fn(),
      addServerSubscription: vi.fn(),
      sendPresenceList: vi.fn(),
      queueVoiceChannelStates: vi.fn(),
      logInfo: vi.fn(),
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      addRtcRoomChannelSubscription: postWriteEffects.addChannelSubscription,
      removeRtcRoomChannelSubscription: postWriteEffects.removeChannelSubscription,
      addRtcRoomServerSubscription: postWriteEffects.addServerSubscription,
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      listRtcRoomOnlineClerkUserIds: vi.fn(() => ["user-1", "user-2"]),
      sendRtcRoomSharedVoiceChannelStatesPayload: vi.fn(async () => true),
      ctx: {
        waitUntil: vi.fn(),
      },
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      subscribed_channels: [] as string[],
      subscribed_servers: [] as string[],
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
      send: vi.fn(),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 27, d: { channel_id: "channel-1" } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        subscribed_channels: ["channel-1"],
      }),
    );
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(postWriteEffects.addChannelSubscription).toHaveBeenCalledWith("channel-1", ws);
    expect(fakeRtcRoom.listRtcRoomOnlineClerkUserIds).toHaveBeenCalledTimes(1);
    expect(postWriteEffects.sendPresenceList).not.toHaveBeenCalled();
    expect(postWriteEffects.queueVoiceChannelStates).not.toHaveBeenCalled();
    expect(fakeRtcRoom.sendRtcRoomSharedVoiceChannelStatesPayload).toHaveBeenCalledWith(
      ws,
      "user-1",
      {
        voice_states: {},
        voice_started_at: {},
        spatial_audio_states: {},
      },
      meetingRoom,
    );
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        op: 19,
        d: {
          event: "PRESENCE_LIST",
          data: { user_ids: ["user-1", "user-2"] },
        },
      }),
    );
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "persist-session", "materialize", "channel-subscribe", "persist-sync"]);
  });

  it("rebuilds duplicate control channel subscribes from authoritative RTC attachments without re-materializing MeetingRoom state", async () => {
    const events: string[] = [];
    const postWriteEffects = {
      queuePresenceWrite: vi.fn(),
      broadcastPresenceStatus: vi.fn(),
      addChannelSubscription: vi.fn(() => {
        events.push("channel-subscribe");
      }),
      removeChannelSubscription: vi.fn(),
      addServerSubscription: vi.fn(),
      sendPresenceList: vi.fn(),
      queueVoiceChannelStates: vi.fn(),
      logInfo: vi.fn(),
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      addRtcRoomChannelSubscription: postWriteEffects.addChannelSubscription,
      removeRtcRoomChannelSubscription: postWriteEffects.removeChannelSubscription,
      addRtcRoomServerSubscription: postWriteEffects.addServerSubscription,
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      listRtcRoomOnlineClerkUserIds: vi.fn(() => ["user-1", "user-2"]),
      sendRtcRoomSharedVoiceChannelStatesPayload: vi.fn(async () => true),
      ctx: {
        waitUntil: vi.fn(),
      },
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      subscribed_channels: ["channel-1"] as string[],
      subscribed_servers: [] as string[],
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: vi.fn(() => attachment),
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
      send: vi.fn(),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 27, d: { channel_id: "channel-1" } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).not.toHaveBeenCalled();
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(postWriteEffects.addChannelSubscription).toHaveBeenCalledWith("channel-1", ws);
    expect(fakeRtcRoom.listRtcRoomOnlineClerkUserIds).toHaveBeenCalledTimes(1);
    expect(postWriteEffects.sendPresenceList).not.toHaveBeenCalled();
    expect(postWriteEffects.queueVoiceChannelStates).not.toHaveBeenCalled();
    expect(fakeRtcRoom.sendRtcRoomSharedVoiceChannelStatesPayload).toHaveBeenCalledWith(
      ws,
      "user-1",
      {
        voice_states: {},
        voice_started_at: {},
        spatial_audio_states: {},
      },
      meetingRoom,
    );
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        op: 19,
        d: {
          event: "PRESENCE_LIST",
          data: { user_ids: ["user-1", "user-2"] },
        },
      }),
    );
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).not.toHaveBeenCalled();
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "channel-subscribe"]);
  });

  it("intercepts control channel unsubscribe in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const postWriteEffects = {
      queuePresenceWrite: vi.fn(),
      broadcastPresenceStatus: vi.fn(),
      addChannelSubscription: vi.fn(),
      removeChannelSubscription: vi.fn(() => {
        events.push("channel-unsubscribe");
      }),
      addServerSubscription: vi.fn(),
      sendPresenceList: vi.fn(),
      queueVoiceChannelStates: vi.fn(),
      logInfo: vi.fn(),
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      addRtcRoomChannelSubscription: postWriteEffects.addChannelSubscription,
      removeRtcRoomChannelSubscription: postWriteEffects.removeChannelSubscription,
      addRtcRoomServerSubscription: postWriteEffects.addServerSubscription,
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      name: "Alice",
      subscribed_channels: ["channel-1", "channel-2"],
      subscribed_servers: [] as string[],
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 28, d: { channel_id: "channel-1" } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        subscribed_channels: ["channel-2"],
      }),
    );
    expect(postWriteEffects.removeChannelSubscription).toHaveBeenCalledWith("channel-1", ws);
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "persist-session", "materialize", "channel-unsubscribe", "persist-sync"]);
  });

  it("rebuilds duplicate control channel unsubscribes from authoritative RTC attachments without re-materializing MeetingRoom state", async () => {
    const events: string[] = [];
    const postWriteEffects = {
      queuePresenceWrite: vi.fn(),
      broadcastPresenceStatus: vi.fn(),
      addChannelSubscription: vi.fn(),
      removeChannelSubscription: vi.fn(() => {
        events.push("channel-unsubscribe");
      }),
      addServerSubscription: vi.fn(),
      sendPresenceList: vi.fn(),
      queueVoiceChannelStates: vi.fn(),
      logInfo: vi.fn(),
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      addRtcRoomChannelSubscription: postWriteEffects.addChannelSubscription,
      removeRtcRoomChannelSubscription: postWriteEffects.removeChannelSubscription,
      addRtcRoomServerSubscription: postWriteEffects.addServerSubscription,
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      subscribed_channels: [] as string[],
      subscribed_servers: [] as string[],
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: vi.fn(() => attachment),
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 28, d: { channel_id: "channel-1" } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).not.toHaveBeenCalled();
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(postWriteEffects.removeChannelSubscription).toHaveBeenCalledWith("channel-1", ws);
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).not.toHaveBeenCalled();
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "channel-unsubscribe"]);
  });

  it("intercepts control server subscribe in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const first = vi.fn(async () => ({ ok: 1 }));
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const postWriteEffects = {
      queuePresenceWrite: vi.fn(),
      broadcastPresenceStatus: vi.fn(),
      addChannelSubscription: vi.fn(),
      removeChannelSubscription: vi.fn(),
      addServerSubscription: vi.fn(() => {
        events.push("server-subscribe");
      }),
      sendPresenceList: vi.fn(),
      queueVoiceChannelStates: vi.fn(),
      logInfo: vi.fn(),
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      addRtcRoomChannelSubscription: postWriteEffects.addChannelSubscription,
      removeRtcRoomChannelSubscription: postWriteEffects.removeChannelSubscription,
      addRtcRoomServerSubscription: postWriteEffects.addServerSubscription,
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      env: {
        DB: {
          prepare,
        },
      },
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      subscribed_channels: [] as string[],
      subscribed_servers: [] as string[],
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 35, d: { server_id: "server-1" } }),
    );

    expect(prepare).toHaveBeenCalledWith(
      "SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?",
    );
    expect(bind).toHaveBeenCalledWith("server-1", "user-1");
    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        subscribed_servers: ["server-1"],
      }),
    );
    expect(postWriteEffects.addServerSubscription).toHaveBeenCalledWith("server-1", ws);
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "persist-session", "materialize", "server-subscribe", "persist-sync"]);
  });

  it("keeps duplicate control server subscribes as a pure no-op in RtcRoom", async () => {
    const events: string[] = [];
    const prepare = vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ 1: 1 })),
      })),
    }));
    const meetingRoom = {
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      env: {
        DB: {
          prepare,
        },
      },
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      subscribed_channels: [] as string[],
      subscribed_servers: ["server-1"] as string[],
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 35, d: { server_id: "server-1" } }),
    );

    expect(prepare).not.toHaveBeenCalled();
    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).not.toHaveBeenCalled();
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).not.toHaveBeenCalled();
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot"]);
  });

  it("intercepts control call initiate in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const calleeWs = {
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-2",
        clerk_user_id: "user-2",
        name: "Bob",
      }),
    } as unknown as WebSocket;
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const persistSync = vi.fn(async () => {
      events.push("persist-sync");
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      readCurrentSharedRtcAuthorityState: vi.fn(async () => {
        events.push("before-authority");
        return {
          controlAuthoritySnapshot: {
            capturedAt: 123_000,
            sessionsByClerkUserId: new Map(),
            sessionsByParticipantId: new Map([
              [
                "participant-existing",
                {
                  id: "participant-existing",
                  clerk_user_id: "user-existing",
                  name: "Existing",
                  self_mute: false,
                  self_deaf: false,
                  self_stream: false,
                  self_stream_audio: false,
                  self_video: false,
                  suppress: false,
                  tracks: [],
                  voice_channel_id: "dm-1",
                  voice_joined_at: 123_000,
                },
              ],
            ]),
            liveSessionCount: 1,
            resumableSessionCount: 0,
          },
          voiceAuthoritySnapshot: { snapshot: "before" },
        };
      }),
      syncRtcRoomSharedCallStateMirror: vi.fn(async () => ({
        pendingCalls: new Map(),
        acceptedCalls: new Map(),
      })),
      persistRtcRoomSharedCallState: vi.fn(async () => {
        events.push("persist-call-state");
      }),
      broadcastRtcRoomIncomingPendingCall: vi.fn(() => {
        events.push("incoming");
      }),
      broadcastRtcRoomOutgoingPendingCallRinging: vi.fn(() => {
        events.push("ringing");
      }),
      env: {
        DB: {
          prepare: vi.fn(() => ({
            bind: vi.fn(() => ({
              first: vi.fn(async () => null),
            })),
          })),
        },
      },
      persistMeetingRoomPendingControlBatch: persistSync,
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: persistSync,
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      findRtcRoomControlSocketByClerkUserId: vi.fn(() => calleeWs),
    });
    (fakeRtcRoom as any).syncMeetingRoomControlAuthoritySnapshot = vi.fn(async () => {
      events.push("after-control");
      return { snapshot: "after" };
    });
    const applySharedTransition = vi.fn(() => {
      events.push("shared-transition");
      return true;
    });
    (fakeRtcRoom as any).applyRtcRoomSharedVoiceTransitionEffects = applySharedTransition;
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      voice_channel_id: "old-dm",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 36, d: { target_user_id: "user-2", channel_id: "dm-1" } }),
    );

    expect((fakeRtcRoom as any).readCurrentSharedRtcAuthorityState).toHaveBeenCalled();
    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        voice_channel_id: "dm-1",
        voice_joined_at: 123_000,
      }),
    );
    expect(fakeRtcRoom.broadcastRtcRoomIncomingPendingCall).toHaveBeenCalledWith(
      expect.objectContaining({
        callerId: "user-1",
        calleeId: "user-2",
        channelId: "dm-1",
      }),
    );
    expect(fakeRtcRoom.broadcastRtcRoomOutgoingPendingCallRinging).toHaveBeenCalledWith(
      expect.objectContaining({
        callerId: "user-1",
        calleeId: "user-2",
        channelId: "dm-1",
      }),
    );
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(applySharedTransition).toHaveBeenCalledWith(
      meetingRoom,
      expect.objectContaining({
        clerkUserId: "user-1",
        rebroadcastCurrentChannel: true,
      }),
    );
    expect(fakeRtcRoom.persistRtcRoomSharedCallState).toHaveBeenCalled();
    expect(persistSync).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual([
      "snapshot",
      "before-authority",
      "persist-session",
      "materialize",
      "incoming",
      "ringing",
      "after-control",
      "shared-transition",
      "persist-call-state",
      "persist-sync",
    ]);
  });

  it("intercepts control call accept in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const pending = {
      callId: "call-1",
      callerId: "user-1",
      calleeId: "user-2",
      channelId: "dm-1",
      voiceRoomId: "dm-call-user-1-user-2",
      expiresAt: 123_000,
      callerName: "Alice",
      calleeName: "Bob",
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      readCurrentSharedRtcAuthorityState: vi.fn(async () => {
        events.push("before-authority");
        return {
          controlAuthoritySnapshot: {
            capturedAt: 123_000,
            sessionsByClerkUserId: new Map(),
            sessionsByParticipantId: new Map([
              [
                "participant-existing",
                {
                  id: "participant-existing",
                  clerk_user_id: "user-existing",
                  name: "Existing",
                  self_mute: false,
                  self_deaf: false,
                  self_stream: false,
                  self_stream_audio: false,
                  self_video: false,
                  suppress: false,
                  tracks: [],
                  voice_channel_id: "dm-1",
                  voice_joined_at: 123_000,
                },
              ],
            ]),
            liveSessionCount: 1,
            resumableSessionCount: 0,
          },
          voiceAuthoritySnapshot: { snapshot: "before" },
        };
      }),
      syncRtcRoomSharedCallStateMirror: vi.fn(async () => ({
        pendingCalls: new Map([["user-2", pending]]),
        acceptedCalls: new Map(),
      })),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      broadcastRtcRoomPendingCallStop: vi.fn(() => {
        events.push("accepted");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistRtcRoomSharedCallState: vi.fn(async () => {
        events.push("persist-call-state");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    let attachment = {
      socket_role: "control",
      id: "participant-2",
      clerk_user_id: "user-2",
      name: "Bob",
      voice_channel_id: undefined,
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 37, d: { call_id: "call-1" } }),
    );

    expect((fakeRtcRoom as any).readCurrentSharedRtcAuthorityState).toHaveBeenCalled();
    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-2",
        voice_channel_id: "dm-1",
        voice_joined_at: 123_000,
      }),
    );
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(fakeRtcRoom.broadcastRtcRoomPendingCallStop).toHaveBeenCalledWith(pending, "accepted");
    expect(fakeRtcRoom.applyRtcRoomSharedVoiceTransitionEffects).toHaveBeenCalledWith(
      meetingRoom,
      expect.objectContaining({
        clerkUserId: "user-2",
        rebroadcastCurrentChannel: true,
      }),
    );
    expect(fakeRtcRoom.persistRtcRoomSharedCallState).toHaveBeenCalled();
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual([
      "snapshot",
      "before-authority",
      "persist-session",
      "materialize",
      "accepted",
      "after-control",
      "shared-transition",
      "persist-call-state",
      "persist-sync",
    ]);
  });

  it("intercepts control call decline in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const pending = {
      callId: "call-1",
      callerId: "user-1",
      calleeId: "user-2",
      channelId: "dm-1",
      voiceRoomId: "dm-call-user-1-user-2",
      expiresAt: 123_000,
      callerName: "Alice",
      calleeName: "Bob",
    };
    const meetingRoom = {
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      syncRtcRoomSharedCallStateMirror: vi.fn(async () => ({
        pendingCalls: new Map([["user-2", pending]]),
        acceptedCalls: new Map(),
      })),
      persistRtcRoomSharedCallState: vi.fn(async () => {
        events.push("persist-call-state");
      }),
      broadcastRtcRoomPendingCallStop: vi.fn(() => {
        events.push("declined");
      }),
      persistMeetingRoomPendingControlBatch: vi.fn(async () => {
        events.push("persist");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    const ws = {
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-2",
        clerk_user_id: "user-2",
        name: "Bob",
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 38, d: { call_id: "call-1" } }),
    );

    expect(fakeRtcRoom.broadcastRtcRoomPendingCallStop).toHaveBeenCalledWith(pending, "declined");
    expect(fakeRtcRoom.persistRtcRoomSharedCallState).toHaveBeenCalled();
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatch).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot", "declined", "persist-call-state", "persist"]);
  });

  it("intercepts control call end in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const pending = {
      callId: "call-1",
      callerId: "user-1",
      calleeId: "user-2",
      channelId: "dm-1",
      voiceRoomId: "dm-call-user-1-user-2",
      expiresAt: 123_000,
      callerName: "Alice",
      calleeName: "Bob",
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return session;
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return session;
        }),
      })),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      syncRtcRoomSharedCallStateMirror: vi.fn(async () => ({
        pendingCalls: new Map([["user-2", pending]]),
        acceptedCalls: new Map(),
      })),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistRtcRoomSharedCallState: vi.fn(async () => {
        events.push("persist-call-state");
      }),
      broadcastRtcRoomPendingCallStop: vi.fn(() => {
        events.push("cancelled");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      ctx: {
        getWebSockets: () => [ws],
      },
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      voice_channel_id: "dm-1",
      voice_joined_at: 123_000,
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 39, d: { call_id: "call-1" } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      }),
    );
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(fakeRtcRoom.applyRtcRoomSharedVoiceTransitionEffects).toHaveBeenCalledWith(
      meetingRoom,
      expect.objectContaining({
        clerkUserId: "user-1",
      }),
    );
    expect(fakeRtcRoom.broadcastRtcRoomPendingCallStop).toHaveBeenCalledWith(pending, "cancelled");
    expect(fakeRtcRoom.persistRtcRoomSharedCallState).toHaveBeenCalled();
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual([
      "snapshot",
      "before-voice",
      "persist-session",
      "materialize",
      "after-control",
      "shared-transition",
      "cancelled",
      "persist-call-state",
      "persist-sync",
    ]);
  });

  it("intercepts control voice-channel join in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const channelStartedAt = Date.now() - 10_000;
    const nextSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: true,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
    };
    const meetingRoom = {
      handleRtcRoomControlIdentify: vi.fn(),
      handleRtcRoomControlHeartbeat: vi.fn(),
      handleRtcRoomControlResume: vi.fn(),
      handleRtcRoomControlClientDisconnect: vi.fn(),
      handleRtcRoomControlVoiceStateUpdate: vi.fn(),
      handleRtcRoomControlProfileRefresh: vi.fn(),
      handleRtcRoomControlRefreshVoiceCredentials: vi.fn(),
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return { ...nextSession, ...session };
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return { ...nextSession, ...session };
        }),
      })),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      readCurrentSharedRtcAuthorityState: vi.fn(async () => {
        events.push("before-authority");
        return {
          controlAuthoritySnapshot: {
            capturedAt: channelStartedAt,
            sessionsByClerkUserId: new Map(),
            sessionsByParticipantId: new Map([
              [
                "participant-existing",
                {
                  id: "participant-existing",
                  clerk_user_id: "user-existing",
                  name: "Existing",
                  self_mute: false,
                  self_deaf: false,
                  self_stream: false,
                  self_stream_audio: false,
                  self_video: false,
                  suppress: false,
                  tracks: [],
                  voice_channel_id: "vc-1",
                  voice_joined_at: channelStartedAt,
                },
              ],
            ]),
            liveSessionCount: 1,
            resumableSessionCount: 0,
          },
          voiceAuthoritySnapshot: { snapshot: "before" },
        };
      }),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 33, d: { channel_id: "vc-1", self_mute: true } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        clerk_user_id: "user-1",
        name: "Alice",
        voice_channel_id: "vc-1",
        voice_joined_at: channelStartedAt,
        self_mute: true,
      }),
    );
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(fakeRtcRoom.applyRtcRoomSharedVoiceTransitionEffects).toHaveBeenCalledWith(
      meetingRoom,
      expect.objectContaining({
        clerkUserId: "user-1",
        rebroadcastCurrentChannel: true,
        allowImplicitCallAccept: true,
      }),
    );
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual([
      "snapshot",
      "before-authority",
      "persist-session",
      "materialize",
      "after-control",
      "shared-transition",
      "persist-sync",
    ]);
  });

  it("intercepts control voice-channel leave in RtcRoom before generic MeetingRoom delegation", async () => {
    const events: string[] = [];
    const nextSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const meetingRoom = {
      handleRtcRoomControlIdentify: vi.fn(),
      handleRtcRoomControlHeartbeat: vi.fn(),
      handleRtcRoomControlResume: vi.fn(),
      handleRtcRoomControlClientDisconnect: vi.fn(),
      handleRtcRoomControlVoiceStateUpdate: vi.fn(),
      handleRtcRoomControlProfileRefresh: vi.fn(),
      handleRtcRoomControlRefreshVoiceCredentials: vi.fn(),
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return { ...nextSession, ...session };
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return { ...nextSession, ...session };
        }),
      })),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 34, d: { channel_id: "vc-1" } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      }),
    );
    expect(meetingRoom.createRtcRoomControlSessionEffectsAdapter).not.toHaveBeenCalled();
    expect(fakeRtcRoom.applyRtcRoomSharedVoiceTransitionEffects).toHaveBeenCalledWith(
      meetingRoom,
      expect.objectContaining({
        clerkUserId: "user-1",
      }),
    );
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual([
      "snapshot",
      "before-voice",
      "persist-session",
      "materialize",
      "after-control",
      "shared-transition",
      "persist-sync",
    ]);
  });

  it("keeps same-channel control joins in-place while preserving the earliest voice_joined_at", async () => {
    const events: string[] = [];
    const candidateStartedAt = Date.now() - 20_000;
    const existingJoinedAt = candidateStartedAt + 77_000;
    const nextSession = {
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: true,
      self_deaf: false,
      self_stream: true,
      self_stream_audio: false,
      self_video: true,
      voice_channel_id: "vc-1",
      voice_joined_at: candidateStartedAt,
    };
    const meetingRoom = {
      mirrorRtcRoomControlSession: vi.fn((_ws, session) => {
        events.push("materialize");
        return { ...nextSession, ...session };
      }),
      createRtcRoomControlSessionEffectsAdapter: vi.fn(() => ({
        materializeControlSession: vi.fn((_ws, session) => {
          events.push("materialize");
          return { ...nextSession, ...session };
        }),
      })),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      readCurrentSharedRtcAuthorityState: vi.fn(async () => {
        events.push("before-authority");
        return {
          controlAuthoritySnapshot: null,
          voiceAuthoritySnapshot: { snapshot: "before" },
        };
      }),
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      applyRtcRoomSharedVoiceTransitionEffects: vi.fn(() => {
        events.push("shared-transition");
        return true;
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    let attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: true,
      self_stream_audio: false,
      self_video: true,
      voice_channel_id: "vc-1",
      voice_joined_at: existingJoinedAt,
    };
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: vi.fn((value) => {
        attachment = value;
      }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 33, d: { channel_id: "vc-1", self_mute: true, started_at: candidateStartedAt } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        voice_channel_id: "vc-1",
        voice_joined_at: candidateStartedAt,
        self_mute: true,
        self_video: true,
        self_stream: true,
      }),
    );
    expect(fakeRtcRoom.applyRtcRoomSharedVoiceTransitionEffects).toHaveBeenCalledWith(
      meetingRoom,
      expect.objectContaining({
        clerkUserId: "user-1",
        rebroadcastCurrentChannel: true,
        allowImplicitCallAccept: true,
      }),
    );
    expect(events).toEqual([
      "snapshot",
      "before-authority",
      "persist-session",
      "materialize",
      "after-control",
      "shared-transition",
      "persist-sync",
    ]);
  });

  it("ignores stale control voice-channel leaves after the session already switched channels", async () => {
    const events: string[] = [];
    const meetingRoom = {
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
      webSocketMessage: vi.fn(async () => {
        events.push("delegate");
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: () => meetingRoom,
      persistRtcRoomControlSessionAttachment: vi.fn(async () => {
        events.push("persist-session");
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
    });
    const ws = {
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-1",
        clerk_user_id: "user-1",
        name: "Alice",
        self_mute: false,
        self_deaf: false,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        voice_channel_id: "vc-2",
        voice_joined_at: 200_000,
      }),
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 34, d: { channel_id: "vc-1" } }),
    );

    expect(fakeRtcRoom.persistRtcRoomControlSessionAttachment).not.toHaveBeenCalled();
    expect(meetingRoom.webSocketMessage).not.toHaveBeenCalled();
    expect(events).toEqual(["snapshot"]);
  });

  it("routes media identify promotions through RtcRoom shared voice transition sync", async () => {
    const rtcRoomMedia = {
      webSocketMessage: vi.fn(async () => undefined),
    };
    const meetingRoom = {};
    const beforeVoiceSnapshot = { snapshot: "before" };
    const afterControlSnapshot = {
      capturedAt: 123_000,
      sessionsByClerkUserId: new Map(),
      sessionsByParticipantId: new Map(),
      liveSessionCount: 0,
      resumableSessionCount: 0,
    };
    const applyRtcRoomSharedVoiceTransitionEffects = vi.fn(() => true);
    const fakeRtcRoom = {
      getRtcRoomMedia: () => rtcRoomMedia,
      getMeetingRoom: () => meetingRoom,
      meetingRoomSharedProjectionBootstrapped: true,
      syncMeetingRoomMediaState: (RtcRoom.prototype as any).syncMeetingRoomMediaState,
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => beforeVoiceSnapshot),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => afterControlSnapshot),
      applyRtcRoomSharedVoiceTransitionEffects,
    };
    const ws = {
      deserializeAttachment: () => ({ socket_role: "media", clerk_user_id: "user-1" }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketMessage.call(
      fakeRtcRoom,
      ws,
      JSON.stringify({ op: 100, d: { participant_id: "participant-1" } }),
    );

    expect(rtcRoomMedia.webSocketMessage).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.readCurrentSharedRtcVoiceAuthoritySnapshot).toHaveBeenCalledTimes(1);
    expect(applyRtcRoomSharedVoiceTransitionEffects).toHaveBeenCalledWith(meetingRoom, {
      clerkUserId: "user-1",
      beforeVoiceSnapshot,
      afterControlSnapshot,
      rebroadcastCurrentChannel: true,
    });
  });

  it("does not bootstrap MeetingRoom shared projection from shared authority alone", () => {
    const events: string[] = [];
    const snapshot = {
      capturedAt: 123_456,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn((shared: boolean) => {
        events.push(`shared:${shared}`);
      }),
      setSharedRtcMediaAuthoritySnapshot: vi.fn((value) => {
        events.push(`media:${value === snapshot}`);
      }),
      clearRtcRoomSharedProjectionChannels: vi.fn(),
      queueRtcRoomSharedVoiceStateBroadcasts: vi.fn(),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      meetingRoom,
      meetingRoomSharedProjectionBootstrapped: false,
    });

    const result = (RtcRoom.prototype as any).syncMeetingRoomMediaAuthoritySnapshot.call(
      fakeRtcRoom,
      123_456,
      snapshot,
    );

    expect(result).toBe(snapshot);
    expect(meetingRoom.setSharedRtcAuthority).toHaveBeenCalledWith(true);
    expect(meetingRoom.setSharedRtcMediaAuthoritySnapshot).toHaveBeenCalledWith(snapshot);
    expect(fakeRtcRoom.meetingRoomSharedProjectionBootstrapped).toBe(false);
    expect(events).toEqual(["shared:true", "media:true"]);
  });

  it("bootstraps MeetingRoom shared projection only after both authoritative snapshots are injected", async () => {
    const events: string[] = [];
    const mediaSnapshot = {
      capturedAt: 123_456,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const controlSnapshot = {
      capturedAt: 123_456,
      sessionsByClerkUserId: new Map([
        [
          "user-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            name: "Alice",
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: false,
          },
        ],
      ]),
      sessionsByParticipantId: new Map([
        [
          "participant-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            name: "Alice",
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: false,
          },
        ],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 0,
    };
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn((shared: boolean) => {
        events.push(`shared:${shared}`);
      }),
      setSharedRtcMediaAuthoritySnapshot: vi.fn((value) => {
        events.push(`media:${value === mediaSnapshot}`);
      }),
      clearRtcRoomSharedProjectionChannels: vi.fn((value) => {
        events.push(`clear-stale:${Array.from(value).join(",")}`);
        return true;
      }),
      queueRtcRoomSharedVoiceStateBroadcasts: vi.fn((value) => {
        events.push(`queue:${Array.from(value).join(",")}`);
        return true;
      }),
    };
    const applyRtcRoomSharedVoiceTransitionEffects = vi.fn(() => {
      events.push("shared-transition");
      return true;
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        waitUntil: vi.fn(() => {
          events.push("queue");
        }),
        getWebSockets: () => [],
      },
      meetingRoom,
      meetingRoomSharedProjectionBootstrapped: false,
      sharedRtcProjectedChannelIds: new Set(["vc-stale"]),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => {
        events.push("readMedia");
        return mediaSnapshot;
      }),
      tryReadSharedRtcControlAuthoritySnapshot: vi.fn(async () => {
        events.push("readControl");
        return controlSnapshot;
      }),
      syncMeetingRoomMediaAuthoritySnapshot: (RtcRoom.prototype as any).syncMeetingRoomMediaAuthoritySnapshot,
      syncMeetingRoomControlAuthoritySnapshot: (RtcRoom.prototype as any).syncMeetingRoomControlAuthoritySnapshot,
      applyRtcRoomSharedVoiceTransitionEffects,
      queueRtcRoomSharedVoiceStateBroadcasts:
        (RtcRoom.prototype as any).queueRtcRoomSharedVoiceStateBroadcasts,
      broadcastRtcRoomSharedVoiceStateMessage:
        (RtcRoom.prototype as any).broadcastRtcRoomSharedVoiceStateMessage,
    });

    const result = await (RtcRoom.prototype as any).syncMeetingRoomMediaState.call(fakeRtcRoom, "user-1");

    expect(result).toBe(true);
    expect(fakeRtcRoom.tryReadSharedRtcMediaAuthoritySnapshot).toHaveBeenCalledTimes(2);
    expect(fakeRtcRoom.tryReadSharedRtcControlAuthoritySnapshot).toHaveBeenCalledTimes(1);
    expect(meetingRoom.setSharedRtcMediaAuthoritySnapshot).toHaveBeenCalledWith(mediaSnapshot);
    expect(fakeRtcRoom.latestSharedRtcControlAuthoritySnapshot).toBe(controlSnapshot);
    expect(applyRtcRoomSharedVoiceTransitionEffects).not.toHaveBeenCalled();
    expect(fakeRtcRoom.meetingRoomSharedProjectionBootstrapped).toBe(true);
    expect(fakeRtcRoom.sharedRtcProjectedChannelIds).toEqual(new Set());
    expect(events).toEqual([
      "readMedia",
      "shared:true",
      "media:true",
      "shared:true",
      "readControl",
      "readMedia",
      "clear-stale:vc-stale",
      "queue",
    ]);
  });

  it("injects the authoritative shared voice snapshot during shared authority control sync", async () => {
    const controlSnapshot = {
      capturedAt: 123_000,
      sessionsByClerkUserId: new Map([
        [
          "user-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            voice_joined_at: 120_000,
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
            self_video: true,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
          },
        ],
      ]),
      sessionsByParticipantId: new Map([
        [
          "participant-1",
          {
            id: "participant-1",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            voice_joined_at: 120_000,
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
            self_video: true,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
          },
        ],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 0,
    };
    const mediaSnapshot = {
      capturedAt: 123_456,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn(),
      clearRtcRoomSharedProjectionChannels: vi.fn(() => false),
      queueRtcRoomSharedVoiceStateBroadcasts: vi.fn(() => false),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      meetingRoom,
      tryReadSharedRtcControlAuthoritySnapshot: vi.fn(async () => controlSnapshot),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => mediaSnapshot),
      buildSharedRtcVoiceAuthoritySnapshot: (RtcRoom.prototype as any).buildSharedRtcVoiceAuthoritySnapshot,
      syncMeetingRoomControlAuthoritySnapshot: (RtcRoom.prototype as any).syncMeetingRoomControlAuthoritySnapshot,
      bootstrapMeetingRoomSharedProjectionIfReady: vi.fn(() => false),
    });

    const result = await (RtcRoom.prototype as any).syncMeetingRoomControlAuthoritySnapshot.call(fakeRtcRoom);

    expect(result).toBe(controlSnapshot);
    expect(fakeRtcRoom.latestSharedRtcControlAuthoritySnapshot).toBe(controlSnapshot);

    const voiceSnapshot = fakeRtcRoom.latestSharedRtcVoiceAuthoritySnapshot;
    expect(voiceSnapshot?.capturedAt).toBe(123_456);
    expect(voiceSnapshot?.channelIdByClerkUserId.get("user-1")).toBe("vc-1");
    expect(voiceSnapshot?.channels.get("vc-1")).toEqual({
      startedAt: 120_000,
      members: [
        expect.objectContaining({
          clerk_user_id: "user-1",
          name: "Alice",
          connected: true,
          connection_state: "connected",
          self_mute: false,
          self_video: true,
        }),
      ],
    });
  });

  it("injects the authoritative shared voice snapshot before RtcRoom shared voice reconciliation", async () => {
    const events: string[] = [];
    const mediaSnapshot = {
      capturedAt: 123_456,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn((shared: boolean) => {
        events.push(`shared:${shared}`);
      }),
      setSharedRtcMediaAuthoritySnapshot: vi.fn((value) => {
        events.push(`media:${value === mediaSnapshot}`);
      }),
    };
    const beforeVoiceSnapshot = { snapshot: "before" };
    const applyRtcRoomSharedVoiceTransitionEffects = vi.fn(() => {
      events.push("shared-transition");
      return true;
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      meetingRoom,
      meetingRoomSharedProjectionBootstrapped: true,
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return beforeVoiceSnapshot;
      }),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => mediaSnapshot),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("control");
        return { capturedAt: 123_456 };
      }),
      syncMeetingRoomMediaAuthoritySnapshot: (RtcRoom.prototype as any).syncMeetingRoomMediaAuthoritySnapshot,
      applyRtcRoomSharedVoiceTransitionEffects,
    });

    const result = await (RtcRoom.prototype as any).syncMeetingRoomMediaState.call(fakeRtcRoom, "user-1");

    expect(result).toBe(true);
    expect(meetingRoom.setSharedRtcMediaAuthoritySnapshot).toHaveBeenCalledWith(mediaSnapshot);
    expect(fakeRtcRoom.syncMeetingRoomControlAuthoritySnapshot).toHaveBeenCalledTimes(1);
    expect(applyRtcRoomSharedVoiceTransitionEffects).toHaveBeenCalledWith(meetingRoom, {
      clerkUserId: "user-1",
      beforeVoiceSnapshot,
      afterControlSnapshot: { capturedAt: 123_456 },
      rebroadcastCurrentChannel: true,
    });
    expect(events.indexOf("media:true")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("control")).toBeGreaterThan(events.indexOf("media:true"));
    expect(events.indexOf("shared-transition")).toBeGreaterThan(events.indexOf("control"));
  });

  it("does not sync MeetingRoom media state when control authority is unavailable", async () => {
    const events: string[] = [];
    const mediaSnapshot = {
      capturedAt: 123_456,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn((shared: boolean) => {
        events.push(`shared:${shared}`);
      }),
      setSharedRtcMediaAuthoritySnapshot: vi.fn((value) => {
        events.push(`media:${value === mediaSnapshot}`);
      }),
      clearRtcRoomSharedProjectionChannels: vi.fn((value) => {
        events.push(`clear-stale:${Array.from(value).join(",")}`);
        return true;
      }),
      queueRtcRoomSharedVoiceStateBroadcasts: vi.fn((value) => {
        events.push(`queue:${Array.from(value).join(",")}`);
        return true;
      }),
    };
    const applyRtcRoomSharedVoiceTransitionEffects = vi.fn(() => {
      events.push("shared-transition");
      return true;
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      meetingRoom,
      meetingRoomSharedProjectionBootstrapped: false,
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => {
        events.push("readMedia");
        return mediaSnapshot;
      }),
      tryReadSharedRtcControlAuthoritySnapshot: vi.fn(async () => {
        events.push("readControl");
        return null;
      }),
      syncMeetingRoomMediaAuthoritySnapshot: (RtcRoom.prototype as any).syncMeetingRoomMediaAuthoritySnapshot,
      syncMeetingRoomControlAuthoritySnapshot: (RtcRoom.prototype as any).syncMeetingRoomControlAuthoritySnapshot,
      applyRtcRoomSharedVoiceTransitionEffects,
    });

    const result = await (RtcRoom.prototype as any).syncMeetingRoomMediaState.call(fakeRtcRoom, "user-1");

    expect(result).toBe(false);
    expect(fakeRtcRoom.tryReadSharedRtcControlAuthoritySnapshot).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.latestSharedRtcControlAuthoritySnapshot).toBeNull();
    expect(applyRtcRoomSharedVoiceTransitionEffects).not.toHaveBeenCalled();
    expect(fakeRtcRoom.meetingRoomSharedProjectionBootstrapped).toBe(false);
    expect(events).toEqual([
      "readMedia",
      "shared:true",
      "media:true",
      "shared:true",
      "readControl",
      "readMedia",
    ]);
  });

  it("reprojects shared RTC voice membership from media disconnects instead of stale control-only state", async () => {
    const rtcRoomMedia = {
      webSocketClose: vi.fn(async () => undefined),
    };
    const meetingRoom = {};
    const beforeVoiceSnapshot = { snapshot: "before" };
    const afterControlSnapshot = {
      capturedAt: 123_000,
      sessionsByClerkUserId: new Map(),
      sessionsByParticipantId: new Map(),
      liveSessionCount: 0,
      resumableSessionCount: 0,
    };
    const applyRtcRoomSharedVoiceTransitionEffects = vi.fn(() => true);
    const fakeRtcRoom = {
      getRtcRoomMedia: () => rtcRoomMedia,
      getMeetingRoom: () => meetingRoom,
      meetingRoomSharedProjectionBootstrapped: true,
      syncMeetingRoomMediaState: (RtcRoom.prototype as any).syncMeetingRoomMediaState,
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => beforeVoiceSnapshot),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => afterControlSnapshot),
      applyRtcRoomSharedVoiceTransitionEffects,
    };
    const ws = {
      deserializeAttachment: () => ({ socket_role: "media", clerk_user_id: "user-1" }),
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketClose.call(fakeRtcRoom, ws, 1000, "Left voice");

    expect(rtcRoomMedia.webSocketClose).toHaveBeenCalledWith(ws, 1000, "Left voice");
    expect(applyRtcRoomSharedVoiceTransitionEffects).toHaveBeenCalledWith(meetingRoom, {
      clerkUserId: "user-1",
      beforeVoiceSnapshot,
      afterControlSnapshot,
      rebroadcastCurrentChannel: true,
    });
  });

  it("lets RtcRoom decide stale shared projection cleanup channels instead of delegating that decision to MeetingRoom", () => {
    const queueRtcRoomSharedVoiceStateBroadcasts = vi.fn(() => true);
    const clearRtcRoomSharedProjectionChannels = vi.fn(() => true);
    const meetingRoom = {
      clearRtcRoomSharedProjectionChannels,
      queueRtcRoomSharedVoiceStateBroadcasts,
    };
    const mediaSnapshot = {
      capturedAt: 123_456,
      liveParticipantIds: new Set(["participant-2"]),
      liveClerkUserIds: new Set(["user-2"]),
      activeClerkUserIds: new Set(["user-2"]),
      presenceByClerkUserId: new Map([
        ["user-2", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const beforeVoiceSnapshot = {
      capturedAt: 123_000,
      channels: new Map([
        [
          "vc-1",
          {
            startedAt: 123_000,
            members: [{ clerk_user_id: "user-1" }],
          },
        ],
      ]),
      channelIdByClerkUserId: new Map([["user-1", "vc-1"]]),
    };
    const afterControlSnapshot = {
      capturedAt: 123_456,
      sessionsByClerkUserId: new Map([
        [
          "user-2",
          {
            id: "participant-2",
            clerk_user_id: "user-2",
            voice_channel_id: "vc-2",
            voice_joined_at: 123_400,
            name: "Bob",
            username: "bob",
            display_name: "Bob",
            avatar_url: null,
            avatar_display: null,
            stream_preview_url: null,
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: true,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
          },
        ],
      ]),
      sessionsByParticipantId: new Map([
        [
          "participant-2",
          {
            id: "participant-2",
            clerk_user_id: "user-2",
            voice_channel_id: "vc-2",
            voice_joined_at: 123_400,
            name: "Bob",
            username: "bob",
            display_name: "Bob",
            avatar_url: null,
            avatar_display: null,
            stream_preview_url: null,
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: true,
            spatial_audio_enabled: false,
            spatial_audio_high_fidelity: false,
          },
        ],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 0,
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => mediaSnapshot),
      sharedRtcPendingCalls: null,
      sharedRtcAcceptedCalls: null,
      ctx: {
        waitUntil: vi.fn(),
        getWebSockets: () => [],
      },
      broadcastRtcRoomSharedVoiceStateMessage:
        (RtcRoom.prototype as any).broadcastRtcRoomSharedVoiceStateMessage,
      queueRtcRoomSharedVoiceStateBroadcasts:
        (RtcRoom.prototype as any).queueRtcRoomSharedVoiceStateBroadcasts,
    });

    const changed = (RtcRoom.prototype as any).applyRtcRoomSharedVoiceTransitionEffects.call(
      fakeRtcRoom,
      meetingRoom,
      {
        clerkUserId: "user-1",
        beforeVoiceSnapshot,
        afterControlSnapshot,
      },
    );

    expect(changed).toBe(true);
    expect(clearRtcRoomSharedProjectionChannels).toHaveBeenCalledWith(new Set(["vc-1"]));
    expect(fakeRtcRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("reconciles shared projection channels from RtcRoom-owned bookkeeping instead of querying MeetingRoom", async () => {
    const authoritativeVoiceSnapshot = {
      capturedAt: 200_000,
      channels: new Map([
        ["vc-2", { startedAt: 200_000, members: [] }],
      ]),
      channelIdByClerkUserId: new Map<string, string>(),
    };
    const meetingRoom = {
      clearRtcRoomSharedProjectionChannels: vi.fn(() => true),
    };
    const applyRtcRoomSharedProjectionChannelUpdates = vi.fn(() => true);
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      sharedRtcProjectedChannelIds: new Set(["vc-stale"]),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => authoritativeVoiceSnapshot),
      setRtcRoomSharedVoiceAuthoritySnapshot:
        (RtcRoom.prototype as any).setRtcRoomSharedVoiceAuthoritySnapshot,
      applyRtcRoomSharedProjectionChannelUpdates,
    });

    const changed = await (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection.call(
      fakeRtcRoom,
      meetingRoom,
      [],
    );

    expect(changed).toBe(true);
    expect(applyRtcRoomSharedProjectionChannelUpdates).toHaveBeenCalledWith(
      meetingRoom,
      new Set(["vc-stale", "vc-2"]),
      authoritativeVoiceSnapshot,
    );
  });

  it("routes control socket close through the explicit RtcRoom lifecycle wrapper", async () => {
    const events: string[] = [];
    const meetingRoom = {
      cleanupRtcRoomChannelSubscriptions: vi.fn(),
      cleanupRtcRoomServerSubscriptions: vi.fn(),
      deleteRtcRoomLiveControlSession: vi.fn(),
      clearRtcRoomLocalResumableControlState: vi.fn(),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [],
      },
      getMeetingRoom: () => meetingRoom,
      rtcRoomProfileRefreshCooldowns: new Map<string, number>(),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      syncRtcRoomSharedCallStateMirror: vi.fn(async () => {
        events.push("sync-call-state");
        return { pendingCalls: new Map(), acceptedCalls: new Map() };
      }),
      persistRtcRoomControlDisconnectState: vi.fn(async () => {
        events.push("persist-disconnect");
      }),
      persistRtcRoomSharedCallState: vi.fn(async () => {
        events.push("persist-call-state");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      toSharedRtcControlSessionSnapshot: vi.fn((session) => session),
    });
    (fakeRtcRoom as any).applyRtcRoomSharedVoiceTransitionEffects = vi.fn(() => {
      events.push("shared-transition");
      return true;
    });
    const attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
    };
    const ws = {
      deserializeAttachment: () => attachment,
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketClose.call(fakeRtcRoom, ws, 1000, "done");

    expect(fakeRtcRoom.persistRtcRoomControlDisconnectState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        voice_channel_id: "vc-1",
        voice_joined_at: 123_000,
      }),
      false,
      expect.any(Number),
    );
    expect(fakeRtcRoom.syncRtcRoomSharedCallStateMirror).toHaveBeenCalledWith(meetingRoom);
    expect(fakeRtcRoom.persistRtcRoomSharedCallState).not.toHaveBeenCalled();
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(events).toEqual([
      "snapshot",
      "before-voice",
      "sync-call-state",
      "persist-disconnect",
      "after-control",
      "shared-transition",
      "persist-sync",
    ]);
  });

  it("routes control socket error through the explicit RtcRoom lifecycle wrapper", async () => {
    const events: string[] = [];
    const meetingRoom = {
      cleanupRtcRoomChannelSubscriptions: vi.fn(),
      cleanupRtcRoomServerSubscriptions: vi.fn(),
      deleteRtcRoomLiveControlSession: vi.fn(),
      clearRtcRoomLocalResumableControlState: vi.fn(),
      setSharedRtcControlAuthoritySnapshot: vi.fn(),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [],
      },
      getMeetingRoom: () => meetingRoom,
      rtcRoomProfileRefreshCooldowns: new Map<string, number>(),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("before-voice");
        return { snapshot: "before" };
      }),
      syncRtcRoomSharedCallStateMirror: vi.fn(async () => {
        events.push("sync-call-state");
        return { pendingCalls: new Map(), acceptedCalls: new Map() };
      }),
      persistRtcRoomControlDisconnectState: vi.fn(async () => {
        events.push("persist-disconnect");
      }),
      persistRtcRoomSharedCallState: vi.fn(async () => {
        events.push("persist-call-state");
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("after-control");
        return { snapshot: "after" };
      }),
      persistMeetingRoomPendingControlBatchAndSyncSnapshot: vi.fn(async () => {
        events.push("persist-sync");
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("snapshot");
      }),
      toSharedRtcControlSessionSnapshot: vi.fn((session) => session),
    });
    (fakeRtcRoom as any).applyRtcRoomSharedVoiceTransitionEffects = vi.fn(() => {
      events.push("shared-transition");
      return true;
    });
    const attachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
    };
    const ws = {
      deserializeAttachment: () => attachment,
    } as unknown as WebSocket;

    await (RtcRoom.prototype as any).webSocketError.call(fakeRtcRoom, ws);

    expect(fakeRtcRoom.persistRtcRoomControlDisconnectState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        voice_channel_id: "vc-1",
        voice_joined_at: 123_000,
      }),
      false,
      expect.any(Number),
    );
    expect(fakeRtcRoom.syncRtcRoomSharedCallStateMirror).toHaveBeenCalledWith(meetingRoom);
    expect(fakeRtcRoom.persistRtcRoomSharedCallState).not.toHaveBeenCalled();
    expect(fakeRtcRoom.persistMeetingRoomPendingControlBatchAndSyncSnapshot).toHaveBeenCalledWith(meetingRoom);
    expect(events).toEqual([
      "snapshot",
      "before-voice",
      "sync-call-state",
      "persist-disconnect",
      "after-control",
      "shared-transition",
      "persist-sync",
    ]);
  });

  it("keeps RTC_ROOM exact-session checks media-authoritative for stale-tab denial from unified room state", async () => {
    const getRtcRoomMedia = vi.fn(() => ({}));
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      storedRoomSlug: null,
      ctx: {
        storage: {
          get: vi.fn(async (key: string) => {
            if (key === "roomSlug") return "rtc-room-channel-1";
            return undefined;
          }),
          sql: {
            exec: vi.fn(() => [
              { id: "participant-2" },
            ]),
          },
        },
        getWebSockets: () => [
          {
            deserializeAttachment: () => ({
              socket_role: "media",
              participant_id: "participant-2",
            }),
          } as unknown as WebSocket,
        ],
      },
      getRtcRoomMedia,
    });

    const result = await (RtcRoom.prototype as any).fetch.call(
      fakeRtcRoom,
      new Request("https://internal/voice-session-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: "user-1",
          channel_id: "channel-1",
          session_id: "participant-1",
          require_exact_session: true,
        }),
      }),
    );

    expect(result).toBeInstanceOf(Response);
    await expect(result.json()).resolves.toEqual({
      allowed: false,
      connected: true,
      exact_session_matched: false,
    });
    expect(getRtcRoomMedia).not.toHaveBeenCalled();
  });

  it("bootstraps the shared media schema once before answering RTC_ROOM exact-session checks", async () => {
    let schemaReady = false;
    const getRtcRoomMedia = vi.fn(() => {
      schemaReady = true;
      return {};
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      storedRoomSlug: null,
      ctx: {
        storage: {
          get: vi.fn(async (key: string) => {
            if (key === "roomSlug") return "rtc-room-channel-1";
            return undefined;
          }),
          sql: {
            exec: vi.fn(() => {
              if (!schemaReady) {
                throw new Error("no such table: participants");
              }
              return [{ id: "participant-1" }];
            }),
          },
        },
        getWebSockets: () => [
          {
            deserializeAttachment: () => ({
              socket_role: "media",
              participant_id: "participant-1",
            }),
          } as unknown as WebSocket,
        ],
      },
      getRtcRoomMedia,
    });

    const result = await (RtcRoom.prototype as any).fetch.call(
      fakeRtcRoom,
      new Request("https://internal/voice-session-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: "user-1",
          channel_id: "channel-1",
          session_id: "participant-1",
          require_exact_session: true,
        }),
      }),
    );

    expect(result).toBeInstanceOf(Response);
    await expect(result.json()).resolves.toEqual({
      allowed: true,
      connected: true,
      exact_session_matched: true,
    });
    expect(getRtcRoomMedia).toHaveBeenCalledTimes(1);
  });

  it("accepts room-scoped control /ws directly and seeds MeetingRoom room state", async () => {
    const events: string[] = [];
    const mediaSnapshot = {
      capturedAt: 123_456,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const originalWebSocketPair = (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
    const originalResponse = globalThis.Response;
    const client = { side: "client" } as unknown as WebSocket;
    const server = {
      serializeAttachment: vi.fn((value: unknown) => {
        events.push(`attach:${JSON.stringify(value)}`);
      }),
      send: vi.fn((value: string) => {
        events.push(`send:${value}`);
      }),
    } as unknown as WebSocket;
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair = function MockWebSocketPair() {
      return {
        0: client,
        1: server,
      };
    };
    (globalThis as { Response?: unknown }).Response = class MockUpgradeResponse {
      status: number;
      webSocket: WebSocket | null;

      constructor(_body: BodyInit | null | undefined, init?: ResponseInit & { webSocket?: WebSocket }) {
        this.status = init?.status ?? 200;
        this.webSocket = init?.webSocket ?? null;
      }
    } as unknown as typeof Response;

    const meetingRoom = {
      setSharedRtcAuthority: vi.fn((shared: boolean) => {
        events.push(`shared:${shared}`);
      }),
      setSharedRtcMediaAuthoritySnapshot: vi.fn((value) => {
        events.push(`media:${value === mediaSnapshot}`);
      }),
      clearRtcRoomSharedProjectionChannels: vi.fn(),
      queueRtcRoomSharedVoiceStateBroadcasts: vi.fn(),
      setRoomSlugFromRtcRoom: vi.fn((roomSlug: string) => {
        events.push(`room:${roomSlug}`);
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      storedRoomSlug: null,
      ctx: {
        acceptWebSocket: vi.fn(() => {
          events.push("accept");
        }),
        storage: {
          put: vi.fn((key: string, value: string) => {
            events.push(`put:${key}:${value}`);
            return Promise.resolve();
          }),
        },
      },
      getMeetingRoom: vi.fn(() => {
        meetingRoom.setSharedRtcAuthority(true);
        return meetingRoom;
      }),
      getRtcRoomMedia: vi.fn(),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => {
        events.push("readMedia");
        return mediaSnapshot;
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(function (this: unknown, ...args: unknown[]) {
        return (RtcRoom.prototype as any).syncMeetingRoomMediaAuthoritySnapshot.apply(this, args);
      }),
    });

    try {
      const result = await (RtcRoom.prototype as any).fetch.call(
        fakeRtcRoom,
        new Request("https://internal/api/channels/room-123/ws?v=7"),
      );

      expect(result.status).toBe(101);
      expect(fakeRtcRoom.storedRoomSlug).toBe("room-123");
      expect(fakeRtcRoom.syncMeetingRoomMediaAuthoritySnapshot).toHaveBeenCalledTimes(1);
      expect(meetingRoom.setSharedRtcMediaAuthoritySnapshot).toHaveBeenCalledWith(mediaSnapshot);
      expect(meetingRoom.setRoomSlugFromRtcRoom).toHaveBeenCalledWith("room-123");
      expect(fakeRtcRoom.ctx.storage.put).toHaveBeenCalledWith("roomSlug", "room-123");
      expect(fakeRtcRoom.ctx.acceptWebSocket).toHaveBeenCalledWith(server);
      expect(server.serializeAttachment).toHaveBeenCalledWith({ socket_role: "control" });
      expect(server.send).toHaveBeenCalledWith(JSON.stringify({
        op: 8,
        d: { heartbeat_interval: 15_000, gateway_version: 7 },
      }));
      expect(fakeRtcRoom.getRtcRoomMedia).not.toHaveBeenCalled();
      expect(events).toEqual([
        "readMedia",
        "shared:true",
        "media:true",
        "put:roomSlug:room-123",
        "shared:true",
        "room:room-123",
        "accept",
        'attach:{"socket_role":"control"}',
        'send:{"op":8,"d":{"heartbeat_interval":15000,"gateway_version":7}}',
      ]);
    } finally {
      if (typeof originalWebSocketPair === "undefined") {
        delete (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
      } else {
        (globalThis as { WebSocketPair?: unknown }).WebSocketPair = originalWebSocketPair;
      }
      (globalThis as { Response?: typeof Response }).Response = originalResponse;
    }
  });

  it("accepts room-scoped media /voice directly and seeds RTC_ROOM media state", async () => {
    const events: string[] = [];
    const originalWebSocketPair = (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
    const originalResponse = globalThis.Response;
    const client = { side: "client" } as unknown as WebSocket;
    const server = {
      serializeAttachment: vi.fn((value: unknown) => {
        events.push(`attach:${JSON.stringify(value)}`);
      }),
      send: vi.fn((value: string) => {
        events.push(`send:${value}`);
      }),
    } as unknown as WebSocket;
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair = function MockWebSocketPair() {
      return {
        0: client,
        1: server,
      };
    };
    (globalThis as { Response?: unknown }).Response = class MockUpgradeResponse {
      status: number;
      webSocket: WebSocket | null;

      constructor(_body: BodyInit | null | undefined, init?: ResponseInit & { webSocket?: WebSocket }) {
        this.status = init?.status ?? 200;
        this.webSocket = init?.webSocket ?? null;
      }
    } as unknown as typeof Response;

    const rtcRoomMedia = {
      setRoomSlugFromRtcRoom: vi.fn((roomSlug: string) => {
        events.push(`room:${roomSlug}`);
      }),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      storedRoomSlug: null,
      ctx: {
        acceptWebSocket: vi.fn(() => {
          events.push("accept");
        }),
        storage: {
          put: vi.fn((key: string, value: string) => {
            events.push(`put:${key}:${value}`);
            return Promise.resolve();
          }),
        },
      },
      getMeetingRoom: vi.fn(),
      getRtcRoomMedia: vi.fn(() => rtcRoomMedia),
    });

    try {
      const result = await (RtcRoom.prototype as any).fetch.call(
        fakeRtcRoom,
        new Request("https://internal/api/channels/room-123/voice?v=7"),
      );

      expect(result.status).toBe(101);
      expect(fakeRtcRoom.storedRoomSlug).toBe("room-123");
      expect(rtcRoomMedia.setRoomSlugFromRtcRoom).toHaveBeenCalledWith("room-123");
      expect(fakeRtcRoom.ctx.storage.put).toHaveBeenCalledWith("roomSlug", "room-123");
      expect(fakeRtcRoom.ctx.acceptWebSocket).toHaveBeenCalledWith(server);
      expect(server.serializeAttachment).toHaveBeenCalledWith({ socket_role: "media" });
      expect(server.send).toHaveBeenCalledWith(JSON.stringify({
        op: 8,
        d: { heartbeat_interval: 15_000, gateway_version: 7 },
      }));
      expect(fakeRtcRoom.getMeetingRoom).not.toHaveBeenCalled();
      expect(events).toEqual([
        "put:roomSlug:room-123",
        "room:room-123",
        "accept",
        'attach:{"socket_role":"media"}',
        'send:{"op":8,"d":{"heartbeat_interval":15000,"gateway_version":7}}',
      ]);
    } finally {
      if (typeof originalWebSocketPair === "undefined") {
        delete (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
      } else {
        (globalThis as { WebSocketPair?: unknown }).WebSocketPair = originalWebSocketPair;
      }
      (globalThis as { Response?: typeof Response }).Response = originalResponse;
    }
  });

  it("rejects arbitrary non-canonical /ws requests instead of delegating them back to MeetingRoom", async () => {
    const meetingRoom = {
      fetch: vi.fn(async () => new Response("ok")),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: vi.fn(() => meetingRoom),
      getRtcRoomMedia: vi.fn(),
    });

    const result = await (RtcRoom.prototype as any).fetch.call(
      fakeRtcRoom,
      new Request("https://internal/control/ws"),
    );

    expect(result.status).toBe(404);
    expect(meetingRoom.fetch).not.toHaveBeenCalled();
    expect(fakeRtcRoom.getMeetingRoom).not.toHaveBeenCalled();
    expect(fakeRtcRoom.getRtcRoomMedia).not.toHaveBeenCalled();
  });

  it("rejects the old /api/room/:id/voice compatibility alias inside RtcRoom", async () => {
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      getMeetingRoom: vi.fn(),
      getRtcRoomMedia: vi.fn(),
    });

    const result = await (RtcRoom.prototype as any).fetch.call(
      fakeRtcRoom,
      new Request("https://internal/api/room/room-123/voice?v=7"),
    );

    expect(result.status).toBe(404);
    expect(fakeRtcRoom.getMeetingRoom).not.toHaveBeenCalled();
    expect(fakeRtcRoom.getRtcRoomMedia).not.toHaveBeenCalled();
  });

  it("does not silently downgrade RTC_ROOM exact-session checks when media authority remains unavailable", async () => {
    const getRtcRoomMedia = vi.fn(() => ({}));
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      storedRoomSlug: null,
      ctx: {
        storage: {
          get: vi.fn(async (key: string) => {
            if (key === "roomSlug") return "rtc-room-channel-1";
            return undefined;
          }),
          sql: {
            exec: vi.fn(() => {
              throw new Error("no such table: participants");
            }),
          },
        },
        getWebSockets: () => [],
      },
      getRtcRoomMedia,
    });

    const result = await (RtcRoom.prototype as any).fetch.call(
      fakeRtcRoom,
      new Request("https://internal/voice-session-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: "user-1",
          channel_id: "channel-1",
          session_id: "participant-1",
          require_exact_session: true,
        }),
      }),
    );

    expect(result.status).toBe(503);
    expect(getRtcRoomMedia).toHaveBeenCalledTimes(1);
  });

  it("prunes zombie control sockets from authoritative RTC_ROOM attachments", async () => {
    const zombieWs = {
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-zombie",
        clerk_user_id: "user-zombie",
        name: "Zombie",
        last_heartbeat: 1_000,
      }),
    } as unknown as WebSocket;
    const freshWs = {
      deserializeAttachment: () => ({
        socket_role: "control",
        id: "participant-fresh",
        clerk_user_id: "user-fresh",
        name: "Fresh",
        last_heartbeat: 99_000,
      }),
    } as unknown as WebSocket;
    const mediaWs = {
      deserializeAttachment: () => ({
        socket_role: "media",
        participant_id: "media-1",
      }),
    } as unknown as WebSocket;
    const meetingRoom = {};
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [zombieWs, freshWs, mediaWs],
      },
      handleRtcRoomControlDisconnectLifecycle: vi.fn(async () => true),
    });

    const pruned = await (RtcRoom.prototype as any).pruneRtcRoomZombieControlSockets.call(
      fakeRtcRoom,
      meetingRoom,
      100_000,
    );

    expect(pruned).toBe(true);
    expect(fakeRtcRoom.handleRtcRoomControlDisconnectLifecycle).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.handleRtcRoomControlDisconnectLifecycle).toHaveBeenCalledWith(
      meetingRoom,
      zombieWs,
      {
        intentional: false,
        closeSocket: true,
        closeCode: 1000,
        closeReason: "Left room",
      },
    );
  });

  it("prunes expired resumable control sessions from authoritative RTC_ROOM storage", async () => {
    const deleteKeys: string[][] = [];
    const expiredSession = {
      id: "participant-expired",
      clerk_user_id: "user-1",
      name: "Expired Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      tracks: [],
    };
    const ws = {
      deserializeAttachment: () => ({ socket_role: "control" }),
      send: vi.fn(),
    } as unknown as WebSocket;
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [ws],
        storage: {
          list: vi.fn(async () => new Map([
            ["resume:expiry:participant-expired", 1_000],
            ["resume:expiry:participant-fresh", 150_000],
          ])),
          get: vi.fn(async (key: string) => {
            if (key === "resume:session:participant-expired") return expiredSession;
            return undefined;
          }),
          delete: vi.fn(async (keys: string[]) => {
            deleteKeys.push(keys);
          }),
          getAlarm: vi.fn(async () => null),
          setAlarm: vi.fn(async () => undefined),
        },
      },
    });

    const pruned = await (RtcRoom.prototype as any).pruneRtcRoomExpiredResumableControlSessions.call(
      fakeRtcRoom,
      200_000,
    );

    expect(pruned).toBe(true);
    const leavePayload = JSON.parse(vi.mocked(ws.send).mock.calls[0][0] as string);
    expect(leavePayload).toEqual({
      op: 15,
      d: {
        participant: expect.objectContaining({
          id: "participant-expired",
          clerk_user_id: "user-1",
          name: "Expired Alice",
        }),
        action: "leave",
      },
    });
    expect(deleteKeys).toEqual([[
      "resume:session:participant-expired",
      "resume:expiry:participant-expired",
    ]]);
  });

  it("schedules RTC_ROOM control resume expiry alarms from the earliest authoritative deadline", async () => {
    const setAlarm = vi.fn(async () => undefined);
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        storage: {
          list: vi.fn(async () => new Map([
            ["resume:expiry:participant-later", 40_000],
            ["resume:expiry:participant-earlier", 10_000],
          ])),
          getAlarm: vi.fn(async () => null),
          setAlarm,
        },
      },
    });

    const scheduled = await (RtcRoom.prototype as any).scheduleRtcRoomControlResumeExpiryAlarm.call(
      fakeRtcRoom,
      50_000,
    );

    expect(scheduled).toBe(true);
    expect(setAlarm).toHaveBeenCalledWith(10_000 + RTC_RECONNECT_GRACE_MS);
  });

  it("expires authoritative resumable control sessions during alarm without rehydrating MeetingRoom local control mirrors", async () => {
    const events: string[] = [];
    const now = 200_000;
    const expiredDisconnectedAt = now - RTC_RECONNECT_GRACE_MS - 1_000;
    const freshDisconnectedAt = now;
    const expiredSession = {
      id: "participant-expired",
      clerk_user_id: "user-1",
      name: "Expired Alice",
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_video: false,
      tracks: [],
    };
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn(),
    };
    const ws = {
      deserializeAttachment: () => ({ socket_role: "control" }),
      send: vi.fn((payload: string) => {
        const parsed = JSON.parse(payload);
        events.push(`leave:${parsed.d.participant.id}:${parsed.d.action}`);
      }),
    } as unknown as WebSocket;
    const deleteKeys: string[][] = [];
    const expiryEntries = new Map<string, number>([
      ["resume:expiry:participant-expired", expiredDisconnectedAt],
      ["resume:expiry:participant-fresh", freshDisconnectedAt],
    ]);
    const setAlarm = vi.fn(async (deadline: number) => {
      events.push(`alarm:${deadline}`);
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [ws],
        storage: {
          list: vi.fn(async ({ prefix }: { prefix: string }) => {
            if (prefix === "resume:expiry:") {
              return new Map(expiryEntries);
            }
            return new Map();
          }),
          get: vi.fn(async (key: string) => {
            if (key === "resume:session:participant-expired") return expiredSession;
            return undefined;
          }),
          delete: vi.fn(async (keys: string[]) => {
            deleteKeys.push(keys);
            for (const key of keys) {
              expiryEntries.delete(key);
            }
            events.push(`delete:${keys.join(",")}`);
          }),
          getAlarm: vi.fn(async () => null),
          setAlarm,
        },
      },
      hasControlSockets: () => false,
      hasPendingControlAlarmWork: vi.fn(async () => true),
      hasMediaSockets: () => false,
      hasPendingMediaAlarmWork: vi.fn(() => false),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: vi.fn(),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("mediaSnapshot");
        return undefined;
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("controlSnapshot");
        return undefined;
      }),
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => {
        events.push("presence");
        return false;
      }),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("voiceSnapshot");
        return null;
      }),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
      reconcileRtcRoomSharedControlIntentFromMedia: vi.fn(async () => {
        events.push("sharedCleanup");
        return new Set<string>();
      }),
    });

    try {
      await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);
    } finally {
      nowSpy.mockRestore();
    }

    expect(deleteKeys).toEqual([[
      "resume:session:participant-expired",
      "resume:expiry:participant-expired",
    ]]);
    expect(setAlarm).toHaveBeenCalledWith(freshDisconnectedAt + RTC_RECONNECT_GRACE_MS);
    expect(fakeRtcRoom.getRtcRoomMedia).not.toHaveBeenCalled();
    expect(events).toEqual([
      "mediaSnapshot",
      "leave:participant-expired:leave",
      "delete:resume:session:participant-expired,resume:expiry:participant-expired",
      `alarm:${freshDisconnectedAt + RTC_RECONNECT_GRACE_MS}`,
      "presence",
      "controlSnapshot",
      "sharedCleanup",
      "voiceSnapshot",
    ]);
  });

  it("projects voice-room alarm cleanup back into meeting-room reconciliation", async () => {
    const rtcRoomMedia = {
      alarm: vi.fn(async () => undefined),
    };
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn(),
    };
    const fakeRtcRoom = {
      runRtcRoomSharedCallStateAlarm: vi.fn(async () => undefined),
      hasControlSockets: () => true,
      hasPendingControlAlarmWork: vi.fn(async () => false),
      hasMediaSockets: () => true,
      hasPendingMediaAlarmWork: vi.fn(() => true),
      sharedRtcProjectedChannelIds: new Set<string>(),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: () => rtcRoomMedia,
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => false),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => undefined),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => null),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: vi.fn(() => false),
    };

    await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);

    expect(rtcRoomMedia.alarm).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.runRtcRoomSharedCallStateAlarm).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.flushRtcRoomPendingPresenceWrites).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.reconcileRtcRoomSharedVoiceProjection).toBeTypeOf("function");
    expect(fakeRtcRoom.applyRtcRoomSharedProjectionChannelUpdates).not.toHaveBeenCalled();
  });

  it("prunes authoritative control zombies before delegated control alarm maintenance", async () => {
    const events: string[] = [];
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn(),
    };
    const fakeRtcRoom = {
      runRtcRoomSharedCallStateAlarm: vi.fn(async () => {
        events.push("call-state");
      }),
      hasControlSockets: () => true,
      hasPendingControlAlarmWork: vi.fn(async () => false),
      hasMediaSockets: () => false,
      hasPendingMediaAlarmWork: vi.fn(() => false),
      sharedRtcProjectedChannelIds: new Set<string>(),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: vi.fn(),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => undefined),
      pruneRtcRoomZombieControlSockets: vi.fn(async () => {
        events.push("zombies");
        return true;
      }),
      pruneRtcRoomExpiredResumableControlSessions: vi.fn(async () => {
        events.push("expiries");
        return true;
      }),
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => {
        events.push("presence");
        return false;
      }),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("voiceSnapshot");
        return null;
      }),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
    };

    await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);

    expect(fakeRtcRoom.pruneRtcRoomZombieControlSockets).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.pruneRtcRoomExpiredResumableControlSessions).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["zombies", "expiries", "call-state", "presence", "voiceSnapshot"]);
  });

  it("prunes shared pending-call timeout and accepted-call ttl state directly in RtcRoom alarm maintenance", async () => {
    const pendingLive = {
      callId: "call-live",
      callerId: "caller-live",
      calleeId: "callee-live",
      channelId: "dm-live",
      voiceRoomId: "voice-live",
      expiresAt: 5_000,
      callerName: "Bob",
    };
    const storageGet = vi.fn(async (key: string) => {
      if (key === "pendingCalls") {
        return {
          "callee-expired": {
            callId: "call-expired",
            callerId: "caller-expired",
            calleeId: "callee-expired",
            channelId: "dm-expired",
            voiceRoomId: "voice-expired",
            expiresAt: 1_000,
            callerName: "Alice",
          },
          "callee-live": pendingLive,
        };
      }
      if (key === "acceptedCallExpiry") {
        return {
          "accepted-expired": 1_000,
          "accepted-live": 5_000,
        };
      }
      return undefined;
    });
    const storagePut = vi.fn(async () => undefined);
    const storageDelete = vi.fn(async () => undefined);
    const setAlarm = vi.fn(async () => undefined);
    const meetingRoom = {
      syncRtcRoomSharedCallState: vi.fn(),
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        storage: {
          get: storageGet,
          put: storagePut,
          delete: storageDelete,
          getAlarm: vi.fn(async () => null),
          setAlarm,
        },
      },
      broadcastRtcRoomPendingCallStop: vi.fn(),
    });

    const changed = await (RtcRoom.prototype as any).runRtcRoomSharedCallStateAlarm.call(
      fakeRtcRoom,
      meetingRoom,
      2_000,
    );

    expect(changed).toBe(true);
    expect(fakeRtcRoom.broadcastRtcRoomPendingCallStop).toHaveBeenCalledWith(
      expect.objectContaining({ callId: "call-expired" }),
      "timeout",
    );
    expect(storagePut).toHaveBeenCalledWith("pendingCalls", {
      "callee-live": pendingLive,
    });
    expect(storagePut).toHaveBeenCalledWith("acceptedCallExpiry", {
      "accepted-live": 5_000,
    });
    expect(storageDelete).not.toHaveBeenCalled();
    expect(setAlarm).toHaveBeenCalledWith(2_000);
  });

  it("clears stale shared control voice intent in RtcRoom before projection cleanup", async () => {
    let liveAttachment = {
      socket_role: "control",
      id: "participant-1",
      clerk_user_id: "user-1",
      name: "Alice",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const ws = {
      deserializeAttachment: () => liveAttachment,
      serializeAttachment: vi.fn((value) => {
        liveAttachment = value;
      }),
    } as unknown as WebSocket;
    const storagePut = vi.fn(async () => undefined);
    const controlAuthoritySnapshot = {
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
            self_video: false,
          },
        ],
      ]),
      sessionsByParticipantId: new Map([
        [
          "participant-1",
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
            self_video: false,
          },
        ],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 1,
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [ws],
        storage: {
          list: vi.fn(async () => new Map([
            [
              "resume:session:participant-1",
              {
                id: "participant-1",
                clerk_user_id: "user-1",
                name: "Alice",
                voice_channel_id: "vc-1",
                voice_joined_at: 123_000,
                self_mute: false,
                self_deaf: false,
                self_stream: false,
                self_stream_audio: false,
                self_video: false,
              },
            ],
          ])),
          put: storagePut,
        },
      },
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => controlAuthoritySnapshot),
    });
    const mediaAuthoritySnapshot = {
      capturedAt: 200_000,
      liveParticipantIds: new Set<string>(),
      liveClerkUserIds: new Set<string>(),
      activeClerkUserIds: new Set<string>(),
      presenceByClerkUserId: new Map(),
      participantCount: 0,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };

    const changedChannelIds = await (RtcRoom.prototype as any).reconcileRtcRoomSharedControlIntentFromMedia.call(
      fakeRtcRoom,
      mediaAuthoritySnapshot,
    );

    expect(ws.serializeAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-1",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      }),
    );
    expect(storagePut).toHaveBeenCalledWith({
      "resume:session:participant-1": expect.objectContaining({
        id: "participant-1",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
      }),
    });
    expect(fakeRtcRoom.syncMeetingRoomControlAuthoritySnapshot).toHaveBeenCalledTimes(2);
    expect([...changedChannelIds]).toEqual(["vc-1"]);
  });

  it("deduplicates stale shared control cleanup before projection rebroadcasts", async () => {
    let liveAttachment = {
      socket_role: "control",
      id: "participant-live",
      clerk_user_id: "user-1",
      name: "Alice",
      voice_channel_id: "vc-1",
      voice_joined_at: 123_000,
      self_mute: false,
      self_deaf: false,
      self_stream: false,
      self_stream_audio: false,
      self_video: false,
    };
    const liveWs = {
      deserializeAttachment: () => liveAttachment,
      serializeAttachment: vi.fn((value) => {
        liveAttachment = value;
      }),
    } as unknown as WebSocket;
    const storagePut = vi.fn(async () => undefined);
    const controlAuthoritySnapshot = {
      capturedAt: 200_000,
      sessionsByClerkUserId: new Map([
        [
          "user-1",
          {
            id: "participant-live",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            voice_joined_at: 123_000,
            name: "Alice",
            self_mute: false,
            self_deaf: false,
            self_stream: true,
            self_stream_audio: true,
            self_video: true,
            stream_preview_url: "https://example.com/live-preview.jpg",
          },
        ],
      ]),
      sessionsByParticipantId: new Map([
        [
          "participant-live",
          {
            id: "participant-live",
            clerk_user_id: "user-1",
            voice_channel_id: "vc-1",
            voice_joined_at: 123_000,
            name: "Alice",
            self_mute: false,
            self_deaf: false,
            self_stream: false,
            self_stream_audio: false,
            self_video: false,
          },
        ],
      ]),
      liveSessionCount: 1,
      resumableSessionCount: 2,
    };
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [liveWs],
        storage: {
          list: vi.fn(async () => new Map([
            [
              "resume:session:participant-live",
              {
                id: "participant-live",
                clerk_user_id: "user-1",
                name: "Alice",
                voice_channel_id: "vc-1",
                voice_joined_at: 123_000,
                self_mute: false,
                self_deaf: false,
                self_stream: true,
                self_stream_audio: true,
                self_video: true,
                stream_preview_url: "https://example.com/live-preview.jpg",
              },
            ],
            [
              "resume:session:participant-stored",
              {
                id: "participant-stored",
                clerk_user_id: "user-1",
                name: "Alice (stored)",
                voice_channel_id: "vc-1",
                voice_joined_at: 122_500,
                self_mute: true,
                self_deaf: false,
                self_stream: true,
                self_stream_audio: true,
                self_video: true,
                stream_preview_url: "https://example.com/stored-preview.jpg",
              },
            ],
          ])),
          put: storagePut,
        },
      },
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => controlAuthoritySnapshot),
    });
    const mediaAuthoritySnapshot = {
      capturedAt: 200_000,
      liveParticipantIds: new Set<string>(),
      liveClerkUserIds: new Set<string>(),
      activeClerkUserIds: new Set<string>(),
      presenceByClerkUserId: new Map(),
      participantCount: 0,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };

    const changedChannelIds = await (RtcRoom.prototype as any).reconcileRtcRoomSharedControlIntentFromMedia.call(
      fakeRtcRoom,
      mediaAuthoritySnapshot,
    );

    expect(liveWs.serializeAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "participant-live",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        stream_preview_url: null,
      }),
    );
    expect(storagePut).toHaveBeenCalledWith({
      "resume:session:participant-live": expect.objectContaining({
        id: "participant-live",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        stream_preview_url: null,
      }),
      "resume:session:participant-stored": expect.objectContaining({
        id: "participant-stored",
        voice_channel_id: undefined,
        voice_joined_at: undefined,
        self_stream: false,
        self_stream_audio: false,
        self_video: false,
        stream_preview_url: null,
      }),
    });
    expect(fakeRtcRoom.syncMeetingRoomControlAuthoritySnapshot).toHaveBeenCalledTimes(2);
    expect([...changedChannelIds]).toEqual(["vc-1"]);
  });

  it("does not project media cleanup back into control state if voice alarm fails", async () => {
    const rtcRoomMedia = {
      alarm: vi.fn(async () => {
        throw new Error("voice failed");
      }),
    };
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn(),
    };
    const fakeRtcRoom = {
      hasControlSockets: () => true,
      hasPendingControlAlarmWork: vi.fn(async () => false),
      hasMediaSockets: () => true,
      hasPendingMediaAlarmWork: vi.fn(() => true),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: () => rtcRoomMedia,
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => false),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => undefined),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => null),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
    };

    await expect((RtcRoom.prototype as any).alarm.call(fakeRtcRoom)).rejects.toThrow("voice failed");
    expect(fakeRtcRoom.flushRtcRoomPendingPresenceWrites).toHaveBeenCalledTimes(1);
  });

  it("lets the control-only alarm path still reconcile shared voice through RtcRoom", async () => {
    const meetingRoom = {
      setSharedRtcAuthority: vi.fn(),
    };
    const fakeRtcRoom = {
      runRtcRoomSharedCallStateAlarm: vi.fn(async () => undefined),
      hasControlSockets: () => true,
      hasPendingControlAlarmWork: vi.fn(async () => true),
      hasMediaSockets: () => false,
      hasPendingMediaAlarmWork: vi.fn(() => false),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: vi.fn(),
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => false),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => undefined),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => null),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: vi.fn(() => false),
    };

    await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);

    expect(fakeRtcRoom.runRtcRoomSharedCallStateAlarm).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.flushRtcRoomPendingPresenceWrites).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.getRtcRoomMedia).not.toHaveBeenCalled();
  });

  it("routes pending-call timeout cleanup through the shared RtcRoom alarm path", async () => {
    const now = 222_222;
    const events: string[] = [];
    const meetingRoom = {
      syncRtcRoomSharedCallState: vi.fn(() => {
        events.push("mirror");
      }),
      setSharedRtcAuthority: vi.fn(),
    };
    const storagePut = vi.fn(async (key: string, value: unknown) => {
      events.push(`put:${key}:${JSON.stringify(value)}`);
    });
    const storageDelete = vi.fn(async (key: string | string[]) => {
      events.push(`delete:${JSON.stringify(key)}`);
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [],
        storage: {
          list: vi.fn(async () => new Map()),
          get: vi.fn(async (key: string) => {
            if (key === "pendingCalls") {
              return {
                "callee-expired": {
                  callId: "call-expired",
                  callerId: "caller-1",
                  calleeId: "callee-expired",
                  channelId: "dm-1",
                  voiceRoomId: "voice-1",
                  expiresAt: now - 1_000,
                  callerName: "Alice",
                },
              };
            }
            return undefined;
          }),
          put: storagePut,
          delete: storageDelete,
          getAlarm: vi.fn(async () => null),
          setAlarm: vi.fn(async () => undefined),
        },
      },
      hasControlSockets: () => false,
      hasMediaSockets: () => false,
      sharedRtcProjectedChannelIds: new Set<string>(),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: vi.fn(),
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => {
        events.push("presence");
        return false;
      }),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("mediaSnapshot");
        return undefined;
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("controlSnapshot");
        return undefined;
      }),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("voiceSnapshot");
        return null;
      }),
      broadcastRtcRoomPendingCallStop: vi.fn((pending: { callId: string }, reason: string) => {
        events.push(`stop:${pending.callId}:${reason}`);
      }),
      reconcileRtcRoomSharedControlIntentFromMedia: vi.fn(async () => new Set()),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
    });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);
    } finally {
      nowSpy.mockRestore();
    }

    expect(storageDelete).toHaveBeenCalledWith("pendingCalls");
    expect(fakeRtcRoom.broadcastRtcRoomPendingCallStop).toHaveBeenCalledWith(
      expect.objectContaining({ callId: "call-expired" }),
      "timeout",
    );
    expect(fakeRtcRoom.flushRtcRoomPendingPresenceWrites).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.getRtcRoomMedia).not.toHaveBeenCalled();
    expect(events).toEqual([
      "mediaSnapshot",
      "delete:\"pendingCalls\"",
      "stop:call-expired:timeout",
      "presence",
      "controlSnapshot",
      "voiceSnapshot",
    ]);
  });

  it("routes accepted-call ttl cleanup through the shared RtcRoom alarm path", async () => {
    const now = 333_333;
    const events: string[] = [];
    const meetingRoom = {
      syncRtcRoomSharedCallState: vi.fn(() => {
        events.push("mirror");
      }),
      setSharedRtcAuthority: vi.fn(),
    };
    const storagePut = vi.fn(async (key: string, value: unknown) => {
      events.push(`put:${key}:${JSON.stringify(value)}`);
    });
    const storageDelete = vi.fn(async (key: string | string[]) => {
      events.push(`delete:${JSON.stringify(key)}`);
    });
    const fakeRtcRoom = Object.assign(Object.create(RtcRoom.prototype), {
      ctx: {
        getWebSockets: () => [],
        storage: {
          list: vi.fn(async () => new Map()),
          get: vi.fn(async (key: string) => {
            if (key === "acceptedCallExpiry") {
              return {
                "accepted-expired": now - 1_000,
              };
            }
            return undefined;
          }),
          put: storagePut,
          delete: storageDelete,
          getAlarm: vi.fn(async () => null),
          setAlarm: vi.fn(async () => undefined),
        },
      },
      hasControlSockets: () => false,
      hasMediaSockets: () => false,
      sharedRtcProjectedChannelIds: new Set<string>(),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: vi.fn(),
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => {
        events.push("presence");
        return false;
      }),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("mediaSnapshot");
        return undefined;
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => {
        events.push("controlSnapshot");
        return undefined;
      }),
      broadcastRtcRoomPendingCallStop: vi.fn(),
      reconcileRtcRoomSharedControlIntentFromMedia: vi.fn(async () => new Set()),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("voiceSnapshot");
        return null;
      }),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
    });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);
    } finally {
      nowSpy.mockRestore();
    }

    expect(storageDelete).toHaveBeenCalledWith("acceptedCallExpiry");
    expect(fakeRtcRoom.broadcastRtcRoomPendingCallStop).not.toHaveBeenCalled();
    expect(fakeRtcRoom.flushRtcRoomPendingPresenceWrites).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.getRtcRoomMedia).not.toHaveBeenCalled();
    expect(events).toEqual([
      "mediaSnapshot",
      "delete:\"acceptedCallExpiry\"",
      "presence",
      "controlSnapshot",
      "voiceSnapshot",
    ]);
  });

  it("still reconciles shared voice after a successful voice alarm even if call-state maintenance fails", async () => {
    const rtcRoomMedia = {
      alarm: vi.fn(async () => undefined),
    };
    const meetingRoom = {
      clearRtcRoomSharedProjectionChannels: vi.fn(),
      setSharedRtcAuthority: vi.fn(),
    };
    const fakeRtcRoom = {
      ctx: {
        waitUntil: vi.fn(),
        getWebSockets: () => [],
      },
      runRtcRoomSharedCallStateAlarm: vi.fn(async () => {
        throw new Error("call-state failed");
      }),
      hasControlSockets: () => true,
      hasPendingControlAlarmWork: vi.fn(async () => false),
      hasMediaSockets: () => true,
      hasPendingMediaAlarmWork: vi.fn(() => true),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: () => rtcRoomMedia,
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => false),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => undefined),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => null),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
    };

    await expect((RtcRoom.prototype as any).alarm.call(fakeRtcRoom)).rejects.toThrow("call-state failed");

    expect(rtcRoomMedia.alarm).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.runRtcRoomSharedCallStateAlarm).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.flushRtcRoomPendingPresenceWrites).not.toHaveBeenCalled();
    expect(meetingRoom.clearRtcRoomSharedProjectionChannels).not.toHaveBeenCalled();
    expect(fakeRtcRoom.ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("still reconciles shared voice after a successful voice alarm even if control maintenance fails", async () => {
    const rtcRoomMedia = {
      alarm: vi.fn(async () => undefined),
    };
    const meetingRoom = {
      clearRtcRoomSharedProjectionChannels: vi.fn(),
      setSharedRtcAuthority: vi.fn(),
    };
    const fakeRtcRoom = {
      ctx: {
        waitUntil: vi.fn(),
        getWebSockets: () => [],
      },
      sharedRtcProjectedChannelIds: new Set(["vc-1"]),
      hasControlSockets: () => true,
      hasPendingControlAlarmWork: vi.fn(async () => false),
      hasMediaSockets: () => true,
      hasPendingMediaAlarmWork: vi.fn(() => true),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: () => rtcRoomMedia,
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => {
        throw new Error("control failed");
      }),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => undefined),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => null),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
    };

    await expect((RtcRoom.prototype as any).alarm.call(fakeRtcRoom)).rejects.toThrow("control failed");

    expect(rtcRoomMedia.alarm).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.flushRtcRoomPendingPresenceWrites).toHaveBeenCalledTimes(1);
    expect(meetingRoom.clearRtcRoomSharedProjectionChannels).toHaveBeenCalledWith(new Set(["vc-1"]));
    expect(fakeRtcRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("refreshes shared media authority before alarm-driven control reconciliation", async () => {
    const events: string[] = [];
    const snapshot = {
      capturedAt: 123_456,
      liveParticipantIds: new Set(["participant-1"]),
      liveClerkUserIds: new Set(["user-1"]),
      activeClerkUserIds: new Set(["user-1"]),
      presenceByClerkUserId: new Map([
        ["user-1", { connected: true, connection_state: "connected", disconnected_at: null, reconnect_expires_at: null }],
      ]),
      participantCount: 1,
      pendingReconnectCount: 0,
      demoChatMessageCount: 0,
    };
    const rtcRoomMedia = {
      alarm: vi.fn(async () => {
        events.push("voice");
      }),
    };
    const meetingRoom = {
      setSharedRtcMediaAuthoritySnapshot: vi.fn((value) => {
        events.push(`set:${value === snapshot}`);
      }),
      setSharedRtcAuthority: vi.fn(),
    };
    const fakeRtcRoom = {
      hasControlSockets: () => true,
      hasPendingControlAlarmWork: vi.fn(async () => false),
      hasMediaSockets: () => true,
      hasPendingMediaAlarmWork: vi.fn(() => true),
      sharedRtcProjectedChannelIds: new Set<string>(),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: () => rtcRoomMedia,
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => {
        events.push("presence");
        return false;
      }),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => {
        events.push("read");
        return snapshot;
      }),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => {
        events.push("syncSnapshot");
        meetingRoom.setSharedRtcMediaAuthoritySnapshot(snapshot);
        return snapshot;
      }),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => undefined),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => {
        events.push("voiceSnapshot");
        return null;
      }),
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
    };

    await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);

    expect(fakeRtcRoom.tryReadSharedRtcMediaAuthoritySnapshot).toHaveBeenCalledTimes(2);
    expect(fakeRtcRoom.syncMeetingRoomMediaAuthoritySnapshot).toHaveBeenCalledTimes(1);
    expect(fakeRtcRoom.flushRtcRoomPendingPresenceWrites).toHaveBeenCalledTimes(1);
    expect(meetingRoom.setSharedRtcMediaAuthoritySnapshot).toHaveBeenCalledWith(snapshot);
    expect(events).toEqual(["read", "voice", "read", "syncSnapshot", "set:true", "presence", "voiceSnapshot"]);
  });

  it("applies projection cleanup directly when RtcRoom cleared stale shared control intent during alarm", async () => {
    const meetingRoom = {
      clearRtcRoomSharedProjectionChannels: vi.fn(),
      setSharedRtcAuthority: vi.fn(),
    };
    const fakeRtcRoom = {
      ctx: {
        waitUntil: vi.fn(),
        getWebSockets: () => [],
      },
      sharedRtcProjectedChannelIds: new Set<string>(),
      hasControlSockets: () => true,
      hasPendingControlAlarmWork: vi.fn(async () => false),
      hasMediaSockets: () => false,
      hasPendingMediaAlarmWork: vi.fn(() => false),
      getMeetingRoom: () => meetingRoom,
      getRtcRoomMedia: vi.fn(),
      flushRtcRoomPendingPresenceWrites: vi.fn(async () => false),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomControlAuthoritySnapshot: vi.fn(async () => undefined),
      readCurrentSharedRtcVoiceAuthoritySnapshot: vi.fn(async () => null),
      reconcileRtcRoomSharedControlIntentFromMedia: vi.fn(async () => new Set(["vc-1"])),
      applyRtcRoomSharedProjectionChannelUpdates: (RtcRoom.prototype as any).applyRtcRoomSharedProjectionChannelUpdates,
      reconcileRtcRoomSharedVoiceProjection: (RtcRoom.prototype as any).reconcileRtcRoomSharedVoiceProjection,
    };

    await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);

    expect(meetingRoom.clearRtcRoomSharedProjectionChannels).toHaveBeenCalledWith(new Set(["vc-1"]));
    expect(fakeRtcRoom.ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("skips idle legacy handlers on alarm when neither side has work", async () => {
    const fakeRtcRoom = {
      hasControlSockets: () => false,
      hasPendingControlAlarmWork: vi.fn(async () => false),
      hasMediaSockets: () => false,
      hasPendingMediaAlarmWork: vi.fn(() => false),
      getMeetingRoom: vi.fn(),
      getRtcRoomMedia: vi.fn(),
      tryReadSharedRtcMediaAuthoritySnapshot: vi.fn(() => undefined),
      syncMeetingRoomMediaAuthoritySnapshot: vi.fn(() => undefined),
    };

    await (RtcRoom.prototype as any).alarm.call(fakeRtcRoom);

    expect(fakeRtcRoom.getMeetingRoom).not.toHaveBeenCalled();
    expect(fakeRtcRoom.getRtcRoomMedia).not.toHaveBeenCalled();
  });
});
