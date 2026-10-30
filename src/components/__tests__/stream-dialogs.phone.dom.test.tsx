// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DesktopScreenPickerModal } from "../DesktopScreenPickerModal";
import { ScreenShareModal } from "../ScreenShareModal";
import { UnifiedScreenShareModal } from "../UnifiedScreenShareModal";

// Every dialog here goes through ResponsiveDialog; pretend to be a phone.
vi.mock("@/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMediaQuery")>()),
  useIsMobile: () => true,
}));

vi.mock("@/stores/useVoiceSettingsStore", () => ({
  useVoiceSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({
      getSettings: () => ({
        screenShareQuality: "1080p30",
        screenShareWithAudio: false,
      }),
      setScreenShareDefaults: () => {},
    }),
}));

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const QUALITIES = ["720p30", "1080p30", "1080p60"];

function drawer() {
  const el = document.querySelector<HTMLElement>(
    '[data-slot="drawer-content"]',
  );
  expect(el).not.toBeNull();
  return el!;
}

describe("stream dialogs on a phone", () => {
  it("web share opens as a bottom drawer with quality chips, a switch and stacked actions", async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(
      <ScreenShareModal
        isOpen
        onClose={() => {}}
        onStart={onStart}
        availableQualities={QUALITIES}
      />,
    );
    await waitFor(() => drawer());
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    // No fixed-width hand-rolled panel left over.
    expect(drawer().innerHTML).not.toMatch(/max-w-xl|w-\[calc\(100%-2rem\)\]/);

    // One source row hands off to the browser; quality is two chip rows.
    expect(screen.getByText("Choose what to share")).toBeVisible();
    const resolution = screen.getByRole("radiogroup", { name: "Resolution" });
    const frameRate = screen.getByRole("radiogroup", { name: "Frame rate" });
    expect(within(resolution).getAllByRole("radio")).toHaveLength(2);
    expect(within(frameRate).getAllByRole("radio")).toHaveLength(2);
    expect(
      within(resolution).getByRole("radio", { name: "1080p" }),
    ).toBeChecked();
    expect(
      within(frameRate).getByRole("radio", { name: "30 fps" }),
    ).toBeChecked();
    // 720p only comes at 30, so switching to it disables 60.
    await user.click(within(resolution).getByRole("radio", { name: "720p" }));
    expect(
      within(frameRate).getByRole("radio", { name: "60 fps" }),
    ).toBeDisabled();
    await user.click(within(resolution).getByRole("radio", { name: "1080p" }));
    await user.click(within(frameRate).getByRole("radio", { name: "60 fps" }));

    const audio = screen.getByRole("switch", { name: "Include audio" });
    await user.click(audio);
    expect(audio).toHaveAttribute("aria-checked", "true");

    const goLive = screen.getByRole("button", { name: "Go live" });
    // Phone footer buttons are 44px targets on touch.
    expect(goLive.className).toContain("pointer-coarse:min-h-11");
    await user.click(goLive);
    expect(onStart).toHaveBeenCalledWith({
      quality: "1080p60",
      withAudio: true,
    });
  });

  it("desktop picker becomes a full-height sheet with one-column tiles", async () => {
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "get_screen_sources"
        ? [
            {
              id: "w-1",
              name: "Editor",
              kind: "window",
              thumbnail: "",
              app_name: "Code",
            },
            {
              id: "m-1",
              name: "Display 1",
              kind: "monitor",
              thumbnail: "",
              app_name: "",
            },
          ]
        : "",
    );
    render(
      <DesktopScreenPickerModal
        isOpen
        onClose={() => {}}
        onStart={() => {}}
        availableQualities={QUALITIES}
        invoke={invoke}
      />,
    );
    await waitFor(() => drawer());
    expect(drawer().className).toContain("h-[calc(100dvh-24px)]");

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Applications",
      "Entire screen",
      "Devices",
    ]);
    for (const tab of tabs) expect(tab.className).toContain("min-h-11");
    expect(screen.getByRole("tablist").className).toContain("overflow-x-auto");
    // The tab list is inset inside its wrapper so the focus ring isn't clipped.
    expect(screen.getByRole("tablist").className).toContain("py-1");

    const group = await screen.findByRole("radiogroup", { name: "Sources" });
    expect(group.className).toContain("grid-cols-1");
    expect(screen.getByRole("radio", { name: /Editor/ }).className).not.toMatch(
      /\bw-\[\d+px\]/,
    );
    for (const chip of within(
      screen.getByRole("radiogroup", { name: "Resolution" }),
    ).getAllByRole("radio")) {
      expect(chip.className).toContain("pointer-coarse:h-11");
    }
    expect(screen.getByRole("button", { name: "Go live" })).toBeEnabled();
  });

  it("keeps Go live disabled until a source is picked and offers the Screens tab when no app is open", async () => {
    const user = userEvent.setup();
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "get_screen_sources"
        ? [
            {
              id: "m-1",
              name: "Display 1",
              kind: "monitor",
              thumbnail: "",
              app_name: "",
            },
          ]
        : "",
    );
    render(
      <DesktopScreenPickerModal
        isOpen
        onClose={() => {}}
        onStart={() => {}}
        availableQualities={QUALITIES}
        invoke={invoke}
      />,
    );
    await waitFor(() => drawer());
    expect(await screen.findByText("No open apps to share")).toBeVisible();
    expect(screen.getByRole("button", { name: "Go live" })).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Share entire screen" }),
    );
    expect(screen.getByRole("tab", { name: "Entire screen" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByRole("radio", { name: /Display 1/ }),
    ).toBeChecked();
    expect(screen.getByRole("button", { name: "Go live" })).toBeEnabled();
  });

  it("explains instead of offering a picker where sharing can't run", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <UnifiedScreenShareModal
        isOpen
        onClose={onClose}
        onStart={() => {}}
        availableQualities={QUALITIES}
        support={{ supported: false, reason: "mobile-browser" }}
      />,
    );
    await waitFor(() => drawer());
    expect(
      screen.getByText("Screen sharing isn't available here"),
    ).toBeVisible();
    expect(screen.getByText(/Phone and tablet browsers/)).toBeVisible();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
    // A phone browser can hand the link to a computer.
    expect(
      screen.getByRole("button", { name: "Copy link for my computer" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("uses app copy in the phone app", async () => {
    render(
      <UnifiedScreenShareModal
        isOpen
        onClose={() => {}}
        onStart={() => {}}
        availableQualities={QUALITIES}
        support={{ supported: false, reason: "mobile-app" }}
      />,
    );
    await waitFor(() => drawer());
    expect(screen.getByText(/phone app can't share/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Copy link for my computer" }),
    ).toBeNull();
  });
});
