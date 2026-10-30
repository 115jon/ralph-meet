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
import type { MessageSearchResponse } from "@/lib/message-search";
import { useChatStore } from "@/stores/chat-store";

const apiGet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({ apiGet }));

import SearchPanel from "../SearchPanel";

const NOW = "2026-01-01T00:00:00.000Z";

const ada = {
  id: "u-ada",
  username: "ada",
  display_name: "Ada Lovelace",
  avatar_url: "https://cdn.example/ada.png",
};
const grace = { id: "u-grace", username: "grace", display_name: "Grace" };

function hit(
  id: string,
  overrides: Partial<MessageSearchResponse["messages"][number]> = {},
): MessageSearchResponse["messages"][number] {
  return {
    id,
    channel_id: "ch-general",
    channel_name: "general",
    author_id: ada.id,
    author: {
      id: ada.id,
      username: ada.username,
      display_name: ada.display_name,
      avatar_url: ada.avatar_url,
      avatar_display: null,
      display_name_style: null,
    },
    content: "hello world",
    is_pinned: false,
    created_at: NOW,
    updated_at: null,
    attachments: [],
    embed_count: 0,
    ...overrides,
  };
}

function page(
  messages: MessageSearchResponse["messages"],
  total = messages.length,
  offset = 0,
): MessageSearchResponse {
  return {
    messages,
    total,
    limit: 25,
    offset,
    has_more: offset + messages.length < total,
  };
}

const serverScope = { kind: "server" as const, serverId: "s-1" };

function renderPanel(
  props: Partial<React.ComponentProps<typeof SearchPanel>> = {},
) {
  const onJump = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <SearchPanel
      scope={serverScope}
      scopeLabel="Ralph HQ"
      onClose={onClose}
      onJump={onJump}
      {...props}
    />,
  );
  const input = screen.getByRole("combobox", {
    name: "Search messages in Ralph HQ",
  });
  return { ...utils, input, onJump, onClose };
}

const expectStatus = (text: string) =>
  waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(text));

const lastUrl = () =>
  new URL(String(apiGet.mock.calls.at(-1)?.[0]), "http://x");

