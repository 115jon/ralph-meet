import { beforeEach, describe, expect, it } from "vitest";

import { normalizePeerSettings, useVoiceSettingsStore } from "./useVoiceSettingsStore";

describe("useVoiceSettingsStore peer volume settings", () => {
  beforeEach(() => {
    useVoiceSettingsStore.setState({ currentUser: null, userSettings: {}, _cache: {} });
  });

  it("stores user volume and stream volume independently", () => {
    const store = useVoiceSettingsStore.getState();

    store.setCurrentUser("viewer");
    store.setPeerVolume("user-2", 25);
    store.setPeerStreamVolume("user-2", 145);

    const peer = useVoiceSettingsStore.getState().getSettings("viewer").peerSettings["user-2"];

    expect(peer.volume).toBe(25);
    expect(peer.streamVolume).toBe(145);
  });

  it("uses existing user volume as the fallback for older stream settings", () => {
    const peer = normalizePeerSettings({ volume: 65 } as any);

    expect(peer.volume).toBe(65);
    expect(peer.streamVolume).toBe(65);
  });
});
