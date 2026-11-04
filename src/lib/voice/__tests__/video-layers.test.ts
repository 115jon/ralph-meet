import { describe, expect, it } from "vitest";
import {
  CAMERA_SIMULCAST_ENCODINGS,
  resolveVideoLayerQuality,
  selectSimulcastRid,
} from "../video-layers";
import { VideoRenderDemand } from "../video-render-demand";

function track(id: string): MediaStreamTrack {
  return { id, kind: "video" } as MediaStreamTrack;
}

function stream(...tracks: MediaStreamTrack[]): MediaStream {
  return { getVideoTracks: () => tracks } as unknown as MediaStream;
}

describe("camera simulcast encodings", () => {
  it("publishes full, half and quarter layers, highest first, with RIDs in asciibetical order", () => {
    const rids = CAMERA_SIMULCAST_ENCODINGS.map((encoding) => encoding.rid);
    expect(rids).toEqual(["f", "h", "q"]);
    // The SFU's asciibetical fallback ranks a before z: f must be best.
    expect([...rids].sort()).toEqual(rids);
    expect(
      CAMERA_SIMULCAST_ENCODINGS.map((e) => e.scaleResolutionDownBy),
    ).toEqual([1, 2, 4]);
  });

  it("keeps the browser's bitrate for the top layer and caps the lower ones", () => {
    const [full, half, quarter] = CAMERA_SIMULCAST_ENCODINGS;
    expect(full?.maxBitrate).toBeUndefined();
    expect(half?.maxBitrate).toBe(500_000);
    expect(quarter?.maxBitrate).toBe(150_000);
    expect(CAMERA_SIMULCAST_ENCODINGS.every((e) => e.active)).toBe(true);
  });
});

describe("resolveVideoLayerQuality", () => {
  it("gives a track nothing renders, or a hidden 0×0 element, the low layer", () => {
    expect(resolveVideoLayerQuality(null)).toBe("low");
    expect(resolveVideoLayerQuality({ width: 0, height: 0 })).toBe("low");
  });

  it("maps tile size in device pixels to a layer", () => {
    // Members-tray thumbnail: 144×81 CSS px at 1×.
    expect(resolveVideoLayerQuality({ width: 144, height: 81 })).toBe("low");
    // The same thumbnail on a 2× display still fits the quarter layer.
    expect(resolveVideoLayerQuality({ width: 288, height: 162 })).toBe("low");
    // A grid tile in a 3×3 grid.
    expect(resolveVideoLayerQuality({ width: 420, height: 236 })).toBe(
      "medium",
    );
    // A focused stage or fullscreen.
    expect(resolveVideoLayerQuality({ width: 1600, height: 900 })).toBe("high");
  });

  it("sizes a tall box by the width its height implies for a 16:9 camera", () => {
    // A phone-width tile filling the stage height (object-cover).
    expect(resolveVideoLayerQuality({ width: 360, height: 640 })).toBe("high");
  });

  it("uses the layer boundaries inclusively", () => {
    expect(resolveVideoLayerQuality({ width: 360, height: 100 })).toBe("low");
    expect(resolveVideoLayerQuality({ width: 361, height: 100 })).toBe(
      "medium",
    );
    expect(resolveVideoLayerQuality({ width: 800, height: 100 })).toBe(
      "medium",
    );
    expect(resolveVideoLayerQuality({ width: 801, height: 100 })).toBe("high");
  });
});

describe("selectSimulcastRid", () => {
  const rids = ["f", "h", "q"];

  it("picks the publisher's layers highest to lowest", () => {
    expect(selectSimulcastRid("high", rids)).toBe("f");
    expect(selectSimulcastRid("medium", rids)).toBe("h");
    expect(selectSimulcastRid("low", rids)).toBe("q");
  });

  it("rounds medium up when only two layers were negotiated", () => {
    expect(selectSimulcastRid("medium", ["f", "q"])).toBe("f");
    expect(selectSimulcastRid("low", ["f", "q"])).toBe("q");
  });

  it("names no layer for a single-layer publisher (mobile, screen, older clients)", () => {
    expect(selectSimulcastRid("high", undefined)).toBeUndefined();
    expect(selectSimulcastRid("low", [])).toBeUndefined();
    expect(selectSimulcastRid("low", ["f"])).toBeUndefined();
  });
});

describe("VideoRenderDemand", () => {
  it("reports the largest size a track is rendered at, across elements", () => {
    const demand = new VideoRenderDemand();
    const camera = track("camera");
    const tray = Symbol("tray");
    const stage = Symbol("stage");
    demand.report(tray, stream(camera), { width: 144, height: 81 });
    demand.report(stage, stream(camera), { width: 1600, height: 900 });
    demand.report(Symbol("other"), stream(track("other")), {
      width: 2000,
      height: 1000,
    });

    expect(demand.largestRenderFor(camera)).toEqual({
      width: 1600,
      height: 900,
    });
    demand.withdraw(stage);
    expect(demand.largestRenderFor(camera)).toEqual({
      width: 144,
      height: 81,
    });
    demand.withdraw(tray);
    expect(demand.largestRenderFor(camera)).toBeNull();
  });

  it("notifies on changes only", () => {
    const demand = new VideoRenderDemand();
    let notified = 0;
    const unsubscribe = demand.subscribe(() => (notified += 1));
    const owner = Symbol("tile");
    const shown = stream(track("camera"));

    demand.report(owner, shown, { width: 100, height: 50 });
    demand.report(owner, shown, { width: 100, height: 50 });
    expect(notified).toBe(1);
    demand.report(owner, shown, { width: 120, height: 60 });
    expect(notified).toBe(2);
    demand.withdraw(owner);
    demand.withdraw(owner);
    expect(notified).toBe(3);

    unsubscribe();
    demand.report(owner, shown, { width: 100, height: 50 });
    expect(notified).toBe(3);
  });
});
