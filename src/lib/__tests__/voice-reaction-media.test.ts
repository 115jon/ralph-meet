import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({
  getAuthAssetUrl: vi.fn((url: string) => `auth:${url}`),
  getMediaUrl: vi.fn((url: string) => `media:${url}`),
}));

import { getVoiceReactionMediaUrl } from "@/lib/voice-reaction-media";

describe("voice reaction media URL resolution", () => {
  it("uses authenticated asset URLs for image reactions", () => {
    expect(getVoiceReactionMediaUrl("/api/attachments/file.gif", "image/gif")).toBe(
      "auth:/api/attachments/file.gif",
    );
  });

  it("uses range-friendly media URLs for video reactions", () => {
    expect(getVoiceReactionMediaUrl("/api/proxy-media?url=https://example.com/file.mp4", "video/mp4")).toBe(
      "media:/api/proxy-media?url=https://example.com/file.mp4",
    );
  });
});
