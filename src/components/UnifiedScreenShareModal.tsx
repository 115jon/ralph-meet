import { DesktopScreenPickerModal } from "@/components/DesktopScreenPickerModal";
import { ScreenShareModal } from "@/components/ScreenShareModal";
import { isTauri } from "@/lib/platform";
import type { StartScreenShareOptions } from "@/lib/screen-share-types";

export interface UnifiedScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: StartScreenShareOptions) => void;
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
