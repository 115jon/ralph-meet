import { describe, expect, it } from "vitest";
import {
  CAMERA_BACKGROUND_UPLOAD_LIMIT_BYTES,
  getCameraBackgroundValidationError,
} from "./camera-background-validation";

function fileLike(name: string, type: string, size = 1024) {
  return { name, type, size } as File;
}

describe("camera background validation", () => {
  it("accepts animated image formats and common static image formats", () => {
    expect(getCameraBackgroundValidationError(fileLike("party.gif", "image/gif"))).toBeNull();
    expect(getCameraBackgroundValidationError(fileLike("loop.webp", "image/webp"))).toBeNull();
    expect(getCameraBackgroundValidationError(fileLike("photo.png", "image/png"))).toBeNull();
    expect(getCameraBackgroundValidationError(fileLike("photo.jpg", "image/jpeg"))).toBeNull();
    expect(getCameraBackgroundValidationError(fileLike("photo.avif", "image/avif"))).toBeNull();
  });

  it("falls back to extension checks when the browser omits the MIME type", () => {
    expect(getCameraBackgroundValidationError(fileLike("loop.webp", ""))).toBeNull();
    expect(getCameraBackgroundValidationError(fileLike("party.gif", "application/octet-stream"))).toBeNull();
  });

  it("rejects video uploads even when users try an unsupported background format", () => {
    expect(getCameraBackgroundValidationError(fileLike("clip.mp4", "video/mp4"))).toBe(
      "Choose a GIF, WebP, PNG, JPEG, or AVIF image.",
    );
  });

  it("allows files up to 25 MB and rejects larger files", () => {
    expect(getCameraBackgroundValidationError(fileLike("large.webp", "image/webp", CAMERA_BACKGROUND_UPLOAD_LIMIT_BYTES))).toBeNull();
    expect(getCameraBackgroundValidationError(fileLike("too-large.webp", "image/webp", CAMERA_BACKGROUND_UPLOAD_LIMIT_BYTES + 1))).toBe(
      "Images must be 25 MB or smaller.",
    );
  });
});
