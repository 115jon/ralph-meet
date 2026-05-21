import { isTauri } from "@/lib/platform";
import type { StartScreenShareOptions } from "@/lib/screen-share-types";
import { lazy, Suspense } from "react";

export interface UnifiedScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: StartScreenShareOptions) => void;
  availableQualities: string[];
}

const DesktopScreenPickerModal = lazy(() =>
  import("@/components/DesktopScreenPickerModal").then((mod) => ({ default: mod.DesktopScreenPickerModal }))
);
const ScreenShareModal = lazy(() =>
  import("@/components/ScreenShareModal").then((mod) => ({ default: mod.ScreenShareModal }))
);

export function UnifiedScreenShareModal({
  isOpen,
  onClose,
  onStart,
  availableQualities,
}: UnifiedScreenShareModalProps) {
  if (!isOpen) return null;

  if (isTauri()) {
    return (
      <Suspense fallback={null}>
        <DesktopScreenPickerModal
          isOpen={isOpen}
          onClose={onClose}
          onStart={onStart}
          availableQualities={availableQualities}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <ScreenShareModal
        isOpen={isOpen}
        onClose={onClose}
        onStart={onStart}
        availableQualities={availableQualities}
      />
    </Suspense>
  );
}
