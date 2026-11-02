// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadHostModule() {
  return import("@/lib/host");
}

describe("getHost selection", () => {
  it("picks the web adapter when the desktop flag is off", async () => {
    const { getHost } = await loadHostModule();
    const { webHost } = await import("@/lib/host/web");
    expect(getHost()).toBe(webHost);
    expect(getHost().kind).toBe("web");
  });

  it("picks the desktop adapter when the build defines __IS_DESKTOP__", async () => {
    vi.stubGlobal("__IS_DESKTOP__", true);
    const { getHost } = await loadHostModule();
    expect(getHost().kind).toBe("desktop");
    // One adapter per page.
    expect(getHost()).toBe(getHost());
  });

  it("uses an injected host until it is cleared", async () => {
    const { getHost, setHostForTests } = await loadHostModule();
    const { webHost } = await import("@/lib/host/web");
    const fake = { ...webHost, kind: "desktop" as const };

    setHostForTests(fake);
    expect(getHost()).toBe(fake);

    setHostForTests(null);
    expect(getHost()).toBe(webHost);
  });
});

describe("web adapter", () => {
  it("has no updates, version, settings or native devices", async () => {
    const { webHost } = await import("@/lib/host/web");

    await expect(webHost.updates.check()).resolves.toBeNull();
    await expect(webHost.updates.getAppVersion()).resolves.toBeNull();
    await expect(webHost.settings.load()).resolves.toBeNull();
    await expect(
      webHost.settings.save({ closeToTray: false }),
    ).resolves.toBeNull();
    await expect(webHost.media.listNativeAudioDevices()).resolves.toEqual([]);
    await expect(webHost.media.listNativeVideoDevices()).resolves.toEqual([]);
    await expect(webHost.media.probeHardwareVideoEncoders()).resolves.toBe(
      null,
    );
  });

  it("treats native window, tray and toast calls as no-ops", async () => {
    const { webHost } = await import("@/lib/host/web");

    await expect(webHost.window.setTitleBarDarkMode(true)).resolves.toBe(
      undefined,
    );
    await expect(
      webHost.notifications.setBadge({
        count: 3,
        showDot: false,
        tooltip: "x",
      }),
    ).resolves.toBe(undefined);
    await expect(
      webHost.notifications.showToast({ title: "hi" }),
    ).resolves.toBe(undefined);

    const unlisten = await webHost.window.onThumbnailToolbarAction(vi.fn());
    expect(() => unlisten()).not.toThrow();
    const unlistenShare = await webHost.media.onNativeScreenShareEnded(vi.fn());
    expect(() => unlistenShare()).not.toThrow();
  });

  it("never delivers deep links and is ready at once", async () => {
    const { webHost } = await import("@/lib/host/web");
    const handler = vi.fn();
    const { ready, unsubscribe } = webHost.deepLinks.subscribe(handler);

    await expect(ready).resolves.toBeUndefined();
    unsubscribe();
    expect(handler).not.toHaveBeenCalled();
  });

  it("opens external links in a new browser tab", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { webHost } = await import("@/lib/host/web");

    await webHost.window.openExternal("https://example.com/");

    expect(open).toHaveBeenCalledWith(
      "https://example.com/",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
