import { describe, expect, it } from "vitest";

import { issueSocketTicket } from "./socket-ticket";
import {
  issueVoiceMoveGrant,
  openVoiceMoveGrant,
  VOICE_MOVE_GRANT_TTL_MS,
} from "./voice-move-grant";

const SECRET = "test-secret";
const claims = {
  jti: "move-1",
  subject: "user-1",
  serverId: "server-1",
  channelId: "channel-2",
  expiresAt: 2_000,
};
const expected = { subject: "user-1", channelId: "channel-2", now: 1_000 };

describe("voice move grants", () => {
  it("lives about 90 seconds", () => {
    expect(VOICE_MOVE_GRANT_TTL_MS).toBe(90_000);
  });

  it("opens to its id for the user and channel it names, until it expires", async () => {
    const grant = await issueVoiceMoveGrant(claims, SECRET);
    await expect(openVoiceMoveGrant(grant, SECRET, expected)).resolves.toEqual({
      jti: "move-1",
      expiresAt: 2_000,
    });
    await expect(
      openVoiceMoveGrant(grant, SECRET, {
        ...expected,
        serverId: "server-1",
      }),
    ).resolves.not.toBeNull();
    await expect(
      openVoiceMoveGrant(grant, SECRET, { ...expected, now: 2_000 }),
    ).resolves.toBeNull();
  });

  it("refuses another user, channel, server or secret", async () => {
    const grant = await issueVoiceMoveGrant(claims, SECRET);
    for (const [check, secret] of [
      [{ ...expected, subject: "user-2" }, SECRET],
      [{ ...expected, channelId: "channel-3" }, SECRET],
      [{ ...expected, serverId: "server-9" }, SECRET],
      [expected, "other-secret"],
      [expected, undefined],
    ] as const) {
      await expect(
        openVoiceMoveGrant(grant, secret, check),
      ).resolves.toBeNull();
    }
  });

  it("refuses a tampered grant, a socket ticket, or junk", async () => {
    const grant = await issueVoiceMoveGrant(claims, SECRET);
    const [version, , signature] = grant.split(".");
    const forged = btoa(
      JSON.stringify({ jti: "x", sub: "user-1", ch: "channel-2", exp: 9e15 }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const ticket = await issueSocketTicket(
      {
        accessMode: "authenticated",
        audience: "room",
        expiresAt: 2_000,
        nonce: "nonce-123456",
        roomSlug: "voice-server-1-channel-2",
        subject: "user-1",
      },
      SECRET,
    );
    for (const value of [
      `${version}.${forged}.${signature}`,
      ticket,
      "",
      42,
      null,
    ]) {
      await expect(
        openVoiceMoveGrant(value, SECRET, expected),
      ).resolves.toBeNull();
    }
  });
});
