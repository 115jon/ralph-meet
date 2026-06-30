import { describe, expect, it } from "vitest";

import { buildVoiceDiagnosticsBundle } from "./diagnostics";

describe("buildVoiceDiagnosticsBundle", () => {
  it("adds support context and strips query strings from page URLs", () => {
    const bundle = buildVoiceDiagnosticsBundle({
      detailedStats: { ping: 42 },
      connectionStats: null,
      channelName: "General",
      locationHref: "https://meet.example/chat?token=secret#frag",
      userAgent: "TestBrowser",
      now: () => new Date("2026-06-30T12:00:00.000Z"),
    });

    expect(bundle).toMatchObject({
      app: "Ralph Meet",
      copiedAt: "2026-06-30T12:00:00.000Z",
      channelName: "General",
      page: "https://meet.example/chat",
      userAgent: "TestBrowser",
      detailedStats: { ping: 42 },
    });
  });

  it("redacts token and user id shaped diagnostic fields", () => {
    const bundle = buildVoiceDiagnosticsBundle({
      detailedStats: {
        voiceToken: "secret",
        clerk_user_id: "user-123",
        nested: { authorization: "Bearer nope" },
      },
      connectionStats: null,
    });

    expect(bundle.detailedStats).toEqual({
      voiceToken: "[redacted]",
      clerk_user_id: "[redacted]",
      nested: { authorization: "[redacted]" },
    });
  });
});
