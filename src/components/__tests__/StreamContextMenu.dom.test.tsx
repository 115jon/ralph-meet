// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isMobileMock = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMediaQuery")>()),
  useIsMobile: () => isMobileMock.value,
}));

vi.mock("@kova/react", () => ({
  useUser: () => ({ user: { id: "viewer" } }),
}));

import { executeBackHandlers } from "@/hooks/useBackButton";
import { useChatStore } from "@/stores/chat-store";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { StreamContextMenu } from "../StreamContextMenu";

describe("StreamContextMenu", () => {
  beforeEach(() => {
    isMobileMock.value = false;
    useChatStore.setState({ members: [], channels: [] });
    useVoiceSettingsStore.setState({
      currentUser: "viewer",
      userSettings: {},
      _cache: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a portalled Base UI menu at the pointer on desktop", async () => {
    render(
      <div data-testid="host">
        <StreamContextMenu userId="target" x={40} y={60} onClose={() => {}} />
      </div>,
    );
    const menu = await screen.findByRole("menu", { name: "User actions" });
    expect(menu).toHaveAttribute("data-slot", "dropdown-menu-content");
    expect(menu).toHaveAttribute("data-stream-preview-interactive", "true");
    expect(screen.getByTestId("host")).not.toContainElement(menu);
    expect(menu.className).toContain("w-52");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape and on the back button", async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <StreamContextMenu userId="target" x={40} y={60} onClose={onClose} />,
    );
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const onBackClose = vi.fn();
    render(
      <StreamContextMenu userId="target" x={40} y={60} onClose={onBackClose} />,
    );
    await screen.findByRole("menu");
    act(() => {
      executeBackHandlers();
    });
    expect(onBackClose).toHaveBeenCalled();
  });

  it("keeps clicks inside the menu from reaching the opener", async () => {
    const hostClick = vi.fn();
    render(
      <div onClick={hostClick}>
        <StreamContextMenu userId="target" x={40} y={60} onClose={() => {}} />
      </div>,
    );
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Mute" }),
    );
    expect(hostClick).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        useVoiceSettingsStore.getState().getSettings("viewer").peerSettings
          .target?.muted,
      ).toBe(true),
    );
  });

  it("opens submenus with ArrowRight and closes them with ArrowLeft", async () => {
    const onClose = vi.fn();
    render(
      <StreamContextMenu
        userId="target"
        x={40}
        y={60}
        isStreaming
        watchedStreams={{ target: true }}
        onClose={onClose}
      />,
    );
    const parent = await screen.findByRole("menuitem", {
      name: "More Options",
    });
    act(() => parent.focus());
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    const profile = await screen.findByRole("menuitem", { name: "Profile" });
    await waitFor(() => expect(profile).toHaveFocus());

    fireEvent.keyDown(profile, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "Profile" }),
      ).not.toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(parent).toHaveFocus();
  });

  it("renders an action sheet with inline sliders and submenus on phones", async () => {
    isMobileMock.value = true;
    const onOpenMessageUser = vi.fn();
    const onClose = vi.fn();
    render(
      <StreamContextMenu
        userId="target"
        x={40}
        y={60}
        onClose={onClose}
        onOpenMessageUser={onOpenMessageUser}
      />,
    );

    const sheet = await screen.findByRole("dialog", { name: "User actions" });
    expect(sheet.closest('[data-slot="action-sheet"]') ?? sheet).toBeTruthy();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Sliders open inline in their row.
    const volumeRow = screen.getByRole("button", { name: /User Volume/ });
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    fireEvent.click(volumeRow);
    const slider = screen.getByRole("slider", { name: "User Volume" });
    fireEvent.change(slider, { target: { value: "150" } });
    await waitFor(() =>
      expect(
        useVoiceSettingsStore.getState().getSettings("viewer").peerSettings
          .target?.volume,
      ).toBe(150),
    );

    fireEvent.click(screen.getByRole("button", { name: "Message" }));
    expect(onOpenMessageUser).toHaveBeenCalledWith("target");
    expect(onClose).toHaveBeenCalled();
  });
});
