import { describe, expect, it } from "vitest";

import { evictChannels, trimChannel } from "./cache";
import type { ChannelMessages, ChatMessage } from "./store";

function message(id: string, send?: ChatMessage["send"]): ChatMessage {
  return {
    id,
    channel_id: "c",
    author_id: "u",
    content: id,
    created_at: "2026-11-01T00:00:00.000Z",
    send,
  };
}

function channel(count: number): ChannelMessages {
  return {
    status: "ready",
    messages: Array.from({ length: count }, (_, i) => message(`m${i}`)),
    hasMore: false,
    loadingOlder: false,
  };
}

describe("trimChannel", () => {
  it("leaves a short history alone", () => {
    const c = channel(3);
    expect(trimChannel(c, 5)).toBe(c);
  });

  it("keeps the newest messages and says more remain", () => {
    const trimmed = trimChannel(channel(10), 4);
    expect(trimmed.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(trimmed.hasMore).toBe(true);
  });

  it("never drops an unsent row", () => {
    const c = channel(6);
    const withFailed: ChannelMessages = {
      ...c,
      messages: [...c.messages, message("failed", "failed")],
    };
    const ids = trimChannel(withFailed, 2).messages.map((m) => m.id);
    expect(ids).toEqual(["m0", "m1", "failed"]);
  });
});

describe("evictChannels", () => {
  it("keeps only the most recently opened", () => {
    const channels = { a: channel(1), b: channel(1), c: channel(1) };
    expect(Object.keys(evictChannels(channels, ["c", "a", "b"], 2))).toEqual([
      "a",
      "c",
    ]);
  });

  it("returns the same object when nothing goes", () => {
    const channels = { a: channel(1) };
    expect(evictChannels(channels, ["a", "b"], 2)).toBe(channels);
  });
});
