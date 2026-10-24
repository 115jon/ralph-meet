// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";

const api = vi.hoisted(() => ({
  apiGet: vi.fn((): Promise<unknown> => new Promise(() => {})),
  apiPost: vi.fn(() =>
    Promise.resolve({ id: "dm-1", name: "", recipient: {} }),
  ),
  apiPut: vi.fn(() => Promise.resolve({})),
  apiDelete: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/api-client", () => api);

import { AvatarFrameEditor } from "../AvatarFrameEditor";
import { AvatarPickerModal } from "../AvatarPickerModal";
import UserProfileModal from "../UserProfileModal";
import UserProfilePopover from "../UserProfilePopover";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

const me = { id: "u-me", username: "me", display_name: "Me" } as User;
const grace = {
  id: "u-grace",
  username: "grace",
  display_name: "Grace Hopper",
  status: "idle",
} as User;

function httpError(status: number) {
  return Object.assign(new Error("D1_ERROR: no such table"), { status });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  useChatStore.setState({
    user: me,
    members: [],
    relationships: [],
    activeServerId: null,
  } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  api.apiGet.mockImplementation(() => new Promise(() => {}));
});

describe("UserProfileModal", () => {
  it("asks before blocking and names the person", async () => {
    render(<UserProfileModal open user={grace} onClose={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Block" }));
    expect(api.apiPut).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Block Grace Hopper\? They'll be removed/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Block Grace Hopper" }));
    await waitFor(() =>
      expect(api.apiPut).toHaveBeenCalledWith("/api/friends", {
        target_user_id: "u-grace",
        action: "block",
      }),
    );
  });

  it("cancel closes the confirm without blocking", async () => {
    render(
      <UserProfileModal
        open
        user={grace}
        onClose={() => {}}
        initialBlockConfirm
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Block" })).toBeInTheDocument();
    expect(api.apiPut).not.toHaveBeenCalled();
  });

  it("shows profile load errors as user copy, never the server message", async () => {
    api.apiGet.mockImplementation(((url: string) =>
      url.endsWith("/profile")
        ? Promise.reject(httpError(500))
        : new Promise(() => {})) as never);
    render(<UserProfileModal open user={grace} onClose={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Unable to load Grace Hopper's profile. Try again in a moment.",
    );
    expect(screen.queryByText(/D1_ERROR/)).toBeNull();
  });

  it("has no fake tabs and one solid button", async () => {
    render(<UserProfileModal open user={grace} onClose={() => {}} />);
    await screen.findByRole("button", { name: "Message" });
    expect(screen.queryByRole("tab")).toBeNull();
    expect(
      document.body.querySelectorAll('[data-variant="default"]'),
    ).toHaveLength(1);
  });
});

describe("UserProfilePopover", () => {
  it("opens the DM from the Message button and has no dead controls", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    render(
      <UserProfilePopover
        userId="u-grace"
        username="grace"
        seedUser={grace}
        anchorEl={anchor}
        onClose={onClose}
      />,
    );

    await screen.findByRole("dialog", { name: "User profile for grace" });
    for (const name of ["Mod View", "Friends", "More options"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Message" }));
    await waitFor(() =>
      expect(api.apiPost).toHaveBeenCalledWith("/api/dms", {
        target_user_id: "u-grace",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useChatStore.getState().activeChannelId).toBe("dm-1");
    anchor.remove();
  });
});

describe("AvatarPickerModal", () => {
  it("labels the delete button and reports history errors as copy", async () => {
    api.apiGet.mockImplementationOnce(() => Promise.reject(httpError(503)));
    render(
      <AvatarPickerModal
        open
        displayName="Ada"
        onClose={() => {}}
        onUpload={() => {}}
      />,
    );
    expect(
      await screen.findByText(
        "Unable to load your recent avatars. Try again in a moment.",
      ),
    ).toBeInTheDocument();
    const surface = document.body.querySelector('[data-slot="dialog-content"]');
    expect(surface?.className).toContain("md:max-w-md");
  });
});

describe("AvatarFrameEditor", () => {
  it("is a dialog that closes on Escape", () => {
    const onCancel = vi.fn();
    render(
      <AvatarFrameEditor
        image={{ src: "blob:test-avatar" }}
        displayName="Ada"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Frame your avatar" });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
