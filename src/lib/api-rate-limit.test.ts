import { describe, expect, it } from "vitest";
import {
  getSoundboardMediaRateLimitKey,
  getSoundboardMediaAggregateRateLimitKey,
  getSoundboardMediaRequesterRateLimitKey,
  isSoundboardMediaRead,
  isStaticAssetRead,
} from "./api-rate-limit";

describe("API rate-limit media classification", () => {
  it.each([
    "/api/attachments/channel-1/clip.mp4",
    "/api/camera-backgrounds/bg-1/preview.webp",
  ])("exempts GET %s", (pathname) => {
    expect(isStaticAssetRead("GET", pathname)).toBe(true);
  });

  it("routes soundboard media through its dedicated limiter", () => {
    const request = new Request(
      "https://meet.test/api/soundboard/uploads/sound-1?cap=cap-1&room_slug=room-1&playback_id=playback-1",
    );

    expect(isStaticAssetRead("GET", "/api/soundboard/uploads/sound-1")).toBe(
      false,
    );
    expect(
      isSoundboardMediaRead("GET", "/api/soundboard/uploads/sound-1"),
    ).toBe(true);
    expect(getSoundboardMediaRateLimitKey(request, "1.2.3.4")).toBe(
      "soundboard-media:requester:1.2.3.4:cap:cap-1:sound:sound-1",
    );
    expect(getSoundboardMediaAggregateRateLimitKey(request, "1.2.3.4")).toBe(
      "soundboard-media:aggregate:requester:1.2.3.4",
    );
    expect(getSoundboardMediaRequesterRateLimitKey(request, "1.2.3.4")).toBe(
      "soundboard-media:requester:1.2.3.4:sound:sound-1",
    );
  });

  it("uses the requester and sound ID when no capability is present", () => {
    const request = new Request(
      "https://meet.test/api/soundboard/uploads/sound-1",
    );

    expect(getSoundboardMediaRateLimitKey(request, "1.2.3.4")).toBe(
      "soundboard-media:requester:1.2.3.4:cap:none:sound:sound-1",
    );
  });

  it("does not classify writes or unrelated API routes as media reads", () => {
    expect(isStaticAssetRead("POST", "/api/soundboard/uploads/sound-1")).toBe(
      false,
    );
    expect(
      isSoundboardMediaRead("POST", "/api/soundboard/uploads/sound-1"),
    ).toBe(false);
    expect(isStaticAssetRead("GET", "/api/servers/server-1/soundboard")).toBe(
      false,
    );
  });
});
