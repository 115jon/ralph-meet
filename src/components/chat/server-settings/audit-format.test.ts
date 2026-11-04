import { describe, expect, it } from "vitest";

import { describeAudit, type AuditLookup } from "./audit-format";

const lookup: AuditLookup = {
  roles: new Map(),
  members: new Map([["user-2", "Sam"]]),
  channels: new Map([
    ["voice-a", { name: "General", voice: true }],
    ["voice-b", { name: "Lounge", voice: true }],
  ]),
};

describe("describeAudit MEMBER_MOVE", () => {
  it("reads as moved Sam from one voice channel to another", () => {
    expect(
      describeAudit(
        {
          id: "log-1",
          server_id: "server-1",
          actor_id: "mod-1",
          action_type: "MEMBER_MOVE",
          target_id: "user-2",
          changes: { from_channel_id: "voice-a", to_channel_id: "voice-b" },
          created_at: "2026-11-04T00:00:00Z",
        },
        lookup,
      ),
    ).toEqual({
      verb: "moved",
      target: { kind: "member", label: "Sam", named: true, id: "user-2" },
      details: [{ type: "text", text: "From General to Lounge" }],
    });
  });

  it("drops channel names it no longer knows", () => {
    expect(
      describeAudit(
        {
          id: "log-2",
          server_id: "server-1",
          actor_id: "mod-1",
          action_type: "MEMBER_MOVE",
          target_id: "user-2",
          changes: { from_channel_id: "gone", to_channel_id: "gone-too" },
          created_at: "2026-11-04T00:00:00Z",
        },
        lookup,
      ).details,
    ).toEqual([]);
  });
});
