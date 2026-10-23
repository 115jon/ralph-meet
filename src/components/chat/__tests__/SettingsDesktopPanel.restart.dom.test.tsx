// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke:
    vi.fn<
      (command: string, args?: Record<string, unknown>) => Promise<unknown>
    >(),
  updateSettings: vi.fn<(updates: Record<string, unknown>) => void>(),
}));

vi.mock("@/lib/platform", () => ({
  isDesktop: () => true,
}));

vi.mock("@/hooks/useBackButton", () => ({
  useBackButton: () => {},
  useDialogBackButton: () => {},
}));

vi.mock("@/components/chat/useAppearanceTheme", () => ({
  useAppearanceTheme: () => ({
    theme: "dark",
    preferences: {
      themePreference: "dark",
      themeSyncEnabled: false,
    },
    setAppearanceTheme: vi.fn(),
    setThemeSyncEnabled: vi.fn(),
  }),
}));

vi.mock("@/stores/useDesktopSettingsStore", () => {
  const state = {
    openOnStartup: false,
    startMinimized: false,
    closeToTray: true,
    hardwareAcceleration: true,
    desktopNotifications: true,
    updateSettings: mocks.updateSettings,
    syncToBackend: vi.fn(),
  };
  return {
    useDesktopSettingsStore: <T,>(selector?: (s: typeof state) => T) =>
      selector ? selector(state) : state,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@/hooks/useAppUpdater", () => ({
  useAppUpdater: () => ({
    status: "idle",
    updateMeta: null,
    downloadProgress: null,
    error: null,
    checkForUpdate: vi.fn(),
    applyUpdate: vi.fn(),
  }),
}));

import DesktopPanel from "@/components/chat/settings/DesktopPanel";
import { SettingsContext } from "@/components/chat/settings/primitives";

describe("DesktopPanel hardware acceleration restart", () => {
  it("routes hardware acceleration confirmation through the desktop restart command", async () => {
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "get_hardware_acceleration") {
        return true;
      }

      return undefined;
    });

    render(
      <SettingsContext.Provider
        value={{
          env: { desktop: true },
          query: "",
          target: null,
          registerEscape: () => () => {},
          openProfileEditor: () => {},
          openThemePreview: () => {},
        }}
      >
        <DesktopPanel />
      </SettingsContext.Provider>,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Hardware acceleration" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Restart now" }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("set_hardware_acceleration", {
        enabled: false,
      });
      expect(mocks.invoke).toHaveBeenCalledWith("restart_app");
    });
  });

  it("keeps the confirm open with the reason when the change fails", async () => {
    mocks.updateSettings.mockClear();
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "get_hardware_acceleration") return true;
      if (command === "set_hardware_acceleration") {
        throw new Error("ipc: command not found");
      }
      return undefined;
    });

    render(
      <SettingsContext.Provider
        value={{
          env: { desktop: true },
          query: "",
          target: null,
          registerEscape: () => () => {},
          openProfileEditor: () => {},
          openThemePreview: () => {},
        }}
      >
        <DesktopPanel />
      </SettingsContext.Provider>,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Hardware acceleration" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Restart now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to change hardware acceleration.",
    );
    expect(screen.getByRole("button", { name: "Restart now" })).toBeVisible();
    expect(screen.queryByText(/ipc: command not found/)).toBeNull();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      hardwareAcceleration: true,
    });
  });
});
