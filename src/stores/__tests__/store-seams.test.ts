import { describe, expect, it, vi } from "vitest";

describe("speaking-source", () => {
  it("answers false until a source registers, then follows it", async () => {
    vi.resetModules();
    const { readIsSpeaking, registerSpeakingSource, subscribeSpeaking } =
      await import("@/stores/speaking-source");

    expect(readIsSpeaking("ada")).toBe(false);
    expect(readIsSpeaking(null)).toBe(false);

    const heard = vi.fn();
    subscribeSpeaking(heard);

    let speaking = new Set<string>();
    let notify: () => void = () => {};
    registerSpeakingSource({
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      isSpeaking: (userId) => speaking.has(userId),
    });
    // Leaves that mounted before the source existed re-check at once.
    expect(heard).toHaveBeenCalledTimes(1);

    speaking = new Set(["ada"]);
    notify();
    expect(heard).toHaveBeenCalledTimes(2);
    expect(readIsSpeaking("ada")).toBe(true);
    expect(readIsSpeaking("grace")).toBe(false);
  });

  it("stops notifying an unsubscribed listener", async () => {
    vi.resetModules();
    const { registerSpeakingSource, subscribeSpeaking } =
      await import("@/stores/speaking-source");
    const heard = vi.fn();
    const unsubscribe = subscribeSpeaking(heard);
    unsubscribe();
    registerSpeakingSource({
      subscribe: () => () => {},
      isSpeaking: () => false,
    });
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("chat-store-loaded", () => {
  it("flips once, tells subscribers, and ignores repeats", async () => {
    vi.resetModules();
    const { isChatStoreLoaded, markChatStoreLoaded, subscribeChatStoreLoaded } =
      await import("@/stores/chat-store-loaded");

    const heard = vi.fn();
    subscribeChatStoreLoaded(heard);
    expect(isChatStoreLoaded()).toBe(false);

    markChatStoreLoaded();
    markChatStoreLoaded();
    expect(isChatStoreLoaded()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("is marked by importing the chat store", async () => {
    vi.resetModules();
    const loaded = await import("@/stores/chat-store-loaded");
    expect(loaded.isChatStoreLoaded()).toBe(false);
    await import("@/stores/chat-store");
    expect(loaded.isChatStoreLoaded()).toBe(true);
  });
});
