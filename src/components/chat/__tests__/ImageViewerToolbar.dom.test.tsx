// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isMobileMock = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMediaQuery")>()),
  useIsMobile: () => isMobileMock.value,
}));

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ImageViewerToolbar } from "../ImageViewerToolbar";

const image = {
  id: "att-1",
  filename: "one.jpg",
  file_key: "attachments/one.jpg",
  content_type: "image/jpeg",
  size_bytes: 2048,
  url: "https://cdn.example.com/one.jpg",
};

function Viewer({ onDialogChange }: { onDialogChange: (o: boolean) => void }) {
  return (
    <Dialog open onOpenChange={onDialogChange}>
      <DialogContent>
        <DialogTitle>Viewer</DialogTitle>
        <ImageViewerToolbar
          context={undefined}
          currentImage={image}
          dimensions={{ width: 640, height: 480 }}
          viewDispatch={() => {}}
          close={() => {}}
          getUrl={(img) => img.url}
        />
      </DialogContent>
    </Dialog>
  );
}

describe("ImageViewerToolbar more menu", () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    isMobileMock.value = false;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    writeText.mockClear();
  });

  it("opens from the more button and runs an item", async () => {
    render(<Viewer onDialogChange={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "More attachment actions" }),
    );

    const menu = await screen.findByRole("menu");
    expect(menu.closest('[data-slot="dropdown-menu-content"]')).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Copy Image" })).toBeVisible();
    const danger = screen.getByRole("menuitem", { name: "Copy Attachment ID" });
    expect(danger.className).toContain("text-rm-danger-ink");

    fireEvent.click(danger);
    expect(writeText).toHaveBeenCalledWith("att-1");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });

  it("Escape closes only the menu, not the viewer", async () => {
    const onDialogChange = vi.fn();
    render(<Viewer onDialogChange={onDialogChange} />);
    const trigger = screen.getByRole("button", {
      name: "More attachment actions",
    });
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu");

    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(onDialogChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Viewer" })).toBeInTheDocument();
  });

  it("phones get an action sheet with the same items and inline details", async () => {
    isMobileMock.value = true;
    render(<Viewer onDialogChange={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "More attachment actions" }),
    );

    const sheet = await screen.findByRole("dialog", {
      name: "Attachment actions",
    });
    expect(sheet).toHaveTextContent("Copy Link");
    const details = screen.getByRole("button", { name: /View Details/ });
    act(() => {
      fireEvent.click(details);
    });
    expect(
      screen.getByRole("region", { name: "Image details panel" }),
    ).toHaveTextContent("640×480");

    fireEvent.click(screen.getByRole("button", { name: /Copy Attachment ID/ }));
    expect(writeText).toHaveBeenCalledWith("att-1");
  });
});
