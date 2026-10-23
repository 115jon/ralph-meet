// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Slider, divider, toActionSheetItems } from "./ContextMenuItems";

describe("Slider (VC-23)", () => {
  it("always shows the thumb and gives coarse pointers a 44px input", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Slider label="User Volume" value={50} max={200} onChange={onChange} />,
    );
    const thumb = container.querySelector('[data-slot="slider-thumb"]');
    expect(thumb?.className).toContain("size-3");
    expect(thumb?.className).toContain("pointer-coarse:size-5");
    expect(thumb?.className).not.toContain("opacity-0");
    expect(thumb).toHaveStyle({ left: "25%" });

    const input = screen.getByRole("slider", { name: "User Volume" });
    expect(input.className).toContain("pointer-coarse:min-h-11");
    fireEvent.change(input, { target: { value: "120" } });
    expect(onChange).toHaveBeenCalledWith(120);
  });
});

describe("toActionSheetItems", () => {
  it("maps dividers, toggles, sliders and submenus to sheet rows", () => {
    const onMute = vi.fn();
    const items = toActionSheetItems([
      { type: "item", key: "profile", label: "Profile", onSelect: vi.fn() },
      divider("a"),
      {
        type: "item",
        key: "mute",
        label: "Mute",
        checked: true,
        onSelect: onMute,
      },
      {
        type: "slider",
        key: "volume",
        label: "User Volume",
        value: 80,
        onChange: vi.fn(),
      },
      {
        type: "submenu",
        key: "apps",
        label: "Apps",
        entries: [
          { type: "item", key: "none", label: "No Apps", disabled: true },
        ],
      },
      {
        type: "item",
        key: "disconnect",
        label: "Disconnect",
        danger: true,
      },
    ]);

    expect(items.map((item) => item.label)).toEqual([
      "Profile",
      "Mute",
      "User Volume",
      "Apps",
      "Disconnect",
    ]);
    expect(items[0]!.divider).toBe(true);
    expect(items[1]!.rightIcon).toBeTruthy();
    items[1]!.onClick();
    expect(onMute).toHaveBeenCalled();
    // Rows never auto-close; the action decides (as on desktop).
    expect(items.every((item) => item.closeOnClick === false)).toBe(true);
    expect(items[2]!.subtitle).toBe("80%");
    expect(items[2]!.submenu).toBeTruthy();
    expect(items[3]!.submenu).toBeTruthy();
    expect(items[4]!.variant).toBe("danger");
  });
});
