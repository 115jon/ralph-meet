// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeImage = {
  id: number;
  size: ReturnType<typeof vi.fn>;
  rgba: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  let nextId = 0;
  const images: FakeImage[] = [];
  const makeImage = (): FakeImage => {
    const image: FakeImage = {
      id: ++nextId,
      size: vi.fn(async () => ({ width: 32, height: 32 })),
      rgba: vi.fn(async () => new Uint8Array(32 * 32 * 4)),
      close: vi.fn(async () => {}),
    };
    images.push(image);
    return image;
  };
  const tray = {
    setTooltip: vi.fn(async (_tooltip: string) => {}),
    setIcon: vi.fn(async (_icon: FakeImage) => {}),
    close: vi.fn(async () => {}),
  };
  return {
    images,
    makeImage,
    tray,
    getById: vi.fn(async (_id: string) => tray),
    imageNew: vi.fn(async () => makeImage()),
    defaultWindowIcon: vi.fn(async () => makeImage()),
    setOverlayIcon: vi.fn(async () => {}),
    invoke: vi.fn(async (_cmd: string, _args?: unknown) => {}),
  };
});

vi.mock("@tauri-apps/api/tray", () => ({
  TrayIcon: { getById: mocks.getById },
}));
vi.mock("@tauri-apps/api/image", () => ({
  Image: { new: mocks.imageNew },
}));
vi.mock("@tauri-apps/api/app", () => ({
  defaultWindowIcon: mocks.defaultWindowIcon,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setOverlayIcon: mocks.setOverlayIcon }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {},
}));

import {
  applyTrayBadge,
  drawBadgedIcon,
  resetTrayBadgeForTests,
} from "@/lib/host/desktop-tray";
import {
  resetDesktopToastsForTests,
  setTaskbarAttention,
} from "@/lib/host/desktop-toasts";

/** Every IPC the badge path can make, counted. */
function ipcCount() {
  return (
    mocks.getById.mock.calls.length +
    mocks.tray.setTooltip.mock.calls.length +
    mocks.tray.setIcon.mock.calls.length +
    mocks.imageNew.mock.calls.length +
    mocks.defaultWindowIcon.mock.calls.length +
    mocks.setOverlayIcon.mock.calls.length +
    mocks.invoke.mock.calls.length +
    mocks.images.reduce(
      (sum, image) =>
        sum + image.size.mock.calls.length + image.rgba.mock.calls.length,
      0,
    )
  );
}

const badge = (count: number, tooltip = `Ralph Meet - ${count} unread`) => ({
  count,
  showDot: false,
  tooltip,
});
const cleared = { count: 0, showDot: false, tooltip: "Ralph Meet" };

describe("desktop tray badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.images.length = 0;
    resetTrayBadgeForTests();
    resetDesktopToastsForTests();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("does not touch the tray at startup when there is nothing to clear", async () => {
    await applyTrayBadge(cleared);
    expect(ipcCount()).toBe(0);
  });

  it("draws a badge once and skips repeats of the same state", async () => {
    await applyTrayBadge(badge(3));

    expect(mocks.getById).toHaveBeenCalledWith("main");
    expect(mocks.tray.setTooltip).toHaveBeenCalledWith("Ralph Meet - 3 unread");
    expect(mocks.setOverlayIcon).toHaveBeenCalledTimes(1);
    expect(mocks.tray.setIcon).toHaveBeenCalledTimes(1);
    const before = ipcCount();

    // A new message that leaves the badge as it was: no IPC at all.
    await applyTrayBadge(badge(3));
    await applyTrayBadge(badge(3));
    expect(ipcCount()).toBe(before);
  });

  it("closes every Image it creates and never closes the tray handle", async () => {
    await applyTrayBadge(badge(3));
    await applyTrayBadge(badge(4));
    await applyTrayBadge(cleared);

    // The window icon read once, plus one image per icon change.
    expect(mocks.defaultWindowIcon).toHaveBeenCalledTimes(1);
    expect(mocks.imageNew).toHaveBeenCalledTimes(3);
    expect(mocks.images).toHaveLength(4);
    for (const image of mocks.images) {
      expect(image.close).toHaveBeenCalledTimes(1);
    }
    // Closing a TrayIcon resource removes the tray icon from the app.
    expect(mocks.tray.close).not.toHaveBeenCalled();
    expect(mocks.getById).toHaveBeenCalledTimes(1);
  });

  it("only sends the tooltip when only the tooltip changed", async () => {
    await applyTrayBadge(badge(3, "Ralph Meet - 3 unread"));
    vi.clearAllMocks();

    await applyTrayBadge(badge(3, "Ralph Meet - 5 unread"));

    expect(mocks.tray.setTooltip).toHaveBeenCalledWith("Ralph Meet - 5 unread");
    expect(mocks.tray.setIcon).not.toHaveBeenCalled();
    expect(mocks.imageNew).not.toHaveBeenCalled();
    expect(mocks.setOverlayIcon).not.toHaveBeenCalled();
  });

  it("restores the plain icon and stops taskbar attention on clear", async () => {
    await applyTrayBadge(badge(2));
    vi.clearAllMocks();

    await applyTrayBadge(cleared);

    expect(mocks.tray.setIcon).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "set_taskbar_notification_attention",
      { active: false },
    );

    vi.clearAllMocks();
    await applyTrayBadge(cleared);
    expect(ipcCount()).toBe(0);
  });

  it("clears taskbar attention a toast left on, even with no badge", async () => {
    await setTaskbarAttention(true);
    vi.clearAllMocks();

    await applyTrayBadge(cleared);

    expect(mocks.invoke).toHaveBeenCalledWith(
      "set_taskbar_notification_attention",
      { active: false },
    );
  });

  it("treats counts above 99 as one label", async () => {
    await applyTrayBadge(badge(120, "t"));
    vi.clearAllMocks();
    await applyTrayBadge(badge(150, "t"));
    expect(ipcCount()).toBe(0);
  });

  it("collapses calls made during an apply into the latest state", async () => {
    const first = applyTrayBadge(badge(1, "t"));
    void applyTrayBadge(badge(2, "t"));
    const last = applyTrayBadge(badge(3, "t"));
    await Promise.all([first, last]);

    // Badge 1, then straight to 3; 2 was never drawn.
    expect(mocks.imageNew).toHaveBeenCalledTimes(2);
  });

  it("draws the badge without mutating the cached window icon", () => {
    const base = { rgba: new Uint8Array(32 * 32 * 4), width: 32, height: 32 };
    const drawn = drawBadgedIcon(base, badge(5));
    expect(base.rgba.every((value) => value === 0)).toBe(true);
    expect(drawn.rgba.some((value) => value !== 0)).toBe(true);
  });
});
