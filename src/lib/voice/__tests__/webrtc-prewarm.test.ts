import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prewarmWebRtc, resetWebRtcPrewarmForTests } from "../webrtc-prewarm";

describe("prewarmWebRtc", () => {
  const close = vi.fn();
  const constructed = vi.fn();

  beforeEach(() => {
    resetWebRtcPrewarmForTests();
    close.mockClear();
    constructed.mockClear();
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        constructor(config?: unknown) {
          constructed(config);
        }
        close() {
          close();
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds and closes one connection, when the page is idle, once", () => {
    const idle: Array<() => void> = [];
    const schedule = (callback: () => void) => idle.push(callback);

    prewarmWebRtc(schedule);
    prewarmWebRtc(schedule);
    expect(constructed).not.toHaveBeenCalled();
    expect(idle).toHaveLength(1);

    idle[0]?.();
    expect(constructed).toHaveBeenCalledOnce();
    // No ICE servers: the warm-up never touches the network.
    expect(constructed).toHaveBeenCalledWith(undefined);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does nothing where WebRTC is missing", () => {
    vi.stubGlobal("RTCPeerConnection", undefined);
    const schedule = vi.fn();
    prewarmWebRtc(schedule);
    expect(schedule).not.toHaveBeenCalled();
  });
});
