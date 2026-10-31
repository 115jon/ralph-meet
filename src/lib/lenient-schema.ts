// ── lenient-schema ───────────────────────────────────────────────────────────
// Field builders for payloads we do not control: third-party API responses
// (TikTok, Instagram, YouTube, Spotify, ...) and JSON columns. Vendors rename,
// retype and drop fields without notice, and consumers used to cope by probing
// each field with `typeof`. These builders move that tolerance into the schema:
// a field that is missing, or whose value has the wrong type, is left out of
// the result instead of failing the whole value. Unknown keys are kept (see
// `looseStruct`).
//
// A schema built only from these fails just when the root is not an object,
// which is the caller's "no data here" path.
//
// SERVER-SIDE ONLY. This module imports effect's Schema (about 100 KB gzip), so
// client code must not import it, directly or transitively: it would put Schema
// in the entry chunk of every public page. Client code that reads
// localStorage uses `@/lib/persisted-guard`, which has no imports.
// `entry-path-imports.test.ts` enforces the boundary.

import { Option, Schema, SchemaGetter } from "effect";

/**
 * An optional key decoded by `read`. A missing key, or a value `read` rejects
 * (by returning `undefined`), leaves the key out of the result. Never fails.
 * A decoded `null` also leaves the key out.
 */
export function tolerant<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  read: (value: unknown) => S["Type"] | undefined,
) {
  return Schema.optionalKey(Schema.Unknown).pipe(
    Schema.decodeTo(Schema.optionalKey(Schema.toType(schema)), {
      decode: SchemaGetter.transformOptional((input: Option.Option<unknown>) =>
        Option.flatMap(input, (value) => Option.fromNullishOr(read(value))),
      ),
      encode: SchemaGetter.passthrough(),
    }),
  );
}

/** An optional key that decodes with `schema`, and is left out when missing or invalid. */
export function lenient<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
) {
  const decode = Schema.decodeUnknownOption(schema);
  return tolerant(schema, (value) => Option.getOrUndefined(decode(value)));
}

/** A trimmed, non-blank string. */
export const lenientText = tolerant(Schema.String, (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
});

/** A string kept verbatim (including blank ones). */
export const lenientString = lenient(Schema.String);

/** A finite number. */
export const lenientNumber = lenient(Schema.Finite);

/** A boolean. */
export const lenientBoolean = lenient(Schema.Boolean);

/** A finite, non-negative number, from a number or a string holding one. */
export function readCount(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** A finite, non-negative number, or a string holding one. Counts, sizes, durations. */
export const lenientCount = tolerant(Schema.Finite, readCount);

/** An array. Elements that are not strings, or are blank, are dropped. */
export const lenientStrings = tolerant(
  Schema.mutable(Schema.Array(Schema.String)),
  (value) =>
    Array.isArray(value)
      ? value.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : undefined,
);

/**
 * An array whose elements are decoded by `element`. Elements that do not decode
 * are dropped, so one malformed entry never discards its siblings. Anything that
 * is not an array leaves the key out.
 */
export function lenientArray<S extends Schema.ConstraintDecoder<unknown>>(
  element: S,
) {
  const decode = Schema.decodeUnknownOption(element);
  return tolerant(
    Schema.mutable(Schema.Array(element)),
    (value): Array<S["Type"]> | undefined => {
      if (!Array.isArray(value)) return undefined;
      const items: Array<S["Type"]> = [];
      for (const item of value) {
        const decoded = decode(item);
        if (Option.isSome(decoded)) items.push(decoded.value);
      }
      return items;
    },
  );
}
