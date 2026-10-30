// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => new Promise(() => {})),
  apiPost: vi.fn(() => new Promise(() => {})),
  apiPut: vi.fn(() => new Promise(() => {})),
  apiPatch: vi.fn(() => new Promise(() => {})),
  apiDelete: vi.fn(() => new Promise(() => {})),
}));

import { executeBackHandlers, useBackButton } from "@/hooks/useBackButton";
import type * as React from "react";
import { useChatStore } from "@/stores/chat-store";
import { useMobileTabStore } from "@/stores/useMobileTabStore";
import { useSettingsDialogStore } from "@/stores/useSettingsDialogStore";
import { MobileNavigationSheet } from "../MobileNavigationSheet";

function renderSheet(overrides: { open?: boolean; onClose?: () => void } = {}) {
  const props = {
    open: overrides.open ?? true,
    onClose: overrides.onClose ?? vi.fn(),
    onSelectDm: vi.fn(),
    serverList: <p>Server list</p>,
    current: <p>Channel list</p>,
  };
  return { props, ...render(<MobileNavigationSheet {...props} />) };
}

function tab(name: RegExp) {
  return within(screen.getByRole("navigation", { name: "Primary" })).getByRole(
    "button",
    { name },
  );
}

describe("MobileNavigationSheet (phone home + tab bar)", () => {
  beforeEach(() => {
    useMobileTabStore.setState({ tab: "servers" });
    useSettingsDialogStore.setState({
      open: false,
      requested: false,
      location: {},
      requestId: 0,
    });
    useChatStore.setState({
      user: { id: "u-me", username: "jon", display_name: "Jon" },
      notifications: [],
      unreadNotificationCount: 3,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens on the Servers tab with the rail and the channel list", () => {
    renderSheet();

    expect(screen.getByRole("dialog", { name: "Servers" })).toBeInTheDocument();
    expect(screen.getByText("Server list")).toBeInTheDocument();
    expect(screen.getByText("Channel list")).toBeInTheDocument();
    expect(tab(/^Servers/)).toHaveAttribute("aria-current", "page");
    expect(tab(/^Notifications/)).toHaveAccessibleName(
      "Notifications, 3 unread",
    );
  });

  it("switches tabs and marks only the active tab current", () => {
    renderSheet();

    fireEvent.click(tab(/^Notifications/));
    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
    expect(screen.queryByText("Server list")).not.toBeInTheDocument();
    expect(tab(/^Notifications/)).toHaveAttribute("aria-current", "page");
    expect(tab(/^Servers/)).not.toHaveAttribute("aria-current");

    fireEvent.click(tab(/^You/));
    expect(screen.getByRole("heading", { name: "Jon" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Status" })).toBeVisible();

    fireEvent.click(tab(/^Messages/));
    expect(
      screen.getByText("Find or start a conversation"),
    ).toBeInTheDocument();
  });

  it("opens the shared settings dialog from the You tab", () => {
    renderSheet();
    fireEvent.click(tab(/^You/));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const state = useSettingsDialogStore.getState();
    expect(state.open).toBe(true);
    // No location: the narrow dialog opens on its push-navigation list.
    expect(state.location).toEqual({});
  });

  it("steps the tab bar aside while the on-screen keyboard is up", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("pointer: coarse"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    render(
      <MobileNavigationSheet
        open
        onClose={vi.fn()}
        onSelectDm={vi.fn()}
        serverList={<p>Server list</p>}
        current={<input aria-label="Filter channels" />}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeVisible();

    act(() => screen.getByLabelText("Filter channels").focus());
    expect(
      screen.queryByRole("navigation", { name: "Primary" }),
    ).not.toBeInTheDocument();

    act(() => screen.getByLabelText("Filter channels").blur());
    await waitFor(() =>
      expect(
        screen.getByRole("navigation", { name: "Primary" }),
      ).toBeInTheDocument(),
    );
    window.matchMedia = original;
  });

  it("goes back to Servers before closing on the back button", () => {
    const onClose = vi.fn();
    renderSheet({ onClose });
    fireEvent.click(tab(/^Messages/));

    act(() => {
      executeBackHandlers();
    });
    expect(useMobileTabStore.getState().tab).toBe("servers");
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      executeBackHandlers();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shares the app's history entry and doesn't pop it when closed by hand", () => {
    vi.useFakeTimers();
    const historyGo = vi
      .spyOn(window.history, "go")
      .mockImplementation(() => undefined);
    function App(props: React.ComponentProps<typeof MobileNavigationSheet>) {
      // The chat layout always keeps a base back handler registered.
      useBackButton(() => false, true);
      return <MobileNavigationSheet {...props} />;
    }
    const props = {
      open: true,
      onClose: vi.fn(),
      onSelectDm: vi.fn(),
      serverList: <p>Server list</p>,
      current: <p>Channel list</p>,
    };
    const { rerender } = render(<App {...props} />);

    rerender(<App {...props} open={false} />);
    vi.advanceTimersByTime(20);

    expect(historyGo).not.toHaveBeenCalled();
    historyGo.mockRestore();
    vi.useRealTimers();
  });
});
