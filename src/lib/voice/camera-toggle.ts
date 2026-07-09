export interface VoiceCameraToggleOptions {
  hasCamera: boolean;
  isCameraActive: boolean;
  alwaysPreviewVideo?: boolean;
  onToggleCamera?: (() => void | Promise<void>) | null;
  onOpenPreviewModal: () => void;
  beforeOpenPreviewModal?: (() => void | Promise<void>) | null;
}

export async function handleVoiceCameraToggle({
  hasCamera,
  isCameraActive,
  alwaysPreviewVideo,
  onToggleCamera,
  onOpenPreviewModal,
  beforeOpenPreviewModal,
}: VoiceCameraToggleOptions) {
  if (!hasCamera) return;

  if (isCameraActive || alwaysPreviewVideo === false) {
    await Promise.resolve(onToggleCamera?.());
    return;
  }

  await Promise.resolve(beforeOpenPreviewModal?.());
  onOpenPreviewModal();
}
