// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invalidate: vi.fn(async () => {}) }));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}));

vi.mock("@/lib/console-logger", () => ({
  clog: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

import { NotFoundPage, RouteErrorPage } from "../PageState";

const SECRET = "D1_ERROR: no such table: message_shares";

describe("RouteErrorPage", () => {
  it("never renders error.message", () => {
    const { container } = render(
      <RouteErrorPage error={new Error(SECRET)} reset={vi.fn()} />,
    );
    expect(container.textContent).not.toContain("D1_ERROR");
    expect(container.textContent).not.toContain("message_shares");
    expect(
      screen.getByRole("heading", { name: "This page didn't load" }),
    ).toBeInTheDocument();
  });

  it("retries by resetting the boundary and invalidating the router", () => {
    const reset = vi.fn();
    render(<RouteErrorPage error={new Error(SECRET)} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it("links home", () => {
    render(<RouteErrorPage error={new Error(SECRET)} reset={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("takes route-specific copy without exposing the error", () => {
    const { container } = render(
      <RouteErrorPage
        error={new Error(SECRET)}
        reset={vi.fn()}
        title="Couldn't load this message"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Couldn't load this message" }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain(SECRET);
  });
});

describe("NotFoundPage", () => {
  it("offers a way home", () => {
    render(<NotFoundPage />);
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
