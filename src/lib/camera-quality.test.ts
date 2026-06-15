import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_QUALITY_ID,
  buildCameraVideoConstraints,
  getCameraQualityProfile,
} from "./camera-quality";

describe("camera quality constraints", () => {
  it("defaults camera capture to a 16:9 720p profile", () => {
    expect(DEFAULT_CAMERA_QUALITY_ID).toBe("720p30");
    expect(getCameraQualityProfile(undefined)).toMatchObject({
      id: "720p30",
      width: 1280,
      height: 720,
      fps: 30,
    });
  });

  it("requests 16:9 resolution, frame rate, and exact device when required", () => {
    expect(buildCameraVideoConstraints({
      deviceId: "cam-1",
      exactDevice: true,
      qualityId: "1080p60",
    })).toEqual({
      deviceId: { exact: "cam-1" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 60, max: 60 },
    });
  });

  it("uses ideal device selection for non-exact retries", () => {
    expect(buildCameraVideoConstraints({
      deviceId: "cam-2",
      exactDevice: false,
      qualityId: "480p30",
    })).toMatchObject({
      deviceId: { ideal: "cam-2" },
      width: { ideal: 854 },
      height: { ideal: 480 },
    });
  });
});
