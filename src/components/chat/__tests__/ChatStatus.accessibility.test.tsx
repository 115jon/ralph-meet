// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatTypingIndicator } from "../ChatTypingIndicator";

describe("ChatTypingIndicator", () => {
  it("announces concise typing status while keeping animation decorative", () => {
    render(<ChatTypingIndicator typingUsers={["Ada", "Lin"]} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Ada, Lin are typing...",
    );
    expect(screen.getByRole("presentation")).toBeInTheDocument();
    expect(
      screen.getByRole("presentation").querySelectorAll("[aria-hidden='true']"),
    ).toHaveLength(3);
  });
});
