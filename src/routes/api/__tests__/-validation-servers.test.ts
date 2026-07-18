import { describe, expect, it } from "vitest";

import { validateBody } from "@/lib/validate-body";
import { banCreateBodySchema, banDeleteBodySchema } from "../servers/$id/bans";
import { inviteCreateBodySchema } from "../servers/$id/invites";
import { memberRolesBodySchema } from "../servers/$id/members/$userId/roles";
import { roleCreateBodySchema } from "../servers/$id/roles";
import { roleUpdateBodySchema } from "../servers/$id/roles/$roleId";

function jsonRequest(body: string): Request {
  return new Request("https://meet.test/api/servers/server-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const schemas = [
  ["ban creation", banCreateBodySchema],
  ["ban deletion", banDeleteBodySchema],
  ["invite creation", inviteCreateBodySchema],
  ["role creation", roleCreateBodySchema],
  ["role updates", roleUpdateBodySchema],
  ["member role updates", memberRolesBodySchema],
] as const;

describe("server request body validation", () => {
  it.each(schemas)(
    "rejects malformed JSON for %s with INVALID_JSON",
    async (_name, schema) => {
      const result = await validateBody(jsonRequest("{not json"), schema);

      expect(result).toBeInstanceOf(Response);
      if (!(result instanceof Response)) throw new Error("expected Response");
      expect(result.status).toBe(400);
      await expect(result.json()).resolves.toMatchObject({
        code: "INVALID_JSON",
      });
    },
  );

  it.each([
    ["ban creation", banCreateBodySchema, { user_id: 123 }],
    ["ban deletion", banDeleteBodySchema, { user_id: false }],
    ["invite creation", inviteCreateBodySchema, { max_uses: "unlimited" }],
    ["role creation", roleCreateBodySchema, { permissions: "all" }],
    ["role updates", roleUpdateBodySchema, { position: "top" }],
    ["member role updates", memberRolesBodySchema, { roleIds: [123] }],
  ] as const)(
    "rejects structurally invalid %s bodies with INVALID_BODY",
    async (_name, schema, body) => {
      const result = await validateBody(
        jsonRequest(JSON.stringify(body)),
        schema,
      );

      expect(result).toBeInstanceOf(Response);
      if (!(result instanceof Response)) throw new Error("expected Response");
      expect(result.status).toBe(400);
      await expect(result.json()).resolves.toMatchObject({
        code: "INVALID_BODY",
      });
    },
  );

  it.each([
    [
      "ban creation",
      banCreateBodySchema,
      { user_id: "user-2", reason: "spam" },
    ],
    ["ban deletion", banDeleteBodySchema, { user_id: "user-2" }],
    [
      "invite creation",
      inviteCreateBodySchema,
      { channel_id: "channel-1", max_uses: 5, max_age: 3600, temporary: true },
    ],
    [
      "role creation",
      roleCreateBodySchema,
      { name: "Moderator", color: "#5865f2", permissions: 8 },
    ],
    [
      "role updates",
      roleUpdateBodySchema,
      { name: "Moderator", color: null, permissions: 8, position: 2 },
    ],
    ["member role updates", memberRolesBodySchema, { roleIds: ["role-1"] }],
  ] as const)(
    "accepts a representative valid %s structure",
    async (_name, schema, body) => {
      const result = await validateBody(
        jsonRequest(JSON.stringify(body)),
        schema,
      );

      expect(result).not.toBeInstanceOf(Response);
    },
  );
});
