import { describe, expect, it } from "vitest";
import {
  createSoundboardPlaybackId,
  isLegacySoundboardPlaybackOwnedBy,
  isSoundboardPlaybackOwnedBy,
  parseSoundboardPlaybackId,
} from "./soundboard-playback-id";

describe("soundboard playback IDs", () => {
  it("round-trips owners containing hyphens without ambiguity", () => {
    const playbackId = createSoundboardPlaybackId("user-other", "airhorn");

    expect(parseSoundboardPlaybackId(playbackId)).toEqual({
      ownerId: "user-other",
      soundId: "airhorn",
    });
    expect(isSoundboardPlaybackOwnedBy(playbackId, "user-other")).toBe(true);
    expect(isSoundboardPlaybackOwnedBy(playbackId, "user")).toBe(false);
  });

  it("requires the legacy compatibility check to match the complete ID", () => {
    expect(
      isLegacySoundboardPlaybackOwnedBy(
        "s-user-other-airhorn",
        "user-other",
        "airhorn",
      ),
    ).toBe(true);
    expect(
      isLegacySoundboardPlaybackOwnedBy(
        "s-user-other-airhorn",
        "user",
        "airhorn",
      ),
    ).toBe(false);
  });

  it("rejects malformed length-prefixed IDs", () => {
    expect(parseSoundboardPlaybackId("sb1:3:user:airhorn")).toBeNull();
    expect(parseSoundboardPlaybackId("sb1:4:user")).toBeNull();
  });
});
