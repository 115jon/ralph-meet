// ── validate-body ────────────────────────────────────────────────────────────
// Runtime validation for attacker-controlled JSON request bodies.
//
// API routes historically cast `await request.json()` straight to a typed
// shape. TypeScript casts are erased at runtime, so a malformed or malicious
// body reaches handler logic unchecked. `validateBody` parses the body with a
// Zod schema and returns either the parsed value or a structured 400 Response.
//
// Schemas here should be PERMISSIVE by design: they exist to reject
// structurally invalid input (wrong types, missing required fields), not to
// impose new business rules that could reject payloads the client already
// sends. Use `.passthrough()`/optional fields liberally when in doubt.

import { z } from "zod";
import { apiError } from "@/lib/api-helpers";

/**
 * Parse and validate a JSON request body against a Zod schema.
 *
 * Returns the parsed value on success, or an `apiError` Response (400) when the
 * body is not JSON or fails validation. Callers use the standard
 * `if (result instanceof Response) return result;` guard already used across
 * the API routes for auth and access checks.
 */
export async function validateBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  req?: Request,
): Promise<z.infer<T> | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON body", 400, "INVALID_JSON", req ?? request);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.join(".") || "body";
    const message = firstIssue
      ? `Invalid request body: ${path} ${firstIssue.message}`
      : "Invalid request body";
    return apiError(message, 400, "INVALID_BODY", req ?? request);
  }

  return parsed.data;
}
