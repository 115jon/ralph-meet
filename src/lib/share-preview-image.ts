const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii(value: string): number[] {
  return [...value].map((char) => char.charCodeAt(0));
}

function chunk(type: string, data: Uint8Array): number[] {
  const typeBytes = new Uint8Array(ascii(type));
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);

  return [
    ...u32(data.length),
    ...typeBytes,
    ...data,
    ...u32(crc32(crcInput)),
  ];
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStore(bytes: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01];
  let offset = 0;

  while (offset < bytes.length) {
    const length = Math.min(65535, bytes.length - offset);
    const isLast = offset + length >= bytes.length;
    blocks.push(isLast ? 0x01 : 0x00, length & 0xff, (length >>> 8) & 0xff);
    const nlen = (~length) & 0xffff;
    blocks.push(nlen & 0xff, (nlen >>> 8) & 0xff);
    for (let i = 0; i < length; i += 1) {
      blocks.push(bytes[offset + i]);
    }
    offset += length;
  }

  blocks.push(...u32(adler32(bytes)));
  return new Uint8Array(blocks);
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function setPixel(data: Uint8Array, index: number, r: number, g: number, b: number, a = 255) {
  data[index] = r;
  data[index + 1] = g;
  data[index + 2] = b;
  data[index + 3] = a;
}

export function createTikTokSharePreviewPng(width = 600, height = 315): Uint8Array {
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const t = (x / width) * 0.7 + (y / height) * 0.3;
      const dist = Math.hypot((x - cx) / width, (y - cy) / height);
      const glow = Math.max(0, 1 - dist * 2.4);
      const pink = Math.max(0, 1 - Math.hypot((x - width * 0.72) / width, (y - height * 0.22) / height) * 4);
      const cyan = Math.max(0, 1 - Math.hypot((x - width * 0.26) / width, (y - height * 0.78) / height) * 4);
      const i = row + 1 + x * 4;
      setPixel(
        raw,
        i,
        mix(12, 24, t) + Math.round(pink * 210) + Math.round(glow * 18),
        mix(12, 18, t) + Math.round(cyan * 210) + Math.round(glow * 14),
        mix(18, 32, t) + Math.round(pink * 70) + Math.round(cyan * 95) + Math.round(glow * 22)
      );
    }
  }

  const radius = Math.min(width, height) * 0.12;
  const triangle = [
    [cx - radius * 0.32, cy - radius * 0.55],
    [cx - radius * 0.32, cy + radius * 0.55],
    [cx + radius * 0.55, cy],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const row = y * stride;
      const i = row + 1 + x * 4;
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius) {
        const edge = Math.min(1, (radius - d) / 10);
        raw[i] = mix(raw[i], 255, 0.88 * edge);
        raw[i + 1] = mix(raw[i + 1], 255, 0.88 * edge);
        raw[i + 2] = mix(raw[i + 2], 255, 0.88 * edge);
      }

      const [a, b, c] = triangle;
      const area = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      const s = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / area;
      const t = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / area;
      const u = 1 - s - t;
      if (s >= 0 && t >= 0 && u >= 0) {
        setPixel(raw, i, 16, 17, 24);
      }
    }
  }

  const ihdr = new Uint8Array([
    ...u32(width),
    ...u32(height),
    8,
    6,
    0,
    0,
    0,
  ]);
  const png = [
    ...PNG_SIGNATURE,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", zlibStore(raw)),
    ...chunk("IEND", new Uint8Array()),
  ];

  return new Uint8Array(png);
}
