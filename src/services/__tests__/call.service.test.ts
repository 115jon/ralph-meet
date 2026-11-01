import {
  callRecordFallbackText,
  describeCallRecord,
  formatCallDuration,
  type CallRecord,
} from "@ralph/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockD1 } from "@/lib/__tests__/mock-d1";
import type { FcmMessage, FcmSendResult } from "@/server/fcm";

import {
  buildCallRingPush,
  buildCallRingStopPush,
  callRecordFields,
  callRingTokens,
  insertCallRecord,
  isMissedRingStop,
  planCallRing,
  sendCallRingPushes,
  sendCallRingStopPushes,
  type CallRing,
} from "../call.service";

const RING: CallRing = {
  callId: "call-1",
  channelId: "dm-1",
  callerId: "ada",
  callerName: "Ada",
  callerAvatarUrl: "/api/avatars/ada",
  expiresAt: 30_000,
};

const ok = async (): Promise<FcmSendResult> => ({ ok: true });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("planCallRing", () => {
  it("rings a callee with a live socket and pushes to their phones too", () => {
    expect(planCallRing({ online: true, pushDevices: 0 })).toEqual({
      ring: true,
      push: false,
    });
    expect(planCallRing({ online: true, pushDevices: 2 })).toEqual({
      ring: true,
      push: true,
    });
  });

  it("keeps ringing a callee with no socket but a phone", () => {
    expect(planCallRing({ online: false, pushDevices: 1 })).toEqual({
      ring: true,
      push: true,
    });
  });

  it("is unavailable with neither", () => {
    expect(planCallRing({ online: false, pushDevices: 0 })).toEqual({
      ring: false,
      push: false,
    });
  });
});

describe("callRingTokens", () => {
  it("asks only for native tokens of a callee not on Do Not Disturb", async () => {
    const db = createMockD1();
    db.mockQuery("FROM push_tokens t", { results: [{ token: "phone" }] });

    expect(await callRingTokens(db as never, "bob")).toEqual(["phone"]);

    db.assertCalledWith("FROM push_tokens t", ["bob"]);
    const [call] = db.getCalls("FROM push_tokens t");
    expect(call?.sql).toMatch(/t\.push_format = 'native'/);
    expect(call?.sql).toMatch(/COALESCE\(u\.status, 'online'\) != 'dnd'/);
  });
});

describe("buildCallRingPush", () => {
  it("is data-only, high priority, and lives only as long as the ring", () => {
    expect(buildCallRingPush(RING, 4_500)).toEqual({
      data: {
        ralph: "2",
        kind: "call_ring",
        callId: "call-1",
        channelId: "dm-1",
        callerId: "ada",
        callerName: "Ada",
        callerAvatar: "/api/avatars/ada",
        ringSeconds: "26",
      },
      android: { priority: "HIGH", ttl: "26s" },
    });
  });

  it("never asks for a zero TTL and leaves a missing avatar out", () => {
    const push = buildCallRingPush({ ...RING, callerAvatarUrl: null }, 40_000);
    expect(push.android.ttl).toBe("1s");
    expect(push.data).not.toHaveProperty("callerAvatar");
  });
});

describe("buildCallRingStopPush", () => {
  it("keeps a missed call for a day, any other stop for a minute", () => {
    expect(buildCallRingStopPush(RING, "timeout")).toMatchObject({
      data: { kind: "call_ring_stop", callId: "call-1", reason: "timeout" },
      android: { priority: "HIGH", ttl: "86400s" },
    });
    expect(buildCallRingStopPush(RING, "accepted").android.ttl).toBe("60s");
    expect(buildCallRingStopPush(RING, "declined").android.ttl).toBe("60s");
  });

  it("counts every stop but an answer or a decline as missed", () => {
    expect(isMissedRingStop("timeout")).toBe(true);
    expect(isMissedRingStop("cancelled")).toBe(true);
    expect(isMissedRingStop("abandoned")).toBe(true);
    expect(isMissedRingStop("disconnected")).toBe(true);
    expect(isMissedRingStop("accepted")).toBe(false);
    expect(isMissedRingStop("declined")).toBe(false);
  });
});

