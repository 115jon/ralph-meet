import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createKovaAuthClient: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@kova/react", () => ({
  createKovaAuthClient: mocks.createKovaAuthClient,
}));

vi.mock("@/lib/kova-auth-config", () => ({
  getKovaAuthConfig: () => ({
    authUrl: "https://auth.test",
    publishableKey: "pk_test_x",
  }),
}));

import { endKovaBrowserSession } from "../kova-sign-out";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("endKovaBrowserSession", () => {
  it("signs the auth-domain session out with a fresh client (no app bearer)", async () => {
    mocks.signOut.mockResolvedValue({ data: { success: true } });
    mocks.createKovaAuthClient.mockReturnValue({ signOut: mocks.signOut });
    await endKovaBrowserSession();
    expect(mocks.createKovaAuthClient).toHaveBeenCalledWith({
      authUrl: "https://auth.test",
      publishableKey: "pk_test_x",
    });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("never throws, so sign-out carries on offline", async () => {
    mocks.signOut.mockRejectedValue(new TypeError("Failed to fetch"));
    mocks.createKovaAuthClient.mockReturnValue({ signOut: mocks.signOut });
    await expect(endKovaBrowserSession()).resolves.toBeUndefined();
  });

  it("gives up waiting after a few seconds", async () => {
    vi.useFakeTimers();
    mocks.signOut.mockReturnValue(new Promise(() => {}));
    mocks.createKovaAuthClient.mockReturnValue({ signOut: mocks.signOut });
    const done = vi.fn();
    void endKovaBrowserSession().then(done);
    await vi.advanceTimersByTimeAsync(3999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });
});
