import { Schema } from "effect";
import { describe, it, expect } from "vitest";
import { looseStruct, withDefault } from "../schema";
import { validateBody } from "../validate-body";

function jsonRequest(body: unknown): Request {
  return new Request("https://meet.test/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const schema = Schema.Struct({
  content: withDefault(Schema.String, ""),
  attachment_ids: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
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

  it("formats the error as 'Invalid request body: <path> <message>'", async () => {
    const result = await validateBody(
      jsonRequest({ content: "ok", attachment_ids: ["a", 2] }),
      schema,
    );
    if (!(result instanceof Response)) throw new Error("expected Response");
    const payload = (await result.json()) as { error: string; code: string };

    expect(payload.code).toBe("INVALID_BODY");
    expect(payload.error).toMatch(
      /^Invalid request body: attachment_ids\.1 \S/,
    );
  });

  it("names the body when the root value is not an object", async () => {
    const result = await validateBody(jsonRequest([1, 2]), schema);
    if (!(result instanceof Response)) throw new Error("expected Response");
    const payload = (await result.json()) as { error: string };

    expect(payload.error).toMatch(/^Invalid request body: body \S/);
  });

  it("does not echo the rejected value back to the client", async () => {
    const secret = "do-not-reflect-this-value";
    const result = await validateBody(
      jsonRequest({ content: [secret] }),
      schema,
    );
    if (!(result instanceof Response)) throw new Error("expected Response");

    expect(JSON.stringify(await result.json())).not.toContain(secret);
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

  it("strips unknown keys from a plain struct and keeps them on a loose one", async () => {
    const body = { content: "x", extra: true };
    const stripped = await validateBody(jsonRequest(body), schema);
    const kept = await validateBody(
      jsonRequest(body),
      looseStruct({ content: Schema.String }),
    );

    expect(stripped).toEqual({ content: "x" });
    expect(kept).toEqual({ content: "x", extra: true });
  });
});
