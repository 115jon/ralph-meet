// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Attachment } from "@/lib/types";
import { ImageGrid } from "../ImageGrid";

const attachments = [
  {
    id: "a-1",
    filename: "one.png",
    file_key: "fixtures/one.png",
    url: "/fixtures/one.png",
    content_type: "image/png",
    size_bytes: 1000,
  },
  {
    id: "a-2",
    filename: "two.png",
    file_key: "fixtures/two.png",
    url: "/fixtures/two.png",
    content_type: "image/png",
    size_bytes: 1000,
  },
] as Attachment[];

describe("ImageGrid delete", () => {
  it("confirms in a dialog instead of window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onDelete = vi.fn();
    render(<ImageGrid attachments={attachments} onDelete={onDelete} />);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete attachment" })[1]!,
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Delete attachment",
    });
    expect(onDelete).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("button", {
      name: "Delete attachment",
    });
    expect(confirm).toHaveAttribute("data-variant", "danger");

    fireEvent.click(confirm);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("a-2"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("sizes multi-image grids with aspect ratios, not fixed pixel heights", () => {
    const { container } = render(<ImageGrid attachments={attachments} />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain("aspect-video");
    expect(grid.className).toContain("max-w-130");
    expect(grid.className).not.toMatch(/h-\[\d+px\]|shadow-xl/);
  });
});
