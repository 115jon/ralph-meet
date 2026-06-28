import { describe, expect, it } from "vitest";

import {
  isVisualSensitiveAttachment,
  shouldBlurSensitiveAttachment,
} from "@/lib/media-safety";

describe("media safety helpers", () => {
  it("treats flagged images and videos as sensitive visual media", () => {
    expect(isVisualSensitiveAttachment({
      content_type: "image/png",
      is_nsfw: true,
    })).toBe(true);

    expect(isVisualSensitiveAttachment({
      content_type: "video/mp4",
      is_nsfw: true,
    })).toBe(true);
  });

  it("ignores non-visual or unflagged attachments", () => {
    expect(isVisualSensitiveAttachment({
      content_type: "application/pdf",
      is_nsfw: true,
    })).toBe(false);

    expect(isVisualSensitiveAttachment({
      content_type: "image/png",
      is_nsfw: false,
    })).toBe(false);
  });

  it("only auto-blurs sensitive media for the high filter", () => {
    const attachment = {
      content_type: "image/jpeg",
      is_nsfw: true,
    };

    expect(shouldBlurSensitiveAttachment(attachment, "high")).toBe(true);
    expect(shouldBlurSensitiveAttachment(attachment, "medium")).toBe(false);
    expect(shouldBlurSensitiveAttachment(attachment, "low")).toBe(false);
    expect(shouldBlurSensitiveAttachment(attachment, "off")).toBe(false);
  });
});
