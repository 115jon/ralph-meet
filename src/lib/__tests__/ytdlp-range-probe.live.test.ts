import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePlayableYouTubeAudio } from "../ytdlp/youtube";

const OUTPUT_DIR = join(tmpdir(), "ralph-meet-ytdlp-range-probe");
const OUTPUT_FILE = join(OUTPUT_DIR, "VtcP0PFifpE-worker-native.m4a");

describe("yt-dlp live range probe", () => {
  it("resolves a YouTube audio URL that survives the second chunk request", async () => {
    const resolved = await resolvePlayableYouTubeAudio("VtcP0PFifpE", "mp4");

    const url = resolved.url;
    expect(url).toBeTruthy();

    const chunk1 = await fetch(url!, {
      headers: {
        Range: "bytes=0-1048575",
      },
    });
    const chunk2 = await fetch(url!, {
      headers: {
        Range: "bytes=1048576-2097151",
      },
    });

    const selected = new URL(url!);
    console.log(
      JSON.stringify({
        client: selected.searchParams.get("c"),
        chunk1: {
          status: chunk1.status,
          contentRange: chunk1.headers.get("content-range"),
          contentLength: chunk1.headers.get("content-length"),
        },
        chunk2: {
          status: chunk2.status,
          contentRange: chunk2.headers.get("content-range"),
          contentLength: chunk2.headers.get("content-length"),
        },
      }),
    );

    expect(chunk1.status).toBe(206);
    expect(chunk2.status).toBe(206);
  }, 120_000);

  it("downloads the full resolved audio file and writes it to disk", async () => {
    const resolved = await resolvePlayableYouTubeAudio("VtcP0PFifpE", "mp4");

    const url = resolved.url;
    expect(url).toBeTruthy();
    // The muxed fallback (itag 18) has no contentLength in the player answer.
    const totalBytes =
      resolved.contentLength ??
      Number(
        (await fetch(url!, { headers: { Range: "bytes=0-1" } })).headers
          .get("Content-Range")
          ?.split("/")[1],
      );
    expect(totalBytes).toBeGreaterThan(1024 * 1024);

    const chunkSize = 1024 * 1024;
    const bytes = new Uint8Array(totalBytes!);
    let offset = 0;

    for (let start = 0; start < totalBytes!; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, totalBytes! - 1);
      const response = await fetch(url!, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
      });
      expect(response.status).toBe(206);
      const chunk = new Uint8Array(await response.arrayBuffer());
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    expect(bytes.byteLength).toBeGreaterThan(1024 * 1024);

    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(OUTPUT_FILE, bytes);

    console.log(
      JSON.stringify({
        outputFile: OUTPUT_FILE,
        bytes: bytes.byteLength,
      }),
    );
  }, 120_000);
});
