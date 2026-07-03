import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

import {
  isMediaReconnectWithinGrace,
  isReconnectWithinGrace,
  isSupersededVoiceConnection,
} from "../src/lib/voice/connection-generation";
import {
  getEffectiveVoiceHeartbeat,
  isVoiceHeartbeatExpired,
  shouldPersistVoiceHeartbeat,
  getVoiceSfuSessionProbeTargets,
  VoiceRoom,
} from "./voice-room";
import {
  RTC_MEDIA_RECONNECT_GRACE_MS,
  RTC_RECONNECT_GRACE_MS,
} from "../src/lib/voice/rtc-room-session";

describe("isSupersededVoiceConnection", () => {
  it("treats a socket as stale when the participant row has a newer connection", () => {
    expect(isSupersededVoiceConnection("new-connection", "old-connection")).toBe(true);
  });

  it("allows the current socket to disconnect the participant", () => {
    expect(isSupersededVoiceConnection("current-connection", "current-connection")).toBe(false);
  });

  it("allows legacy sockets without connection metadata", () => {
    expect(isSupersededVoiceConnection("current-connection", undefined)).toBe(false);
    expect(isSupersededVoiceConnection(null, "socket-connection")).toBe(false);
  });
});

describe("isReconnectWithinGrace", () => {
  it("keeps reconnect transfer enabled only inside the grace window", () => {
    expect(isReconnectWithinGrace(1_000, 1_000 + RTC_RECONNECT_GRACE_MS - 1, RTC_RECONNECT_GRACE_MS)).toBe(true);
    expect(isReconnectWithinGrace(1_000, 1_000 + RTC_RECONNECT_GRACE_MS, RTC_RECONNECT_GRACE_MS)).toBe(false);
  });
});

describe("isMediaReconnectWithinGrace", () => {
  it("uses the shorter media grace window for SFU transfer decisions", () => {
    expect(RTC_MEDIA_RECONNECT_GRACE_MS).toBeLessThan(RTC_RECONNECT_GRACE_MS);
    expect(isMediaReconnectWithinGrace(1_000, 1_000 + RTC_MEDIA_RECONNECT_GRACE_MS - 1)).toBe(true);
    expect(isMediaReconnectWithinGrace(1_000, 1_000 + RTC_MEDIA_RECONNECT_GRACE_MS)).toBe(false);
  });
});

describe("voice heartbeat persistence helpers", () => {
  it("coalesces SQLite heartbeat writes until the persist interval elapses", () => {
    expect(shouldPersistVoiceHeartbeat(undefined, 10_000, 60_000)).toBe(true);
    expect(shouldPersistVoiceHeartbeat(10_000, 69_999, 60_000)).toBe(false);
    expect(shouldPersistVoiceHeartbeat(10_000, 70_000, 60_000)).toBe(true);
  });

  it("uses the freshest socket heartbeat when persisted state is stale", () => {
    expect(getEffectiveVoiceHeartbeat(10_000, 55_000)).toBe(55_000);
    expect(getEffectiveVoiceHeartbeat(55_000, 10_000)).toBe(55_000);
  });

  it("avoids false zombie expiry when the socket heartbeat is newer than SQLite", () => {
    expect(isVoiceHeartbeatExpired(10_000, 55_000, 120_000, 90_000)).toBe(false);
    expect(isVoiceHeartbeatExpired(10_000, 20_000, 120_000, 90_000)).toBe(true);
  });
});

describe("getVoiceSfuSessionProbeTargets", () => {
  it("includes both pull and publisher sessions while ignoring blanks", () => {
    expect(getVoiceSfuSessionProbeTargets([
      {
        id: "participant-1",
        pull_session_id: "pull-1",
        push_session_cam: "push-cam-1",
        push_session_screen: "   ",
      },
      {
        id: "participant-2",
        pull_session_id: null,
        push_session_cam: null,
        push_session_screen: "push-screen-2",
      },
    ])).toEqual([
      { participantId: "participant-1", sessionId: "pull-1", sessionType: "pull" },
      { participantId: "participant-1", sessionId: "push-cam-1", sessionType: "push_cam" },
      { participantId: "participant-2", sessionId: "push-screen-2", sessionType: "push_screen" },
    ]);
  });
});

describe("waitForRetryDelay", () => {
  it("prefers scheduler.wait when available", async () => {
    const wait = vi.fn(async () => undefined);
    const globals = globalThis as typeof globalThis & {
      scheduler?: {
        wait?: (delay: number) => Promise<unknown>;
      };
    };
    const originalScheduler = globals.scheduler;
    globals.scheduler = { wait };

    try {
      await (VoiceRoom.prototype as any).waitForRetryDelay.call({}, 500);
    } finally {
      globals.scheduler = originalScheduler;
    }

    expect(wait).toHaveBeenCalledWith(500);
  });
});

