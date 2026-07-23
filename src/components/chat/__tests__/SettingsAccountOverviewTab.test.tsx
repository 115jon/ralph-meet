// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  loadCurrentUser: vi.fn(),
}));

vi.mock("@kova/react", () => ({
  useUser: () => ({
    user: {
      username: "old_handle",
      fullName: "Auth User",
      primaryEmailAddress: { emailAddress: "user@example.com" },
    },
  }),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: mocks.apiGet,
  apiPatch: mocks.apiPatch,
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: {
        id: "user-1",
        username: "old_handle",
        display_name: "Old Name",
      },
      actions: { loadCurrentUser: mocks.loadCurrentUser },
    }),
}));

import SettingsAccountOverviewTab from "../SettingsAccountOverviewTab";

describe("SettingsAccountOverviewTab inline profile editing", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("uses field-specific edit buttons instead of opening the profile editor", () => {
    render(<SettingsAccountOverviewTab onOpenProfileEditor={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Edit display name" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit username" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Edit profile" }),
    ).toHaveLength(1);
  });

  it("saves a display name inline", async () => {
    mocks.apiPatch.mockResolvedValueOnce({});
    mocks.loadCurrentUser.mockResolvedValueOnce(undefined);
    render(<SettingsAccountOverviewTab onOpenProfileEditor={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit display name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "New Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save display name" }));

    await waitFor(() =>
      expect(mocks.apiPatch).toHaveBeenCalledWith("/api/update-profile", {
        displayName: "New Name",
      }),
    );
    expect(mocks.loadCurrentUser).toHaveBeenCalledOnce();
  });

  it("checks a changed username after a debounce and saves only when available", async () => {
    vi.useFakeTimers();
    mocks.apiGet.mockResolvedValue({ available: true });
    mocks.apiPatch.mockResolvedValueOnce({});
    mocks.loadCurrentUser.mockResolvedValueOnce(undefined);
    render(<SettingsAccountOverviewTab onOpenProfileEditor={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit username" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Username" }), {
      target: { value: "New_Handle" },
    });

    expect(mocks.apiGet).not.toHaveBeenCalled();
    vi.advanceTimersByTime(399);
    expect(mocks.apiGet).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/check-username?username=new_handle",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Username is available")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save username" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.apiPatch).toHaveBeenCalledWith("/api/update-profile", {
      username: "new_handle",
    });
  });
});
