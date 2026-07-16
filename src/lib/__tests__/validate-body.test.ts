import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateBody } from "../validate-body";

function jsonRequest(body: unknown): Request {
  return new Request("https://meet.test/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const schema = z.object({
  content: z.string().default(""),
  attachment_ids: z.array(z.string()).optional(),
});

describe("validateBody", () => {
  it("returns parsed data for a valid body", async () => {
    const result = await validateBody(
      jsonRequest({ content: "hello", attachment_ids: ["a", "b"] }),
      schema,
    );
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) throw new Error("unexpected Response");
    expect(result.content).toBe("hello");
    expect(result.attachment_ids).toEqual(["a", "b"]);
  });

  it("applies defaults for omitted optional fields", async () => {
    const result = await validateBody(jsonRequest({}), schema);
    if (result instanceof Response) throw new Error("unexpected Response");
    expect(result.content).toBe("");
    expect(result.attachment_ids).toBeUndefined();
  });

  it("rejects a wrong-typed field with a 400 and structured code", async () => {
    const result = await validateBody(
      jsonRequest({ content: 123, attachment_ids: "not-an-array" }),
      schema,
    );
    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("expected Response");
    expect(result.status).toBe(400);
    const payload = (await result.json()) as { error: string; code: string };
    expect(payload.code).toBe("INVALID_BODY");
    expect(payload.error).toContain("content");
  });

  it("rejects non-JSON bodies with INVALID_JSON", async () => {
    const badRequest = new Request("https://meet.test/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const result = await validateBody(badRequest, schema);
    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("expected Response");
    expect(result.status).toBe(400);
    const payload = (await result.json()) as { code: string };
    expect(payload.code).toBe("INVALID_JSON");
  });

  it("rejects array element type mismatches", async () => {
    const result = await validateBody(
      jsonRequest({ content: "ok", attachment_ids: [1, 2, 3] }),
      schema,
    );
    expect(result).toBeInstanceOf(Response);
  });
});
