import { describe, expect, it } from "vitest";
import { pointerToField } from "@/components/home/landing-field";
import {
  FALLBACK_RELEASES,
  fetchDesktopReleases,
  mapGithubReleases,
} from "@/components/home/releases";

describe("pointerToField", () => {
  it("maps a wide host onto the centred square canvas", () => {
    const rect = { left: 0, top: 0, width: 1600, height: 800 };
    // Square is 1600 wide, overhanging 400px above and below the host.
    expect(pointerToField(800, 400, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointerToField(0, 0, rect)).toEqual({ x: 0, y: 0.25 });
    expect(pointerToField(1600, 800, rect)).toEqual({ x: 1, y: 0.75 });
  });

  it("maps a tall host and clamps outside points", () => {
    const rect = { left: 100, top: 50, width: 400, height: 800 };
    expect(pointerToField(300, 450, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointerToField(-500, -500, rect)).toEqual({ x: 0, y: 0 });
  });
});

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
