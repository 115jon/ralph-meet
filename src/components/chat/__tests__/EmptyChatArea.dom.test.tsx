// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/DitherField", () => ({
  DitherField: () => null,
}));

import { EmptyChatArea } from "../EmptyChatArea";

describe("EmptyChatArea", () => {
  it("names the empty state as a heading with guidance", () => {
    render(<EmptyChatArea onMenuClick={() => {}} />);

    expect(
      screen.getByRole("heading", { name: "No channel selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pick a server and a channel to start chatting."),
    ).toBeInTheDocument();
  });

  it("opens navigation from the one action", () => {
    const onMenuClick = vi.fn();
    render(<EmptyChatArea onMenuClick={onMenuClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse channels" }));

    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });
});
