// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  isSignedIn: false,
  fetch: vi.fn(),
}));

vi.mock("@kova/react", () => ({
  useAuth: () => ({ isSignedIn: mocks.isSignedIn }),
  UserButton: () => <div data-testid="user-button" />,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/lib/platform", () => ({
  isWindows: () => true,
}));

// The dither canvas needs WebGL2 and a real paint loop; neither exists in
// jsdom. The fallback gradient host is enough for structure.
vi.mock("@/components/home/LandingField", () => ({
  LandingField: () => <div data-testid="landing-field" />,
}));

import HomePageClient from "@/components/HomePageClient";

describe("HomePageClient", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.isSignedIn = false;
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => [] });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the hero copy visible without any motion state", () => {
    render(<HomePageClient />);
    const title = screen.getByRole("heading", {
      level: 1,
      name: "The room is always open.",
    });
    expect(title).toBeVisible();
    // Reveal targets ship without a state attribute so SSR output is visible.
    const pending = document.querySelectorAll('[data-reveal="out"]');
    expect(pending.length).toBe(0);
  });

  it("keeps the account nav, downloads, create and join paths", () => {
    render(<HomePageClient />);
    const signIn = screen.getAllByRole("link", { name: "Sign in" });
    expect(signIn.length).toBeGreaterThan(0);
    for (const link of signIn) expect(link).toHaveAttribute("href", "/sign-in");
    const downloads = screen.getAllByRole("link", {
      name: /Download for Windows/,
    });
    expect(downloads.length).toBeGreaterThan(0);
    for (const link of downloads) {
      expect(link.getAttribute("href")).toMatch(/RalphMeetSetup\.exe$/);
    }

    fireEvent.click(
      screen.getAllByRole("button", { name: /Start a room/ })[0]!,
    );
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/room/$slug",
        params: { slug: expect.stringMatching(/^[a-z0-9]{6}-[a-z0-9]{4}$/) },
      }),
    );

    const input = screen.getByLabelText("Room code or link");
    const join = screen.getByRole("button", { name: /Join room/ });
    expect(join).toBeDisabled();
    fireEvent.change(input, { target: { value: "  Hazy River 4k2 " } });
    expect(join).toBeEnabled();
    fireEvent.submit(input.closest("form")!);
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/room/$slug",
      params: { slug: "hazy-river-4k2" },
    });
  });

  it("shows the app entry points when signed in", () => {
    mocks.isSignedIn = true;
    render(<HomePageClient />);
    expect(screen.getByTestId("user-button")).toBeInTheDocument();
    const open = screen.getAllByRole("link", { name: "Open the app" });
    expect(open.length).toBeGreaterThan(0);
    for (const link of open) expect(link).toHaveAttribute("href", "/chat");
    expect(screen.queryAllByRole("link", { name: "Sign in" })).toHaveLength(0);
  });

  it("links the footer to the project without hard-coded site hosts", () => {
    render(<HomePageClient />);
    const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.some((h) => h?.includes("115jon."))).toBe(false);
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/115jon/ralph-meet",
    );
  });
});
