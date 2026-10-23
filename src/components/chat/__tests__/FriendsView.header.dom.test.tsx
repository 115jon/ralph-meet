// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat-store";

const apiDelete = vi.fn((..._args: unknown[]) => Promise.resolve({}));
vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => new Promise(() => {})),
  apiPost: vi.fn(() => Promise.resolve({})),
  apiPut: vi.fn(() => Promise.resolve({})),
  apiPatch: vi.fn(() => Promise.resolve({})),
  apiDelete: (...args: unknown[]) => apiDelete(...args),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import FriendsView from "../FriendsView";

function renderView() {
  return render(
    <TooltipProvider>
      <FriendsView onMenuClick={() => {}} onSelectDm={() => {}} />
    </TooltipProvider>,
  );
}

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

const ada = {
  id: "u-ada",
  username: "ada",
  display_name: "Ada Lovelace",
  status: "online" as const,
};

describe("FriendsView header", () => {
  beforeEach(() => {
    apiDelete.mockClear();
    window.confirm = vi.fn(() => true);
    useChatStore.setState({
      relationships: [{ user: ada, type: 0, created_at: "" }],
    } as never);
  });

  it("at 390, moves the tabs to their own strip and keeps Add Friend in the header", () => {
    setViewport(390);
    renderView();

    const header = screen.getByTestId("friends-header");
    // Add Friend is a 40px icon button in the header, not a labelled button
    // pushed past the right edge by the tabs.
    const add = within(header).getByRole("button", { name: "Add Friend" });
    expect(add.className).toContain("size-10");
    expect(within(header).queryByRole("tablist")).toBeNull();

    const strip = screen.getByTestId("friends-tab-strip");
    const tablist = within(strip).getByRole("tablist", { name: "Friends" });
    expect(tablist).toHaveAttribute("data-scrollable", "true");
    expect(tablist.className).toContain("overflow-x-auto");
    expect(within(tablist).getAllByRole("tab")).toHaveLength(4);
  });

  it("at 1280, keeps the tabs inline and labels Add Friend", () => {
    setViewport(1280);
    renderView();

    const header = screen.getByTestId("friends-header");
    expect(within(header).getByRole("tablist")).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: /Add Friend/ }),
    ).toHaveTextContent("Add Friend");
    expect(screen.queryByTestId("friends-tab-strip")).toBeNull();
  });

  it("confirms Remove Friend in a dialog instead of window.confirm", async () => {
    setViewport(1280);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Remove Friend" }));
    expect(window.confirm).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Ada Lovelace will be removed/),
    ).toBeTruthy();
    expect(apiDelete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith("/api/friends", {
        target_user_id: "u-ada",
      }),
    );
  });

  it("shows add-friend errors in danger ink and marks the field invalid", async () => {
    setViewport(1280);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /Add Friend/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send Request" }));

    const field = screen.getByLabelText("Add Friend");
    await vi.waitFor(() =>
      expect(field).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.getByRole("status").className).toContain(
      "text-rm-danger-ink",
    );
  });
});
