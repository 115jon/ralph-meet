// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmStrip, useConfirm } from "../settings/primitives";
import { SettingsWorkbench, WorkbenchNav } from "../settings/SettingsWorkbench";
import { useWorkbenchNav } from "../settings/useWorkbenchNav";

const originalWidth = window.innerWidth;

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  fireEvent(window, new Event("resize"));
}

afterEach(() => setWidth(originalWidth));

function Confirmable() {
  const { armed, arm, cancel, done, triggerRef } = useConfirm();
  return (
    <div>
      <button type="button" ref={triggerRef} onClick={arm}>
        Delete role
      </button>
      {armed ? (
        <ConfirmStrip
          consequence="Members lose this role."
          confirmLabel="Delete role"
          onConfirm={done}
          onCancel={cancel}
        />
      ) : null}
    </div>
  );
}

function Harness({
  onClose,
  nested = false,
}: {
  onClose: () => void;
  nested?: boolean;
}) {
  const nav = useWorkbenchNav<"overview" | "roles">("overview");
  const [editing, setEditing] = useState(nested);
  const groups = [
    {
      items: [
        { id: "overview", label: "Overview", icon: "settings" as const },
        { id: "roles", label: "Roles", icon: "shield" as const },
      ],
    },
  ];
  return (
    <SettingsWorkbench
      open
      onClose={onClose}
      title="Server settings"
      activeId={nav.active}
      showList={nav.showList}
      onShowListChange={nav.setShowList}
      nav={
        <WorkbenchNav
          groups={groups}
          activeId={nav.active}
          onSelect={(id) => nav.go(id as "overview" | "roles")}
        />
      }
      pageTitle={
        editing ? "Moderator" : nav.active === "roles" ? "Roles" : "Overview"
      }
      back={
        editing
          ? { label: "Back to roles", onBack: () => setEditing(false) }
          : undefined
      }
    >
      <Confirmable />
    </SettingsWorkbench>
  );
}

describe("SettingsWorkbench", () => {
  it("pushes from the list into a page on phones and back again", async () => {
    setWidth(390);
    render(<Harness onClose={() => {}} />);

    const nav = screen.getByRole("navigation", {
      name: "Server settings navigation",
    });
    const region = document.querySelector<HTMLElement>(
      '[aria-label="Server settings content"]',
    )!;
    expect(nav).not.toHaveAttribute("inert");
    expect(region).toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: "Roles" }));

    expect(nav).toHaveAttribute("inert");
    expect(region).not.toHaveAttribute("inert");
    expect(
      screen.getByRole("heading", { level: 2, name: "Roles" }),
    ).toHaveFocus();

    fireEvent.click(
      screen.getByRole("button", { name: "Back to server settings" }),
    );
    expect(nav).not.toHaveAttribute("inert");
    expect(region).toHaveAttribute("inert");
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Roles" })).toHaveFocus();
  });

  it("shows both columns on desktop and marks the current page", () => {
    setWidth(1280);
    render(<Harness onClose={() => {}} />);
    const overview = screen.getByRole("button", { name: "Overview" });
    expect(overview).toHaveAttribute("aria-current", "page");
    expect(
      document.querySelector('[aria-label="Server settings content"]'),
    ).not.toHaveAttribute("inert");
    expect(
      screen.queryByRole("button", { name: "Back to server settings" }),
    ).toBeNull();
  });

  it("steps back one level per Escape: confirm, nested page, list, close", () => {
    setWidth(390);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} nested />);
    fireEvent.click(screen.getByRole("button", { name: "Roles" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete role" }));
    expect(screen.getByText("Members lose this role.")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByText("Members lose this role.")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Moderator" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.getByRole("heading", { level: 2, name: "Roles" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.getByRole("navigation", { name: "Server settings navigation" }),
    ).not.toHaveAttribute("inert");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes from the header in every state", () => {
    setWidth(1280);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} nested />);
    fireEvent.click(
      screen.getByRole("button", { name: "Close server settings" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