beforeEach(() => {
  apiGet.mockReset();
  window.localStorage.clear();
  useChatStore.setState({
    user: { id: "u-me", username: "me" },
    members: [],
    membersByServerId: {
      "s-1": [
        {
          user: ada,
          roles: [
            {
              id: "r-admin",
              server_id: "s-1",
              name: "Admin",
              color: "#f0b232",
              permissions: 0,
              position: 10,
              is_default: false,
              created_at: NOW,
            },
          ],
        },
        { user: grace, roles: [] },
      ],
    },
    channelsByServerId: {
      "s-1": [
        {
          id: "ch-general",
          server_id: "s-1",
          name: "general",
          channel_type: "text",
          position: 0,
          created_at: NOW,
        },
        {
          id: "ch-design",
          server_id: "s-1",
          name: "design",
          channel_type: "text",
          position: 1,
          created_at: NOW,
        },
      ],
    },
    relationships: [],
    dmChannels: [],
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchPanel request lifecycle", () => {
  it("ignores a stale response and resets when the text gets too short", async () => {
    let resolveFirst: ((value: MessageSearchResponse) => void) | undefined;
    apiGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    apiGet.mockResolvedValueOnce(page([]));

    const { input } = renderPanel();
    fireEvent.change(input, { target: { value: "old" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    fireEvent.change(input, { target: { value: "new" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      resolveFirst?.(page([hit("m-1")]));
    });

    await waitFor(() =>
      expect(screen.getByText("No messages found")).toBeInTheDocument(),
    );
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "n" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(screen.getByText("Search options")).toBeInTheDocument();
  });

  it("clears the debounce timer on unmount", () => {
    vi.useFakeTimers();
    const { input, unmount } = renderPanel();
    fireEvent.change(input, { target: { value: "query" } });
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("starts over when the scope changes", async () => {
    let resolveSearch: ((value: MessageSearchResponse) => void) | undefined;
    apiGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const { input, rerender } = renderPanel();
    fireEvent.change(input, { target: { value: "old" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    rerender(
      <SearchPanel
        scope={{ kind: "server", serverId: "s-2" }}
        scopeLabel="Ralph HQ"
        onClose={() => {}}
        onJump={() => {}}
      />,
    );
    expect(screen.getByText("Search options")).toBeInTheDocument();
    await act(async () => {
      resolveSearch?.(page([hit("m-1")]));
    });
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
  });

  it("runs the initial text on open and searches DMs through the channel endpoint", async () => {
    apiGet.mockResolvedValue(page([]));
    render(
      <SearchPanel
        scope={{ kind: "channel", channelId: "dm-1" }}
        scopeLabel="Ada"
        initialText="lunch"
        onClose={() => {}}
        onJump={() => {}}
      />,
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(lastUrl().pathname).toBe("/api/channels/dm-1/search");
    expect(lastUrl().searchParams.get("q")).toBe("lunch");
    // DMs have one channel: no in: option.
    expect(screen.queryByText("in:")).not.toBeInTheDocument();
  });
});

describe("SearchPanel filters and autocomplete", () => {
  it("suggests members with avatars and turns a pick into a chip", async () => {
    apiGet.mockResolvedValue(page([]));
    const { input } = renderPanel();

    fireEvent.change(input, { target: { value: "from:ad" } });
    const listbox = screen.getByRole("listbox", { name: "Search suggestions" });
    const option = within(listbox).getByRole("option", {
      name: /Ada Lovelace/,
    });
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
    expect(option.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example/ada.png",
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      screen.getByRole("button", { name: "Remove filter from: Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(input).toHaveValue("");
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(lastUrl().searchParams.get("from")).toBe("u-ada");
  });

  it("moves through options with the arrow keys and closes them with Escape", () => {
    const { input, onClose } = renderPanel();
    fireEvent.change(input, { target: { value: "has:" } });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("commits a typed token on space and removes the last chip with Backspace", async () => {
    apiGet.mockResolvedValue(page([]));
    const { input } = renderPanel();
    fireEvent.change(input, { target: { value: "has:image " } });
    expect(
      screen.getByRole("button", { name: "Remove filter has: image" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(lastUrl().searchParams.get("has")).toBe("image"),
    );

    (input as HTMLInputElement).setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(
      screen.queryByRole("button", { name: "Remove filter has: image" }),
    ).not.toBeInTheDocument();
  });

  it("offers filter options from the idle state", () => {
    const { input } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /^in:/ }));
    expect(input).toHaveValue("in:");
    expect(screen.getByRole("option", { name: /design/ })).toBeInTheDocument();
  });
});

describe("SearchPanel results", () => {
  it("renders results like messages, grouped by channel, and jumps", async () => {
    apiGet.mockResolvedValue(
      page(
        [
          hit("m-1", {
            content: "The token scale ships @grace",
            is_pinned: true,
            attachments: [
              {
                id: "a-1",
                filename: "scale.png",
                content_type: "image/png",
                size_bytes: 10,
              },
            ],
            embed_count: 1,
          }),
          hit("m-2", { content: "token check" }),
          hit("m-3", {
            channel_id: "ch-design",
            channel_name: "design",
            author_id: grace.id,
            author: {
              id: grace.id,
              username: "grace",
              display_name: "Grace",
              avatar_url: null,
              avatar_display: null,
              display_name_style: null,
            },
            content: "token review",
          }),
        ],
        3,
      ),
    );
    const { input, onJump } = renderPanel();
    fireEvent.change(input, { target: { value: "token" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await expectStatus("3 results");
    expect(screen.getByRole("status")).toHaveTextContent("3 results");
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["general", "design"]);

    const [first] = screen.getAllByRole("button", {
      name: /Jump to message from Ada Lovelace/,
    });
    if (!first) throw new Error("missing result");
    expect(first.querySelector("mark")).toHaveTextContent("token");
    expect(first.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example/ada.png",
    );
    expect(within(first).getByText("Ada Lovelace")).toHaveStyle({
      color: "#f0b232",
    });
    expect(within(first).getByText("@grace")).toBeInTheDocument();
    expect(within(first).getByText("scale.png")).toBeInTheDocument();
    expect(within(first).getByText("Link preview")).toBeInTheDocument();
    expect(within(first).getByRole("img", { name: "Pinned" })).toBeTruthy();

    fireEvent.click(first);
    expect(onJump).toHaveBeenCalledWith("ch-general", "m-1");
    expect(first).toHaveAttribute("aria-current", "true");
  });

  it("re-runs with the chosen sort and pages with offset", async () => {
    apiGet.mockResolvedValueOnce(page([hit("m-1"), hit("m-2")], 4));
    const { input } = renderPanel();
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await expectStatus("4 results");

    apiGet.mockResolvedValueOnce(page([hit("m-3"), hit("m-4")], 4, 2));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("End of results");
    expect(lastUrl().searchParams.get("offset")).toBe("2");
    expect(
      screen.getAllByRole("button", { name: /Jump to message/ }),
    ).toHaveLength(4);

    apiGet.mockResolvedValueOnce(page([hit("m-1")], 1));
    fireEvent.click(screen.getByRole("button", { name: "Oldest" }));
    await expectStatus("1 result");
    expect(lastUrl().searchParams.get("sort")).toBe("oldest");
    expect(screen.getByRole("button", { name: "Oldest" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows an error with a working retry", async () => {
    apiGet.mockRejectedValueOnce(new Error("offline"));
    const { input } = renderPanel();
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Search didn't load");

    apiGet.mockResolvedValueOnce(page([hit("m-1")]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await expectStatus("1 result");
  });
});
