// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ code: "abc123" }),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));

vi.mock("@/components/chat/InlineEmojiText", () => ({
  default: ({ text }: { text: string }) => <>{text}</>,
}));

import InviteClient, { INVITE_REDIRECT_MS } from "../InviteClient";

const INVITE = {
  code: "abc123",
  server: { id: "srv-1", name: "Design Club", icon_url: null, member_count: 1 },
  inviter: { username: "grace", display_name: "Grace", avatar_url: null },
};

function httpError(status: number, message = "Server said something raw") {
  return Object.assign(new Error(message), { status });
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InviteClient", () => {
  it("shows the server and a sign-in link back to the invite on 401", async () => {
    mocks.apiGet.mockImplementation(async (_url: string, opts?: unknown) => {
      if (!opts) throw httpError(401, "Authentication required");
      return INVITE;
    });
    render(<InviteClient />);
    const link = await screen.findByRole("link", { name: "Sign in to join" });
    expect(link).toHaveAttribute(
      "href",
      "/sign-in?redirect_url=%2Finvite%2Fabc123",
    );
    expect(screen.getByText("Design Club")).toBeInTheDocument();
    expect(screen.getByText("1 member")).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenLastCalledWith("/api/invites/abc123", {
      skipAuth: true,
    });
    expect(screen.queryByText("Authentication required")).toBeNull();
  });

  it("turns a 401 on join into the sign-in state", async () => {
    mocks.apiGet.mockResolvedValue(INVITE);
    mocks.apiPost.mockRejectedValue(httpError(401));
    render(<InviteClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Accept invite" }),
    );
    expect(
      await screen.findByRole("link", { name: "Sign in to join" }),
    ).toBeInTheDocument();
  });

  it("shows written copy for a missing invite, never the server text", async () => {
    mocks.apiGet.mockRejectedValue(httpError(404, "Invite not found (raw)"));
    render(<InviteClient />);
    expect(
      await screen.findByRole("heading", { name: "This invite isn't valid" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/mistyped/)).toBeInTheDocument();
    expect(screen.queryByText(/raw/)).toBeNull();
  });

  it("explains an expired invite on 410", async () => {
    mocks.apiGet.mockRejectedValue(httpError(410, "Invite has expired"));
    render(<InviteClient />);
    expect(await screen.findByText(/Ask for a new invite/)).toBeInTheDocument();
    expect(screen.getByText(/expired or has been used/)).toBeInTheDocument();
  });

  it("gives already-members their own state with an Open action", async () => {
    mocks.apiGet.mockResolvedValue(INVITE);
    mocks.apiPost.mockResolvedValue({
      already_member: true,
      server: { id: "srv-1", name: "Design Club" },
    });
    render(<InviteClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Accept invite" }),
    );
    expect(
      await screen.findByRole("heading", { name: "You're already a member" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Design Club" }));
    expect(mocks.navigate).toHaveBeenCalledWith({ href: "/chat/srv-1" });
  });

  it("announces the join and clears the redirect timer on unmount", async () => {
    mocks.apiGet.mockResolvedValue(INVITE);
    mocks.apiPost.mockResolvedValue({
      joined: true,
      server: { id: "srv-1", name: "Design Club" },
    });
    const { unmount } = render(<InviteClient />);
    const accept = await screen.findByRole("button", { name: "Accept invite" });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(accept);
    });
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent(
      "Joined Design Club. Opening the server.",
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(INVITE_REDIRECT_MS + 100);
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("opens the joined server after the hold", async () => {
    mocks.apiGet.mockResolvedValue(INVITE);
    mocks.apiPost.mockResolvedValue({
      joined: true,
      server: { id: "srv-1", name: "Design Club" },
    });
    render(<InviteClient redirectMs={10} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Accept invite" }),
    );
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ href: "/chat/srv-1" }),
    );
  });
});
