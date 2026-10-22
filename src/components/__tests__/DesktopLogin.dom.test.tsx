// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DeviceSignInController,
  DeviceSignInState,
  DeviceSignInOptions,
} from "@/lib/device-sign-in";

type FakeController = {
  controller: DeviceSignInController & { state: DeviceSignInState };
  options: DeviceSignInOptions;
  emit: (state: DeviceSignInState) => void;
};

const mocks = vi.hoisted(() => ({
  startDeviceSignIn: vi.fn(),
  navigate: vi.fn(),
  openUrl: vi.fn(async (_url: string) => undefined),
  waitForDesktopToken: vi.fn(
    async (_timeout?: number) => null as string | null,
  ),
  setDesktopAuthSession: vi.fn(),
  clearDesktopAuthSession: vi.fn(),
  fetch: vi.fn(),
  controllers: [] as FakeController[],
}));

vi.mock("@kova/react", () => ({
  startDeviceSignIn: mocks.startDeviceSignIn,
  useAuth: () => ({ isSignedIn: false }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Navigate: () => null,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

vi.mock("@/lib/desktop-auth", () => ({
  waitForDesktopToken: mocks.waitForDesktopToken,
  setDesktopAuthSession: mocks.setDesktopAuthSession,
  clearDesktopAuthSession: mocks.clearDesktopAuthSession,
}));

vi.mock("@/lib/platform", () => ({
  apiUrl: (path: string) => `https://api.test${path}`,
  isMobile: () => false,
  isWindows: () => true,
}));

vi.mock("@/lib/kova-auth-config", () => ({
  getKovaAuthUrl: () => "https://auth.test",
  KOVA_AUTH_PUBLISHABLE_KEY: "pk_test",
}));

vi.mock("@/components/SplashScreen", () => ({
  SplashScreen: () => <div data-testid="splash" />,
}));

vi.mock("@/components/ThemeAwareSplashLogo", () => ({
  ThemeAwareSplashLogo: () => <span data-testid="logo" />,
}));

import DesktopLogin, { SIGN_IN_SUCCESS_HOLD_MS } from "../DesktopLogin";

const PENDING: DeviceSignInState = {
  status: "pending",
  userCode: "ABCD-EFGH",
  verificationUri: "https://auth.test/device",
  verificationUriComplete: "https://auth.test/device?code=ABCD-EFGH",
  expiresAt: Date.now() + 10 * 60_000,
  interval: 5,
};

function createFakeController(options: DeviceSignInOptions): FakeController {
  let resolveDone!: (state: DeviceSignInState) => void;
  const done = new Promise<DeviceSignInState>((resolve) => {
    resolveDone = resolve;
  });
  const controller = {
    state: { status: "starting" } as DeviceSignInState,
    done,
    cancel: vi.fn(),
    nudge: vi.fn(),
  };
  return {
    controller,
    options,
    emit(state) {
      controller.state = state;
      act(() => {
        options.onChange?.(state);
      });
      if (state.status !== "starting" && state.status !== "pending") {
        resolveDone(state);
      }
    },
  };
}

function latestController(): FakeController {
  const ctl = mocks.controllers.at(-1);
  if (!ctl) throw new Error("device sign-in was not started");
  return ctl;
}

function jsonResponse(status: number) {
  return new Response(JSON.stringify({}), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function renderIdle() {
  render(<DesktopLogin />);
  return screen.findByRole("button", { name: "Sign in with browser" });
}

async function startAndReachPending() {
  const button = await renderIdle();
  fireEvent.click(button);
  latestController().emit(PENDING);
  await screen.findByRole("heading", { name: "Check your browser" });
}

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  mocks.controllers.length = 0;
  mocks.startDeviceSignIn.mockReset();
  mocks.startDeviceSignIn.mockImplementation((options: DeviceSignInOptions) => {
    const ctl = createFakeController(options);
    mocks.controllers.push(ctl);
    return ctl.controller;
  });
  mocks.navigate.mockReset();
  mocks.openUrl.mockClear();
  mocks.waitForDesktopToken.mockReset();
  mocks.waitForDesktopToken.mockResolvedValue(null);
  mocks.setDesktopAuthSession.mockReset();
  mocks.clearDesktopAuthSession.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  MotionGlobalConfig.skipAnimations = false;
});

describe("DesktopLogin device sign-in", () => {
  it("shows a single sign-in action when there is no stored session", async () => {
    const button = await renderIdle();
    expect(button).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(mocks.startDeviceSignIn).not.toHaveBeenCalled();
  });

  it("goes idle → pending, shows the code and opens the server URL", async () => {
    await startAndReachPending();

    expect(mocks.startDeviceSignIn).toHaveBeenCalledTimes(1);
    expect(latestController().options).toMatchObject({
      authUrl: "https://auth.test",
      publishableKey: "pk_test",
      device: { platform: "windows", label: "Ralph Meet Desktop" },
    });

    expect(screen.getByTestId("device-user-code")).toHaveTextContent("ABCD");
    expect(screen.getByTestId("device-user-code")).toHaveTextContent("EFGH");
    expect(
      screen.getAllByText(/A B C D, E F G H/).length,
    ).toBeGreaterThanOrEqual(1);
    await waitFor(() =>
      expect(mocks.openUrl).toHaveBeenCalledWith(
        "https://auth.test/device?code=ABCD-EFGH",
      ),
    );
    expect(mocks.openUrl).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: /open browser again/i }),
    );
    await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledTimes(2));
    expect(mocks.openUrl).toHaveBeenLastCalledWith(
      "https://auth.test/device?code=ABCD-EFGH",
    );
  });

  it("validates the approved token before persisting it, then opens chat", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse(200));
    await startAndReachPending();

    latestController().emit({ status: "approved", sessionToken: "tok_good" });

    await screen.findByRole("heading", { name: "You're in" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.test/api/users/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok_good",
          "X-Publishable-Key": "pk_test",
        }),
      }),
    );
    expect(mocks.setDesktopAuthSession).toHaveBeenCalledWith("tok_good");
    expect(mocks.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setDesktopAuthSession.mock.invocationCallOrder[0],
    );

    await waitFor(
      () =>
        expect(mocks.navigate).toHaveBeenCalledWith({
          to: "/chat",
          replace: true,
        }),
      { timeout: SIGN_IN_SUCCESS_HOLD_MS + 1000 },
    );
  });

  it("does not persist a token the API rejects", async () => {
    mocks.fetch.mockResolvedValue(jsonResponse(401));
    await startAndReachPending();

    latestController().emit({ status: "approved", sessionToken: "tok_bad" });

    await screen.findByRole("heading", {
      name: "That sign-in didn't go through",
    });
    expect(mocks.setDesktopAuthSession).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.startDeviceSignIn).toHaveBeenCalledTimes(2);
  });

  it("lets the user retry validation when the API is unreachable", async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError("offline"));
    await startAndReachPending();

    latestController().emit({ status: "approved", sessionToken: "tok_good" });

    await screen.findByRole("heading", { name: "Couldn't finish signing in" });
    expect(mocks.setDesktopAuthSession).not.toHaveBeenCalled();

    mocks.fetch.mockResolvedValueOnce(jsonResponse(200));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByRole("heading", { name: "You're in" });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.setDesktopAuthSession).toHaveBeenCalledWith("tok_good");
    expect(mocks.startDeviceSignIn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["denied", { status: "denied" } as const, "Sign-in declined"],
    ["expired", { status: "expired" } as const, "That code expired"],
    [
      "start error",
      { status: "error", error: "Failed to fetch", retryable: true } as const,
      "Couldn't reach sign-in",
    ],
  ])("%s → Try again starts a fresh code", async (_label, state, heading) => {
    await startAndReachPending();
    const first = latestController();

    first.emit(state);
    await screen.findByRole("heading", { name: heading });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.startDeviceSignIn).toHaveBeenCalledTimes(2);

    latestController().emit({ ...PENDING, userCode: "WXYZ-2345" });
    await screen.findByRole("heading", { name: "Check your browser" });
    expect(screen.getByTestId("device-user-code")).toHaveTextContent("WXYZ");
  });

  it("cancel stops the controller and returns to idle", async () => {
    await startAndReachPending();
    const ctl = latestController();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(ctl.controller.cancel).toHaveBeenCalledTimes(1);
    await screen.findByRole("button", { name: "Sign in with browser" });
  });

  it("nudges polling when the window regains focus or becomes visible", async () => {
    await startAndReachPending();
    const ctl = latestController();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(ctl.controller.nudge).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(ctl.controller.nudge).toHaveBeenCalledTimes(2);
  });

  it("cancels the controller on unmount", async () => {
    const { unmount } = render(<DesktopLogin />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in with browser" }),
    );
    const ctl = latestController();
    ctl.emit(PENDING);

    unmount();

    expect(ctl.controller.cancel).toHaveBeenCalled();
  });

  it("skips sign-in when a stored session is still valid", async () => {
    mocks.waitForDesktopToken.mockResolvedValue("tok_stored");
    mocks.fetch.mockResolvedValue(jsonResponse(200));

    render(<DesktopLogin />);

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/chat",
        replace: true,
      }),
    );
    expect(screen.getByTestId("splash")).toBeInTheDocument();
    expect(mocks.startDeviceSignIn).not.toHaveBeenCalled();
  });

  it("clears a stored session the API rejects and shows sign-in", async () => {
    mocks.waitForDesktopToken.mockResolvedValue("tok_stale");
    mocks.fetch.mockResolvedValue(jsonResponse(401));

    render(<DesktopLogin />);

    await screen.findByRole("button", { name: "Sign in with browser" });
    expect(mocks.clearDesktopAuthSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