describe("validateSfuSessions", () => {
  it("clears expired pull sessions and tells the client to rebuild its pull PC", async () => {
    const participant = {
      id: "participant-1",
      pull_session_id: "pull-1",
      push_session_cam: null,
      push_session_screen: null,
    };
    const ws = {};
    const sendTo = vi.fn();

    const sql = {
      exec: vi.fn((query: string, ...params: unknown[]) => {
        if (query.includes("SELECT id, pull_session_id, push_session_cam, push_session_screen")) {
          return [participant];
        }
        if (query.includes("SELECT pull_session_id as session_id FROM participants WHERE id = ?")) {
          return [{ session_id: participant.pull_session_id }];
        }
        if (query.startsWith("UPDATE participants SET pull_session_id = NULL")) {
          if (params[0] === participant.id && params[1] === participant.pull_session_id) {
            participant.pull_session_id = null;
          }
          return [];
        }

        throw new Error(`Unexpected SQL query: ${query}`);
      }),
    };

    const fakeVoiceRoom = Object.assign(Object.create(VoiceRoom.prototype), {
      sql,
      sfuFetch: vi.fn(async () => {
        throw new Error("SFU GET sessions/pull-1 failed (410): gone");
      }),
      getWsByParticipant: vi.fn(() => ws),
      sendTo,
    });

    await (VoiceRoom.prototype as any).validateSfuSessions.call(fakeVoiceRoom);

    expect(participant.pull_session_id).toBeNull();
    expect(sendTo).toHaveBeenCalledWith(ws, {
      op: 18,
      d: { code: 0, message: "pull-session-expired", session_type: "pull" },
    });
  });

  it("clears expired publisher sessions, drops their tracks, and forces media reconnect", async () => {
    const participant = {
      id: "participant-1",
      pull_session_id: null,
      push_session_cam: "push-cam-1",
      push_session_screen: null,
    };
    const tracks = [
      { track_name: "audio-participant-1", participant_id: participant.id, session_id: "push-cam-1" },
      { track_name: "video-participant-1", participant_id: participant.id, session_id: "push-cam-1" },
    ];
    const ws = { close: vi.fn() };
    const sendTo = vi.fn();
    const broadcast = vi.fn();

    const sql = {
      exec: vi.fn((query: string, ...params: unknown[]) => {
        if (query.includes("SELECT id, pull_session_id, push_session_cam, push_session_screen")) {
          return [participant];
        }
        if (query.includes("SELECT push_session_cam as session_id FROM participants WHERE id = ?")) {
          return [{ session_id: participant.push_session_cam }];
        }
        if (query.startsWith("UPDATE participants SET push_session_cam = NULL")) {
          if (params[0] === participant.id && params[1] === participant.push_session_cam) {
            participant.push_session_cam = null;
          }
          return [];
        }
        if (query.startsWith("SELECT track_name FROM tracks WHERE participant_id = ? AND session_id = ?")) {
          return tracks
            .filter((track) => track.participant_id === params[0] && track.session_id === params[1])
            .map((track) => ({ track_name: track.track_name }));
        }
        if (query.startsWith("DELETE FROM tracks WHERE participant_id = ? AND session_id = ?")) {
          const participantId = params[0];
          const sessionId = params[1];
          for (let index = tracks.length - 1; index >= 0; index -= 1) {
            if (tracks[index].participant_id === participantId && tracks[index].session_id === sessionId) {
              tracks.splice(index, 1);
            }
          }
          return [];
        }

        throw new Error(`Unexpected SQL query: ${query}`);
      }),
    };

    const fakeVoiceRoom = Object.assign(Object.create(VoiceRoom.prototype), {
      sql,
      sfuFetch: vi.fn(async () => {
        throw new Error("SFU GET sessions/push-cam-1 failed (410): gone");
      }),
      getWsByParticipant: vi.fn(() => ws),
      sendTo,
      broadcast,
      clearStreamWatchersByParticipantId: vi.fn(() => false),
      broadcastStreamWatcherSnapshot: vi.fn(),
    });

    await (VoiceRoom.prototype as any).validateSfuSessions.call(fakeVoiceRoom);

    expect(participant.push_session_cam).toBeNull();
    expect(tracks).toHaveLength(0);
    expect(broadcast).toHaveBeenCalledWith({
      op: 13,
      d: {
        participant_id: participant.id,
        track_names: ["audio-participant-1", "video-participant-1"],
        session_id: "push-cam-1",
      },
    });
    expect(sendTo).toHaveBeenCalledWith(ws, {
      op: 18,
      d: { code: 0, message: "publisher-session-expired", session_type: "push_cam" },
    });
    expect(ws.close).toHaveBeenCalledWith(1012, "publisher-session-expired");
  });

  it("scopes deprecated IceRestart failures so the client can rebuild the right publisher side", async () => {
    const sendTo = vi.fn();
    const fakeVoiceRoom = Object.assign(Object.create(VoiceRoom.prototype), {
      requireParticipantId: vi.fn(() => "participant-1"),
      sendTo,
    });
    const ws = {} as WebSocket;

    await (VoiceRoom.prototype as any).handleIceRestart.call(fakeVoiceRoom, ws, {
      sdp: "stale-offer",
      session_type: "push_screen",
    });

    expect(sendTo).toHaveBeenCalledWith(ws, {
      op: 18,
      d: { code: 0, message: "publisher-session-expired", session_type: "push_screen" },
    });
  });
});

