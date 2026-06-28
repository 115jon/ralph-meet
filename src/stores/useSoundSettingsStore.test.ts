import { beforeEach, describe, expect, it } from "vitest";

import { isSoundEnabled, useSoundSettingsStore } from "@/stores/useSoundSettingsStore";

describe("useSoundSettingsStore", () => {
  beforeEach(() => {
    useSoundSettingsStore.setState({ currentUser: null, userSettings: {}, _cache: {} });
  });

  it("enables stream watcher activity sounds by default", () => {
    useSoundSettingsStore.getState().setCurrentUser("user-1");

    expect(useSoundSettingsStore.getState().getSettings().streamWatcherActivity).toBe(true);
    expect(isSoundEnabled("streamWatcherActivity")).toBe(true);
  });

  it("backfills the stream watcher activity toggle for older stored users", () => {
    useSoundSettingsStore.setState({
      currentUser: "user-1",
      userSettings: {
        "user-1": {
          soundsEnabled: true,
          voiceJoinLeave: true,
          muteDeafen: true,
          notifications: true,
          selfConnectDisconnect: true,
          screenShare: true,
          messageReceived: true,
          calls: true,
          soundVolume: 100,
        } as any,
      },
      _cache: {},
    });

    expect(useSoundSettingsStore.getState().getSettings().streamWatcherActivity).toBe(true);
  });
});
