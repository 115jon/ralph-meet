// @vitest-environment jsdom

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: { user: null as Record<string, unknown> | null },
  apiPatch: vi.fn(),
  loadCurrentUser: vi.fn(() => Promise.resolve(true)),
  updateStatus: vi.fn(),
}));

vi.mock("@kova/react", () => ({
  useUser: () => ({ isLoaded: true, user: null }),
}));

vi.mock("@/lib/api-client", () => ({
  apiPatch: mocks.apiPatch,
  apiDelete: vi.fn(),
  apiUpload: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: mocks.state.user,
      members: [],
      activeServerId: "@me",
      actions: {
        loadCurrentUser: mocks.loadCurrentUser,
        updateStatus: mocks.updateStatus,
      },
    }),
}));

vi.mock("../AvatarPickerModal", () => ({ AvatarPickerModal: () => null }));
vi.mock("../AvatarFrameEditor", () => ({ AvatarFrameEditor: () => null }));
vi.mock("../collectibles/CollectiblePicker", () => ({
  CollectiblePicker: () => null,
}));

import SettingsAccountTab from "../SettingsAccountTab";

const render = (ui: ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const USER = {
  id: "user-1",
  username: "jon",
  display_name: "Jon",
  pronouns: "",
  bio: "",
  custom_status: null,
  status: "online",
  avatar_url: null,
  avatar_display: null,
  created_at: "2025-01-01T00:00:00Z",
};

describe("SettingsAccountTab (profile editor)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.state.user = null;
  });

  it("shows a signed-out state with a way out when there is no user", () => {
    const onClose = vi.fn();
    render(<SettingsAccountTab authUserLoaded onClose={onClose} />);

    expect(screen.getByText("You're signed out")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Close profile editor" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a spinner and keeps the close button while loading", () => {
    render(<SettingsAccountTab authUserLoaded={false} onClose={() => {}} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(
      screen.getByRole("button", { name: "Close profile editor" }),
    ).toBeInTheDocument();
  });

  it("renders the editor from the chat-store user without a Kova user", () => {
    mocks.state.user = USER;
    render(<SettingsAccountTab onClose={() => {}} />);

    expect(
      screen.getByRole("heading", { name: "Edit profile" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Profile preview" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    // The placeholder controls are gone (ST-02).
    for (const dead of [
      "Main Profile",
      "Board",
      "Activity",
      "Wishlist",
      "Add Widget",
    ]) {
      expect(screen.queryByText(dead)).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /rotating game slot/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the save bar for a draft and resets it", () => {
    mocks.state.user = USER;
    render(<SettingsAccountTab onClose={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Pronouns" }), {
      target: { value: "he/him" },
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Pronouns" })).toHaveValue("");
  });

  it("refuses a close while the draft is dirty and nudges the bar", () => {
    mocks.state.user = USER;
    const closeGuard = { current: null as (() => boolean) | null };
    render(<SettingsAccountTab onClose={() => {}} closeGuard={closeGuard} />);

    expect(closeGuard.current).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Pronouns" }), {
      target: { value: "he/him" },
    });
    expect(closeGuard.current?.()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(closeGuard.current).toBeNull();
  });

  it("saves the draft and sends the custom status", async () => {
    mocks.state.user = USER;
    mocks.apiPatch.mockResolvedValueOnce({ ok: true });
    render(<SettingsAccountTab onClose={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Pronouns" }), {
      target: { value: "he/him" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Custom status" }), {
      target: { value: "Shipping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(mocks.apiPatch).toHaveBeenCalledWith(
        "/api/update-profile",
        expect.objectContaining({ pronouns: "he/him", bio: null }),
      ),
    );
    expect(mocks.updateStatus).toHaveBeenCalledWith("online", "Shipping");
    // The refreshed store user is what clears the draft.
    await waitFor(() => expect(mocks.loadCurrentUser).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a friendly error when the save fails, never the server message", async () => {
    mocks.state.user = USER;
    mocks.apiPatch.mockRejectedValueOnce(
      Object.assign(new Error("D1_ERROR: constraint failed"), { status: 500 }),
    );
    render(<SettingsAccountTab onClose={() => {}} />);

    fireEvent.change(screen.getByRole("textbox", { name: "About me" }), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save your profile. Try again in a moment.",
    );
    expect(screen.queryByText(/D1_ERROR/)).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});