describe("handleSelectProtocol partial pull recovery", () => {
  it("sends the pull offer before the inline pull-retry hint for failed tracks", async () => {
    const ws = {
      deserializeAttachment: () => ({ participant_id: "participant-1" }),
    } as unknown as WebSocket;
    const sendTo = vi.fn();
    const sql = {
      exec: vi.fn((query: string) => {
        if (query.startsWith("SELECT push_session_cam, push_session_screen, pull_session_id FROM participants")) {
          return [{ push_session_cam: null, push_session_screen: null, pull_session_id: "pull-session-1" }];
        }
        return [];
      }),
    };

    const fakeVoiceRoom = Object.assign(Object.create(VoiceRoom.prototype), {
      sql,
      sendTo,
      sfuPost: vi.fn(async () => ({
        sessionDescription: { sdp: "mock-pull-offer-sdp", type: "offer" },
        tracks: [
          { trackName: "cam-audio-remote-a", sessionId: "publisher-a", mid: "0" },
          { trackName: "cam-video-remote-b", errorCode: 404 },
        ],
      })),
      evictDeadPublisherTracks: vi.fn(),
      getVoiceAttachment: (VoiceRoom.prototype as any).getVoiceAttachment,
      getParticipantId: (VoiceRoom.prototype as any).getParticipantId,
      requireParticipantId: (VoiceRoom.prototype as any).requireParticipantId,
    });

    await (VoiceRoom.prototype as any).handleSelectProtocol.call(fakeVoiceRoom, ws, {
      sdp: "",
      push_tracks: [],
      pull_tracks: [
        {
          participant_id: "remote-a",
          track_name: "cam-audio-remote-a",
          session_id: "publisher-a",
          kind: "audio",
        },
        {
          participant_id: "remote-b",
          track_name: "cam-video-remote-b",
          session_id: "publisher-b",
          kind: "video",
        },
      ],
      request_id: "pull-123",
    });

    const messages = sendTo.mock.calls.map(([, message]) => message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      d: {
        sdp: "mock-pull-offer-sdp",
        request_id: "pull-123",
        operation: "pull",
        tracks: [
          expect.objectContaining({ track_name: "cam-audio-remote-a" }),
        ],
      },
    });
    expect(messages[1]).toMatchObject({
      d: {
        message: 'pull-retry:["cam-video-remote-b"]',
        request_id: "pull-123",
        operation: "pull",
      },
    });
    expect(fakeVoiceRoom.evictDeadPublisherTracks).toHaveBeenCalledWith([
      expect.objectContaining({ trackName: "cam-video-remote-b", errorCode: 404 }),
    ]);
  });
});

describe("voice session check helpers", () => {
  it("rejects channel-mismatched media checks before scanning participants", async () => {
    const sqlExec = vi.fn(() => []);
    const fakeVoiceRoom = Object.assign(Object.create(VoiceRoom.prototype), {
      roomSlug: "voice-server-1-channel-1",
      ctx: {
        storage: {
          get: vi.fn(async () => undefined),
        },
      },
      sql: {
        exec: sqlExec,
      },
      getWsByParticipant: vi.fn(),
      getParticipantId: vi.fn(),
    });

    const response = await (VoiceRoom.prototype as any).checkVoiceSession.call(fakeVoiceRoom, {
      user_id: "user-1",
      channel_id: "channel-2",
      require_exact_session: false,
      require_channel_match: true,
    });

    await expect(response.json()).resolves.toEqual({
      allowed: false,
      connected: false,
      exact_session_matched: false,
    });
    expect(sqlExec).not.toHaveBeenCalled();
  });

  it("loads the persisted room slug before enforcing media-side channel checks", async () => {
    const activeWs = {} as WebSocket;
    const fakeVoiceRoom = Object.assign(Object.create(VoiceRoom.prototype), {
      roomSlug: "",
      ctx: {
        storage: {
          get: vi.fn(async () => "voice-server-1-channel-1"),
        },
      },
      sql: {
        exec: vi.fn(() => [{ id: "participant-1" }]),
      },
      getWsByParticipant: vi.fn(() => activeWs),
      getParticipantId: vi.fn(() => "participant-1"),
    });

    const response = await (VoiceRoom.prototype as any).checkVoiceSession.call(fakeVoiceRoom, {
      user_id: "user-1",
      channel_id: "channel-1",
      session_id: "participant-1",
      require_exact_session: true,
    });

    await expect(response.json()).resolves.toEqual({
      allowed: true,
      connected: true,
      exact_session_matched: true,
    });
    expect(fakeVoiceRoom.ctx.storage.get).toHaveBeenCalledWith("roomSlug");
  });
});
