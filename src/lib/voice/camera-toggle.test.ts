import { describe, expect, it, vi } from "vitest";
import { handleVoiceCameraToggle } from "./camera-toggle";

describe("handleVoiceCameraToggle", () => {
  it("does nothing when no camera is available", async () => {
    const onToggleCamera = vi.fn();
    const onOpenPreviewModal = vi.fn();

    await handleVoiceCameraToggle({
      hasCamera: false,
      isCameraActive: false,
      onToggleCamera,
      onOpenPreviewModal,
    });

    expect(onToggleCamera).not.toHaveBeenCalled();
    expect(onOpenPreviewModal).not.toHaveBeenCalled();
  });

  it("toggles the camera directly when it is already active", async () => {
    const onToggleCamera = vi.fn();
    const onOpenPreviewModal = vi.fn();

    await handleVoiceCameraToggle({
      hasCamera: true,
      isCameraActive: true,
      alwaysPreviewVideo: true,
      onToggleCamera,
      onOpenPreviewModal,
    });

    expect(onToggleCamera).toHaveBeenCalledTimes(1);
    expect(onOpenPreviewModal).not.toHaveBeenCalled();
  });

  it("toggles the camera directly when preview is disabled", async () => {
    const onToggleCamera = vi.fn();
    const onOpenPreviewModal = vi.fn();

    await handleVoiceCameraToggle({
      hasCamera: true,
      isCameraActive: false,
      alwaysPreviewVideo: false,
      onToggleCamera,
      onOpenPreviewModal,
    });

    expect(onToggleCamera).toHaveBeenCalledTimes(1);
    expect(onOpenPreviewModal).not.toHaveBeenCalled();
  });

  it("opens the preview modal when preview is enabled", async () => {
    const beforeOpenPreviewModal = vi.fn();
    const onToggleCamera = vi.fn();
    const onOpenPreviewModal = vi.fn();

    await handleVoiceCameraToggle({
      hasCamera: true,
      isCameraActive: false,
      alwaysPreviewVideo: true,
      beforeOpenPreviewModal,
      onToggleCamera,
      onOpenPreviewModal,
    });

    expect(beforeOpenPreviewModal).toHaveBeenCalledTimes(1);
    expect(onToggleCamera).not.toHaveBeenCalled();
    expect(onOpenPreviewModal).toHaveBeenCalledTimes(1);
  });
});
