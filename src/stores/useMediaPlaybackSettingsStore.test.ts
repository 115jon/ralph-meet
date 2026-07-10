import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MEDIA_PLAYBACK_SETTINGS,
  normalizeMediaPlaybackSettings,
  useMediaPlaybackSettingsStore,
} from "@/stores/useMediaPlaybackSettingsStore";

describe("useMediaPlaybackSettingsStore", () => {
  beforeEach(() => {
    useMediaPlaybackSettingsStore.setState({
      ...DEFAULT_MEDIA_PLAYBACK_SETTINGS,
    });
  });

  it("defaults to full volume and sound enabled", () => {
    expect(useMediaPlaybackSettingsStore.getState().videoVolume).toBe(1);
    expect(useMediaPlaybackSettingsStore.getState().videoMuted).toBe(false);
  });

  it("clamps persisted volume values into the valid range", () => {
    expect(
      normalizeMediaPlaybackSettings({ videoVolume: 2.2, videoMuted: false }),
    ).toEqual({
      videoVolume: 1,
      videoMuted: false,
    });

    expect(
      normalizeMediaPlaybackSettings({ videoVolume: -0.25, videoMuted: false }),
    ).toEqual({
      videoVolume: 0,
      videoMuted: true,
    });
  });

  it("forces muted playback when the saved volume is zero", () => {
    useMediaPlaybackSettingsStore.getState().updateSettings({
      videoVolume: 0,
      videoMuted: false,
    });

    expect(useMediaPlaybackSettingsStore.getState().videoVolume).toBe(0);
    expect(useMediaPlaybackSettingsStore.getState().videoMuted).toBe(true);
  });

  it("preserves the saved volume when muting and unmuting", () => {
    useMediaPlaybackSettingsStore.getState().updateSettings({
      videoVolume: 0.35,
      videoMuted: true,
    });

    useMediaPlaybackSettingsStore
      .getState()
      .updateSettings({ videoMuted: false });

    expect(useMediaPlaybackSettingsStore.getState().videoVolume).toBe(0.35);
    expect(useMediaPlaybackSettingsStore.getState().videoMuted).toBe(false);
  });
});
