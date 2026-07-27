// @vitest-environment jsdom

import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CameraSettingsModal } from "../CameraSettingsModal";
import { DesktopScreenPickerModal } from "../DesktopScreenPickerModal";
import { ScreenShareModal } from "../ScreenShareModal";

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
      }),
      setDevice: () => {},
      updateUserSettings: () => {},
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
