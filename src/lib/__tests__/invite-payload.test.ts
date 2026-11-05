import { describe, expect, it } from "vitest";

import { inviteCreateBodySchema } from "../../routes/api/servers/$id/invites";
import { buildInvitePayload } from "../invite-payload";
import { validateBody } from "../validate-body";

describe("buildInvitePayload", () => {
  it("sends the expiry as max_age in seconds", () => {
    expect(buildInvitePayload({ expiresHours: 24, maxUses: 0 })).toEqual({
      max_age: 86_400,
    });
    expect(buildInvitePayload({ expiresHours: 168, maxUses: 5 })).toEqual({
      max_age: 604_800,
      max_uses: 5,
    });
  });

  it("omits never-expires and no-limit instead of sending null", () => {
    const payload = buildInvitePayload({ expiresHours: 0, maxUses: 0 });
    expect(payload).toEqual({});
    expect(Object.keys(payload)).toHaveLength(0);
  });

  it("produces a body the invite route's schema accepts", async () => {
    for (const options of [
      { expiresHours: 0, maxUses: 0 },
      { expiresHours: 1, maxUses: 1 },
    ]) {
      const request = new Request("https://meet.test/api/servers/s/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildInvitePayload(options)),
      });
      const result = await validateBody(request, inviteCreateBodySchema);
      expect(result).not.toBeInstanceOf(Response);
    }
  });
});
