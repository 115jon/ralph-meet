// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { onPageWake } from "../page-wake";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("onPageWake", () => {
  it("shares one set of DOM listeners between every socket owner", () => {
    const add = vi.spyOn(window, "addEventListener");
    const chat = vi.fn();
    const call = vi.fn();
    const stopChat = onPageWake(chat);
    const stopCall = onPageWake(call);
    expect(
      add.mock.calls.filter(([type]) => String(type) === "online"),
    ).toHaveLength(1);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(chat).not.toHaveBeenCalled();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("pageshow"));
    expect(chat).toHaveBeenCalledTimes(3);
    expect(call).toHaveBeenCalledTimes(3);

    stopChat();
    window.dispatchEvent(new Event("online"));
    expect(chat).toHaveBeenCalledTimes(3);
    expect(call).toHaveBeenCalledTimes(4);

    const remove = vi.spyOn(window, "removeEventListener");
    stopCall();
    expect(remove.mock.calls.map(([type]) => type)).toEqual([
      "online",
      "pageshow",
    ]);
    window.dispatchEvent(new Event("online"));
    expect(call).toHaveBeenCalledTimes(4);
  });
});
