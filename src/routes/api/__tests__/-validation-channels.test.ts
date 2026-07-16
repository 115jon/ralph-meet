import { describe, expect, it } from "vitest";

import { validateBody } from "@/lib/validate-body";
import { gifUploadBodySchema } from "../channels/$id/messages/gif";
import { permissionOverrideBodySchema } from "../channels/$id/permissions/$targetId";
import { pinsBodySchema } from "../channels/$id/pins";
import { voiceDisconnectBodySchema } from "../channels/$id/voice-disconnect";

function jsonRequest(body: string): Request {
  return new Request("https://meet.test/api/channels/channel-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("channel request body validation", () => {
  it.each([
    ["pins", pinsBodySchema],
    ["GIF uploads", gifUploadBodySchema],
    ["voice disconnects", voiceDisconnectBodySchema],
    ["permission overrides", permissionOverrideBodySchema],
  ])("rejects malformed JSON for %s with a 400", async (_name, schema) => {
    const result = await validateBody(jsonRequest("{not json"), schema);

    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("expected Response");
    expect(result.status).toBe(400);
  });

  it.each([
    ["pins", pinsBodySchema, { message_id: 123, pinned: "yes" }],
    ["GIF uploads", gifUploadBodySchema, { source_url: 123 }],
    [
      "voice disconnects",
      voiceDisconnectBodySchema,
      { gateway_session_id: 123 },
    ],
    [
      "permission overrides",
      permissionOverrideBodySchema,
      { target_type: 123, allow: "read", deny: false },
    ],
  ])(
    "rejects structurally invalid %s bodies with a 400",
    async (_name, schema, body) => {
      const result = await validateBody(
        jsonRequest(JSON.stringify(body)),
        schema,
      );

      expect(result).toBeInstanceOf(Response);
      if (!(result instanceof Response)) throw new Error("expected Response");
      expect(result.status).toBe(400);
    },
  );

  it.each([
    ["pins", pinsBodySchema, { message_id: "message-1", pinned: true }],
    [
      "GIF uploads",
      gifUploadBodySchema,
      {
        source_url: "https://media.tenor.com/gif.gif",
        provider: "tenor",
        size_bytes: 1024,
      },
    ],
    [
      "voice disconnects",
      voiceDisconnectBodySchema,
      { server_id: null, gateway_session_id: "gateway-1" },
    ],
    [
      "permission overrides",
      permissionOverrideBodySchema,
      { target_type: "role", allow: 1, deny: 2 },
    ],
  ])(
    "accepts representative valid %s structures",
    async (_name, schema, body) => {
      const result = await validateBody(
        jsonRequest(JSON.stringify(body)),
        schema,
      );

      expect(result).not.toBeInstanceOf(Response);
    },
  );
});
