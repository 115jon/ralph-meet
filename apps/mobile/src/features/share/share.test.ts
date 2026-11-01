import { describe, expect, it } from "vitest";

import { describePayload, payloadOf } from "./payload";
import { shareTargets, type TargetSources } from "./targets";

describe("payloadOf", () => {
  it("turns shared files into attach-tray files", () => {
    const payload = payloadOf({
      files: [
        {
          path: "file:///cache/a.jpg",
          mimeType: "image/jpeg",
          fileName: "a.jpg",
          size: 1200,
          duration: null,
        },
        {
          path: "file:///cache/b.mp4",
          mimeType: "video/mp4",
          fileName: null,
          size: null,
          duration: 2500,
        },
      ],
      text: null,
    });
    expect(payload?.files).toEqual([
      {
        key: "share:file:///cache/a.jpg",
        uri: "file:///cache/a.jpg",
        name: "a.jpg",
        type: "image/jpeg",
        size: 1200,
        kind: "image",
        duration: null,
      },
      {
        key: "share:file:///cache/b.mp4",
        uri: "file:///cache/b.mp4",
        name: "b.mp4",
        type: "video/mp4",
        size: null,
        kind: "video",
        duration: 2.5,
      },
    ]);
    expect(describePayload(payload!)).toBe("A photo, a video");
  });

  it("keeps text and drops an empty share", () => {
    expect(payloadOf({ files: null, text: "  hello  " })).toEqual({
      files: [],
      text: "hello",
    });
    expect(payloadOf({ files: [], text: "   " })).toBeNull();
    expect(describePayload({ files: [], text: "hi" })).toBe("Text");
  });
});

const SOURCES: TargetSources = {
  dms: [
    {
      id: "dm-1",
      created_at: "2026-10-01T00:00:00Z",
      recipient: { id: "u1", username: "ada", display_name: "Ada L" },
    },
  ],
  servers: [{ id: "s1", name: "Predators Only" }],
  trees: {
    s1: {
      status: "ready",
      categories: [],
      channels: [
        { id: "c1", name: "general", channel_type: "text", position: 0 },
        { id: "c2", name: "test", channel_type: "text", position: 1 },
        { id: "v1", name: "Lounge", channel_type: "voice", position: 2 },
      ],
    },
  },
  lastMessageAt: {
    c2: "2026-10-31T10:00:00Z",
    "dm-1": "2026-10-30T10:00:00Z",
    c1: "2026-10-01T10:00:00Z",
  },
};

describe("shareTargets", () => {
  it("lists DMs and text channels, most recent first", () => {
    expect(shareTargets(SOURCES, "").map((t) => t.channelId)).toEqual([
      "c2",
      "dm-1",
      "c1",
    ]);
  });

  it("searches names first, then servers and usernames", () => {
    expect(shareTargets(SOURCES, "#te").map((t) => t.channelId)).toEqual([
      "c2",
    ]);
    expect(shareTargets(SOURCES, "@ada").map((t) => t.channelId)).toEqual([
      "dm-1",
    ]);
    expect(shareTargets(SOURCES, "predators").map((t) => t.channelId)).toEqual([
      "c2",
      "c1",
    ]);
    expect(shareTargets(SOURCES, "lounge")).toEqual([]);
  });
});
