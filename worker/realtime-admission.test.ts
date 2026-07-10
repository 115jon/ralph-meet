import { describe, expect, it } from "vitest";

import {
  appendRealtimeAdmissionHeaders,
  createRealtimeAdmissionContext,
  getRealtimeAdmissionConfig,
  getRealtimeAdmissionFromHeaders,
  stripRealtimeAdmissionHeaders,
} from "./realtime-admission";
import type { SocketTicketClaims } from "../src/lib/voice/socket-ticket";

const claims: SocketTicketClaims = {
  accessMode: "authenticated",
  audience: "voice",
  expiresAt: 1_800_000_000_000,
  nonce: "nonce-123456789",
  roomSlug: "voice-server-channel",
  subject: "user-123",
};

describe("realtime admission", () => {
  it("fails closed when the ticket secret is missing", () => {
    expect(getRealtimeAdmissionConfig({})).toEqual({ ok: false, reason: "missing_ticket_secret" });
  });

  it("accepts a configured ticket secret", () => {
    expect(getRealtimeAdmissionConfig({
      REALTIME_TICKET_SECRET: "ticket-secret",
    })).toEqual({ ok: true, config: { ticketSecret: "ticket-secret" } });
  });

  it("round-trips only verified admission context through internal headers", async () => {
    const context = await createRealtimeAdmissionContext(claims);
    const headers = appendRealtimeAdmissionHeaders(new Headers({
      "x-ralph-realtime-subject": "attacker",
    }), context);

    expect(getRealtimeAdmissionFromHeaders(headers)).toEqual(context);
  });

  it("strips forged admission headers from incoming requests", () => {
    const headers = stripRealtimeAdmissionHeaders(new Headers({
      "x-ralph-realtime-subject": "attacker",
      "x-other-header": "kept",
    }));

    expect(headers.get("x-ralph-realtime-subject")).toBeNull();
    expect(headers.get("x-other-header")).toBe("kept");
  });
});
