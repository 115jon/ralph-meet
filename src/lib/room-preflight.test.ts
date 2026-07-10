import { describe, expect, it } from "vitest";

import { getRoomPreflightWarnings } from "./room-preflight";

describe("getRoomPreflightWarnings", () => {
  it("warns when no microphone is available", () => {
    expect(
      getRoomPreflightWarnings([{ kind: "videoinput" } as MediaDeviceInfo]),
    ).toContain("No microphone detected");
  });

  it("does not warn when an audio input exists", () => {
    expect(
      getRoomPreflightWarnings([{ kind: "audioinput" } as MediaDeviceInfo]),
    ).toEqual([]);
  });
});
