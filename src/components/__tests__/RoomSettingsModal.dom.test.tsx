// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@kova/react", () => ({
  useUser: () => ({ isLoaded: true, user: { id: "user-1" } }),
}));

vi.mock("@/lib/platform", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/platform")>("@/lib/platform");
  return { ...actual, isDesktop: () => false };
});

const panels = vi.hoisted(() => ({
  voice: vi.fn(),
  camera: vi.fn(),
}));

vi.mock("@/components/chat/settings/VoiceVideoPanel", () => ({
  default: (props: unknown) => {
    panels.voice(props);
    return <div data-testid="voice-panel" />;
  },
}));
vi.mock("@/components/chat/settings/CameraCard", () => ({
  default: (props: unknown) => {
    panels.camera(props);
    return <div data-testid="camera-card" />;
  },
}));
vi.mock("@/components/chat/settings/AppearancePanel", () => ({
  default: () => <div data-testid="appearance-panel" />,
}));
vi.mock("@/components/chat/ThemePreviewSidebar", () => ({
  default: () => null,
}));

import RoomSettingsModal from "../RoomSettingsModal";

beforeAll(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });
});

describe("RoomSettingsModal", () => {
  it("renders the Studio panels in the settings workbench", async () => {
    render(
      <RoomSettingsModal open onClose={() => {}} settingsUserId="room-1" />,
    );
    const dialog = screen.getByRole("dialog", { name: "Room settings" });
    const nav = within(dialog).getByRole("navigation", {
      name: "Room settings navigation",
    });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Voice", "Camera", "Appearance"]);
    expect(screen.getByTestId("voice-panel")).toBeVisible();
    expect(panels.voice).toHaveBeenLastCalledWith({
      settingsUserId: "room-1",
      includeCamera: false,
    });

    await userEvent.click(within(nav).getByRole("button", { name: "Camera" }));
    expect(screen.getByTestId("camera-card")).toBeVisible();
    expect(panels.camera).toHaveBeenLastCalledWith({
      settingsUserId: "room-1",
      autoPreview: true,
    });
  });

  it("opens on the requested page", () => {
    render(
      <RoomSettingsModal
        open
        onClose={() => {}}
        settingsUserId="room-1"
        initialTab="appearance"
      />,
    );
    expect(screen.getByTestId("appearance-panel")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "Appearance" }),
    ).toBeVisible();
  });

  it("closes from the header button", async () => {
    const onClose = vi.fn();
    render(<RoomSettingsModal open onClose={onClose} settingsUserId="r" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Close room settings" }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
