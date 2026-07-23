import { describe, expect, it } from "vitest";
import { normalizeSoundboardUploadUrl } from "./soundboard-media";

describe("soundboard media URLs", () => {
  it.each([
    "/api/soundboard/uploads/sound-1?download=1",
    "/api/soundboard/uploads/sound-1#fragment",
  ])("rejects local URLs with query or fragment metadata: %s", (value) => {
    expect(normalizeSoundboardUploadUrl(value)).toBeNull();
  });
});
