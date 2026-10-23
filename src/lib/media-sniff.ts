// ── media-sniff ─────────────────────────────────────────────────────────────
// Read intrinsic dimensions from the first bytes of an image or MP4 so a
// direct-media embed can reserve its box before the file loads (no layout
// jump in the message list). Every parser is bounds-checked and returns null
// rather than throwing on truncated or unexpected input.

export interface MediaDimensions {
  width: number;
  height: number;
}

/** Enough for every header format here, including MP4s with moov up front. */
export const MEDIA_SNIFF_BYTES = 64 * 1024;

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return text;
}

function valid(width: number, height: number): MediaDimensions | null {
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= 65_535 &&
    height <= 65_535
    ? { width, height }
    : null;
}

function sniffPng(bytes: Uint8Array): MediaDimensions | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || ascii(bytes, 1, 3) !== "PNG") return null;
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  return valid(u32be(bytes, 16), u32be(bytes, 20));
}

function sniffGif(bytes: Uint8Array): MediaDimensions | null {
  if (bytes.length < 10) return null;
  const signature = ascii(bytes, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  return valid(u16le(bytes, 6), u16le(bytes, 8));
}

function sniffWebp(bytes: Uint8Array): MediaDimensions | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    return valid(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return valid(
      1 + (((b1 & 0x3f) << 8) | b0),
      1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    );
  }
  if (chunk === "VP8X") {
    return valid(1 + u24le(bytes, 24), 1 + u24le(bytes, 27));
  }
  return null;
}

function sniffJpeg(bytes: Uint8Array): MediaDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = u16be(bytes, offset + 2);
    if (segmentLength < 2) return null;
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      return valid(u16be(bytes, offset + 7), u16be(bytes, offset + 5));
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function indexOfAscii(bytes: Uint8Array, needle: string, from = 0): number {
  const first = needle.charCodeAt(0);
  outer: for (
    let index = from;
    index <= bytes.length - needle.length;
    index++
  ) {
    if (bytes[index] !== first) continue;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle.charCodeAt(offset)) continue outer;
    }
    return index;
  }
  return -1;
}

function sniffAvif(bytes: Uint8Array): MediaDimensions | null {
  if (bytes.length < 16 || ascii(bytes, 4, 4) !== "ftyp") return null;
  const brand = ascii(bytes, 8, 4);
  if (brand !== "avif" && brand !== "avis" && brand !== "mif1") return null;
  const ispe = indexOfAscii(bytes, "ispe");
  if (ispe < 0 || ispe + 16 > bytes.length) return null;
  return valid(u32be(bytes, ispe + 8), u32be(bytes, ispe + 12));
}

export function sniffImageDimensions(
  bytes: Uint8Array,
): MediaDimensions | null {
  return (
    sniffPng(bytes) ??
    sniffGif(bytes) ??
    sniffJpeg(bytes) ??
    sniffWebp(bytes) ??
    sniffAvif(bytes)
  );
}

/**
 * Width and height of the first visual track in an MP4/MOV whose `moov` box
 * sits at the front of the file (the usual "faststart" layout). Returns null
 * when the header is further in than the sniffed bytes.
 */
export function sniffMp4Dimensions(bytes: Uint8Array): MediaDimensions | null {
  let from = 0;
  for (let guard = 0; guard < 16; guard += 1) {
    const tkhd = indexOfAscii(bytes, "tkhd", from);
    if (tkhd < 0) return null;
    const payload = tkhd + 4;
    const version = bytes[payload];
    const dimensionsOffset = payload + 4 + (version === 1 ? 32 : 20) + 52;
    if (dimensionsOffset + 8 > bytes.length) return null;
    const width = Math.round(u32be(bytes, dimensionsOffset) / 65_536);
    const height = Math.round(u32be(bytes, dimensionsOffset + 4) / 65_536);
    const dimensions = valid(width, height);
    if (dimensions) return dimensions;
    from = tkhd + 4;
  }
  return null;
}

/** Read up to `limit` bytes from a body stream, then release it. */
export async function readLeadingBytes(
  body: ReadableStream<Uint8Array> | null,
  limit = MEDIA_SNIFF_BYTES,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, bytes.length - offset);
    bytes.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= bytes.length) break;
  }
  return bytes;
}
