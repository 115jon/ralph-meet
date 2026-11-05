import { describe, expect, it, vi } from "vitest";

import { createNetworkWake } from "./network-wake";

describe("createNetworkWake", () => {
  it("reconnects at once when the network is back after a loss", () => {
    const wake = vi.fn();
    const listener = createNetworkWake(wake);
    listener(false);
    expect(wake).not.toHaveBeenCalled();
    listener(true);
    expect(wake).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("only probes on a switch with no loss in between", () => {
    const wake = vi.fn();
    const listener = createNetworkWake(wake);
    listener(true);
    expect(wake).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("counts one loss once", () => {
    const wake = vi.fn();
    const listener = createNetworkWake(wake);
    listener(false);
    listener(false);
    listener(true);
    listener(true);
    expect(wake.mock.calls).toEqual([[true], [false]]);
  });
});
