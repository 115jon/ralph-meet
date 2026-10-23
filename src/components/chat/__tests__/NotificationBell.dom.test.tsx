// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";
import { useChatStore } from "@/stores/chat-store";

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => new Promise(() => {})),
  apiPost: vi.fn(() => Promise.resolve({})),
  apiPatch: vi.fn(() => Promise.resolve({})),
  apiDelete: vi.fn(() => Promise.resolve({})),
}));

import { NotificationBell } from "../NotificationBell";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

function bell() {
  return screen.getByRole("button", { name: "Notifications" });
}

function panel() {
  return screen.queryByRole("dialog", { name: "Notifications" });
}

describe("NotificationBell", () => {
  beforeEach(() => {
    setViewport(1280);
    useChatStore.setState({
      notifications: [],
      unreadNotificationCount: 0,
    } as never);
  });

  it("opens an anchored panel; Escape closes it and focus returns to the bell", async () => {
    render(<NotificationBell />);
    bell().focus();
    fireEvent.click(bell());

    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    expect(bell()).toHaveAttribute("aria-expanded", "true");
    expect(dialog.className).toContain("fixed");
    expect(dialog.style.top).not.toBe("");
    expect(dialog.style.right).not.toBe("");
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
    expect(bell()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(bell()).toHaveFocus());
  });

  it("a press on the bell while open closes it without reopening", async () => {
    render(<NotificationBell />);
    fireEvent.click(bell());
    await screen.findByRole("dialog", { name: "Notifications" });

    // The full pointer sequence: pointerdown (outside the panel), focus, click.
    fireEvent.pointerDown(bell());
    fireEvent.mouseDown(bell());
    bell().focus();
    fireEvent.pointerUp(bell());
    fireEvent.mouseUp(bell());
    fireEvent.click(bell());

    await waitFor(() => expect(panel()).not.toBeInTheDocument());
    expect(bell()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on an outside press and on the back button", async () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <NotificationBell />
      </>,
    );
    fireEvent.click(bell());
    await screen.findByRole("dialog", { name: "Notifications" });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    await waitFor(() => expect(panel()).not.toBeInTheDocument());

    fireEvent.click(bell());
    await screen.findByRole("dialog", { name: "Notifications" });
    act(() => {
      executeBackHandlers();
    });
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });

  it("the close button closes the panel", async () => {
    render(<NotificationBell />);
    fireEvent.click(bell());
    await screen.findByRole("dialog", { name: "Notifications" });
    fireEvent.click(
      screen.getByRole("button", { name: "Close notifications" }),
    );
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });
  it("is a bottom drawer on phones", async () => {
    setViewport(500);
    render(<NotificationBell />);
    fireEvent.click(bell());
    const drawer = await screen.findByRole("dialog", { name: "Notifications" });
    expect(drawer).toHaveAttribute("data-rm-drawer");
    fireEvent.click(
      screen.getByRole("button", { name: "Close notifications" }),
    );
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });
});
