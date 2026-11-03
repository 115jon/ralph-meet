import { describe, expect, it } from "vitest";
import { hookSourceLabel } from "@/components/voice/streamingStats";
import type { NativeShareStatsSnapshot } from "@/types/native-share-stats";

function snapshot(
  overrides: Partial<NativeShareStatsSnapshot>,
): NativeShareStatsSnapshot {
  return {
    capture_mode: "hook",
    capture_policy: "wgc-enabled",
    capture_unavailable: false,
    foreign_hook: false,
    active_backend: "dx11",
    encoder_backend: "nvenc",
    fallback_reason: "none",
    captured_frames: 0,
    encoded_frames: 0,
    encode_errors: 0,
    samples_written: 0,
    dropped_frames: 0,
    last_fused_gpu_us: 0,
    last_encode_submit_us: 0,
    fused_gpu_us_avg: 0,
    encode_submit_us_avg: 0,
    negotiated_width: null,
    negotiated_height: null,
    negotiated_fps: null,
    ...overrides,
  };
}

describe("hookSourceLabel", () => {
  it("names the signed hook, its version, release and pacing", () => {
    expect(
      hookSourceLabel(
        snapshot({
          hook_flavor: "obs-signed",
          hook_version: "1.8",
          obs_version: "33.0.1",
          pacing: "timer",
        }),
      ),
    ).toBe(" · OBS Studio capture hook 1.8 (33.0.1), timer pacing");
  });

  it("labels the development fork", () => {
    expect(
      hookSourceLabel(snapshot({ hook_flavor: "own", pacing: "present" })),
    ).toBe(" · development hook, present pacing");
  });

  it("is empty for WGC, unavailable capture, and older desktop builds", () => {
    expect(
      hookSourceLabel(
        snapshot({ capture_mode: "wgc", hook_flavor: "obs-signed" }),
      ),
    ).toBe("");
    expect(
      hookSourceLabel(
        snapshot({ capture_unavailable: true, hook_flavor: "obs-signed" }),
      ),
    ).toBe("");
    expect(hookSourceLabel(snapshot({}))).toBe("");
  });
});
