// ── schema ───────────────────────────────────────────────────────────────────
// Small helpers over Effect Schema (v4) that keep the semantics the API routes
// had under the previous `z.*` schemas. Client code (AccountPanel, and the
// schemas in validations.ts) imports this file, so it only reaches for `Schema`,
// `SchemaIssue`, `Result` and `Effect.succeed` (needed for decoding defaults).
// Do not add other Effect runtime imports here.
//
// Mapping from the old `z.*` schemas, for the next person converting a route:
//   z.object({...})              Schema.Struct({...})        (strips unknown keys)
//   z.object({...}).passthrough() looseStruct({...})
//   z.number()                   Schema.Finite               (rejects NaN and Infinity)
//   z.number().int().min(n)      Schema.Int.check(Schema.isGreaterThanOrEqualTo(n))
//   z.string().trim()            Schema.Trim
//   z.string().default(x)        withDefault(Schema.String, x)
//   z.x().optional()             Schema.optional(Schema.x)   (key absent or undefined)
//   z.x().nullable()             Schema.NullOr(Schema.x)
//   z.unknown().optional()       Schema.optional(Schema.Unknown)
//   z.array(x)                   Schema.mutable(Schema.Array(x))   (Schema.Array alone is readonly)
//   schema.safeParse(v)          safeParse(schema, v)
//   schema.parse(v)              Schema.decodeUnknownSync(schema)(v)

import { Effect, Result, Schema, SchemaIssue } from "effect";

/**
 * A struct that keeps keys it does not declare, like `z.object().passthrough()`.
 * A plain `Schema.Struct` strips them. Extra keys are typed `unknown`.
 */
export function looseStruct<const F extends Schema.Struct.Fields>(fields: F) {
  return Schema.StructWithRest(Schema.Struct(fields), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]);
}

/**
 * The `.default(value)` of `z.*`: a missing or `undefined` input decodes to `value`.
 * Any other input is validated by `schema`. The default is not re-validated.
 *
 *     content: withDefault(Schema.String, "")
 */
export function withDefault<S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
) {
  return Schema.withDecodingDefaultType(Effect.succeed(value))(schema);
}

interface ParseIssue {
  /** Keys leading to the failing value; empty when the root value failed. */
  readonly path: ReadonlyArray<PropertyKey>;
  /** The message of the failing check, or the library default. */
  readonly message: string;
}

export type SafeParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: ReadonlyArray<ParseIssue> };

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * Decodes `input` without throwing, like `schema.safeParse(input)`. Parsing
 * stops at the first failure, so `issues` holds the first problem in schema
 * declaration order. Input values are never copied into messages.
 */
export function safeParse<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): SafeParseResult<S["Type"]> {
  const result = Schema.decodeUnknownResult(schema)(input);
  if (Result.isSuccess(result)) {
    return { success: true, data: result.success };
  }

  return {
    success: false,
    issues: formatIssue(result.failure.issue).issues.map((issue) => ({
      path: (issue.path ?? []).map((segment) =>
        typeof segment === "object" ? segment.key : segment,
      ),
      message: issue.message,
    })),
  };
}

/**
 * `JSON.parse` followed by {@link safeParse}, without throwing. Text that is not
 * JSON is a failed parse with one root issue, so callers have a single
 * "use the fallback" branch for stored or received text.
 */
export function safeParseJson<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  text: string,
): SafeParseResult<S["Type"]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { success: false, issues: [{ path: [], message: "Invalid JSON" }] };
  }
  return safeParse(schema, raw);
}
