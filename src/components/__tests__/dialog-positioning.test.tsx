// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("@/components/chat/settings/CameraCard", () => ({
  default: () => <div data-testid="camera-card" />,
}));

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

  it("uses the shared responsive dialog for web screen share", () => {
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
    // No hand-rolled scrim: the dialog primitive owns overlay and z (13.1).
    expect(markup).not.toContain("fixed inset-0 z-60");
    expect(
      document.querySelector('[data-slot="dialog-content"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Share your screen" }),
    ).toBeVisible();
  });

  it("uses the shared responsive dialog for the desktop picker", () => {
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
    expect(markup).not.toContain("fixed inset-0 z-60");
    expect(
      document.querySelector('[data-slot="dialog-content"]'),
    ).not.toBeNull();
  });

  it("keeps the desktop picker open while quality chips are used", async () => {
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

    // The quality control is two rows of chips in the dialog itself, so
    // choosing a preset is an inside press.
    await user.click(screen.getByRole("radio", { name: "1080p" }));
    expect(screen.getByRole("radio", { name: "1080p" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "60 fps" })).toBeChecked();

    expect(onClose).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-slot="dialog-content"][data-state="open"]'),
    ).not.toBeNull();
  });

  it("uses the shared responsive dialog for camera settings", () => {
    render(<CameraSettingsModal isOpen onClose={() => {}} />);
    const markup = document.body.innerHTML;
    const content = document.querySelector<HTMLElement>(
      '[data-slot="dialog-content"]',
    );
    const scrollRegion =
      content?.querySelector<HTMLElement>(".overflow-y-auto");

    expect(markup).not.toContain("<dialog");
    expect(content).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Camera" })).toBeVisible();
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion).toHaveClass("min-h-0");
    expect(screen.getByTestId("camera-card")).toBeVisible();
  });
});
