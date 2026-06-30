import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CameraSettingsModal } from "../CameraSettingsModal";
import { DesktopScreenPickerModal } from "../DesktopScreenPickerModal";
import { ScreenShareModal } from "../ScreenShareModal";

vi.mock("@/lib/useMediaDevices", () => ({
  useMediaDevices: () => ({
    videoInputs: [],
  }),
}));

vi.mock("@/stores/useVoiceSettingsStore", () => ({
  useVoiceSettingsStore: (selector: (state: any) => unknown) => selector({
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
  it("keeps the screen share modal dialog in normal flow for overlay centering", () => {
    const markup = renderToStaticMarkup(
      <ScreenShareModal
        isOpen
        onClose={() => {}}
        onStart={() => {}}
        availableQualities={["720p30"]}
      />,
    );

    expect(markup).toContain('<dialog open="" class="relative m-0');
  });

  it("keeps the desktop screen picker dialog in normal flow for overlay centering", () => {
    const markup = renderToStaticMarkup(
      <DesktopScreenPickerModal
        isOpen
        onClose={() => {}}
        onStart={() => {}}
        availableQualities={["720p30"]}
      />,
    );

    expect(markup).toContain('<dialog open="" class="relative m-0');
  });

  it("keeps the camera settings dialog in normal flow for overlay centering", () => {
    const markup = renderToStaticMarkup(
      <CameraSettingsModal
        isOpen
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('<dialog open="" class="relative m-0');
  });
});
