import { describe, expect, it, vi } from "vitest";
import { RadioStationResolver } from "../voice-room/radio-station-resolver";

const station = {
  stationuuid: "station-1",
  name: "Test Radio",
  url_resolved: "https://stream.example.com/live",
  homepage: "https://station.example.com",
  favicon: "https://station.example.com/art.png",
};

describe("RadioStationResolver", () => {
  it("resolves and caches a public station", async () => {
    const fetch = vi.fn(async () => Response.json([station]));
    const resolver = new RadioStationResolver({ fetch, now: () => 1_000 });

    await expect(
      resolver.resolve("station-1", "user-1"),
    ).resolves.toMatchObject({
      kind: "radio",
      id: "station-1",
      streamUrl: "https://stream.example.com/live",
      canonicalUrl: "https://station.example.com/",
    });
    await resolver.resolve("station-1", "user-1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://127.0.0.1/live",
    "https://10.0.0.2/live",
    "https://[::1]/live",
    "http://stream.example.com/live",
  ])("rejects unsafe stream URL %s", async (streamUrl) => {
    const fetch = vi.fn(async () =>
      Response.json([{ ...station, url_resolved: streamUrl }]),
    );
    const resolver = new RadioStationResolver({ fetch, now: () => 1_000 });

    await expect(resolver.resolve("station-1", "user-1")).resolves.toBeNull();
  });

  it("deduplicates in-flight lookups and rate-limits distinct misses per user", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return Response.json([station]);
    });
    const resolver = new RadioStationResolver({
      fetch,
      now: () => 1_000,
      maxResolutionsPerWindow: 2,
      resolutionWindowMs: 60_000,
    });

    const first = resolver.resolve("station-1", "user-1");
    const duplicate = resolver.resolve("station-1", "user-1");
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, duplicate])).resolves.toHaveLength(2);
    await expect(resolver.resolve("station-2", "user-1")).resolves.toBeNull();
    await expect(resolver.resolve("station-3", "user-1")).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
