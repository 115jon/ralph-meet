import { beforeEach, describe, expect, it } from "vitest";
import { useVoiceActivityStore } from "./useVoiceActivityStore";

describe("useVoiceActivityStore", () => {
  beforeEach(() => {
    useVoiceActivityStore.setState({ activeByUser: {} });
  });

  it("separates channel activity discovery from a user's own activity", () => {
    const store = useVoiceActivityStore.getState();

    store.setUserActivity({
      userId: "host",
      channelId: "voice-1",
      activity: "wordle",
      startedAt: 1,
    });

    expect(store.getChannelActivity("voice-1")?.userId).toBe("host");
    expect(store.getUserActivity("guest", "voice-1")).toBeNull();
  });

  it("clears only the leaving user's activity", () => {
    const store = useVoiceActivityStore.getState();

    store.setUserActivity({
      userId: "host",
      channelId: "voice-1",
      activity: "wordle",
      startedAt: 1,
    });
    store.setUserActivity({
      userId: "guest",
      channelId: "voice-1",
      activity: "wordle",
      startedAt: 2,
    });

    store.clearUserActivity("guest");

    expect(store.getChannelActivity("voice-1")?.userId).toBe("host");
    expect(store.getUserActivity("guest", "voice-1")).toBeNull();
  });
});
