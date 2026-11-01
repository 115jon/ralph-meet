import type { CallRecord } from "@ralph/protocol";
import { describe, expect, it } from "vitest";

import { buildRows } from "@/features/chat/rows";
import type { ChatMessage } from "@/features/chat/store";
import { dmCallRoomSlug } from "@/features/voice/protocol";

import { callPreview, isMissedRingStop, unreachableText } from "./record";

const MISSED: CallRecord = {
  call_id: "c1",
  outcome: "missed",
  caller_id: "ada",
  callee_id: "bob",
};

describe("callPreview", () => {
  it("says it from the viewer's side", () => {
    expect(callPreview(MISSED, "bob")).toBe("Missed call");
    expect(callPreview(MISSED, "ada")).toBe("You called · no answer");
    expect(callPreview({ ...MISSED, outcome: "declined" }, "ada")).toBe(
      "Call declined",
    );
    expect(callPreview({ ...MISSED, outcome: "ended" }, "bob")).toBe(
      "Called you",
    );
  });
});

describe("ring stops", () => {
  it("counts only unanswered stops as missed", () => {
    for (const reason of [
      "timeout",
      "cancelled",
      "abandoned",
      "disconnected",
    ]) {
      expect(isMissedRingStop(reason)).toBe(true);
    }
    for (const reason of ["accepted", "declined", "busy"]) {
      expect(isMissedRingStop(reason)).toBe(false);
    }
  });

  it("explains a ring that never started, and nothing else", () => {
    expect(unreachableText("busy", "Ada")).toBe("Ada is in another call");
    expect(unreachableText("unavailable", "Ada")).toBe(
      "Ada can't take calls right now",
    );
    expect(unreachableText("timeout", "Ada")).toBeNull();
  });
});

describe("DM call rooms", () => {
  it("name the room the server does, whoever calls", () => {
    expect(dmCallRoomSlug("u-b", "u-a")).toBe("dm-call-u-a-u-b");
    expect(dmCallRoomSlug("u-a", "u-b")).toBe("dm-call-u-a-u-b");
  });
});

describe("call rows", () => {
  const at = (minute: number) =>
    new Date(Date.UTC(2026, 10, 1, 21, minute)).toISOString();
  const message = (
    id: string,
    minute: number,
    extra: Partial<ChatMessage> = {},
  ): ChatMessage => ({
    id,
    channel_id: "dm",
    author_id: "ada",
    content: id,
    created_at: at(minute),
    ...extra,
  });

  it("draws a call record as its own row and never groups across it", () => {
    const rows = buildRows([
      message("after", 3),
      message("record", 2, {
        type: "call",
        content: "Missed call",
        call: MISSED,
      }),
      message("before", 1),
    ]);

    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get("record")).toMatchObject({ kind: "call", call: MISSED });
    const after = byKey.get("after");
    expect(after?.kind === "message" && after.grouped).toBe(false);
  });
});
