// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(() => Promise.resolve()),
  markAuthLogoutIntent: vi.fn(),
  clearDesktopAuthSession: vi.fn(),
}));

vi.mock("@kova/react", () => ({
  useUser: () => ({
    isLoaded: true,
    user: {
      id: "user-1",
      username: "jon",
      primaryEmailAddress: { emailAddress: "jon@example.com" },
    },
  }),
  useAuth: () => ({ signOut: mocks.signOut }),
}));

vi.mock("@/lib/desktop-auth", () => ({
  markAuthLogoutIntent: mocks.markAuthLogoutIntent,
  clearDesktopAuthSession: mocks.clearDesktopAuthSession,
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: vi.fn(() => new Promise(() => {})),
  apiPatch: vi.fn(() => Promise.resolve({})),
  apiDelete: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/platform", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/platform")>("@/lib/platform");
  return { ...actual, isDesktop: () => false };
});

vi.mock("../SettingsAccountTab", () => ({ default: () => null }));

import SettingsModal from "../SettingsModal";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

function nav() {
  return screen.getByRole("navigation", { name: "Settings navigation" });
}

function pageTitle() {
  return within(
    screen.getByRole("region", { name: "Settings content" }),
  ).getByRole("heading", { level: 2 });
}

describe("SettingsModal (Studio)", () => {
  const originalWidth = window.innerWidth;
  const originalLocation = window.location;

  beforeEach(() => {
    setViewport(1280);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace: vi.fn() },
    });
  });

  afterEach(() => {
    setViewport(originalWidth);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.clearAllMocks();
  });

  describe("search", () => {
    it("finds individual rows across panels, with hit counts per page", async () => {
      const user = userEvent.setup();
      render(<SettingsModal open onClose={() => {}} initialTab="account" />);

      await user.type(
        screen.getByRole("searchbox", { name: "Search settings" }),
        "echo",
      );

      // The panel that holds the row shows a count, others are dimmed out.
      const voiceItem = within(nav()).getByRole("button", {
        name: /Voice & video, 1 match/,
      });
      expect(voiceItem).toBeEnabled();
      expect(
        within(nav()).getByRole("button", { name: /Account, 0 matches/ }),
      ).toBeDisabled();

      // The matching row itself is listed, with the match highlighted.
      const rowHit = within(nav()).getByRole("button", {
        name: /Echo cancellation/,
      });
      expect(rowHit.querySelector("mark")).toHaveTextContent(/echo/i);
      expect(screen.getByText("1 setting matches")).toBeInTheDocument();
    });

    it("filters the current page in place and lands on a row from Enter", async () => {
      const user = userEvent.setup();
      render(<SettingsModal open onClose={() => {}} initialTab="account" />);
      const search = screen.getByRole("searchbox", { name: "Search settings" });

      await user.type(search, "unique");
      const content = screen.getByRole("region", { name: "Settings content" });
      // "Unique to you" (Username) and "doesn't need to be unique" (Display name)
      expect(within(content).getByText("Username")).toBeInTheDocument();
      expect(within(content).getByText("Display name")).toBeInTheDocument();
      expect(within(content).queryByText("Email")).not.toBeInTheDocument();
      expect(
        within(content).queryByText("Server profiles"),
      ).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "sign out{Enter}");

      expect(search).toHaveValue("");
      expect(pageTitle()).toHaveTextContent("Account");
      const row = document.querySelector('[data-row="sign-out"]');
      expect(row).toHaveAttribute("data-target", "true");
      await waitFor(() => expect(row).toHaveFocus());
    });

    it("clears the search with Escape before closing the dialog", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<SettingsModal open onClose={onClose} initialTab="account" />);
      const search = screen.getByRole("searchbox", { name: "Search settings" });

      await user.type(search, "theme");
      await user.keyboard("{Escape}");
      expect(search).toHaveValue("");
      expect(onClose).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("deep links", () => {
    it("opens on a panel and row from props, and highlights the row", async () => {
      render(<SettingsModal open onClose={() => {}} initialRow="theme-sync" />);

      expect(pageTitle()).toHaveTextContent("Appearance");
      const row = document.querySelector('[data-row="theme-sync"]');
      expect(row).toHaveAttribute("data-target", "true");
      await waitFor(() => expect(row).toHaveFocus());
      expect(
        within(nav()).getByRole("button", { name: "Appearance" }),
      ).toHaveAttribute("aria-current", "page");
    });

    it("maps pre-Studio tab names to their new home", () => {
      render(<SettingsModal open onClose={() => {}} initialTab="shares" />);

      expect(pageTitle()).toHaveTextContent("Privacy & safety");
      expect(
        document.querySelector('[data-row="shared-messages"]'),
      ).toHaveAttribute("data-target", "true");
    });

    it("moves to a new location when asked again while open", async () => {
      const { rerender } = render(
        <SettingsModal open onClose={() => {}} initialTab="account" />,
      );
      expect(pageTitle()).toHaveTextContent("Account");

      rerender(
        <SettingsModal
          open
          onClose={() => {}}
          initialRow="sign-out"
          requestId={1}
        />,
      );

      expect(pageTitle()).toHaveTextContent("Account");
      await waitFor(() =>
        expect(document.querySelector('[data-row="sign-out"]')).toHaveAttribute(
          "data-target",
          "true",
        ),
      );

      rerender(
        <SettingsModal
          open
          onClose={() => {}}
          initialTab="voice"
          requestId={2}
        />,
      );
      expect(pageTitle()).toHaveTextContent("Voice & video");
    });
  });

  describe("sign out", () => {
    it("asks first, names the consequence, and runs the full sign-out flow", async () => {
      const user = userEvent.setup();
      render(<SettingsModal open onClose={() => {}} initialTab="account" />);
      const content = screen.getByRole("region", { name: "Settings content" });

      const trigger = within(content).getByRole("button", { name: "Sign out" });
      await user.click(trigger);

      const confirm = within(content).getByRole("group", {
        name: /signed out on this device, and any call you're in will end/,
      });
      expect(mocks.markAuthLogoutIntent).not.toHaveBeenCalled();
      expect(
        within(confirm).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus();

      await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
      expect(
        within(content).queryByRole("group", { name: /signed out/ }),
      ).not.toBeInTheDocument();
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(mocks.signOut).not.toHaveBeenCalled();

      await user.click(trigger);
      await user.click(
        within(
          within(content).getByRole("group", { name: /signed out/ }),
        ).getByRole("button", { name: "Sign out" }),
      );

      expect(mocks.markAuthLogoutIntent).toHaveBeenCalledOnce();
      expect(mocks.clearDesktopAuthSession).toHaveBeenCalledOnce();
      expect(mocks.signOut).toHaveBeenCalledWith("/sign-in");
      await waitFor(() =>
        expect(window.location.replace).toHaveBeenCalledWith("/sign-in"),
      );
    });

    it("cancels the confirm with Escape without closing settings", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<SettingsModal open onClose={onClose} initialTab="account" />);
      const content = screen.getByRole("region", { name: "Settings content" });

      await user.click(
        within(content).getByRole("button", { name: "Sign out" }),
      );
      await user.keyboard("{Escape}");

      expect(
        within(content).queryByRole("group", { name: /signed out/ }),
      ).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("nav keyboard", () => {
    it("moves focus with arrows, Home and End, and opens a page with Enter", async () => {
      const user = userEvent.setup();
      render(<SettingsModal open onClose={() => {}} initialTab="account" />);
      const items = within(nav()).getAllByRole("button");
      const account = within(nav()).getByRole("button", { name: "Account" });

      // One tab stop: only the current page is in the tab order.
      expect(account).toHaveAttribute("tabindex", "0");
      expect(
        items.filter((item) => item.getAttribute("tabindex") === "0"),
      ).toHaveLength(1);

      account.focus();
      await user.keyboard("{ArrowDown}");
      expect(
        within(nav()).getByRole("button", { name: "Sessions" }),
      ).toHaveFocus();

      await user.keyboard("{End}");
      expect(
        within(nav()).getByRole("button", { name: "Notifications" }),
      ).toHaveFocus();

      await user.keyboard("{ArrowDown}");
      expect(account).toHaveFocus();

      await user.keyboard("{ArrowUp}{ArrowUp}");
      const appearance = within(nav()).getByRole("button", {
        name: "Appearance",
      });
      expect(appearance).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(appearance).toHaveAttribute("aria-current", "page");
      expect(account).not.toHaveAttribute("aria-current");
      expect(pageTitle()).toHaveTextContent("Appearance");
    });

    it("leaves the desktop-only page out on the web", () => {
      render(<SettingsModal open onClose={() => {}} />);
      expect(
        within(nav()).queryByRole("button", { name: "Desktop app" }),
      ).not.toBeInTheDocument();
    });
  });
});
