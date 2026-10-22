// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async (_options: unknown) => undefined),
  search: {} as Record<string, string | undefined>,
  getToken: vi.fn(async () => "tok_app"),
  setStoredKovaAuthSessionToken: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@kova/react", () => ({
  SignIn: () => <div data-testid="sign-in-form" />,
  useAuth: () => ({
    getToken: mocks.getToken,
    isLoaded: true,
    isSignedIn: true,
  }),
}));

vi.mock("@/lib/desktop-auth", () => ({
  consumeAuthLogoutIntent: () => false,
  clearStoredKovaAuthSessionToken: vi.fn(),
  getStoredKovaAuthSessionToken: () => null,
  setStoredKovaAuthSessionToken: mocks.setStoredKovaAuthSessionToken,
}));

vi.mock("@/lib/platform", () => ({
  isTauri: () => false,
  getPublicWebUrl: () => "https://meet.115jon.site",
}));
vi.mock("@/components/DesktopLogin", () => ({ default: () => null }));
vi.mock("@/components/SplashScreen", () => ({
  SplashScreen: () => <div data-testid="splash" />,
}));
vi.mock("@/components/auth/AuthSplitLayout", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/auth/auth-card-appearance", () => ({
  AUTH_CARD_APPEARANCE: {},
}));

import { Route } from "./sign-in";

const SignInPage = (Route as unknown as { options: { component: React.FC } })
  .options.component;

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.setStoredKovaAuthSessionToken.mockClear();
});

describe("/sign-in after signing in", () => {
  it("returns to /activate with its code (href, so the query survives)", async () => {
    mocks.search = { redirect_url: "/activate?code=ABCD-EFGH" };
    render(<SignInPage />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: "/activate?code=ABCD-EFGH",
        replace: true,
      }),
    );
    expect(mocks.setStoredKovaAuthSessionToken).toHaveBeenCalledWith("tok_app");
  });

  it("goes to /chat without a redirect_url", async () => {
    mocks.search = {};
    render(<SignInPage />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: "/chat",
        replace: true,
      }),
    );
  });
});
