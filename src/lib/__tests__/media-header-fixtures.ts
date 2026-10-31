/** Minimal real file headers for dimension-sniffing tests. */
export function bytes(...parts: Array<number[] | string>): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      for (const char of part) out.push(char.charCodeAt(0));
    } else {
      out.push(...part);
    }
  }
  return new Uint8Array(out);
}

export const u32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const u16be = (value: number) => [(value >>> 8) & 0xff, value & 0xff];
export const u16le = (value: number) => [value & 0xff, (value >>> 8) & 0xff];

export function pngHeader(width: number, height: number): Uint8Array {
  return bytes(
    [0x89],
    "PNG",
    [0x0d, 0x0a, 0x1a, 0x0a],
    u32(13),
    "IHDR",
    u32(width),
    u32(height),
    [8, 6, 0, 0, 0],
  );
}

export function gifHeader(width: number, height: number): Uint8Array {
  return bytes("GIF89a", u16le(width), u16le(height), [0, 0, 0]);
}

export function jpegHeader(width: number, height: number): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    // APP0 (JFIF), 16 bytes long
    [0xff, 0xe0],
    u16be(16),
    "JFIF",
    [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    // SOF0
    [0xff, 0xc0],
    u16be(17),
    [8],
    u16be(height),
    u16be(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
}

export function mp4Header(width: number, height: number): Uint8Array {
  const tkhdPayload = [
    0,
    0,
    0,
    3, // version 0 + flags
    ...u32(0),
    ...u32(0),
    ...u32(1),
    ...u32(0),
    ...u32(1000), // times, id, duration
    ...new Array(8).fill(0), // reserved
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0, // layer, alt group, volume, reserved
    ...new Array(36).fill(0), // matrix
    ...u32(width * 65536),
    ...u32(height * 65536),
  ];
  return bytes(
    u32(24),
    "ftyp",
    "isom",
    u32(0),
    "isommp41",
    u32(8 + 4 + tkhdPayload.length),
    "tkhd",
    tkhdPayload,
  );
}
