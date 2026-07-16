// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { BaseModal } from "../BaseModal";

function TestModal({ onClose }: { onClose: () => void }) {
  return (
    <BaseModal onClose={onClose}>
      <div>
        <button type="button">First action</button>
        <button type="button">Second action</button>
      </div>
    </BaseModal>
  );
}

describe("BaseModal", () => {
  it("only owns a dialog role when the wrapper has an accessible name", () => {
    const { rerender } = render(
      <BaseModal onClose={() => {}}>
        <div role="dialog" aria-label="Caller-owned dialog">
          <button type="button">Action</button>
        </div>
      </BaseModal>,
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Caller-owned dialog" }),
    ).toBeInTheDocument();

    rerender(
      <BaseModal onClose={() => {}} aria-label="Wrapper-owned dialog">
        <button type="button">Action</button>
      </BaseModal>,
    );

    expect(
      screen.getByRole("dialog", { name: "Wrapper-owned dialog" }),
    ).toBeInTheDocument();
  });

  it("focuses the first usable control and traps Tab within the modal", async () => {
    const user = userEvent.setup();
    render(<TestModal onClose={() => {}} />);

    const first = screen.getByRole("button", { name: "First action" });
    const second = screen.getByRole("button", { name: "Second action" });

    expect(first).toHaveFocus();
    await user.tab();
    expect(second).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
  });

  it("restores focus and only the topmost modal handles Escape", () => {
    function Harness() {
      const [outerOpen, setOuterOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOuterOpen(true)}>
            Open modal
          </button>
          {outerOpen ? (
            <BaseModal onClose={() => setOuterOpen(false)}>
              <div>
                <button type="button" onClick={() => setInnerOpen(true)}>
                  Open inner modal
                </button>
              </div>
            </BaseModal>
          ) : null}
          {innerOpen ? (
            <BaseModal onClose={() => setInnerOpen(false)}>
              <div>
                <button type="button">Inner action</button>
              </div>
            </BaseModal>
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open modal" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Open inner modal" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("button", { name: "Inner action" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open inner modal" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(opener).toHaveFocus();
  });

  it("isolates the background while open", () => {
    const background = document.createElement("button");
    background.textContent = "Background";
    document.body.appendChild(background);

    render(<TestModal onClose={() => {}} />);

    expect(background).toHaveAttribute("aria-hidden", "true");
    expect(background).toHaveAttribute("inert");
  });

  it("focuses the first connected, visible, non-inert control", () => {
    render(
      <BaseModal onClose={() => {}}>
        <button type="button" hidden>
          Hidden action
        </button>
        <div ref={(element) => element?.setAttribute("inert", "")}>
          <button type="button">Inert action</button>
        </div>
        <button type="button">Visible action</button>
      </BaseModal>,
    );

    expect(
      screen.getByRole("button", { name: "Visible action" }),
    ).toHaveFocus();
  });

  it("skips backdrop close buttons when choosing the initial focus", () => {
    render(
      <BaseModal onClose={() => {}}>
        <button type="button" data-base-modal-backdrop>
          Close backdrop
        </button>
        <div role="dialog" aria-label="Visible dialog">
          <button type="button">Visible action</button>
        </div>
      </BaseModal>,
    );

    expect(
      screen.getByRole("button", { name: "Visible action" }),
    ).toHaveFocus();
  });

  it("does not let programmatic history cleanup close a parent modal", () => {
    vi.useFakeTimers();
    const historyGo = vi
      .spyOn(window.history, "go")
      .mockImplementation(() => undefined);

    function Harness() {
      const [outerOpen, setOuterOpen] = useState(true);
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <>
          {outerOpen ? (
            <BaseModal onClose={() => setOuterOpen(false)}>
              <button type="button" onClick={() => setInnerOpen(true)}>
                Open inner
              </button>
            </BaseModal>
          ) : null}
          {innerOpen ? (
            <BaseModal onClose={() => setInnerOpen(false)}>
              <button type="button" onClick={() => setInnerOpen(false)}>
                Close inner
              </button>
            </BaseModal>
          ) : null}
        </>
      );
    }

    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole("button", { name: "Open inner" }));
      fireEvent.click(screen.getByRole("button", { name: "Close inner" }));

      act(() => {
        vi.runAllTimers();
      });
      expect(historyGo).toHaveBeenCalled();

      fireEvent.popState(window);
      expect(
        screen.getByRole("button", { name: "Open inner" }),
      ).toBeInTheDocument();
    } finally {
      historyGo.mockRestore();
      vi.useRealTimers();
    }
  });
});
