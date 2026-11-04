import { describe, expect, it } from "vitest";

import { issueSocketTicket } from "./socket-ticket";
import { issueVoiceMoveGrant, verifyVoiceMoveGrant } from "./voice-move-grant";

const SECRET = "test-secret";
const claims = {
  subject: "user-1",
  serverId: "server-1",
  channelId: "channel-2",
  expiresAt: 2_000,
};
const expected = { subject: "user-1", channelId: "channel-2", now: 1_000 };

describe("voice move grants", () => {
  it("verifies for the user and channel they name, until they expire", async () => {
    const grant = await issueVoiceMoveGrant(claims, SECRET);
    await expect(verifyVoiceMoveGrant(grant, SECRET, expected)).resolves.toBe(
      true,
    );
    await expect(
      verifyVoiceMoveGrant(grant, SECRET, {
        ...expected,
        serverId: "server-1",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyVoiceMoveGrant(grant, SECRET, { ...expected, now: 2_000 }),
    ).resolves.toBe(false);
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
      await expect(verifyVoiceMoveGrant(grant, secret, check)).resolves.toBe(
        false,
      );
    }
  });

  it("refuses a tampered grant, a socket ticket, or junk", async () => {
    const grant = await issueVoiceMoveGrant(claims, SECRET);
    const [version, , signature] = grant.split(".");
    const forged = btoa(JSON.stringify({ sub: "user-1", ch: "channel-2" }))
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
      await expect(verifyVoiceMoveGrant(value, SECRET, expected)).resolves.toBe(
        false,
      );
    }
  });
});
