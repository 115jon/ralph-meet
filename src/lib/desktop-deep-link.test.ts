import { beforeEach, describe, expect, it, vi } from "vitest";

type EventCallback = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, EventCallback[]>(),
  invoke: vi.fn<(cmd: string) => Promise<string[]>>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, callback: EventCallback) => {
    const list = mocks.listeners.get(event) ?? [];
    list.push(callback);
    mocks.listeners.set(event, list);
    return () => {};
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import {
  DESKTOP_DEEP_LINK_EVENT,
  inviteCodeFromDeepLink,
  readDeepLinkPayload,
  resetDesktopDeepLinksForTests,
  subscribeDesktopDeepLinks,
} from "@/lib/desktop-deep-link";

function emit(event: string, payload: unknown) {
  for (const callback of mocks.listeners.get(event) ?? []) {
    callback({ payload });
  }
}

describe("desktop deep links", () => {
  beforeEach(() => {
    mocks.listeners.clear();
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue([]);
    resetDesktopDeepLinksForTests();
  });

  it("listens to exactly one event and delivers each link once", async () => {
    const handler = vi.fn<(url: string) => void>();
    const { ready } = subscribeDesktopDeepLinks(handler);
    await ready;

    expect([...mocks.listeners.keys()]).toEqual([DESKTOP_DEEP_LINK_EVENT]);
    expect(mocks.listeners.get(DESKTOP_DEEP_LINK_EVENT)).toHaveLength(1);

    emit(DESKTOP_DEEP_LINK_EVENT, { url: "yap://invite/abc" });
    // The old event names are not listened to any more.
    emit("deep-link", "yap://invite/abc");
    emit("deep-link://new-url", ["yap://invite/abc"]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("yap://invite/abc");
  });

  it("delivers links Rust queued before the listener was ready", async () => {
    mocks.invoke.mockResolvedValueOnce(["yap://invite/cold"]);
    const handler = vi.fn<(url: string) => void>();
    await subscribeDesktopDeepLinks(handler).ready;

    expect(mocks.invoke).toHaveBeenCalledWith("take_pending_deep_links");
    expect(handler).toHaveBeenCalledWith("yap://invite/cold");
  });

  it("attaches once across resubscribes and keeps links for the next handler", async () => {
    const first = vi.fn<(url: string) => void>();
    const sub = subscribeDesktopDeepLinks(first);
    await sub.ready;
    sub.unsubscribe();

    emit(DESKTOP_DEEP_LINK_EVENT, { url: "yap://invite/between" });
    expect(first).not.toHaveBeenCalled();

    const second = vi.fn<(url: string) => void>();
    await subscribeDesktopDeepLinks(second).ready;

    expect(second).toHaveBeenCalledWith("yap://invite/between");
    expect(mocks.listeners.get(DESKTOP_DEEP_LINK_EVENT)).toHaveLength(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("ignores payloads that are not { url }", async () => {
    const handler = vi.fn<(url: string) => void>();
    await subscribeDesktopDeepLinks(handler).ready;

    emit(DESKTOP_DEEP_LINK_EVENT, "yap://invite/abc");
    emit(DESKTOP_DEEP_LINK_EVENT, ["yap://invite/abc"]);
    emit(DESKTOP_DEEP_LINK_EVENT, { url: 3 });

    expect(handler).not.toHaveBeenCalled();
  });

  it("reads payloads and invite codes", () => {
    expect(readDeepLinkPayload({ url: "yap://invite/x" })).toBe(
      "yap://invite/x",
    );
    expect(readDeepLinkPayload(null)).toBeNull();
    expect(inviteCodeFromDeepLink("yap://invite/abc123")).toBe("abc123");
    expect(inviteCodeFromDeepLink("ralphmeet://invite/abc123")).toBeNull();
    expect(inviteCodeFromDeepLink("yap://other/abc")).toBeNull();
    expect(inviteCodeFromDeepLink("yap://invite/")).toBeNull();
    expect(inviteCodeFromDeepLink("https://invite/abc")).toBeNull();
    expect(inviteCodeFromDeepLink("not a url")).toBeNull();
  });
});
