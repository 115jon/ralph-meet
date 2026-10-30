// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  offFocus: vi.fn(),
  offResize: vi.fn(),
  offOcclusion: vi.fn(),
  failListen: false,
}));

vi.mock("@/lib/platform", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async () => tauri.offFocus,
    onResized: async () => tauri.offResize,
    isMinimized: async () => false,
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => {
    if (tauri.failListen) throw new Error("no event bridge");
    return tauri.offOcclusion;
  },
}));

import { act, cleanup, renderHook } from "@testing-library/react";
import { useAppActive } from "@/hooks/useAppActive";

afterEach(() => {
  cleanup();
  tauri.offFocus.mockReset();
  tauri.offResize.mockReset();
  tauri.offOcclusion.mockReset();
  tauri.failListen = false;
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("useAppActive listener cleanup", () => {
  it("removes every native listener on unmount", async () => {
    const { unmount } = renderHook(() => useAppActive());
    await settle();
    unmount();
    expect(tauri.offFocus).toHaveBeenCalledOnce();
    expect(tauri.offResize).toHaveBeenCalledOnce();
    expect(tauri.offOcclusion).toHaveBeenCalledOnce();
  });

  it("does not strand the listeners already attached when a later one throws", async () => {
    tauri.failListen = true;
    const { unmount } = renderHook(() => useAppActive());
    await settle();
    unmount();
    expect(tauri.offFocus).toHaveBeenCalledOnce();
    expect(tauri.offResize).toHaveBeenCalledOnce();
  });

  it("keeps removing listeners when one cleanup throws", async () => {
    tauri.offFocus.mockImplementation(() => {
      throw new Error("already gone");
    });
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useAppActive());
    await settle();
    unmount();
    expect(tauri.offResize).toHaveBeenCalledOnce();
    expect(tauri.offOcclusion).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("blur", expect.any(Function));
    remove.mockRestore();
  });

  it("attaches nothing when unmounted before the native API loads", async () => {
    const { unmount } = renderHook(() => useAppActive());
    unmount();
    await settle();
    expect(tauri.offFocus).not.toHaveBeenCalled();
  });
});
