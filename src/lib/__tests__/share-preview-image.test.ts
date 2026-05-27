import { describe, expect, it } from "vitest";
import { createTikTokSharePreviewPng } from "../share-preview-image";

describe("share preview image", () => {
  it("creates a valid PNG preview", () => {
    const png = createTikTokSharePreviewPng(64, 32);

    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.length).toBeGreaterThan(64 * 32);
  });
});
