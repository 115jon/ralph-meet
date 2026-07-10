import { describe, expect, it } from "vitest";

import {
  buildSocketTicketProtocols,
  issueSocketTicket,
  parseSocketTicketProtocols,
  verifySocketTicket,
  type SocketTicketClaims,
} from "./socket-ticket";

const secret = "test-secret-for-socket-ticket";

const claims: SocketTicketClaims = {
  accessMode: "authenticated",
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
        accessMode: "authenticated",
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
        accessMode: "authenticated",
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
        accessMode: "authenticated",
        audience: "room",
        now: claims.expiresAt,
        roomSlug: claims.roomSlug,
      }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed ticket input without exposing a parser error", async () => {
    await expect(
      verifySocketTicket("not-a-ticket", secret, {
        accessMode: "authenticated",
        audience: "room",
        now: claims.expiresAt - 1,
        roomSlug: claims.roomSlug,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a ticket from another deployment access mode", async () => {
    const ticket = await issueSocketTicket(claims, secret);

    await expect(
      verifySocketTicket(ticket, secret, {
        accessMode: "public-demo",
        audience: "room",
        now: claims.expiresAt - 1,
        roomSlug: claims.roomSlug,
      }),
    ).resolves.toEqual({ ok: false, reason: "mode_mismatch" });
  });

  it("parses the stable websocket protocol without exposing the ticket", async () => {
    const ticket = await issueSocketTicket(claims, secret);
    const protocols = buildSocketTicketProtocols(ticket);

    expect(parseSocketTicketProtocols(protocols.join(", "))).toEqual({
      ok: true,
      value: {
        responseProtocol: "ralph.realtime.v1",
        ticket,
      },
    });
  });

  it("rejects missing, duplicate, and unsupported websocket protocols", async () => {
    const ticket = await issueSocketTicket(claims, secret);

    expect(parseSocketTicketProtocols(null)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(parseSocketTicketProtocols("ralph.realtime.v1")).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(
      parseSocketTicketProtocols(
        `ralph.realtime.v1, ralph.ticket.${ticket}, ralph.ticket.${ticket}`,
      ),
    ).toEqual({ ok: false, reason: "multiple" });
    expect(
      parseSocketTicketProtocols(
        `ralph.realtime.v1, ralph.ticket.${ticket}, unknown.protocol`,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });
});