describe("sending", () => {
  it("rings the given tokens and drops a dead one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = createMockD1();
    const send = vi.fn(
      async (token: string, _message: FcmMessage): Promise<FcmSendResult> =>
        token === "dead"
          ? { ok: false, status: 404, staleToken: true }
          : { ok: true },
    );

    await sendCallRingPushes(db as never, { send }, ["live", "dead"], RING);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[1].data.kind).toBe("call_ring");
    db.assertCalledWith("DELETE FROM push_tokens WHERE token = ?", ["dead"]);
  });

  it("stops the ring on every native token, DND or not", async () => {
    const db = createMockD1();
    db.mockQuery("FROM push_tokens", { results: [{ token: "phone" }] });
    const send = vi.fn(ok);

    await sendCallRingStopPushes(
      db as never,
      { send },
      "bob",
      RING,
      "accepted",
    );

    db.assertCalledWith(/push_format = 'native'/, ["bob"]);
    const [call] = db.getCalls("FROM push_tokens");
    expect(call?.sql).not.toMatch(/dnd/);
    expect(send).toHaveBeenCalledWith(
      "phone",
      buildCallRingStopPush(RING, "accepted"),
    );
  });

  it("does nothing without a sender and never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createMockD1();
    await sendCallRingPushes(db as never, null, ["t"], RING);
    await sendCallRingStopPushes(db as never, null, "bob", RING, "timeout");
    expect(db.calls).toHaveLength(0);

    const broken = {
      prepare: () => {
        throw new Error("D1 down");
      },
    };
    await expect(
      sendCallRingStopPushes(
        broken as never,
        { send: ok },
        "bob",
        RING,
        "timeout",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("call records", () => {
  const MISSED: CallRecord = {
    call_id: "call-1",
    outcome: "missed",
    caller_id: "ada",
    callee_id: "bob",
  };

  it("saves the record as a call message by the caller", async () => {
    const db = createMockD1();
    db.mockQuery("FROM users WHERE id = ?", {
      username: "ada",
      display_name: "Ada",
      avatar_url: null,
      avatar_display: null,
    });

    const message = await insertCallRecord(
      db as never,
      "dm-1",
      "msg-1",
      MISSED,
      "2026-11-01T21:52:00.000Z",
    );

    db.assertCalledWith("INSERT INTO messages", [
      "msg-1",
      "dm-1",
      "ada",
      "Missed call",
      "2026-11-01T21:52:00.000Z",
      "call",
      JSON.stringify(MISSED),
    ]);
    expect(message).toMatchObject({
      id: "msg-1",
      channel_id: "dm-1",
      author_id: "ada",
      author: { id: "ada", username: "ada", display_name: "Ada" },
      content: "Missed call",
      type: "call",
      call: MISSED,
    });
    expect(db.getCalls("message_postprocessing_jobs")).toHaveLength(0);
  });

  it("reads a stored row back, and ignores other rows", () => {
    expect(
      callRecordFields({ type: "call", metadata: JSON.stringify(MISSED) }),
    ).toEqual({ type: "call", call: MISSED });
    expect(callRecordFields({ type: null, metadata: null })).toBeNull();
    expect(callRecordFields({ type: "call", metadata: "{oops" })).toBeNull();
    expect(
      callRecordFields({
        type: "call",
        metadata: JSON.stringify({ ...MISSED, outcome: "weird" }),
      }),
    ).toBeNull();
  });

  it("words the row for each side of the call", () => {
    const names = { callerName: "Ada", calleeName: "Bob" };
    expect(describeCallRecord(MISSED, "bob", names)).toEqual({
      tone: "missed",
      text: "Missed call from Ada",
      duration: null,
    });
    expect(describeCallRecord(MISSED, "ada", names).text).toBe(
      "You called Bob · no answer",
    );
    const ended: CallRecord = { ...MISSED, outcome: "ended", duration_s: 862 };
    expect(describeCallRecord(ended, "bob", names)).toEqual({
      tone: "neutral",
      text: "Ada called",
      duration: "14:22",
    });
    expect(callRecordFallbackText(ended)).toBe("Call · 14:22");
    expect(formatCallDuration(3723)).toBe("1:02:03");
    expect(formatCallDuration(7)).toBe("0:07");
  });
});
