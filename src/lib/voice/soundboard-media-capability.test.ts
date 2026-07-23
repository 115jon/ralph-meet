import { describe, expect, it } from "vitest";

import {
  getSoundboardMediaCapabilityUrl,
  issueSoundboardMediaCapability,
  verifySoundboardMediaCapability,
} from "./soundboard-media-capability";

const secret = "realtime-secret";
const claims = {
  soundId: "sound-1",
  sourceServerId: "server-1",
  roomSlug: "dm-call-user-1-user-2",
  playbackId: "sb1:6:user-1:sound-1",
  issuerSubject: "user-1",
  expiresAt: 2_000,
};

describe("soundboard media capabilities", () => {
  it("verifies a valid capability", async () => {
    const token = await issueSoundboardMediaCapability(claims, secret);

    await expect(
      verifySoundboardMediaCapability(token, secret, {
        now: 1_000,
        ...claims,
      }),
    ).resolves.toEqual({ ok: true, claims });
  });

  it("rejects an expired capability", async () => {
    const token = await issueSoundboardMediaCapability(claims, secret);

    await expect(
      verifySoundboardMediaCapability(token, secret, {
        now: claims.expiresAt,
        soundId: claims.soundId,
      }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it.each([
    ["room", { roomSlug: "dm-call-user-1-user-3" }],
    ["sound", { soundId: "sound-2" }],
    ["server", { sourceServerId: "server-2" }],
    ["playback", { playbackId: "sb1:6:user-1:sound-2" }],
  ] as const)(
    "rejects a capability with the wrong %s",
    async (_field, context) => {
      const token = await issueSoundboardMediaCapability(claims, secret);

      await expect(
        verifySoundboardMediaCapability(token, secret, {
          now: 1_000,
          ...context,
        }),
      ).resolves.toEqual({ ok: false, reason: `${_field}_mismatch` });
    },
  );

  it("rejects a tampered capability", async () => {
    const token = await issueSoundboardMediaCapability(claims, secret);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    await expect(
      verifySoundboardMediaCapability(tampered, secret, {
        now: 1_000,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("binds room and playback context into the media URL", async () => {
    const token = await issueSoundboardMediaCapability(claims, secret);
    const url = new URL(
      getSoundboardMediaCapabilityUrl(claims.soundId, token, claims),
      "https://meet.test",
    );

    expect(url.pathname).toBe("/api/soundboard/uploads/sound-1");
    expect(url.searchParams.get("cap")).toBe(token);
    expect(url.searchParams.get("room_slug")).toBe(claims.roomSlug);
    expect(url.searchParams.get("playback_id")).toBe(claims.playbackId);
  });
});
