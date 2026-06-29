import { describe, expect, it } from "vitest";

import { resolveStreamPreviewAutomation } from "@/lib/stream-preview-automation";

describe("resolveStreamPreviewAutomation", () => {
  it("shows the preview when the floating mini player needs a hidden stream", () => {
    expect(
      resolveStreamPreviewAutomation({
        isScreenSharing: true,
        isPreviewHidden: true,
        shouldRenderMiniPreview: true,
        isAppInactive: false,
        alwaysShowPreview: false,
        automationState: "idle",
      }),
    ).toEqual({
      action: "show-preview",
      nextAutomationState: "shown-for-mini-preview",
    });
  });

  it("pauses an active preview when the app is unfocused and auto-pause is enabled", () => {
    expect(
      resolveStreamPreviewAutomation({
        isScreenSharing: true,
        isPreviewHidden: false,
        shouldRenderMiniPreview: true,
        isAppInactive: true,
        alwaysShowPreview: false,
        automationState: "shown-for-mini-preview",
      }),
    ).toEqual({
      action: "hide-preview",
      nextAutomationState: "paused-for-inactive",
    });
  });

  it("restores the preview after refocusing even when the voice view is active again", () => {
    expect(
      resolveStreamPreviewAutomation({
        isScreenSharing: true,
        isPreviewHidden: true,
        shouldRenderMiniPreview: false,
        isAppInactive: false,
        alwaysShowPreview: false,
        automationState: "paused-for-inactive",
      }),
    ).toEqual({
      action: "show-preview",
      nextAutomationState: "idle",
    });
  });

  it("restores the original hidden state after leaving the mini preview", () => {
    expect(
      resolveStreamPreviewAutomation({
        isScreenSharing: true,
        isPreviewHidden: false,
        shouldRenderMiniPreview: false,
        isAppInactive: false,
        alwaysShowPreview: false,
        automationState: "shown-for-mini-preview",
      }),
    ).toEqual({
      action: "restore-hidden",
      nextAutomationState: "idle",
    });
  });

  it("does not auto-pause when the user prefers to always show the preview", () => {
    expect(
      resolveStreamPreviewAutomation({
        isScreenSharing: true,
        isPreviewHidden: false,
        shouldRenderMiniPreview: true,
        isAppInactive: true,
        alwaysShowPreview: true,
        automationState: "shown-for-mini-preview",
      }),
    ).toEqual({
      action: "none",
      nextAutomationState: "shown-for-mini-preview",
    });
  });
});
