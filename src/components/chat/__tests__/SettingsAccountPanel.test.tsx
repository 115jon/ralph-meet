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
  apiPost: vi.fn(),
  loadCurrentUser: vi.fn(),
}));

vi.mock("@kova/react", () => ({
  useAuth: () => ({ signOut: vi.fn(() => Promise.resolve()) }),
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
  apiPost: mocks.apiPost,
}));

const CLAIMS_URL = "/api/account-claims";
const claimCandidate = {
  id: "legacy-1",
  username: "legacy_jon",
  display_name: "Legacy Jon",
  avatar_url: null,
  match_method: "email",
};

/** Answers the claim check; everything else goes to `fallback`. */
function routeApiGet(
  claims: unknown = { claimed: true, candidates: [] },
  fallback: (url: string) => unknown = () => undefined,
) {
  mocks.apiGet.mockImplementation((url: string) =>
    url === CLAIMS_URL ? Promise.resolve(claims) : fallback(url),
  );
}

const usernameChecks = () =>
  mocks.apiGet.mock.calls.filter(([url]) => url !== CLAIMS_URL);

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

import AccountPanel from "../settings/AccountPanel";

describe("AccountPanel inline profile editing", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("uses field-specific edit buttons instead of opening the profile editor", () => {
    routeApiGet();
    render(<AccountPanel />);

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
    routeApiGet();
    mocks.apiPatch.mockResolvedValueOnce({});
    mocks.loadCurrentUser.mockResolvedValueOnce(undefined);
    render(<AccountPanel />);

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
    routeApiGet(undefined, () => Promise.resolve({ available: true }));
    mocks.apiPatch.mockResolvedValueOnce({});
    mocks.loadCurrentUser.mockResolvedValueOnce(undefined);
    render(<AccountPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Edit username" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Username" }), {
      target: { value: "New_Handle" },
    });

    expect(usernameChecks()).toHaveLength(0);
    vi.advanceTimersByTime(399);
    expect(usernameChecks()).toHaveLength(0);
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

  it("hides the claim card when there is nothing to claim", async () => {
    routeApiGet();
    render(<AccountPanel />);
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith(CLAIMS_URL));
    expect(
      screen.queryByRole("heading", { name: "Claim an existing account" }),
    ).not.toBeInTheDocument();
  });

  it("claims a legacy account only after confirming, and keeps the strip open on failure", async () => {
    routeApiGet({ claimed: false, candidates: [claimCandidate] });
    mocks.apiPost.mockRejectedValueOnce(
      Object.assign(new Error("D1_ERROR: boom"), { status: 500 }),
    );
    render(<AccountPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Claim @legacy_jon" }),
    );
    expect(mocks.apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Claim account" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith(CLAIMS_URL, {
        legacyUserId: "legacy-1",
      }),
    );
    expect(
      await screen.findByText(
        "Unable to claim that account. Try again in a moment.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/D1_ERROR/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Claim account" }),
    ).toBeInTheDocument();
  });
});
