import { describe, expect, it } from "vitest";
import {
  createSoundboardPlaybackId,
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

  it("does not parse the retired s-<owner>-<sound> form", () => {
    expect(parseSoundboardPlaybackId("s-user-airhorn")).toBeNull();
    expect(isSoundboardPlaybackOwnedBy("s-user-airhorn", "user")).toBe(false);
  });

  it("rejects malformed length-prefixed IDs", () => {
    expect(parseSoundboardPlaybackId("sb1:3:user:airhorn")).toBeNull();
    expect(parseSoundboardPlaybackId("sb1:4:user")).toBeNull();
  });
});
