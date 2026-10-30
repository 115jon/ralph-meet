import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/types";
import { buildMessageRows } from "../message-rows";

function at(y: number, m: number, d: number, h: number, min = 0) {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function msg(id: string, author: string, created_at: string): Message {
  return {
    id,
    channel_id: "c",
    author_id: author,
    content: id,
    is_pinned: false,
    created_at,
  };
}

describe("buildMessageRows day dividers", () => {
  const messages = [
    msg("a", "u1", at(2026, 10, 21, 23, 58)),
    msg("b", "u1", at(2026, 10, 22, 0, 1)),
    msg("c", "u1", at(2026, 10, 22, 0, 2)),
  ];

  it("places a divider at each local day change and breaks the group there", () => {
    const rows = buildMessageRows(messages, null, true);
    expect(rows.map((r) => r.showDayDivider)).toEqual([true, true, false]);
    // b is 3 minutes after a from the same author, but a new day starts a
    // new group.
    expect(rows[1]!.showHeader).toBe(true);
    expect(rows[2]!.showHeader).toBe(false);
  });

  it("skips the leading divider while older history can still prepend", () => {
    const rows = buildMessageRows(messages, null, false);
    expect(rows[0]!.showDayDivider).toBe(false);
    expect(rows[1]!.showDayDivider).toBe(true);
  });
});
