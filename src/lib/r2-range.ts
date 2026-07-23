export interface R2ByteRange {
  offset?: number;
  length?: number;
  suffix?: number;
}

export interface ParsedR2ByteRange {
  range?: R2ByteRange;
  requested: boolean;
  invalid: boolean;
}

export interface ResolvedR2ByteRange extends ParsedR2ByteRange {
  offset?: number;
  length?: number;
}

export function toR2GetOptions(range: R2ByteRange | undefined):
  | {
      range:
        | { offset: number; length: number }
        | { offset: number }
        | { suffix: number };
    }
  | undefined {
  if (!range) return undefined;
  if (typeof range.suffix === "number") {
    return { range: { suffix: range.suffix } };
  }
  if (typeof range.offset !== "number") return undefined;
  return typeof range.length === "number"
    ? { range: { offset: range.offset, length: range.length } }
    : { range: { offset: range.offset } };
}

export function getR2ObjectRangeBounds(range: R2Range | undefined): {
  offset?: number;
  length?: number;
} {
  if (!range || !("offset" in range)) return {};
  return {
    ...(typeof range.offset === "number" ? { offset: range.offset } : {}),
    ...(typeof range.length === "number" ? { length: range.length } : {}),
  };
}

function parseNonNegativeSafeInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseR2ByteRangeHeader(
  header: string | null,
): ParsedR2ByteRange {
  const value = header?.trim();
  if (!value) return { requested: false, invalid: false };

  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) {
    return { requested: true, invalid: true };
  }

  const start = match[1] ? parseNonNegativeSafeInteger(match[1]) : null;
  const end = match[2] ? parseNonNegativeSafeInteger(match[2]) : null;
  if ((match[1] && start === null) || (match[2] && end === null)) {
    return { requested: true, invalid: true };
  }

  if (start === null && end !== null) {
    return end > 0
      ? { range: { suffix: end }, requested: true, invalid: false }
      : { requested: true, invalid: true };
  }

  if (start !== null && end !== null && end < start) {
    return { requested: true, invalid: true };
  }

  const length = start !== null && end !== null ? end - start + 1 : undefined;

  return {
    range: {
      ...(start !== null ? { offset: start } : {}),
      ...(length !== undefined
        ? {
            length: Number.isSafeInteger(length)
              ? length
              : Number.MAX_SAFE_INTEGER,
          }
        : {}),
    },
    requested: true,
    invalid: false,
  };
}

export function resolveR2ByteRangeHeader(
  header: string | null,
  objectSize: number,
): ResolvedR2ByteRange {
  const parsed = parseR2ByteRangeHeader(header);
  if (!parsed.requested) return parsed;
  if (parsed.invalid || !Number.isSafeInteger(objectSize) || objectSize < 0) {
    return { requested: true, invalid: true };
  }

  const suffix = parsed.range?.suffix;
  if (suffix !== undefined) {
    if (objectSize === 0) return { requested: true, invalid: true };
    const length = Math.min(suffix, objectSize);
    return {
      requested: true,
      invalid: false,
      range: { offset: objectSize - length, length },
      offset: objectSize - length,
      length,
    };
  }

  const offset = parsed.range?.offset ?? 0;
  const requestedLength =
    parsed.range?.length === undefined
      ? objectSize - offset
      : parsed.range.length;
  const length = Math.min(requestedLength, objectSize - offset);
  if (
    objectSize === 0 ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    offset >= objectSize ||
    length <= 0 ||
    offset + length > objectSize
  ) {
    return { requested: true, invalid: true };
  }

  return {
    ...parsed,
    range: { offset, length },
    offset,
    length,
  };
}
