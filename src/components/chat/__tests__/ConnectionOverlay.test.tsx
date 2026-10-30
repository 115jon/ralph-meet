// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayConnectionBanner } from "../ConnectionBanner";
import { ConnectionOverlay } from "../ConnectionOverlay";

const chatState = vi.hoisted(() => ({
  connected: false,
  reconnectAttempt: 0,
  connectStep: 0 as 0 | 1 | 2 | 3,
  gatewayFailure: null as "auth" | null,
  user: { id: "me" },
  gateway: { initGateway: vi.fn(), wake: vi.fn() },
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) =>
    selector(chatState),
}));

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

function markStep() {
  return document
    .querySelector("[data-slot=logo-resolve]")
    ?.getAttribute("data-step");
}

function overlayShown() {
  return document.querySelector("[data-slot=cold-load]") !== null;
}

function strip() {
  return document.querySelector("[data-slot=connection-banner]");
}

beforeEach(() => setOnline(true));

afterEach(() => {
  vi.useRealTimers();
  chatState.connected = false;
  chatState.reconnectAttempt = 0;
  chatState.connectStep = 0;
  chatState.gatewayFailure = null;
  chatState.gateway.wake.mockReset();
  document.documentElement.className = "";
});

describe("ConnectionOverlay (cold load)", () => {
  it("shows the current step as one live status line and resolves the mark", () => {
    chatState.connectStep = 1;
    render(<ConnectionOverlay />);

    expect(markStep()).toBe("1");
    expect(screen.getByRole("status")).toHaveTextContent("Opening chat");
    expect(screen.getByText("02 / 03")).toBeInTheDocument();
    expect(screen.queryByText(/Warming up/)).toBeNull();
  });

  it("stays away when it mounts over a gateway that is already connected", () => {
    chatState.connected = true;
    chatState.connectStep = 3;
    render(<ConnectionOverlay />);
    expect(overlayShown()).toBe(false);
  });

  it("coming back to /chat after Ready is a reconnect, not a false You're in", () => {
    // disconnectGateway left the store disconnected at step 3.
    chatState.connected = false;
    chatState.connectStep = 3;
    render(
      <ConnectionOverlay>
        <button type="button">App</button>
      </ConnectionOverlay>,
    );
    expect(overlayShown()).toBe(false);
    expect(screen.queryByText("You're in")).toBeNull();
    expect(
      screen.getByRole("button", { name: "App" }).closest("[inert]"),
    ).toBeNull();
  });

  it("makes the app beneath inert while it covers it, and releases it on the way out", () => {
    vi.useFakeTimers();
    chatState.connectStep = 2;
    chatState.connected = true;
    const { rerender } = render(
      <ConnectionOverlay>
        <button type="button">App</button>
      </ConnectionOverlay>,
    );
    const app = () => document.querySelector("button")!;
    expect(app().closest("[inert]")).not.toBeNull();

    chatState.connectStep = 3;
    rerender(
      <ConnectionOverlay>
        <button type="button">App</button>
      </ConnectionOverlay>,
    );
    const before = app();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(app().closest("[inert]")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(overlayShown()).toBe(false);
    // The app was never remounted by the screen coming or going.
    expect(app()).toBe(before);
  });

  it("never covers the app after an earlier connection (spec §3 rule 4)", () => {
    chatState.reconnectAttempt = 3;
    render(<ConnectionOverlay initialHasConnected />);
    expect(overlayShown()).toBe(false);
  });

  it("waits for Ready, lands on the mark and You're in, then fades out", () => {
    vi.useFakeTimers();
    chatState.connectStep = 2;
    chatState.connected = true;
    const { rerender } = render(<ConnectionOverlay />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading messages");

    chatState.connectStep = 3;
    rerender(<ConnectionOverlay />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(markStep()).toBe("3");
    expect(screen.getByRole("status")).toHaveTextContent("You're in");
    expect(document.querySelector("[data-slot=cold-load]")).toHaveClass(
      "rm-loading-exit",
    );
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(overlayShown()).toBe(false);
  });

  it("does not hold the app if Ready never comes after the socket opens", () => {
    vi.useFakeTimers();
    chatState.connectStep = 2;
    chatState.connected = true;
    render(<ConnectionOverlay />);
    for (const ms of [4000, 0, 1200]) {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    }
    expect(overlayShown()).toBe(false);
  });

  it("a refused session says so and offers Sign in instead of spinning", () => {
    chatState.gatewayFailure = "auth";
    render(<ConnectionOverlay />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your session expired",
    );
    expect(markStep()).toBe("0");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("moves focus to Sign in when the session is refused", () => {
    const { rerender } = render(<ConnectionOverlay />);
    expect(document.activeElement).toBe(document.body);
    chatState.gatewayFailure = "auth";
    rerender(<ConnectionOverlay />);
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveFocus();
  });

  it("says it is waiting for a network when the device is offline", () => {
    setOnline(false);
    chatState.connectStep = 1;
    render(<ConnectionOverlay />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for network");
  });

  it("offers Reload after 10s without getting ready", () => {
    vi.useFakeTimers();
    chatState.connectStep = 1;
    render(<ConnectionOverlay />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Taking longer than usual",
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});

describe("connection strip (after the first connection)", () => {
  it("shows nothing for a blip under the grace period", () => {
    vi.useFakeTimers();
    chatState.connected = true;
    const { rerender } = render(<GatewayConnectionBanner />);
    chatState.connected = false;
    rerender(<GatewayConnectionBanner />);
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(strip()).toBeNull();
    chatState.connected = true;
    rerender(<GatewayConnectionBanner />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(strip()).toBeNull();
  });

  it("reconnecting is amber with the attempt and Retry now (wakes the gateway)", () => {
    chatState.reconnectAttempt = 3;
    render(<GatewayConnectionBanner initialHasConnected />);
    const banner = strip()!;
    expect(banner).toHaveAttribute("data-state", "reconnecting");
    expect(banner).toHaveTextContent("Reconnecting");
    expect(banner).toHaveTextContent("Try 3");
    screen.getByRole("button", { name: "Retry now" }).click();
    expect(chatState.gateway.wake).toHaveBeenCalled();
  });

  it("turns red with Retry once reconnecting keeps failing", () => {
    chatState.reconnectAttempt = 7;
    render(<GatewayConnectionBanner initialHasConnected />);
    expect(strip()).toHaveAttribute("data-state", "failed");
    expect(strip()).toHaveTextContent("No chat link");
    screen.getByRole("button", { name: "Retry" }).click();
    expect(chatState.gateway.wake).toHaveBeenCalled();
  });

  it("offline says so, with nothing to retry", () => {
    setOnline(false);
    render(<GatewayConnectionBanner initialHasConnected />);
    expect(strip()).toHaveAttribute("data-state", "offline");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("signed out shows at once with a Sign in key", () => {
    vi.useFakeTimers();
    chatState.connected = true;
    const { rerender } = render(<GatewayConnectionBanner />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    chatState.connected = false;
    chatState.gatewayFailure = "auth";
    rerender(<GatewayConnectionBanner />);
    expect(strip()).toHaveAttribute("data-state", "signed-out");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("says Back online after a drop that was on screen, then clears", () => {
    vi.useFakeTimers();
    chatState.reconnectAttempt = 2;
    const { rerender } = render(
      <GatewayConnectionBanner initialHasConnected />,
    );
    expect(strip()).toHaveAttribute("data-state", "reconnecting");

    chatState.connected = true;
    rerender(<GatewayConnectionBanner initialHasConnected />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(strip()).toHaveAttribute("data-state", "back");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(strip()).toBeNull();
  });

  it("coming back to /chat after Ready shows the strip, not the cover", () => {
    vi.useFakeTimers();
    chatState.connectStep = 3;
    chatState.reconnectAttempt = 1;
    render(<GatewayConnectionBanner />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(strip()).toHaveAttribute("data-state", "reconnecting");
  });

  it("shows no strip before the first connection", () => {
    render(<GatewayConnectionBanner />);
    expect(strip()).toBeNull();
  });
});
