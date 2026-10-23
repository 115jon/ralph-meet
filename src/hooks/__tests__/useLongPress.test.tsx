// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ContextMenu from "@/components/chat/ContextMenu";
import { useLongPressMenu } from "../useLongPress";

function Row({
  onContextMenu,
  onClick,
}: {
  onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onClick?: () => void;
}) {
  const longPress = useLongPressMenu<HTMLButtonElement>(onContextMenu);
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...longPress}
    >
      <span>Message body</span>
    </button>
  );
}

const touch = { pointerType: "touch", isPrimary: true, pointerId: 1 };

function setPhoneViewport(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("useLongPressMenu", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("turns a touch long press into the row's contextmenu handler", () => {
    const onContextMenu = vi.fn();
    const onClick = vi.fn();
    render(<Row onContextMenu={onContextMenu} onClick={onClick} />);
    const body = screen.getByText("Message body");

    fireEvent.pointerDown(body, { ...touch, clientX: 40, clientY: 60 });
    act(() => vi.advanceTimersByTime(449));
    expect(onContextMenu).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(onContextMenu).toHaveBeenCalledOnce();
    const event = onContextMenu.mock.calls[0]![0];
    expect(event.clientX).toBe(40);
    expect(event.clientY).toBe(60);
    expect(event.target).toBe(body);
    expect(event.currentTarget).toBe(screen.getByRole("button"));

    // The click that follows the release must not also activate the row.
    fireEvent.pointerUp(body, touch);
    fireEvent.click(body);
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(body);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("cancels when the finger moves (a scroll) or the browser takes over", () => {
    const onContextMenu = vi.fn();
    render(<Row onContextMenu={onContextMenu} />);
    const row = screen.getByRole("button");

    fireEvent.pointerDown(row, { ...touch, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row, { ...touch, clientX: 10, clientY: 30 });
    act(() => vi.advanceTimersByTime(600));

    fireEvent.pointerDown(row, { ...touch, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(row, touch);
    act(() => vi.advanceTimersByTime(600));

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("ignores mouse presses (desktop uses right click)", () => {
    const onContextMenu = vi.fn();
    render(<Row onContextMenu={onContextMenu} />);

    fireEvent.pointerDown(screen.getByRole("button"), {
      pointerType: "mouse",
      isPrimary: true,
      pointerId: 2,
    });
    act(() => vi.advanceTimersByTime(600));

    expect(onContextMenu).not.toHaveBeenCalled();
  });
});

describe("ContextMenu on phones", () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders the items as an action sheet with 48px rows", () => {
    setPhoneViewport(true);
    const onReply = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[
          { label: "Reply", onClick: onReply },
          { label: "", onClick: () => {}, divider: true, disabled: true },
          { label: "Delete Message", onClick: () => {}, variant: "danger" },
        ]}
        onClose={() => {}}
      />,
    );

    const sheet = screen.getByRole("dialog", { name: "Actions" });
    expect(sheet).toHaveAttribute("data-slot", "action-sheet");
    const reply = screen.getByRole("button", { name: "Reply" });
    expect(reply.className).toContain("min-h-12");
    // Spacer items never render as empty rows.
    expect(sheet.querySelectorAll("li")).toHaveLength(2);

    fireEvent.click(reply);
    expect(onReply).toHaveBeenCalledOnce();
  });

  it("long press on a row opens the sheet (the phone path end to end)", () => {
    setPhoneViewport(true);
    vi.useFakeTimers();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <Row onContextMenu={() => setOpen(true)} />
          {open ? (
            <ContextMenu
              x={0}
              y={0}
              items={[{ label: "Copy Text", onClick: () => {} }]}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      );
    }
    render(<Harness />);

    fireEvent.pointerDown(screen.getByText("Message body"), touch);
    act(() => vi.advanceTimersByTime(450));

    expect(
      screen.getByRole("button", { name: "Copy Text" }),
    ).toBeInTheDocument();
    vi.useRealTimers();
  });
});
