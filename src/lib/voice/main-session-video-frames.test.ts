import { describe, expect, it } from "vitest";

import { readMainSessionVideoFrames } from "./main-session-video-frames";

function receiver(
  entries: Array<Record<string, unknown>>,
): RTCRtpReceiver & { reads: number } {
  const fake = {
    reads: 0,
    getStats: async () => {
      fake.reads += 1;
      return new Map(entries.map((entry, index) => [`s${index}`, entry]));
    },
  };
  return fake as unknown as RTCRtpReceiver & { reads: number };
}

describe("readMainSessionVideoFrames", () => {
  it("reads the hub's entry for this track without polling the receiver", () => {
    const direct = receiver([]);
    expect(
      readMainSessionVideoFrames(
        { frames: 42, timestamp: 2_000 },
        1_000,
        direct,
      ),
    ).toEqual({ frames: 42, at: 2_000 });
    expect(direct.reads).toBe(0);
  });

  it("reads the receiver when the hub never matched the track (no trackIdentifier)", async () => {
    // Firefox before 111 / Safari before 16.4: inbound-rtp has no
    // trackIdentifier, so the hub has no entry and frames do flow.
    const direct = receiver([
      { type: "inbound-rtp", kind: "video", framesDecoded: 90 },
    ]);
    const reading = await readMainSessionVideoFrames(null, 1_000, direct);
    expect(reading?.frames).toBe(90);
    expect(direct.reads).toBe(1);
  });

  it("does not take the alias's previous track's entry for this one", async () => {
    const direct = receiver([]);
    const reading = await readMainSessionVideoFrames(
      { frames: 500, timestamp: 900 },
      1_000,
      direct,
    );
    // Nothing has arrived for this track yet.
    expect(reading?.frames).toBe(0);
  });

  it("reads nothing without a receiver", () => {
    expect(readMainSessionVideoFrames(undefined, 1_000, null)).toBeNull();
  });
});
