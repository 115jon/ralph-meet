import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEDIA_CONTENT_FILTER,
  MEDIA_CONTENT_FILTER_OPTIONS,
  isMediaContentFilter,
  parseMediaContentFilter,
} from "@/lib/media-content-filter";

describe("media content filter helpers", () => {
  it("accepts the supported provider filter levels", () => {
    expect(isMediaContentFilter("high")).toBe(true);
    expect(isMediaContentFilter("medium")).toBe(true);
    expect(isMediaContentFilter("low")).toBe(true);
    expect(isMediaContentFilter("off")).toBe(true);
  });

  it("falls back safely for unsupported values", () => {
    expect(isMediaContentFilter("wild-west")).toBe(false);
    expect(parseMediaContentFilter("wild-west")).toBe(DEFAULT_MEDIA_CONTENT_FILTER);
    expect(parseMediaContentFilter(null, "low")).toBe("low");
  });

  it("keeps the settings UI options aligned with the supported levels", () => {
    expect(MEDIA_CONTENT_FILTER_OPTIONS.map((option) => option.value)).toEqual([
      "high",
      "medium",
      "low",
      "off",
    ]);
  });
});
