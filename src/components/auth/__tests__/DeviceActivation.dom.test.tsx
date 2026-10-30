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
  releaseDeviceRequest: vi.fn(),
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
    releaseDeviceRequest: mocks.releaseDeviceRequest,
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

import {
  DeviceActivation,
  OUTCOME_COPY,
  outcomeForError,
  timeLeftLabel,
} from "../DeviceActivation";

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
  mocks.releaseDeviceRequest.mockReset();
  mocks.releaseDeviceRequest.mockResolvedValue({
    ok: true,
    status: "released",
  });
  mocks.navigate.mockReset();
  mocks.signOut.mockClear();
  mocks.markAuthLogoutIntent.mockClear();
});

afterEach(() => vi.clearAllMocks());

describe("DeviceActivation", () => {
  it("sends signed-out visitors to sign-in with a path-only return", () => {
    mocks.auth.isSignedIn = false;
    render(<DeviceActivation initialCode="abcd-efgh" />);
    // The loading view holds the column while the redirect happens.
    expect(
      screen.getByRole("heading", { name: "Checking your code" }),
    ).toBeInTheDocument();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { redirect_url: "/activate?code=ABCD-EFGH" },
      replace: true,
    });
  });

  it("shows the loading view, not an empty column, while auth loads", () => {
    mocks.auth.isLoaded = false;
    const { container } = render(<DeviceActivation initialCode="abcd-efgh" />);
    expect(container).not.toBeEmptyDOMElement();
    expect(
      screen.getByRole("heading", { name: "Checking your code" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.getDeviceRequest).not.toHaveBeenCalled();
  });

  it("shows the loading view without a code while auth loads", () => {
    mocks.auth.isLoaded = false;
    render(<DeviceActivation />);
    expect(
      screen.getByRole("heading", { name: "Connect a device" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Device code")).not.toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "Is this you?" });
    expect(mocks.getDeviceRequest).toHaveBeenCalledWith("ABCD-EFGH");
    expect(screen.getByText("Code: A B C D, E F G H")).toBeInTheDocument();
    expect(
      screen.getByText("Ralph Meet Desktop · Windows"),
    ).toBeInTheDocument();
    expect(screen.getByText("ada-laptop")).toBeInTheDocument();
    expect(screen.getByText("Reported by the device")).toBeInTheDocument();
    expect(screen.getByText("Nashville, US")).toBeInTheDocument();
    expect(screen.getByTitle("203.0.113.7")).toBeInTheDocument();
    // The poster body names the app and the account; the account row repeats
    // the name beside its email and the "Not you?" switch.
    expect(
      screen.getByText(/Ralph Meet for Windows wants to sign in as/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(
      screen.getByText("Only approve if you started this sign-in yourself."),
    ).toBeInTheDocument();
    // The code is printed once, in Martian.
    expect(screen.getByTestId("device-user-code")).toHaveTextContent(
      "ABCD-EFGH",
    );
    // Deny sits left of Approve.
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Deny")).toBeLessThan(
      buttons.indexOf("Approve sign-in"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve sign-in" }));
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

  it("shows no expiry when the request carries none", async () => {
    mocks.getDeviceRequest.mockResolvedValue({ ok: true, request: REQUEST });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    await screen.findByRole("heading", { name: "Is this you?" });
    expect(screen.getByText("Desktop sign-in")).toBeInTheDocument();
    expect(screen.queryByText(/min left/)).not.toBeInTheDocument();
    // Only the Approve key's cap is dithered; there is no expiry bar.
    const bars = Array.from(
      document.querySelectorAll<HTMLElement>("[data-dither]"),
    ).filter((el) => el.style.width);
    expect(bars).toHaveLength(0);
  });

  it("prints the time left in the kicker and a still expiry bar", async () => {
    mocks.getDeviceRequest.mockResolvedValue({
      ok: true,
      request: {
        ...REQUEST,
        expiresAt: new Date(Date.now() + 4 * 60_000 + 12_000).toISOString(),
      },
    });
    render(<DeviceActivation initialCode="ABCD-EFGH" />);
    await screen.findByRole("heading", { name: "Is this you?" });
    expect(
      screen.getByText("Desktop sign-in · 4 min left"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Expires /)).toBeInTheDocument();
    // The one dither under the code: aria-hidden, width = the time left.
    const bars = Array.from(
      document.querySelectorAll<HTMLElement>("[data-dither]"),
    ).filter((el) => el.style.width);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(bars[0]!.style.width).toBe("42%");
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
    ["mfa_required", "Two-step verification needed", "Sign in again"],
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
    await screen.findByRole("heading", {
      name: "Two-step verification needed",
    });
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
    await screen.findByRole("heading", { name: "Is this you?" });
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
    await screen.findByRole("button", { name: "Approve sign-in" });
    fireEvent.click(screen.getByRole("button", { name: "Approve sign-in" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Couldn't reach the server. Check your connection and try again.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "Is this you?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve sign-in" }),
    ).toBeEnabled();
  });

  describe("'Not you?'", () => {
    const SIGN_IN_BACK_HERE =
      "/sign-in?redirect_url=%2Factivate%3Fcode%3DABCD-EFGH";

    async function clickNotYou(code = "abcd-efgh") {
      mocks.getDeviceRequest.mockResolvedValue({ ok: true, request: REQUEST });
      render(<DeviceActivation initialCode={code} />);
      const other = await screen.findByRole("button", { name: /Not you?/ });
      await act(async () => {
        fireEvent.click(other);
      });
    }

    it("releases the claim with the current session, then signs out", async () => {
      await clickNotYou();
      expect(mocks.releaseDeviceRequest).toHaveBeenCalledWith("ABCD-EFGH");
      expect(mocks.markAuthLogoutIntent).toHaveBeenCalled();
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
      const [release] = mocks.releaseDeviceRequest.mock.invocationCallOrder;
      const [signOut] = mocks.signOut.mock.invocationCallOrder;
      expect(release).toBeLessThan(signOut!);
    });

    it("signs out straight to sign-in with an encoded return to this code", async () => {
      await clickNotYou();
      expect(mocks.signOut).toHaveBeenCalledWith(SIGN_IN_BACK_HERE);
      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith({
          to: "/sign-in",
          search: { redirect_url: "/activate?code=ABCD-EFGH" },
          replace: true,
        }),
      );
    });

    it("lands on that URL even though the SDK hard-navigates after sign-out", async () => {
      // The SDK ends signOut with `location.href = callbackURL ??
      // afterSignOutUrl` ("/sign-in", no query) — the original bug.
      window.history.replaceState(null, "", "/activate?code=ABCD-EFGH");
      mocks.signOut.mockImplementationOnce(async (callbackURL?: string) => {
        window.history.replaceState(null, "", callbackURL ?? "/sign-in");
      });
      await clickNotYou();
      expect(window.location.pathname + window.location.search).toBe(
        SIGN_IN_BACK_HERE,
      );
      expect(
        new URLSearchParams(window.location.search).get("redirect_url"),
      ).toBe("/activate?code=ABCD-EFGH");
    });

    it("treats not_claimed as nothing to release", async () => {
      mocks.releaseDeviceRequest.mockResolvedValue({
        ok: false,
        error: "not_claimed",
        status: 409,
        message: "x",
      });
      await clickNotYou();
      expect(mocks.signOut).toHaveBeenCalledWith(SIGN_IN_BACK_HERE);
    });

    it.each([
      [
        "an error",
        () =>
          mocks.releaseDeviceRequest.mockResolvedValue({
            ok: false,
            error: "network_error",
            status: 0,
            message: "x",
          }),
      ],
      [
        "a throw",
        () => mocks.releaseDeviceRequest.mockRejectedValue(new Error("boom")),
      ],
    ])(
      "still signs out after %s, then shows Code in use with a restart hint",
      async (_label, arrange) => {
        arrange();
        mocks.signOut.mockImplementationOnce(async () => {
          mocks.auth.isSignedIn = false;
        });
        await clickNotYou();
        expect(mocks.signOut).toHaveBeenCalledWith(
          "/activate?code=ABCD-EFGH&release=failed",
        );
        const heading = await screen.findByRole("heading", {
          name: "Code in use",
        });
        expect(
          screen.getByText(OUTCOME_COPY.release_failed.body),
        ).toBeInTheDocument();
        expect(OUTCOME_COPY.release_failed.body).toMatch(
          /Start sign-in again on your device/,
        );
        expect(screen.getByRole("status")).toHaveTextContent("Code in use");
        await waitFor(() => expect(document.activeElement).toBe(heading));
        expect(mocks.navigate).toHaveBeenCalledWith({
          to: "/activate",
          search: { code: "ABCD-EFGH", release: "failed" },
          replace: true,
        });
        expect(mocks.navigate).not.toHaveBeenCalledWith(
          expect.objectContaining({ to: "/sign-in" }),
        );
      },
    );

    it("shows the failed-release page signed out instead of bouncing to sign-in", () => {
      mocks.auth.isSignedIn = false;
      render(<DeviceActivation initialCode="ABCD-EFGH" releaseFailed />);
      expect(
        screen.getByRole("heading", { name: "Code in use" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Enter a different code" }),
      ).toHaveAttribute("href", "/activate");
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.getDeviceRequest).not.toHaveBeenCalled();
    });

    it("doesn't release on 'Sign in again' (nothing was claimed)", async () => {
      mocks.getDeviceRequest.mockResolvedValue({
        ok: false,
        error: "mfa_required",
        status: 403,
        message: "x",
      });
      render(<DeviceActivation initialCode="ABCD-EFGH" />);
      const again = await screen.findByRole("button", {
        name: "Sign in again",
      });
      await act(async () => {
        fireEvent.click(again);
      });
      expect(mocks.releaseDeviceRequest).not.toHaveBeenCalled();
      expect(mocks.signOut).toHaveBeenCalledWith(SIGN_IN_BACK_HERE);
    });
  });

  it("words the time left", () => {
    expect(timeLeftLabel(4 * 60_000 + 12_000)).toBe("4 min left");
    expect(timeLeftLabel(59_000)).toBe("Under 1 min left");
    expect(timeLeftLabel(0)).toBe("Expired");
    expect(timeLeftLabel(-5)).toBe("Expired");
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
