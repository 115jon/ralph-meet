// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@kova/react", () => ({
  useUser: () => ({ isLoaded: true, user: null }),
  useAuth: () => ({ signOut: vi.fn(() => Promise.resolve()) }),
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

import { useSettingsDialogStore } from "@/stores/useSettingsDialogStore";
import { SettingsHost } from "../SettingsHost";
import { closeSettings, openSettings } from "../settings/settings-links";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches =
      (max ? width <= Number(max[1]) : true) &&
      (min ? width >= Number(min[1]) : true);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  }) as typeof window.matchMedia;
}

function pageTitle() {
  return within(
    screen.getByRole("region", { name: "Settings content" }),
  ).getByRole("heading", { level: 2 });
}

describe("SettingsHost", () => {
  const originalWidth = window.innerWidth;
  const originalMatchMedia = window.matchMedia;

  // The host lazy-loads the dialog; warm the chunk so findBy stays fast.
  // The first import transforms the whole settings tree, which can take
  // longer than the default 10s hook timeout when the full suite runs.
  beforeAll(async () => {
    await import("../SettingsModal");
  }, 60_000);

  beforeEach(() => {
    useSettingsDialogStore.setState({
      open: false,
      requested: false,
      location: {},
      requestId: 0,
    });
  });

  afterEach(() => {
    act(() => closeSettings());
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
    window.matchMedia = originalMatchMedia;
  });

  it("renders nothing until settings are asked for", () => {
    const { container } = render(<SettingsHost />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on a deep link from the desktop gear path and closes back to the store", async () => {
    setViewport(1280);
    render(<SettingsHost />);

    act(() => openSettings({ panel: "voice" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(pageTitle()).toHaveTextContent("Voice & video");

    // A second opener while it is up moves it rather than stacking a dialog.
    act(() => openSettings({ row: "sign-out" }));
    await waitFor(() => expect(pageTitle()).toHaveTextContent("Account"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    const user = userEvent.setup();
    await user.click(
      within(
        screen.getByRole("region", { name: "Settings content" }),
      ).getAllByRole("button", { name: "Close settings" })[0]!,
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(useSettingsDialogStore.getState().open).toBe(false);
  });

  it("accepts legacy tab names (shares) as a panel", async () => {
    setViewport(1280);
    render(<SettingsHost />);

    act(() => openSettings({ panel: "shares" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(pageTitle()).toHaveTextContent("Privacy & safety");
  });

  it("opens the narrow push-navigation list on phones", async () => {
    setViewport(390);
    render(<SettingsHost />);

    act(() => openSettings());

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", {
      name: "Settings navigation",
    });
    expect(nav).not.toHaveAttribute("aria-hidden", "true");
    expect(
      document.querySelector('[aria-label="Settings content"]'),
    ).toHaveAttribute("inert");
  });
});
