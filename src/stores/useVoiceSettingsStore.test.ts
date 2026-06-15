import { beforeEach, describe, expect, it } from "vitest";
import { normalizePeerSettings, useVoiceSettingsStore } from "./useVoiceSettingsStore";

describe("useVoiceSettingsStore peer volume settings", () => {
  beforeEach(() => {
    useVoiceSettingsStore.setState({ currentUser: null, userSettings: {}, _cache: {} });
  });

  it("preserves explicit peer stream volume independently from voice volume", () => {
    const store = useVoiceSettingsStore.getState();
    store.setCurrentUser("viewer");
    store.setPeerVolume("user-2", 55);
    store.setPeerStreamVolume("user-2", 25);

    const peer = useVoiceSettingsStore.getState().getSettings("viewer").peerSettings["user-2"];
    expect(peer.volume).toBe(55);
    expect(peer.streamVolume).toBe(25);
  });

  it("backfills stream volume from voice volume for older stored peer settings", () => {
    expect(normalizePeerSettings({ volume: 42 } as any).streamVolume).toBe(42);
  });

  it("defaults camera capture and background settings for existing users", () => {
    useVoiceSettingsStore.setState({
      currentUser: "viewer",
      userSettings: {
        viewer: {
          inputDeviceId: "default",
          outputDeviceId: "default",
          videoDeviceId: "default",
        } as any,
      },
      _cache: {},
    });

    expect(useVoiceSettingsStore.getState().getSettings("viewer")).toMatchObject({
      cameraQuality: "720p30",
      cameraBackground: { type: "none" },
      customCameraBackgrounds: [],
    });
  });
});
