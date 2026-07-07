import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveYouTubePlayback } from "../ytdlp/youtube";

const OUTPUT_DIR = "F:/dev/TS/CLOUDFLARE/ralph-meet/.codex/downloads";
const OUTPUT_FILE = `${OUTPUT_DIR}/VtcP0PFifpE-worker-native.m4a`;

describe("yt-dlp live range probe", () => {
  it(
    "resolves a YouTube audio URL that survives the second chunk request",
    async () => {
      const resolved = await resolveYouTubePlayback("https://www.youtube.com/watch?v=VtcP0PFifpE", {
        preferredKind: "audio",
        preferredContainer: "mp4",
        includeFormats: true,
      });

      const url = resolved.selectedFormat?.url;
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
      console.log(JSON.stringify({
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
      }));

      expect(chunk1.status).toBe(206);
      expect(chunk2.status).toBe(206);
    },
    120_000,
  );

  it(
    "downloads the full resolved audio file and writes it to disk",
    async () => {
      const resolved = await resolveYouTubePlayback("https://www.youtube.com/watch?v=VtcP0PFifpE", {
        preferredKind: "audio",
        preferredContainer: "mp4",
        includeFormats: true,
      });

      const url = resolved.selectedFormat?.url;
      expect(url).toBeTruthy();
      const totalBytes = resolved.selectedFormat?.contentLength;
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

      console.log(JSON.stringify({
        outputFile: OUTPUT_FILE,
        bytes: bytes.byteLength,
      }));
    },
    120_000,
  );
});
