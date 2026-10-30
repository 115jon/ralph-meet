import { describe, expect, it } from "vitest";
import {
  readLeadingBytes,
  sniffImageDimensions,
  sniffMp4Dimensions,
} from "../media-sniff";
import {
  bytes,
  gifHeader,
  jpegHeader,
  mp4Header,
  pngHeader,
  u16le,
  u32,
} from "./media-header-fixtures";

describe("sniffImageDimensions", () => {
  it("reads PNG, GIF and JPEG headers", () => {
    expect(sniffImageDimensions(pngHeader(544, 184))).toEqual({
      width: 544,
      height: 184,
    });
    expect(sniffImageDimensions(gifHeader(400, 300))).toEqual({
      width: 400,
      height: 300,
    });
    expect(sniffImageDimensions(jpegHeader(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("reads lossy and extended WebP headers", () => {
    const vp8 = bytes(
      "RIFF",
      u32(0),
      "WEBP",
      "VP8 ",
      u32(0),
      [0, 0, 0, 0x9d, 0x01, 0x2a],
      u16le(640),
      u16le(480),
    );
    expect(sniffImageDimensions(vp8)).toEqual({ width: 640, height: 480 });

    const vp8x = bytes(
      "RIFF",
      u32(0),
      "WEBP",
      "VP8X",
      u32(10),
      [0, 0, 0, 0],
      [0xff, 0x03, 0x00], // width - 1 = 1023
      [0x57, 0x02, 0x00], // height - 1 = 599
    );
    expect(sniffImageDimensions(vp8x)).toEqual({ width: 1024, height: 600 });
  });

  it("returns null for truncated or unknown data instead of throwing", () => {
    expect(sniffImageDimensions(new Uint8Array())).toBeNull();
    expect(sniffImageDimensions(pngHeader(10, 10).slice(0, 12))).toBeNull();
    expect(sniffImageDimensions(bytes("<!doctype html>"))).toBeNull();
  });
});

describe("sniffMp4Dimensions", () => {
  it("reads the first visual track from a faststart MP4", () => {
    expect(sniffMp4Dimensions(mp4Header(1280, 720))).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("returns null when the moov box is past the sniffed bytes", () => {
    expect(sniffMp4Dimensions(bytes(u32(24), "ftyp", "isom"))).toBeNull();
  });
});

describe("readLeadingBytes", () => {
  it("stops after the limit and cancels the rest of the body", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024).fill(7));
      },
      cancel() {
        cancelled = true;
      },
    });
    const head = await readLeadingBytes(stream, 2500);
    expect(head.byteLength).toBe(2500);
    expect(cancelled).toBe(true);
  });
});
