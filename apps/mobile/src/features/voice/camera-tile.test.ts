import { describe, expect, it } from "vitest";

import { cameraTileView } from "./camera-tile";

describe("cameraTileView", () => {
  it("leaves our own tile, screens and cameras that are off as they were", () => {
    expect(cameraTileView(null, true, true)).toBe("video");
    expect(cameraTileView(null, false, true)).toBe("video");
  });

  it("shows a remote camera's video while it plays or is not measured", () => {
    expect(cameraTileView({ flow: "playing" }, true, false)).toBe("video");
    expect(cameraTileView({ flow: undefined }, true, false)).toBe("video");
  });

  it("shows the avatar while the camera is on its way", () => {
    expect(cameraTileView({ flow: undefined }, false, false)).toBe(
      "connecting",
    );
    expect(cameraTileView({ flow: "waiting" }, true, false)).toBe("connecting");
  });

  it("says the video is unavailable once the grace runs out or it stalled", () => {
    expect(cameraTileView({ flow: undefined }, false, true)).toBe(
      "unavailable",
    );
    expect(cameraTileView({ flow: "waiting" }, true, true)).toBe("unavailable");
    expect(cameraTileView({ flow: "stalled" }, true, false)).toBe(
      "unavailable",
    );
    // Frames came back: the video again, whatever the grace said.
    expect(cameraTileView({ flow: "playing" }, true, true)).toBe("video");
  });
});
