import { describe, expect, it } from "vitest";
import {
  FALLBACK_RELEASES,
  fetchDesktopReleases,
  mapGithubReleases,
} from "@/components/home/releases";

describe("releases", () => {
  it("maps GitHub releases with an .exe asset and marks the first latest", () => {
    const mapped = mapGithubReleases([
      {
        tag_name: "v2.0.0",
        name: null,
        assets: [
          { name: "notes.txt", browser_download_url: "https://x/notes.txt" },
          {
            name: "RalphMeetSetup.exe",
            browser_download_url: "https://x/a.exe",
          },
        ],
      },
      { tag_name: "v1.9.0", name: "Ninety", assets: [] },
      { nope: true },
    ]);
    expect(mapped).toEqual([
      {
        tagName: "v2.0.0",
        name: "v2.0.0",
        downloadUrl: "https://x/a.exe",
        fileName: "RalphMeetSetup.exe",
        isLatest: true,
      },
    ]);
    expect(mapGithubReleases({})).toEqual([]);
  });

  it("resolves to [] on network failure so the fallback stays", async () => {
    const failing = (() =>
      Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await fetchDesktopReleases(failing)).toEqual([]);
    expect(FALLBACK_RELEASES[0]?.downloadUrl).toMatch(/\.exe$/);
  });
});
