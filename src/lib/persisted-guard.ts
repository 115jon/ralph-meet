// ── persisted-guard ──────────────────────────────────────────────────────────
// Field readers for state read back from localStorage. That data outlives the
// code that wrote it: it can be hand-edited, truncated, written by an older
// release or by a build that keeps different fields. `merge` and `migrate`
// used to cast it to the state type, so a wrong-typed field leaked into the
// store and crashed whatever read it.
//
// This module has NO imports, on purpose. Client code on the public pages (the
// entry chunk, the share, invite and room pages) reads storage, and importing
// effect's Schema there costs about 100 KB gzip. Server-side payload decoding
// uses `@/lib/lenient-schema`, which is Schema-based and must not be imported
// from client code (`entry-path-imports.test.ts` enforces that).
//
// A `Read<T>` returns the value when it is valid and `undefined` otherwise. A
// shape built from them has, for every key, either a valid value or no key (or
// a stated fallback), so `{ ...defaults, ...read(stored) }` keeps the default
// for anything that was missing, corrupt or retyped.

export type Read<T> = (value: unknown) => T | undefined;

/** The reader of one key of a shape. It may return `undefined` only for an optional key. */
type Field<T> = (value: unknown) => T;

const MISSING: unique symbol = Symbol("missing");

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const readBoolean: Read<boolean> = (value) =>
  typeof value === "boolean" ? value : undefined;

/** A finite number. */
export const readNumber: Read<number> = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const readString: Read<string> = (value) =>
  typeof value === "string" ? value : undefined;

/** A string with at least one non-whitespace character. */
export const readNonBlankString: Read<string> = (value) =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/** One of `options`. Own members only, so `"toString"` is never accepted. */
export function readOneOf<const T extends string>(
  options: readonly T[],
): Read<T> {
  return (value) =>
    typeof value === "string" && options.some((option) => option === value)
      ? (value as T)
      : undefined;
}

/** Whatever `is` accepts. */
export function readGuard<T>(is: (value: unknown) => value is T): Read<T> {
  return (value) => (is(value) ? value : undefined);
}

/** An array, keeping the elements `item` accepts. Anything else is `undefined`. */
export function readList<T>(item: Read<T>): Read<T[]> {
  return (value) => {
    if (!Array.isArray(value)) return undefined;
    const items: T[] = [];
    for (const entry of value) {
      const read = item(entry);
      if (read !== undefined) items.push(read);
    }
    return items;
  };
}

/** A plain object, keeping the entries `item` accepts. Anything else is `undefined`. */
export function readMap<T>(item: Read<T>): Read<Record<string, T>> {
  return (value) => {
    if (!isRecord(value)) return undefined;
    const entries: Record<string, T> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "__proto__") continue;
      const read = item(entry);
      if (read !== undefined) entries[key] = read;
    }
    return entries;
  };
}

/** A required key: `fallback` when the value is missing or rejected by `read`. */
export function orElse<T>(read: Read<T>, fallback: T): Field<T> {
  return (value) => read(value) ?? fallback;
}

/** Like {@link orElse}, for a fallback that must be a fresh object per entry. */
export function orElseWith<T>(read: Read<T>, make: () => T): Field<T> {
  return (value) => read(value) ?? make();
}

/** A required key: the whole shape is rejected when the value is missing or invalid. */
export function required<T>(read: Read<T>): Field<T> {
  // The shape reader intercepts the sentinel; it never reaches a caller.
  return (value) => read(value) ?? (MISSING as never);
}

/**
 * An object reader. Optional keys use a plain `Read` and are left out when
 * invalid; required keys use {@link orElse} or {@link required}. Keys the shape
 * does not declare are dropped, unless `keepUnknown` is set (to preserve fields
 * written by a newer release).
 */
export function readObject<T extends object>(
  fields: { [K in keyof T]-?: Field<T[K]> },
  options: { keepUnknown?: boolean } = {},
): Read<T> {
  // Object.keys loses the key type; the keys are exactly those of `fields`.
  const keys = Object.keys(fields) as Array<keyof T & string>;
  return (value) => {
    if (!isRecord(value)) return undefined;
    const out: Record<string, unknown> = options.keepUnknown
      ? { ...value }
      : {};
    for (const key of keys) {
      const field = fields[key](value[key]);
      if (field === (MISSING as unknown)) return undefined;
      if (field === undefined) delete out[key];
      else out[key] = field;
    }
    // Every key of `T` was filled by its field reader above.
    return out as T;
  };
}

/** Parses stored JSON text and reads it with `read`; text that is not JSON gives `undefined`. */
export function readStoredJson<T>(
  raw: string | null | undefined,
  read: Read<T>,
): T | undefined {
  if (!raw) return undefined;
  try {
    return read(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
