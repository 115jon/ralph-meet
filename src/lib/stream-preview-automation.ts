export type StreamPreviewAutomationState =
  | "idle"
  | "shown-for-mini-preview"
  | "paused-for-inactive";

export type StreamPreviewAutomationAction =
  | "none"
  | "show-preview"
  | "hide-preview"
  | "restore-hidden";

interface ResolveStreamPreviewAutomationArgs {
  isScreenSharing: boolean;
  isPreviewHidden: boolean;
  shouldRenderMiniPreview: boolean;
  isAppInactive: boolean;
  alwaysShowPreview: boolean;
  automationState: StreamPreviewAutomationState;
}

interface StreamPreviewAutomationResolution {
  action: StreamPreviewAutomationAction;
  nextAutomationState: StreamPreviewAutomationState;
}

export function resolveStreamPreviewAutomation({
  isScreenSharing,
  isPreviewHidden,
  shouldRenderMiniPreview,
  isAppInactive,
  alwaysShowPreview,
  automationState,
}: ResolveStreamPreviewAutomationArgs): StreamPreviewAutomationResolution {
  if (!isScreenSharing) {
    return {
      action: "none",
      nextAutomationState: "idle",
    };
  }

  if (!alwaysShowPreview && isAppInactive) {
    if (!isPreviewHidden) {
      return {
        action: "hide-preview",
        nextAutomationState: "paused-for-inactive",
      };
    }

    return {
      action: "none",
      nextAutomationState: automationState,
    };
  }

  if (shouldRenderMiniPreview) {
    if (isPreviewHidden) {
      return {
        action: "show-preview",
        nextAutomationState: "shown-for-mini-preview",
      };
    }

    return {
      action: "none",
      nextAutomationState: automationState,
    };
  }

  if (automationState === "shown-for-mini-preview") {
    return {
      action: isPreviewHidden ? "none" : "restore-hidden",
      nextAutomationState: "idle",
    };
  }

  if (automationState === "paused-for-inactive") {
    return {
      action: isPreviewHidden ? "show-preview" : "none",
      nextAutomationState: "idle",
    };
  }

  return {
    action: "none",
    nextAutomationState: "idle",
  };
}
