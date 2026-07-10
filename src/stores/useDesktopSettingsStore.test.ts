import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const autostartIsEnabledMock = vi.fn<() => Promise<boolean>>();
const autostartEnableMock = vi.fn<() => Promise<void>>();
const autostartDisableMock = vi.fn<() => Promise<void>>();

vi.mock("@/lib/platform", () => ({
  isDesktop: () => true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: autostartIsEnabledMock,
  enable: autostartEnableMock,
  disable: autostartDisableMock,
}));

import { syncSettingsToRust } from "@/stores/useDesktopSettingsStore";

describe("syncSettingsToRust", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    autostartIsEnabledMock.mockReset();
    autostartEnableMock.mockReset();
    autostartDisableMock.mockReset();

    autostartIsEnabledMock.mockResolvedValue(false);
    autostartEnableMock.mockResolvedValue();
    autostartDisableMock.mockResolvedValue();
    invokeMock.mockResolvedValue(undefined);

    vi.stubGlobal("navigator", {
      userAgent: "Windows NT 10.0",
    });
  });

  it("does not overwrite hardware acceleration during generic backend sync", async () => {
    await syncSettingsToRust({
      openOnStartup: false,
      startMinimized: false,
      closeToTray: true,
      hardwareAcceleration: true,
      desktopNotifications: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("set_open_on_startup", {
      enabled: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("set_close_to_tray", {
      enabled: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("set_start_minimized", {
      enabled: false,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("set_hardware_acceleration", {
      enabled: true,
    });
  });

  it("persists hardware acceleration only when explicitly requested", async () => {
    await syncSettingsToRust(
      {
        openOnStartup: false,
        startMinimized: true,
        closeToTray: false,
        hardwareAcceleration: false,
        desktopNotifications: true,
      },
      { includeHardwareAcceleration: true },
    );

    expect(invokeMock).toHaveBeenCalledWith("set_hardware_acceleration", {
      enabled: false,
    });
  });
});
