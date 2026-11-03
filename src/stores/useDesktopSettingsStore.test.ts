import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() =>
  vi.fn<
    (
      cmd: string,
      args?: Record<string, unknown>,
    ) => Promise<DesktopSettings | DesktopSettingsSnapshot>
  >(),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { setHostForTests } from "@/lib/host";
import { createDesktopHost } from "@/lib/host/desktop";
import {
  hydrateDesktopSettings,
  resetDesktopSettingsHydrationForTests,
  useDesktopSettingsStore,
  type DesktopSettings,
  type DesktopSettingsSnapshot,
} from "@/stores/useDesktopSettingsStore";

const rustDefaults: DesktopSettings = {
  openOnStartup: false,
  startMinimized: false,
  closeToTray: true,
  hardwareAcceleration: true,
  desktopNotifications: true,
  gameCaptureHook: true,
};

function settingsOf(state: DesktopSettings): DesktopSettings {
  return {
    openOnStartup: state.openOnStartup,
    startMinimized: state.startMinimized,
    closeToTray: state.closeToTray,
    hardwareAcceleration: state.hardwareAcceleration,
    desktopNotifications: state.desktopNotifications,
    gameCaptureHook: state.gameCaptureHook,
  };
}

// The real desktop adapter over the mocked `invoke`.
setHostForTests(createDesktopHost());

describe("desktop settings owned by Rust", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetDesktopSettingsHydrationForTests();
    useDesktopSettingsStore.setState(rustDefaults);
  });

  it("hydrates from Rust when Rust has persisted settings", async () => {
    useDesktopSettingsStore.setState({ startMinimized: false });
    invokeMock.mockResolvedValueOnce({
      persisted: true,
      settings: { ...rustDefaults, startMinimized: true, closeToTray: false },
    });

    await hydrateDesktopSettings();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_desktop_settings");
    expect(settingsOf(useDesktopSettingsStore.getState())).toEqual({
      ...rustDefaults,
      startMinimized: true,
      closeToTray: false,
    });
  });

  it("migrates localStorage values once when Rust has none, keeping Rust's hardware acceleration", async () => {
    useDesktopSettingsStore.setState({
      openOnStartup: true,
      startMinimized: true,
      closeToTray: false,
      hardwareAcceleration: true,
      desktopNotifications: false,
    });
    const migrated: DesktopSettings = {
      openOnStartup: true,
      startMinimized: true,
      closeToTray: false,
      hardwareAcceleration: false,
      desktopNotifications: false,
      gameCaptureHook: true,
    };
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "get_desktop_settings"
        ? {
            persisted: false,
            settings: { ...rustDefaults, hardwareAcceleration: false },
          }
        : migrated,
    );

    await hydrateDesktopSettings();
    await hydrateDesktopSettings();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("set_desktop_settings", {
      patch: {
        openOnStartup: true,
        startMinimized: true,
        closeToTray: false,
        desktopNotifications: false,
      },
    });
    expect(settingsOf(useDesktopSettingsStore.getState())).toEqual(migrated);
  });

  it("retries hydration after a failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ipc down"));
    await hydrateDesktopSettings();
    invokeMock.mockResolvedValueOnce({
      persisted: true,
      settings: { ...rustDefaults, closeToTray: false },
    });
    await hydrateDesktopSettings();
    expect(useDesktopSettingsStore.getState().closeToTray).toBe(false);
  });

  it("sends only the changed keys in one set and applies Rust's answer", async () => {
    invokeMock.mockResolvedValueOnce({ ...rustDefaults, closeToTray: false });

    await useDesktopSettingsStore.getState().saveSettings({
      closeToTray: false,
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("set_desktop_settings", {
      patch: { closeToTray: false },
    });
    expect(useDesktopSettingsStore.getState().closeToTray).toBe(false);
  });

  it("reverts the changed keys and rejects when Rust fails to save", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));

    await expect(
      useDesktopSettingsStore
        .getState()
        .saveSettings({ hardwareAcceleration: false }),
    ).rejects.toThrow("disk full");

    expect(useDesktopSettingsStore.getState().hardwareAcceleration).toBe(true);
  });

  it("updateSettings applies optimistically and logs failures", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));

    useDesktopSettingsStore.getState().updateSettings({ startMinimized: true });
    expect(useDesktopSettingsStore.getState().startMinimized).toBe(true);

    await vi.waitFor(() =>
      expect(useDesktopSettingsStore.getState().startMinimized).toBe(false),
    );
  });
});
