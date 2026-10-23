/**
 * Camera settings before (or while) you are on video: a centred dialog on
 * desktop, a bottom drawer on phones, with the Studio camera rows as the body.
 *
 *   <CameraSettingsModal isOpen onClose={close}
 *     isCameraActive={on} onToggleCamera={toggle} settingsUserId={id} />
 */

import CameraCard from "@/components/chat/settings/CameraCard";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type React from "react";

interface CameraSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isCameraActive?: boolean;
  onToggleCamera?: () => void;
  settingsUserId?: string;
}

export const CameraSettingsModal: React.FC<CameraSettingsModalProps> = ({
  isOpen,
  onClose,
  isCameraActive = false,
  onToggleCamera,
  settingsUserId,
}) => {
  const turnOn = () => {
    onToggleCamera?.();
    onClose();
  };
  const canTurnOn = !isCameraActive && Boolean(onToggleCamera);

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ResponsiveDialogContent
        showCloseButton={false}
        className="gap-0"
        dialogClassName="flex max-h-[min(760px,calc(100dvh-32px))] flex-col p-0 md:max-w-lg"
        drawerClassName="px-0"
      >
        <ResponsiveDialogHeader className="relative shrink-0 px-4 pb-2 pt-5 md:px-6 md:pr-14">
          <ResponsiveDialogTitle className="text-ui-lg font-semibold text-rm-text">
            Camera
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-ui-sm text-rm-text-secondary">
            Pick a camera and background. Changes save as you go.
          </ResponsiveDialogDescription>
          <ResponsiveDialogClose asChild>
            <IconButton
              aria-label="Close camera settings"
              icon="close"
              size="sm"
              className="absolute right-4 top-4 max-md:hidden"
            />
          </ResponsiveDialogClose>
        </ResponsiveDialogHeader>

        {/* Only mounted while open, so the preview never runs hidden. */}
        <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain md:px-2">
          {isOpen ? (
            <CameraCard
              settingsUserId={settingsUserId ?? null}
              autoPreview
              bare
            />
          ) : null}
        </div>

        <ResponsiveDialogFooter className="shrink-0 border-t border-rm-border px-4 pt-3 pb-[max(16px,var(--safe-area-bottom,0px))] md:px-6 md:pb-5">
          {canTurnOn ? (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                Not now
              </Button>
              <Button type="button" onClick={turnOn}>
                Turn on camera
              </Button>
            </>
          ) : (
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
