import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { copyToClipboard } from "@/components/ui/toast";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  getScreenShareSupport,
  type ScreenShareSupport,
} from "@/lib/screen-share-support";
import type { StartScreenShareOptions } from "@/lib/screen-share-types";
import { lazy, Suspense, useState } from "react";

export interface UnifiedScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (options: StartScreenShareOptions) => void;
  availableQualities: string[];
  /** Override detection (fixtures and tests). */
  support?: ScreenShareSupport;
}

const DesktopScreenPickerModal = lazy(() =>
  import("@/components/DesktopScreenPickerModal").then((mod) => ({
    default: mod.DesktopScreenPickerModal,
  })),
);
const ScreenShareModal = lazy(() =>
  import("@/components/ScreenShareModal").then((mod) => ({
    default: mod.ScreenShareModal,
  })),
);

const UNSUPPORTED_COPY: Record<
  Extract<ScreenShareSupport, { supported: false }>["reason"],
  string
> = {
  "mobile-app":
    "The Ralph Meet phone app can't share your screen yet. You can still watch other people's streams here. To share, use the desktop app or a browser on a computer.",
  "mobile-browser":
    "Phone and tablet browsers can't share a screen. You can still watch other people's streams here. To share, open Ralph Meet on a computer.",
  browser:
    "This browser can't share a screen. Try a recent Chrome, Edge, Firefox or Safari on a computer.",
};

export function ScreenShareUnsupportedDialog({
  isOpen,
  onClose,
  reason,
}: {
  isOpen: boolean;
  onClose: () => void;
  reason: Extract<ScreenShareSupport, { supported: false }>["reason"];
}) {
  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <span className="mb-1 flex size-10 items-center justify-center rounded-lg bg-tint-2 text-ink-2">
            <Icon name="screenShare" size="lg" />
          </span>
          <ResponsiveDialogTitle>
            Screen sharing isn&apos;t available here
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {UNSUPPORTED_COPY[reason]}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          {/* The phone app's own URL isn't a link a computer can open. */}
          {reason === "mobile-app" ? null : (
            <Button
              variant="secondary"
              onClick={() =>
                void copyToClipboard(window.location.href, "Link copied")
              }
            >
              <Icon name="link" size="sm" />
              Copy link for my computer
            </Button>
          )}
          <Button autoFocus onClick={onClose}>
            Got it
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function UnifiedScreenShareModal({
  isOpen,
  onClose,
  onStart,
  availableQualities,
  support: supportOverride,
}: UnifiedScreenShareModalProps) {
  // Capabilities do not change while the app runs: read them once.
  const [detected] = useState(() => getScreenShareSupport());
  const support = supportOverride ?? detected;

  if (!support.supported) {
    return (
      <ScreenShareUnsupportedDialog
        isOpen={isOpen}
        onClose={onClose}
        reason={support.reason}
      />
    );
  }

  if (support.picker === "desktop-app") {
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
