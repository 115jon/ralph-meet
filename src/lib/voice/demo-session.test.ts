import { describe, expect, it } from "vitest";

import { getOrCreateDemoSession } from "./demo-session";

const secret = "test-demo-session-secret";

describe("demo sessions", () => {
  it("creates a signed HttpOnly session and resumes it from a cookie", async () => {
    const first = await getOrCreateDemoSession(
      new Request("https://meet.test/api/voice/socket-ticket"),
      secret,
      1_000,
    );

    expect(first.subject).toMatch(/^demo-/);
    expect(first.cookie).toContain("HttpOnly");
    expect(first.cookie).toContain("Secure");
    expect(first.cookie).toContain("SameSite=Strict");

    const cookie = first.cookie?.split(";", 1)[0];
    if (!cookie) throw new Error("Expected demo session cookie");
    const second = await getOrCreateDemoSession(
      new Request("https://meet.test/api/voice/socket-ticket", {
        headers: { cookie },
      }),
      secret,
      2_000,
    );

    expect(second).toEqual({ cookie: null, subject: first.subject });
  });

  it("replaces a tampered or expired cookie", async () => {
    const first = await getOrCreateDemoSession(
      new Request("https://meet.test/api/voice/socket-ticket"),
      secret,
      1_000,
    );
    const cookie = first.cookie?.split(";", 1)[0] ?? "";
    const tampered = `${cookie}x`;

    const replacement = await getOrCreateDemoSession(
      new Request("https://meet.test/api/voice/socket-ticket", {
        headers: { cookie: tampered },
      }),
      secret,
      2_000,
    );
    expect(replacement.cookie).not.toBeNull();
    expect(replacement.subject).not.toBe(first.subject);

    const expired = await getOrCreateDemoSession(
      new Request("https://meet.test/api/voice/socket-ticket", {
        headers: { cookie },
      }),
      secret,
      1_000 + 24 * 60 * 60 * 1000,
    );
    expect(expired.cookie).not.toBeNull();
    expect(expired.subject).not.toBe(first.subject);
  });
});
