import { describe, expect, it, vi } from "vitest";

import { loadUntilLoaded } from "./load-until-loaded";

function network() {
  let listener: (() => void) | null = null;
  return {
    onNetworkBack: (next: () => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    back: () => listener?.(),
    get listening() {
      return listener !== null;
    },
  };
}

describe("loadUntilLoaded", () => {
  it("loads again when the network comes back after an offline launch", async () => {
    const net = network();
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("me");
    const loaded = vi.fn();
    loadUntilLoaded(load, loaded, net.onNetworkBack);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(loaded).not.toHaveBeenCalled();

    net.back();
    await vi.waitFor(() => expect(loaded).toHaveBeenCalledWith("me"));
    // Loaded: later network changes do nothing.
    expect(net.listening).toBe(false);
  });

  it("does nothing after it is stopped", async () => {
    const net = network();
    let resolve: (value: string) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const loaded = vi.fn();
    const stop = loadUntilLoaded(load, loaded, net.onNetworkBack);
    stop();
    resolve("me");
    await Promise.resolve();
    expect(loaded).not.toHaveBeenCalled();
    expect(net.listening).toBe(false);
  });
});
