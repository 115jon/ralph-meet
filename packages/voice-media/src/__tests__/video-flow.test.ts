import { describe, expect, it } from "vitest";
import {
  CAMERA_CONNECT_GRACE_MS,
  cameraTileVideo,
  VideoFlowDetector,
} from "../video-flow";

const options = { firstFrameTimeoutMs: 6_000, stallAfterMs: 5_000 };

describe("VideoFlowDetector", () => {
  it("waits for a first frame, then plays while frames grow", () => {
    const detector = new VideoFlowDetector(0, options);
    expect(detector.flow).toBe("waiting");
    expect(detector.sample({ frames: 0, at: 2_000 })).toBe("waiting");
    expect(detector.sample({ frames: 30, at: 4_000 })).toBe("playing");
    expect(detector.sample({ frames: 90, at: 6_000 })).toBe("playing");
  });

  it("counts frames decoded before the first reading as playing", () => {
    const detector = new VideoFlowDetector(0, options);
    expect(detector.sample({ frames: 120, at: 2_000 })).toBe("playing");
  });

  it("stalls a track that decodes no first frame in time", () => {
    // A re-pull answered on a recycled MID: a track, never a frame.
    const detector = new VideoFlowDetector(0, options);
    expect(detector.sample({ frames: 0, at: 4_000 })).toBe("waiting");
    expect(detector.sample({ frames: 0, at: 6_000 })).toBe("stalled");
  });

  it("stalls a playing track that stops decoding, and plays again when it resumes", () => {
    const detector = new VideoFlowDetector(0, options);
    detector.sample({ frames: 60, at: 2_000 });
    expect(detector.sample({ frames: 60, at: 4_000 })).toBe("playing");
    expect(detector.sample({ frames: 60, at: 6_000 })).toBe("playing");
    expect(detector.sample({ frames: 60, at: 7_000 })).toBe("stalled");
    expect(detector.sample({ frames: 61, at: 9_000 })).toBe("playing");
  });

  it("keeps a slow but moving track (a keepalive's one frame a second) playing", () => {
    const detector = new VideoFlowDetector(0, options);
    for (let at = 1_000, frames = 1; at <= 20_000; at += 2_000, frames += 2) {
      expect(detector.sample({ frames, at })).toBe("playing");
    }
  });

  it("judges by the readings' own time, so a stats source that pauses is no stall", () => {
    const detector = new VideoFlowDetector(0, options);
    detector.sample({ frames: 60, at: 2_000 });
    // The same cached reading, read again much later.
    expect(detector.sample({ frames: 60, at: 2_000 })).toBe("playing");
    expect(detector.sample({ frames: 60, at: 2_000 })).toBe("playing");
  });

  it("treats a count that went down (another receiver) as progress", () => {
    const detector = new VideoFlowDetector(0, options);
    detector.sample({ frames: 500, at: 2_000 });
    expect(detector.sample({ frames: 3, at: 8_000 })).toBe("playing");
  });

  it("plays when stats cannot be read, as before it existed", () => {
    const detector = new VideoFlowDetector(0, options);
    expect(detector.sample(null)).toBe("playing");
  });
});

describe("cameraTileVideo", () => {
  it("shows the camera while its track plays or is not measured", () => {
    expect(
      cameraTileVideo({ hasTrack: true, flow: "playing", waitingForMs: 0 }),
    ).toBe("video");
    expect(
      cameraTileVideo({ hasTrack: true, flow: undefined, waitingForMs: 0 }),
    ).toBe("video");
  });

  it("shows the loading state while the pull or its first frame is on the way", () => {
    expect(
      cameraTileVideo({ hasTrack: false, flow: undefined, waitingForMs: 0 }),
    ).toBe("connecting");
    expect(
      cameraTileVideo({ hasTrack: true, flow: "waiting", waitingForMs: 3_000 }),
    ).toBe("connecting");
  });

  it("says the video is unavailable after the grace, or once its track stalled", () => {
    expect(
      cameraTileVideo({
        hasTrack: false,
        flow: undefined,
        waitingForMs: CAMERA_CONNECT_GRACE_MS,
      }),
    ).toBe("unavailable");
    expect(
      cameraTileVideo({
        hasTrack: true,
        flow: "waiting",
        waitingForMs: CAMERA_CONNECT_GRACE_MS,
      }),
    ).toBe("unavailable");
    expect(
      cameraTileVideo({ hasTrack: true, flow: "stalled", waitingForMs: 0 }),
    ).toBe("unavailable");
  });
});
