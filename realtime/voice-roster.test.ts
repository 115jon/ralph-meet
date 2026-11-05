import { describe, expect, it } from "vitest";

import {
  buildVoiceRosterMembers,
  isNewerVoiceRoster,
  nextVoiceRosterSeq,
  parseVoiceRosterPull,
  parseVoiceRosterPushReply,
  parseVoiceRosterSnapshot,
  resolveRoomVoiceChannelId,
  VoiceRosterPusher,
  type VoiceRosterSession,
  voiceRosterSessionOf,
} from "./voice-roster";

const NOW = 1_800_000_000_000;

function session(
  id: string,
  userId: string,
  overrides: Partial<VoiceRosterSession> = {},
): VoiceRosterSession {
  return {
    id,
    user_id: userId,
    admission: { accessMode: "authenticated" },
    name: userId,
    self_mute: true,
    self_deaf: false,
    self_video: false,
    self_stream: false,
    voice_joined_at: NOW - 1_000,
    voice_join_order: 1,
    ...overrides,
  };
}

describe("buildVoiceRosterMembers", () => {
  const options = { graceMs: 120_000, now: NOW, fallbackJoinedAt: NOW };

  it("lists live sessions as connected and held ones as reconnecting", () => {
    const members = buildVoiceRosterMembers(
      [session("a", "alice")],
      [{ session: session("b", "bob"), disconnectedAt: NOW - 5_000 }],
      options,
    );
    expect(members).toEqual([
      expect.objectContaining({
        user_id: "alice",
        connected: true,
        connection_state: "connected",
        disconnected_at: null,
      }),
      expect.objectContaining({
        user_id: "bob",
        connected: false,
        connection_state: "reconnecting",
        disconnected_at: NOW - 5_000,
        reconnect_expires_at: NOW - 5_000 + 120_000,
      }),
    ]);
  });

  it("leaves out standby, public-demo, anonymous and lapsed sessions", () => {
    const members = buildVoiceRosterMembers(
      [
        session("s", "standby-user", { standby: true }),
        session("d", "demo-user", {
          admission: { accessMode: "public-demo" },
        }),
        session("x", "", { user_id: undefined }),
      ],
      [{ session: session("l", "lapsed"), disconnectedAt: NOW - 120_000 }],
      options,
    );
    expect(members).toEqual([]);
  });

  it("keeps one member per user: live beats held, newest join beats older", () => {
    const members = buildVoiceRosterMembers(
      [
        session("old", "alice", { voice_join_order: 1, self_mute: true }),
        session("new", "alice", { voice_join_order: 2, self_mute: false }),
      ],
      [
        {
          session: session("held", "alice", { voice_join_order: 3 }),
          disconnectedAt: NOW - 1_000,
        },
      ],
      options,
    );
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      user_id: "alice",
      connected: true,
      self_mute: false,
    });
  });
});

describe("roster ordering", () => {
  it("counts seqs up past the clock and the previous seq", () => {
    expect(nextVoiceRosterSeq(0, NOW)).toBe(NOW * 1000);
    expect(nextVoiceRosterSeq(NOW * 1000, NOW)).toBe(NOW * 1000 + 1);
    // A clock that went back still counts up.
    expect(nextVoiceRosterSeq(NOW * 1000 + 5, NOW - 10)).toBe(NOW * 1000 + 6);
  });

  it("applies only a seq above the last applied one", () => {
    expect(isNewerVoiceRoster(undefined, 1)).toBe(true);
    expect(isNewerVoiceRoster(5, 6)).toBe(true);
    expect(isNewerVoiceRoster(5, 5)).toBe(false);
    expect(isNewerVoiceRoster(5, 4)).toBe(false);
  });
});

describe("parseVoiceRosterSnapshot", () => {
  const member = {
    user_id: "alice",
    name: "Alice",
    connected: true,
    connection_state: "connected",
    disconnected_at: null,
    reconnect_expires_at: null,
    self_mute: false,
    self_deaf: false,
    self_video: false,
    self_stream: false,
    joined_at: NOW,
  };

  it("reads a snapshot and fills optional member fields", () => {
    expect(
      parseVoiceRosterSnapshot({
        channel_id: "c",
        room_slug: "r",
        seq: 3,
        started_at: NOW,
        members: [member],
      }),
    ).toMatchObject({
      channel_id: "c",
      seq: 3,
      members: [
        {
          user_id: "alice",
          display_name: null,
          stream_preview_url: null,
          self_stream_audio: false,
        },
      ],
    });
  });

  it("refuses malformed snapshots and duplicate members", () => {
    const base = {
      channel_id: "c",
      room_slug: "r",
      seq: 3,
      started_at: null,
    };
    expect(
      parseVoiceRosterSnapshot({ ...base, members: [member, member] }),
    ).toBeNull();
    expect(parseVoiceRosterSnapshot({ ...base, seq: 1.5, members: [] })).toBe(
      null,
    );
    expect(
      parseVoiceRosterSnapshot({
        ...base,
        members: [{ ...member, connection_state: "gone" }],
      }),
    ).toBeNull();
    expect(parseVoiceRosterSnapshot({ ...base, members: "x" })).toBeNull();
  });
});

