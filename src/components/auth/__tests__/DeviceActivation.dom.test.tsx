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
  signOut: vi.fn(async () => undefined),
  getDeviceRequest: vi.fn(),
  approveDeviceRequest: vi.fn(),
  denyDeviceRequest: vi.fn(),
  markAuthLogoutIntent: vi.fn(),
  auth: { isLoaded: true, isSignedIn: true },
}));

vi.mock("@kova/react", () => ({
  useAuth: () => ({ ...mocks.auth, signOut: mocks.signOut }),
  useUser: () => ({
    user: { name: "Ada Lovelace", email: "ada@example.com", image: null },
    isLoaded: true,
  }),
  useDeviceApproval: () => ({
    isReady: true,
    getDeviceRequest: mocks.getDeviceRequest,
    approveDeviceRequest: mocks.approveDeviceRequest,
    denyDeviceRequest: mocks.denyDeviceRequest,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/lib/desktop-auth", () => ({
  markAuthLogoutIntent: mocks.markAuthLogoutIntent,
}));

vi.mock("@/lib/kova-auth-config", () => ({
  getKovaAuthUrl: () => "https://auth.test",
}));

vi.mock("@/components/ThemeAwareSplashLogo", () => ({
  ThemeAwareSplashLogo: () => <span data-testid="logo" />,
}));

import { DeviceActivation, outcomeForError } from "../DeviceActivation";

const REQUEST = {
  userCode: "ABCD-EFGH",
  status: "pending" as const,
  device: {
    label: "Ralph Meet Desktop",
    platform: "win32",
    hostname: "ada-laptop",
  },
  requester: { city: "Nashville", country: "US", ip: "203.0.113.7" },
  expiresAt: null,
};

beforeEach(() => {
  mocks.auth.isLoaded = true;
  mocks.auth.isSignedIn = true;
  mocks.getDeviceRequest.mockReset();
  mocks.approveDeviceRequest.mockReset();
  mocks.denyDeviceRequest.mockReset();
  mocks.navigate.mockReset();
  mocks.signOut.mockClear();
  mocks.markAuthLogoutIntent.mockClear();
});

afterEach(() => vi.clearAllMocks());

describe("DeviceActivation", () => {
  it("sends signed-out visitors to sign-in with a path-only return", () => {
    mocks.auth.isSignedIn = false;
    const { container } = render(<DeviceActivation initialCode="abcd-efgh" />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { redirect_url: "/activate?code=ABCD-EFGH" },
      replace: true,
    });
  });

  it("shows the entry form without a code and formats as you type", () => {
    render(<DeviceActivation />);
    expect(
      screen.getByRole("heading", { name: "Connect a device" }),
    ).toBeInTheDocument();
    const input = screen.getByLabelText("Device code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abcdefgh" } });
    expect(input.value).toBe("ABCD-EFGH");
    expect(mocks.getDeviceRequest).not.toHaveBeenCalled();
  });

  it("rejects a short code without leaving the page", () => {
    render(<DeviceActivation />);
    const input = screen.getByLabelText("Device code");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That code is too short",
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("looks the code up, reviews it, and approves", async () => {
    mocks.getDeviceRequest.mockResolvedValue({ ok: true, request: REQUEST });
    mocks.approveDeviceRequest.mockResolvedValue({
      ok: true,
      status: "approved",
    });
    render(<DeviceActivation initialCode="abcd-efgh" />);
    await screen.findByRole("heading", { name: "Sign in to Ralph Meet?" });
    expect(mocks.getDeviceRequest).toHaveBeenCalledWith("ABCD-EFGH");
    expect(screen.getByText("Code: A B C D, E F G H")).toBeInTheDocument();
    expect(
      screen.getByText("Ralph Meet Desktop · Windows"),
    ).toBeInTheDocument();
    expect(screen.getByText("ada-laptop")).toBeInTheDocument();
    expect(screen.getByText("Reported by the device")).toBeInTheDocument();
    expect(screen.getByText("Nashville, US")).toBeInTheDocument();
    expect(screen.getByTitle("203.0.113.7")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("Only approve if you started this sign-in yourself."),
    ).toBeInTheDocument();
    // Deny sits left of Approve.
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Deny")).toBeLessThan(buttons.indexOf("Approve"));

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const heading = await screen.findByRole("heading", {
      name: "You're signed in on Ralph Meet Desktop",
    });
    expect(mocks.approveDeviceRequest).toHaveBeenCalledWith("ABCD-EFGH");
    expect(
      screen.getByText("You can close this tab and go back to the app."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're signed in on Ralph Meet Desktop",
    );
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("denies", async () => {
    mocks.getDeviceRequest.mockResolvedValue({ ok: true, request: REQUEST });
    mocks.denyDeviceRequest.mockResolvedValue({ ok: true, status: "denied" });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    await screen.findByRole("button", { name: "Deny" });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await screen.findByRole("heading", { name: "Sign-in denied" });
    expect(
      screen.getByText("Nothing was signed in. You can close this tab."),
    ).toBeInTheDocument();
  });

  it.each([
    ["expired_token", "Code expired", "Enter a different code"],
    ["invalid_code", "Code not recognized", "Enter a different code"],
    ["already_processed", "Code already used", "Enter a different code"],
    ["access_denied", "Code in use", "Enter a different code"],
    ["network_error", "Couldn't reach the server", "Try again"],
    ["server_error", "Something went wrong", "Try again"],
    ["mfa_required", "Two-factor sign-in needed", "Sign in again"],
  ])("maps %s to its outcome", async (error, title, action) => {
    mocks.getDeviceRequest.mockResolvedValue({
      ok: false,
      error,
      status: 400,
      message: "x",
    });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    await screen.findByRole("heading", { name: title });
    expect(screen.getByText(action)).toBeInTheDocument();
  });

  it("shows the Retry-After wait when rate limited", async () => {
    mocks.getDeviceRequest.mockResolvedValue({
      ok: false,
      error: "rate_limited",
      status: 429,
      message: "x",
      retryAfterSeconds: 125,
    });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    await screen.findByRole("heading", { name: "Too many attempts" });
    expect(
      screen.getByText("Wait 3 minutes before trying this code again."),
    ).toBeInTheDocument();
  });

  it("links two-factor help to account security settings", async () => {
    mocks.getDeviceRequest.mockResolvedValue({
      ok: false,
      error: "mfa_required",
      status: 403,
      message: "x",
    });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    await screen.findByRole("heading", { name: "Two-factor sign-in needed" });
    expect(
      screen.getByRole("link", { name: "account security settings" }),
    ).toHaveAttribute("href", "https://auth.test/settings");
  });

  it("retries a network error in place", async () => {
    mocks.getDeviceRequest
      .mockResolvedValueOnce({
        ok: false,
        error: "network_error",
        status: 0,
        message: "x",
      })
      .mockResolvedValueOnce({ ok: true, request: REQUEST });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    await screen.findByRole("heading", { name: "Couldn't reach the server" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Sign in to Ralph Meet?" });
    expect(mocks.getDeviceRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps the review on a failed decision and reports it inline", async () => {
    mocks.getDeviceRequest.mockResolvedValue({ ok: true, request: REQUEST });
    mocks.approveDeviceRequest.mockResolvedValue({
      ok: false,
      error: "network_error",
      status: 0,
      message: "x",
    });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Couldn't reach the server. Check your connection and try again.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "Sign in to Ralph Meet?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("'Not you?' signs out and returns here through sign-in", async () => {
    mocks.getDeviceRequest.mockResolvedValue({ ok: true, request: REQUEST });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    const other = await screen.findByRole("button", { name: /Not you?/ });
    await act(async () => {
      fireEvent.click(other);
    });
    expect(mocks.markAuthLogoutIntent).toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/sign-in",
        search: { redirect_url: "/activate?code=ABCD-EFGH" },
        replace: true,
      }),
    );
  });

  it("treats a lost session as a sign-in, never as an error page", () => {
    expect(
      outcomeForError({
        ok: false,
        error: "invalid_session",
        status: 401,
        message: "",
      }),
    ).toBeNull();
    expect(
      outcomeForError({
        ok: false,
        error: "not_claimed",
        status: 409,
        message: "",
      }),
    ).toBe("claimed");
    expect(
      outcomeForError({
        ok: false,
        error: "unexpected_response",
        status: 500,
        message: "",
      }),
    ).toBe("unavailable");
  });
});
