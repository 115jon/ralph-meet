import { describe, expect, it } from "vitest";

import { resolveVoiceIdentity } from "@/lib/voice-identity";

describe("resolveVoiceIdentity", () => {
  it("prefers display names over stale raw names", () => {
    const identity = resolveVoiceIdentity({
      name: "legacy-name",
      username: "alice",
      display_name: "Alice Display",
      avatar_url: null,
    });

    expect(identity.name).toBe("Alice Display");
    expect(identity.displayName).toBe("Alice Display");
    expect(identity.username).toBe("alice");
  });

  it("prefers the later avatar source for voice identities", () => {
    const identity = resolveVoiceIdentity(
      {
        name: "Alice Fresh",
        username: "alice-fresh",
        display_name: "Alice Fresh",
        avatar_url: "/stale.png",
      },
      {
        name: "Alice Fresh",
        username: "alice-fresh",
        display_name: "Alice Fresh",
        avatar_url: "/fresh.png",
      },
    );

    expect(identity.name).toBe("Alice Fresh");
    expect(identity.displayName).toBe("Alice Fresh");
    expect(identity.username).toBe("alice-fresh");
    expect(identity.avatarUrl).toBe("/fresh.png");
  });

  it("does not fall back to a stale display name when fresher profile data clears it", () => {
    const identity = resolveVoiceIdentity(
      {
        name: "alice-new",
        username: "alice-new",
        display_name: null,
        avatar_url: "/fresh.png",
      },
      {
        name: "Alice Stale",
        username: "alice-old",
        display_name: "Alice Stale",
        avatar_url: "/stale.png",
      },
    );

    expect(identity.name).toBe("alice-new");
    expect(identity.displayName).toBe("alice-new");
    expect(identity.username).toBe("alice-new");
  });

});
