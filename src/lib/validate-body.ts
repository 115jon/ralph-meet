// ── validate-body ────────────────────────────────────────────────────────────
// Runtime validation for attacker-controlled JSON request bodies.
//
// API routes historically cast `await request.json()` straight to a typed
// shape. TypeScript casts are erased at runtime, so a malformed or malicious
// body reaches handler logic unchecked. `validateBody` parses the body with an
// Effect Schema and returns either the parsed value or a structured 400
// Response.
//
// Schemas here should be PERMISSIVE by design: they exist to reject
// structurally invalid input (wrong types, missing required fields), not to
// impose new business rules that could reject payloads the client already
// sends. Use `looseStruct` (keeps unknown keys) and optional fields liberally
// when in doubt.

import type { Schema } from "effect";
import { apiError } from "@/lib/api-helpers";
import { safeParse } from "@/lib/schema";

/**
 * Parse and validate a JSON request body against an Effect Schema.
 *
 * Returns the parsed value on success, or an `apiError` Response (400) when the
 * body is not JSON or fails validation. Callers use the standard
 * `if (result instanceof Response) return result;` guard already used across
 * the API routes for auth and access checks.
 */
export async function validateBody<S extends Schema.ConstraintDecoder<unknown>>(
  request: Request,
  schema: S,
  req?: Request,
): Promise<S["Type"] | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON body", 400, "INVALID_JSON", req ?? request);
  }

  const parsed = safeParse(schema, raw);
  if (!parsed.success) {
    const firstIssue = parsed.issues[0];
    const path = firstIssue?.path.map(String).join(".") || "body";
    const message = firstIssue
      ? `Invalid request body: ${path} ${firstIssue.message}`
      : "Invalid request body";
    return apiError(message, 400, "INVALID_BODY", req ?? request);
  }

  return parsed.data;
}
