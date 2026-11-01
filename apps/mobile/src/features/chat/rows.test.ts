import { describe, expect, it } from "vitest";

import { buildRows, UNREAD_KEY } from "./rows";
import type { ChatMessage } from "./store";

const me = "me";

function message(
  id: string,
  minute: number,
  author = "kai",
  send?: ChatMessage["send"],
): ChatMessage {
  return {
    id,
    channel_id: "c",
    author_id: author,
    content: id,
    created_at: new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString(),
    send,
  };
}

/** Newest first, as the store keeps them. */
const history = [
  message("m4", 4),
  message("m3", 3),
  message("m2", 2),
  message("m1", 1),
];

const at = (minute: number) =>
  new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString();

function keys(rows: ReturnType<typeof buildRows>): string[] {
  return rows.filter((row) => row.kind !== "day").map((row) => row.key);
}

describe("buildRows unread line", () => {
  it("sits above the first message after the read mark", () => {
    const rows = buildRows(history, { readAt: at(2), myId: me });
    expect(keys(rows)).toEqual(["m4", "m3", UNREAD_KEY, "m2", "m1"]);
  });

  it("breaks the group at the line", () => {
    const rows = buildRows(history, { readAt: at(2), myId: me });
    const first = rows.find((row) => row.key === "m3");
    expect(first?.kind === "message" && first.grouped).toBe(false);
  });

  it("is absent when everything was read", () => {
    const rows = buildRows(history, { readAt: at(9), myId: me });
    expect(keys(rows)).not.toContain(UNREAD_KEY);
  });

  it("is absent when only my own messages came since", () => {
    const mine = [message("x2", 6, me), message("x1", 5, me), ...history];
    const rows = buildRows(mine, { readAt: at(4), myId: me });
    expect(keys(rows)).not.toContain(UNREAD_KEY);
  });

  it("ignores unsent rows and a missing read mark", () => {
    const pending = [message("p", 9, me, "sending"), ...history];
    expect(keys(buildRows(pending, { readAt: at(4), myId: me }))).not.toContain(
      UNREAD_KEY,
    );
    expect(
      keys(buildRows(history, { readAt: undefined, myId: me })),
    ).not.toContain(UNREAD_KEY);
  });

  it("reads SQLite timestamps", () => {
    const rows = buildRows(history, {
      readAt: "2026-11-01 12:02:00",
      myId: me,
    });
    expect(keys(rows)).toEqual(["m4", "m3", UNREAD_KEY, "m2", "m1"]);
  });
});
