// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsWorkbench, WorkbenchNav } from "../SettingsWorkbench";
import { UnsavedBar } from "../UnsavedBar";

const originalWidth = window.innerWidth;

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  fireEvent(window, new Event("resize"));
}

afterEach(() => setWidth(originalWidth));

const groups = [
  {
    title: "You",
    items: [
      { id: "account", label: "Account", icon: "account" as const },
      { id: "sessions", label: "Sessions", icon: "sessions" as const },
    ],
  },
  {
    title: "Calls",
    items: [{ id: "voice", label: "Voice & video", icon: "mic" as const }],
  },
];

function Shell({ size }: { size?: "default" | "wide" }) {
  return (
    <SettingsWorkbench
      open
      onClose={() => {}}
      title="Settings"
      size={size}
      activeId="voice"
      showList={false}
      onShowListChange={() => {}}
      nav={
        <WorkbenchNav groups={groups} activeId="voice" onSelect={() => {}} />
      }
      pageTitle="Voice & video"
      pageIcon="mic"
    >
      <p>Page body</p>
    </SettingsWorkbench>
  );
}

describe("WorkbenchNav", () => {
  it("numbers the groups in silkscreen and names each group by its title", () => {
    setWidth(1280);
    render(<Shell />);

    const you = screen.getByRole("group", { name: "You" });
    const calls = screen.getByRole("group", { name: "Calls" });
    expect(
      within(you)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Account", "Sessions"]);
    expect(
      within(calls).getByRole("button", { name: "Voice & video" }),
    ).toHaveAttribute("aria-current", "page");

    // "01" and "02" are decoration: the group's name stays "You" / "Calls".
    const heading = screen.getByRole("heading", { level: 3, name: "You" });
    expect(within(heading).getByText("01")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Calls" }),
    ).toHaveTextContent("02");
  });
});

describe("SettingsWorkbench shell", () => {
  it("is a 264px nav beside a 48px page header with the panel's title and a close key", () => {
    setWidth(1280);
    render(<Shell />);

    const nav = screen.getByRole("navigation", { name: "Settings navigation" });
    expect(nav).toHaveClass("w-[264px]");

    const title = screen.getByRole("heading", {
      level: 2,
      name: "Voice & video",
    });
    const header = title.closest("header");
    expect(header).toHaveClass("h-12");
    expect(
      within(header as HTMLElement).getByRole("button", {
        name: "Close settings",
      }),
    ).toBeInTheDocument();
  });

  it("shows the Esc key cap on desktop as decoration, and a close button on phones", () => {
    setWidth(1280);
    const { unmount } = render(<Shell />);
    const esc = screen.getByText("Esc");
    expect(esc.tagName).toBe("KBD");
    expect(esc).toHaveAttribute("aria-hidden", "true");
    unmount();

    setWidth(390);
    render(<Shell />);
    expect(screen.queryByText("Esc")).toBeNull();
  });

  it("widens the dialog for pages that carry a preview rail", () => {
    setWidth(1280);
    render(<Shell size="wide" />);
    const surface = document.querySelector("[data-settings-workbench]");
    expect(surface?.className).toContain("md:w-[min(1280px,calc(100vw-32px))]");
    expect(surface?.className).not.toContain("md:w-[min(1120px");
  });
});

describe("UnsavedBar", () => {
  it("says what is pending with an LED label and keeps Reset and Save live", () => {
    const onReset = vi.fn();
    const onSave = vi.fn();
    render(<UnsavedBar dirty onReset={onReset} onSave={onSave} />);

    const bar = screen.getByRole("region", { name: "Unsaved changes" });
    expect(bar).toHaveClass("border-t-2");
    expect(within(bar).getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole("button", { name: "Reset" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Save changes" }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("shows a save failure in place of the pending message", () => {
    render(
      <UnsavedBar
        dirty
        error="Couldn't save."
        onReset={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText("Couldn't save.")).toBeInTheDocument();
    expect(
      screen.queryByText("Unsaved changes", { selector: "span" }),
    ).toBeNull();
  });
});
