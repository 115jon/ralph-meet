import { DesktopScreenPickerModal } from "@/components/DesktopScreenPickerModal";
import { ScreenShareModal } from "@/components/ScreenShareModal";
import { isTauri } from "@/lib/platform";

export interface UnifiedScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: { quality: string; withAudio: boolean; sourceId?: string }) => void;
  availableQualities: string[];
}

export function UnifiedScreenShareModal({
  isOpen,
  onClose,
  onStart,
  availableQualities,
}: UnifiedScreenShareModalProps) {
  if (isTauri()) {
    return (
      <DesktopScreenPickerModal
        isOpen={isOpen}
        onClose={onClose}
        onStart={onStart}
        availableQualities={availableQualities}
      />
    );
  }

  return (
    <ScreenShareModal
      isOpen={isOpen}
      onClose={onClose}
      onStart={onStart}
      availableQualities={availableQualities}
    />
  );
}
