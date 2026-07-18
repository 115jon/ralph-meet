// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({ apiGet }));
vi.mock("@/hooks/useUserResolution", () => ({
  useUserResolution: (_id: string, user: unknown) => ({
    displayName:
      user && typeof user === "object" && "username" in user
        ? String(user.username)
        : "User",
  }),
}));

import SearchPanel from "../SearchPanel";

const result = {
  id: "message-1",
  channel_id: "channel-1",
  channel_name: "general",
  author_id: "user-1",
  author: { id: "user-1", username: "Ada", avatar_url: null },
  content: "hello world",
  is_pinned: false,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("SearchPanel request lifecycle", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it("ignores a stale response and clears results when the query becomes short", async () => {
    let resolveFirst:
      | ((value: { messages: (typeof result)[]; total: number }) => void)
      | undefined;
    apiGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    apiGet.mockResolvedValueOnce({ messages: [], total: 0 });

    render(<SearchPanel serverId="server-1" onClose={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Search messages" });
    fireEvent.change(input, { target: { value: "old" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.change(input, { target: { value: "new" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      resolveFirst?.({ messages: [result], total: 1 });
    });

    await waitFor(() =>
      expect(screen.queryByText("hello world")).not.toBeInTheDocument(),
    );
    fireEvent.change(input, { target: { value: "n" } });
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
  });

  it("clears the debounce timer on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <SearchPanel serverId="server-1" onClose={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search messages" }), {
      target: { value: "query" },
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(apiGet).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("invalidates a pending request and clears results when the server changes", async () => {
    let resolveSearch:
      | ((value: { messages: (typeof result)[]; total: number }) => void)
      | undefined;
    apiGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );

    const { rerender } = render(
      <SearchPanel serverId="server-1" onClose={() => {}} />,
    );
    const input = screen.getByRole("textbox", { name: "Search messages" });
    fireEvent.change(input, { target: { value: "old" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    rerender(<SearchPanel serverId="server-2" onClose={() => {}} />);
    expect(screen.getByText("Search for messages")).toBeInTheDocument();

    await act(async () => {
      resolveSearch?.({ messages: [result], total: 1 });
    });
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
  });
});
