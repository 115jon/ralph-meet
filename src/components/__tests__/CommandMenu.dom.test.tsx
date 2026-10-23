// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/stores/chat-store";
import {
  commandFilter,
  commandValue,
  parseCommandSearch,
} from "../command-menu-filter";

vi.mock("../chat/useAppearanceTheme", () => ({
  useAppearanceTheme: () => ({ theme: "dark", setAppearanceTheme: vi.fn() }),
}));

import CommandMenu from "../CommandMenu";

// cmdk measures its list and scrolls the active item into view.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const NOW = "2026-10-22T00:00:00.000Z";

describe("command menu filter", () => {
  it("parses kind prefixes", () => {
    expect(parseCommandSearch("@ada")).toEqual({ kind: "dm", query: "ada" });
    expect(parseCommandSearch("# gen")).toEqual({
      kind: "channel",
      query: "gen",
    });
    expect(parseCommandSearch("plain")).toEqual({ kind: null, query: "plain" });
  });

  it("limits a prefixed search to one kind", () => {
    const dm = commandValue("dm", "Ada Lovelace", "ada");
    const channel = commandValue("channel", "general", "Ralph HQ");
    expect(commandFilter(dm, "@ad")).toBeGreaterThan(0);
    expect(commandFilter(channel, "@ad")).toBe(0);
    expect(commandFilter(channel, "#")).toBe(1);
    expect(commandFilter(channel, "gen")).toBeGreaterThan(0);
    // The kind tag itself never matches a plain query.
    expect(commandFilter(channel, "channel")).toBe(0);
  });
});

describe("CommandMenu", () => {
  beforeEach(() => {
    useChatStore.setState({
      servers: [
        {
          id: "s-1",
          name: "Ralph HQ",
          owner_id: "u-me",
          icon_url: "https://cdn.example/ralph.png",
          created_at: NOW,
        },
        { id: "s-2", name: "Design Club", owner_id: "u-me", created_at: NOW },
      ],
      channels: [
        {
          id: "ch-general",
          server_id: "s-1",
          name: "general",
          channel_type: "text",
          position: 0,
          created_at: NOW,
        },
        {
          id: "ch-lounge",
          server_id: "s-1",
          name: "Lounge",
          channel_type: "voice",
          position: 1,
          created_at: NOW,
        },
      ],
      dmChannels: [
        {
          id: "dm-ada",
          name: "Ada",
          recipient: {
            id: "u-ada",
            username: "ada",
            display_name: "Ada Lovelace",
            avatar_url: "https://cdn.example/ada.png",
            status: "online",
          },
        },
      ],
      activeServerId: "s-1",
      activeChannelId: "ch-general",
    } as never);
  });

  function open() {
    render(<CommandMenu />);
    act(() => {
      window.dispatchEvent(new CustomEvent("open-command-menu"));
    });
    return screen.getByRole("dialog", { name: "Quick switcher" });
  }

  it("shows avatars for DMs, server icons and initials, and channel rows", () => {
    const dialog = open();
    const dm = within(dialog).getByRole("option", { name: /Ada Lovelace/ });
    expect(dm.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example/ada.png",
    );
    const ralph = within(dialog).getByRole("option", { name: /^Ralph HQ/ });
    expect(ralph.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example/ralph.png",
    );
    expect(
      within(dialog).getByRole("option", { name: /Design Club/ }),
    ).toHaveTextContent("DC");
    expect(
      within(dialog).getByRole("option", { name: /general/ }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Lounge/ })).toBeTruthy();
  });

  it("narrows with a prefix and hands text to message search", () => {
    const dialog = open();
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "@ad" } });
    expect(
      within(dialog).queryByRole("option", { name: /general/ }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("option", { name: /Ada Lovelace/ }),
    ).toBeInTheDocument();

    const listener = vi.fn();
    window.addEventListener("open-message-search", listener);
    fireEvent.change(input, { target: { value: "token scale" } });
    fireEvent.click(
      within(dialog).getByRole("option", { name: /Search Ralph HQ for/ }),
    );
    expect(listener).toHaveBeenCalled();
    expect(
      (listener.mock.calls[0]![0] as CustomEvent<{ text: string }>).detail.text,
    ).toBe("token scale");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    window.removeEventListener("open-message-search", listener);
  });

  it("opens on Ctrl+K with the field focused; Escape closes and returns focus", async () => {
    render(
      <>
        <button type="button">Composer</button>
        <CommandMenu />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Composer" });
    opener.focus();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "Quick switcher" });
    await waitFor(() =>
      expect(within(dialog).getByRole("combobox")).toHaveFocus(),
    );
    // Keyboard-initiated: no open/close animation on the scrim (9.6).
    expect(
      document.querySelector('[data-slot="dialog-overlay"]')?.className,
    ).toContain("data-[state=open]:animate-none!");

    fireEvent.keyDown(within(dialog).getByRole("combobox"), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes on the back button and toggles closed on a second Ctrl+K", async () => {
    const { executeBackHandlers } = await import("@/hooks/useBackButton");
    open();
    act(() => {
      executeBackHandlers();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Quick switcher" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
