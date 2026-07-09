// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  updateSettings: vi.fn<(updates: Record<string, unknown>) => void>(),
}));

vi.mock("@/lib/platform", () => ({
  isDesktop: () => true,
}));

vi.mock("@/hooks/useBackButton", () => ({
  useBackButton: () => { },
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

vi.mock("@/stores/useDesktopSettingsStore", () => ({
  useDesktopSettingsStore: <T,>(selector: (state: {
    hardwareAcceleration: boolean;
    updateSettings: typeof mocks.updateSettings;
  }) => T) => selector({
    hardwareAcceleration: true,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import SettingsAppearanceTab from "@/components/chat/SettingsAppearanceTab";

describe("SettingsAppearanceTab restart flow", () => {
  it("routes hardware acceleration confirmation through the desktop restart command", async () => {
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "get_hardware_acceleration") {
        return true;
      }

      return undefined;
    });

    render(<SettingsAppearanceTab />);

    fireEvent.click(screen.getAllByLabelText("Toggle setting")[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Change and Restart" }));

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("set_hardware_acceleration", { enabled: false });
      expect(mocks.invoke).toHaveBeenCalledWith("restart_app");
    });
  });
});