describe("seq feedback (pull min_seq, push reply)", () => {
  it("reads a pull's min_seq, which older gateways leave out", () => {
    expect(
      parseVoiceRosterPull({ channel_id: "c", room_slug: "r", min_seq: 42 }),
    ).toEqual({ channelId: "c", roomSlug: "r", minSeq: 42 });
    expect(parseVoiceRosterPull({ channel_id: "c", room_slug: "r" })).toEqual({
      channelId: "c",
      roomSlug: "r",
      minSeq: 0,
    });
    expect(
      parseVoiceRosterPull({ channel_id: "c", room_slug: "r", min_seq: -1 }),
    ).toBeNull();
  });

  it("reads a push reply with or without the gateway's seq", () => {
    expect(parseVoiceRosterPushReply({ applied: false, seq: 9 })).toEqual({
      applied: false,
      seq: 9,
    });
    expect(parseVoiceRosterPushReply({ applied: true })).toEqual({
      applied: true,
    });
    expect(parseVoiceRosterPushReply({ applied: "yes" })).toBeNull();
    expect(parseVoiceRosterPushReply({ applied: true, seq: 1.5 })).toBeNull();
  });
});

describe("voiceRosterSessionOf", () => {
  it("turns a member a reset dropped back into the same member when held", () => {
    const [member] = buildVoiceRosterMembers(
      [session("s1", "u1", { self_mute: false, self_stream: true })],
      [],
      { graceMs: 120_000, now: NOW, fallbackJoinedAt: NOW },
    );
    const [held] = buildVoiceRosterMembers(
      [],
      [{ session: voiceRosterSessionOf(member), disconnectedAt: NOW }],
      { graceMs: 120_000, now: NOW, fallbackJoinedAt: NOW },
    );
    expect(held).toEqual({
      ...member,
      connected: false,
      connection_state: "reconnecting",
      disconnected_at: NOW,
      reconnect_expires_at: NOW + 120_000,
    });
  });
});

describe("resolveRoomVoiceChannelId", () => {
  it("prefers the ticket's channel id, else decodes the server voice slug", () => {
    expect(
      resolveRoomVoiceChannelId("dm-call-a-b", { channelId: "dm-1" }),
    ).toBe("dm-1");
    expect(
      resolveRoomVoiceChannelId("voice-srv-1-chan-9", { serverId: "srv-1" }),
    ).toBe("chan-9");
    expect(resolveRoomVoiceChannelId("dm-call-a-b", {})).toBeNull();
    expect(
      resolveRoomVoiceChannelId("voice-other-chan", { serverId: "srv-1" }),
    ).toBeNull();
  });
});

describe("VoiceRosterPusher", () => {
  function harness(results: boolean[]) {
    const sent: number[] = [];
    const sleeps: number[] = [];
    let gaveUp = 0;
    let delivered = 0;
    const waits: Promise<unknown>[] = [];
    let version = 0;
    const pusher = new VoiceRosterPusher({
      send: async () => {
        sent.push(version);
        return results.shift() ?? true;
      },
      onGiveUp: () => {
        gaveUp += 1;
      },
      onDelivered: () => {
        delivered += 1;
      },
      waitUntil: (promise) => waits.push(promise),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      backoffMs: [10, 20],
    });
    return {
      pusher,
      sent,
      sleeps,
      bump: () => (version += 1),
      stats: () => ({ gaveUp, delivered }),
    };
  }

  it("retries a failed push with backoff, then delivers", async () => {
    const h = harness([false, false, true]);
    h.pusher.request();
    await h.pusher.idle();
    expect(h.sent).toHaveLength(3);
    expect(h.sleeps).toEqual([10, 20]);
    expect(h.stats()).toEqual({ gaveUp: 0, delivered: 1 });
  });

  it("gives up after the last backoff so the alarm can retry", async () => {
    const h = harness([false, false, false]);
    h.pusher.request();
    await h.pusher.idle();
    expect(h.sent).toHaveLength(3);
    expect(h.stats()).toEqual({ gaveUp: 1, delivered: 0 });
  });

  it("sends one at a time and sends again for a change made meanwhile", async () => {
    const h = harness([]);
    h.pusher.request();
    h.bump();
    // A request while one is in flight does not start a second send.
    h.pusher.request();
    h.pusher.request();
    await h.pusher.idle();
    // The first send saw version 0; the change made during it is sent next.
    expect(h.sent).toEqual([0, 1]);
  });
});
