import { describe, expect, it } from "vitest";

import {
  issueSocketTicket,
  verifySocketTicket,
  type SocketTicketClaims,
} from "./socket-ticket";

const secret = "test-secret-for-socket-ticket";

const claims: SocketTicketClaims = {
  audience: "room",
  expiresAt: 1_800_000_000_000,
  nonce: "ticket-nonce-123456",
  roomSlug: "voice-server-1-channel-1",
  subject: "user-123",
};

describe("socket tickets", () => {
  it("verifies a ticket for its bound room and audience", async () => {
    const ticket = await issueSocketTicket(claims, secret);

    await expect(
      verifySocketTicket(ticket, secret, {
        audience: "room",
        now: claims.expiresAt - 1,
        roomSlug: claims.roomSlug,
      }),
    ).resolves.toEqual({ ok: true, claims });
  });

  it("rejects a valid ticket when used for another socket audience", async () => {
    const ticket = await issueSocketTicket(claims, secret);

    await expect(
      verifySocketTicket(ticket, secret, {
        audience: "voice",
        now: claims.expiresAt - 1,
        roomSlug: claims.roomSlug,
      }),
    ).resolves.toEqual({ ok: false, reason: "audience_mismatch" });
  });

  it("rejects an expired ticket", async () => {
    const ticket = await issueSocketTicket(claims, secret);

    await expect(
      verifySocketTicket(ticket, secret, {
        audience: "room",
        now: claims.expiresAt,
        roomSlug: claims.roomSlug,
      }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed ticket input without exposing a parser error", async () => {
    await expect(
      verifySocketTicket("not-a-ticket", secret, {
        audience: "room",
        now: claims.expiresAt - 1,
        roomSlug: claims.roomSlug,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });
});
