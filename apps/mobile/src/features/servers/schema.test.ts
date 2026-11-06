import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { VoiceMemberSchema } from "./schema";

const decode = Schema.decodeUnknownSync(VoiceMemberSchema);

describe("VoiceMemberSchema", () => {
  it("keeps the room's connected flag, so a held seat can be dimmed", () => {
    expect(
      decode({ user_id: "u1", name: "Ada", connected: false }).connected,
    ).toBe(false);
    expect(decode({ user_id: "u1", connected: true }).connected).toBe(true);
  });

  it("decodes a member without it (older rooms and deltas)", () => {
    expect(decode({ user_id: "u1", name: "Ada" }).connected).toBeUndefined();
  });
});
