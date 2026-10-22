// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../select";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function TestSelect({ onChange }: { onChange: (value: string) => void }) {
  return (
    <Select defaultValue="two" onValueChange={onChange}>
      <SelectTrigger aria-label="Test select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="one">One</SelectItem>
        <SelectItem value="two">Two</SelectItem>
        <SelectItem value="three">Three</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("shadcn Select", () => {
  it("opens, navigates, selects, and closes through the Radix primitive", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TestSelect onChange={onChange} />);

    const trigger = screen.getByRole("combobox", { name: "Test select" });
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toHaveClass("z-[110]");
    expect(screen.getAllByRole("option")).toHaveLength(3);

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("three");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("exposes the selected label and supports Escape", async () => {
    const user = userEvent.setup();
    render(<TestSelect onChange={() => {}} />);

    const trigger = screen.getByRole("combobox", { name: "Test select" });
    expect(trigger).toHaveTextContent("Two");

    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
});
