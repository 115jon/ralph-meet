import { describe, expect, it } from "vitest";
import { issueVoiceToken, verifyVoiceToken } from "../voice-token";

const SECRET = "voice-token-test-secret";
const PARTICIPANT_ID = "participant-1";
const ROOM_SLUG = "room-1";

describe("voice token codec", () => {
  it("round-trips an authenticated token", async () => {
    const token = await issueVoiceToken({
      participantId: PARTICIPANT_ID,
      roomSlug: ROOM_SLUG,
      subject: "user-1",
      secret: SECRET,
      now: 1_700_000_000_000,
    });

    await expect(
      verifyVoiceToken({
        token,
        participantId: PARTICIPANT_ID,
        roomSlug: ROOM_SLUG,
        secret: SECRET,
        now: 1_700_000_001_000,
      }),
    ).resolves.toEqual({
      ok: true,
      subject: "user-1",
      timestamp: 1_700_000_000_000,
    });
  });

  it("round-trips an anonymous token with an empty subject", async () => {
    const token = await issueVoiceToken({
      participantId: PARTICIPANT_ID,
      roomSlug: ROOM_SLUG,
      secret: SECRET,
      now: 1_700_000_000_000,
    });

    await expect(
      verifyVoiceToken({
        token,
        participantId: PARTICIPANT_ID,
        roomSlug: ROOM_SLUG,
        secret: SECRET,
        now: 1_700_000_001_000,
      }),
    ).resolves.toMatchObject({ ok: true, subject: "anonymous" });
  });

  it.each([
    ["malformed", "not-a-token"],
    [
      "participant mismatch",
      "other-participant:room-1:1700000000000:user-1.invalid",
    ],
    ["room mismatch", "participant-1:other-room:1700000000000:user-1.invalid"],
  ])("rejects %s tokens", async (_name, token) => {
    await expect(
      verifyVoiceToken({
        token,
        participantId: PARTICIPANT_ID,
        roomSlug: ROOM_SLUG,
        secret: SECRET,
        now: 1_700_000_001_000,
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("rejects an expired token", async () => {
    const token = await issueVoiceToken({
      participantId: PARTICIPANT_ID,
      roomSlug: ROOM_SLUG,
      subject: "user-1",
      secret: SECRET,
      now: 1_700_000_000_000,
    });

    await expect(
      verifyVoiceToken({
        token,
        participantId: PARTICIPANT_ID,
        roomSlug: ROOM_SLUG,
        secret: SECRET,
        now: 1_700_000_000_000 + 60 * 60 * 1000 + 1,
      }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token with an invalid signature", async () => {
    const token = await issueVoiceToken({
      participantId: PARTICIPANT_ID,
      roomSlug: ROOM_SLUG,
      subject: "user-1",
      secret: SECRET,
      now: 1_700_000_000_000,
    });

    await expect(
      verifyVoiceToken({
        token: `${token.slice(0, -1)}x`,
        participantId: PARTICIPANT_ID,
        roomSlug: ROOM_SLUG,
        secret: SECRET,
        now: 1_700_000_001_000,
      }),
    ).resolves.toEqual({ ok: false, reason: "signature" });
  });
});
