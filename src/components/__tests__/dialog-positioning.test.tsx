// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CameraSettingsModal } from "../CameraSettingsModal";
import { DesktopScreenPickerModal } from "../DesktopScreenPickerModal";
import { ScreenShareModal } from "../ScreenShareModal";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("@/lib/useMediaDevices", () => ({
  useMediaDevices: () => ({
    videoInputs: [],
  }),
}));

vi.mock("@/stores/useVoiceSettingsStore", () => ({
  useVoiceSettingsStore: (selector: (state: any) => unknown) =>
    selector({
      getSettings: () => ({
        cameraBackground: { type: "none" },
        customCameraBackgrounds: [],
        videoDeviceId: null,
        cameraQuality: "720p",
        alwaysPreviewVideo: false,
        screenShareQuality: "720p30",
        screenShareWithAudio: false,
      }),
      setDevice: () => {},
      updateUserSettings: () => {},
      setScreenShareDefaults: () => {},
    }),
}));

describe("dialog positioning regression guard", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the shadcn dialog primitive for screen share positioning", () => {
    render(
      <ScreenShareModal
        isOpen
        onClose={() => {}}
        onStart={() => {}}
        availableQualities={["720p30"]}
      />,
    );
    const markup = document.body.innerHTML;

    expect(markup).not.toContain("<dialog");
    expect(markup).toContain("fixed inset-0 z-90");
  });

  it("uses the shadcn dialog primitive for desktop screen picker positioning", () => {
    render(
      <DesktopScreenPickerModal
        isOpen
        onClose={() => {}}
        onStart={() => {}}
        availableQualities={["720p30"]}
      />,
    );
    const markup = document.body.innerHTML;

    expect(markup).not.toContain("<dialog");
    expect(markup).toContain("fixed inset-0 z-90");
  });

  it("keeps the desktop picker open when the quality select opens", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DesktopScreenPickerModal
        isOpen
        onClose={onClose}
        onStart={() => {}}
        availableQualities={["720p30", "1080p60"]}
      />,
    );

    await user.click(
      screen.getByRole("combobox", { name: "Select stream quality" }),
    );

    expect(onClose).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-slot="dialog-surface"][data-state="open"]'),
    ).not.toBeNull();
    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveClass("z-[110]");
    expect(screen.getByRole("option", { name: /1080p/i })).toBeVisible();

    const overlay = document.querySelector('[role="presentation"]');
    expect(overlay).not.toBeNull();
    fireEvent.pointerDown(overlay as Element);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-slot="dialog-surface"][data-state="open"]'),
    ).not.toBeNull();
  });

  it("uses the shadcn dialog primitive for camera settings positioning", () => {
    render(<CameraSettingsModal isOpen onClose={() => {}} />);
    const markup = document.body.innerHTML;
    const scrollRegion = document.querySelector<HTMLElement>(
      ".flex-1.space-y-5.overflow-y-auto",
    );

    expect(markup).not.toContain("<dialog");
    expect(markup).toContain("fixed inset-0 z-50");
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion).toHaveClass("min-h-0");
  });
});
