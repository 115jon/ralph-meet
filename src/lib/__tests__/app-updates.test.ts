import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appUpdates,
  createProgressTracker,
  progressPercent,
  resetAppUpdatesForTests,
  UPDATE_CHECK_TIMEOUT_MS,
  withTimeout,
} from "@/lib/app-updates";
import { setHostForTests } from "@/lib/host";
import type { Host, UpdateDownloadEvent, UpdateMetadata } from "@/lib/host";
import { webHost } from "@/lib/host/web";

const update: UpdateMetadata = {
  version: "3.8.0",
  currentVersion: "3.7.0",
  notes: "Fixes",
};

function fakeDesktopHost(updates: Partial<Host["updates"]>): Host {
  return {
    ...webHost,
    kind: "desktop",
    updates: { ...webHost.updates, ...updates },
  };
}

beforeEach(() => resetAppUpdatesForTests());
afterEach(() => {
  setHostForTests(null);
  vi.useRealTimers();
});

describe("progress math", () => {
  it("folds download events into 0–1 and clamps overshoot", () => {
    const track = createProgressTracker();
    expect(track({ event: "started", data: { contentLength: 200 } })).toBe(0);
    expect(track({ event: "progress", data: { chunkLength: 50 } })).toBe(0.25);
    expect(track({ event: "progress", data: { chunkLength: 200 } })).toBe(1);
    expect(track({ event: "finished" })).toBe(1);
  });

  it("reports nothing until the size is known", () => {
    const track = createProgressTracker();
    expect(track({ event: "started", data: { contentLength: null } })).toBe(
      null,
    );
    expect(track({ event: "progress", data: { chunkLength: 10 } })).toBe(null);
  });

  it("rounds to whole percent", () => {
    expect(progressPercent(null)).toBe(0);
    expect(progressPercent(0.256)).toBe(26);
    expect(progressPercent(1)).toBe(100);
  });
});

describe("withTimeout", () => {
  it("rejects with the message after the timeout", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 1000, "too slow");
    const assertion = expect(pending).rejects.toThrow("too slow");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("passes the value through when in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "x")).resolves.toBe(7);
  });
});

describe("app update client", () => {
  it("does nothing on the web host", async () => {
    await expect(appUpdates.check()).resolves.toBeNull();
    expect(appUpdates.getState().phase).toBe("idle");
  });

  it("shares one check between callers and keeps what it found", async () => {
    let resolve: (value: UpdateMetadata | null) => void = () => {};
    const check = vi.fn(
      () =>
        new Promise<UpdateMetadata | null>((r) => {
          resolve = r;
        }),
    );
    setHostForTests(fakeDesktopHost({ check }));

    const first = appUpdates.check();
    const second = appUpdates.check();
    expect(appUpdates.getState().phase).toBe("checking");
    resolve(update);

    await expect(first).resolves.toEqual(update);
    await expect(second).resolves.toEqual(update);
    expect(check).toHaveBeenCalledTimes(1);
    expect(appUpdates.getState()).toMatchObject({
      phase: "available",
      pending: update,
    });
  });

  it("says up to date when there is nothing", async () => {
    setHostForTests(fakeDesktopHost({ check: async () => null }));
    await appUpdates.check();
    expect(appUpdates.getState()).toMatchObject({
      phase: "up-to-date",
      pending: null,
    });
  });

  it("times out a check that hangs", async () => {
    vi.useFakeTimers();
    setHostForTests(fakeDesktopHost({ check: () => new Promise(() => {}) }));

    const pending = appUpdates.check();
    const assertion = expect(pending).rejects.toThrow(
      "Desktop update check timed out",
    );
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);
    await assertion;
    expect(appUpdates.getState()).toMatchObject({
      phase: "error",
      failed: "check",
    });
  });

  it("refuses to install without a pending update", async () => {
    const install = vi.fn(async () => {});
    setHostForTests(fakeDesktopHost({ install }));

    await expect(appUpdates.install()).rejects.toThrow("No pending update");
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the pending update and reports progress", async () => {
    const seen: Array<{ phase: string; progress: number | null }> = [];
    const events: UpdateDownloadEvent[] = [
      { event: "started", data: { contentLength: 100 } },
      { event: "progress", data: { chunkLength: 40 } },
      { event: "progress", data: { chunkLength: 60 } },
      { event: "finished" },
    ];
    setHostForTests(
      fakeDesktopHost({
        check: async () => update,
        install: async (onEvent) => {
          for (const event of events) onEvent(event);
        },
      }),
    );
    await appUpdates.check();
    appUpdates.subscribe(() => {
      const { phase, progress } = appUpdates.getState();
      seen.push({ phase, progress });
    });

    await appUpdates.install();

    expect(seen).toEqual([
      { phase: "downloading", progress: 0 },
      { phase: "downloading", progress: 0 },
      { phase: "downloading", progress: 0.4 },
      { phase: "downloading", progress: 1 },
      { phase: "installing", progress: 1 },
      { phase: "installed", progress: 1 },
    ]);
  });

  it("does not re-check while installing, so Rust's pending update stays", async () => {
    let finishInstall: () => void = () => {};
    const check = vi.fn(async () => update);
    setHostForTests(
      fakeDesktopHost({
        check,
        install: () =>
          new Promise<void>((r) => {
            finishInstall = r;
          }),
      }),
    );
    await appUpdates.check();
    const installing = appUpdates.install();

    await expect(appUpdates.check()).resolves.toEqual(update);
    expect(check).toHaveBeenCalledTimes(1);

    finishInstall();
    await installing;
  });

  it("checks again after an install that did not exit the app", async () => {
    const check = vi.fn(async () => update);
    setHostForTests(fakeDesktopHost({ check, install: async () => {} }));
    await appUpdates.check();
    await appUpdates.install();

    await appUpdates.check();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("drops the pending update when the install fails", async () => {
    setHostForTests(
      fakeDesktopHost({
        check: async () => update,
        install: async () => {
          throw new Error("disk full");
        },
      }),
    );
    await appUpdates.check();

    await expect(appUpdates.install()).rejects.toThrow("disk full");
    expect(appUpdates.getState()).toMatchObject({
      phase: "error",
      failed: "install",
      pending: null,
      progress: null,
    });
  });
});
