// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CustomSelect } from "../CustomSelect";

describe("CustomSelect", () => {
  it("supports opening, roving focus, selection, and Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CustomSelect
        value="two"
        onChange={onChange}
        ariaLabel="Test select"
        options={[
          { value: "one", label: "One" },
          { value: "two", label: "Two" },
          { value: "three", label: "Three" },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Test select" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(options[2]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("three");
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("prevents scrolling when restoring focus to the trigger", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      render(
        <CustomSelect
          value="one"
          onChange={() => {}}
          ariaLabel="Test select"
          options={[{ value: "one", label: "One" }]}
        />,
      );

      const trigger = screen.getByRole("button", { name: "Test select" });
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      fireEvent.keyDown(screen.getByRole("option", { name: "One" }), {
        key: "Escape",
      });

      expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true }]);
    } finally {
      focus.mockRestore();
    }
  });

  it("closes when focus leaves the popup", async () => {
    render(
      <>
        <CustomSelect
          value="one"
          onChange={() => {}}
          ariaLabel="Test select"
          options={[{ value: "one", label: "One" }]}
        />
        <button type="button">Outside</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Test select" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    screen.getByRole("button", { name: "Outside" }).focus();
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
  });

  it("closes on Tab without trapping focus in the popup", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <CustomSelect
          value="one"
          onChange={() => {}}
          ariaLabel="Test select"
          options={[{ value: "one", label: "One" }]}
        />
        <button type="button">After</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Test select" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await user.tab();

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("skips hidden or inert Tab candidates and continues after an unfocusable one", () => {
    render(
      <>
        <CustomSelect
          value="one"
          onChange={() => {}}
          ariaLabel="Test select"
          options={[{ value: "one", label: "One" }]}
        />
        <button type="button" hidden>
          Hidden
        </button>
        <div
          ref={(element) => {
            element?.setAttribute("inert", "");
          }}
        >
          <button type="button">Inert</button>
        </div>
        <div aria-hidden="true">
          <button type="button">Aria hidden</button>
        </div>
        <button
          type="button"
          ref={(element) => {
            if (element) {
              Object.defineProperty(element, "focus", {
                configurable: true,
                value: () => {},
              });
            }
          }}
        >
          Unfocusable
        </button>
        <button type="button">After</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Test select" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = screen.getByRole("option", { name: "One" });
    fireEvent.keyDown(option, { key: "Tab" });

    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });
});
