/**
 * Camera settings before (or while) you are on video: a dialog on desktop, a
 * bottom drawer on phones, with the Studio camera rows as the body. The
 * dialog primitive owns the header close.
 *
 *   <CameraSettingsModal isOpen onClose={close}
 *     isCameraActive={on} onToggleCamera={toggle} settingsUserId={id} />
 *
 * With no camera, or with camera access refused, "Turn on camera" stays
 * visible but disabled, with the reason under the footer.
 */

import CameraCard from "@/components/chat/settings/CameraCard";
import { useDeviceAccess } from "@/components/chat/settings/useDeviceAccess";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type React from "react";
import { useEffect, useId, useState } from "react";

interface CameraSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isCameraActive?: boolean;
  onToggleCamera?: () => void;
  settingsUserId?: string;
}

/** The browser's camera permission, watched for changes ("denied" or not). */
function useCameraPermissionDenied() {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return undefined;
    const permissions = navigator.permissions;
    if (!permissions?.query) return undefined;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const sync = () => {
      if (!cancelled && status) setDenied(status.state === "denied");
    };
    permissions
      .query({ name: "camera" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        status = result;
        sync();
        result.addEventListener?.("change", sync);
      })
      // Some runtimes don't expose the camera permission; assume allowed.
      .catch(() => {});
    return () => {
      cancelled = true;
      status?.removeEventListener?.("change", sync);
    };
  }, []);
  return denied;
}

/** Why the camera can't be turned on right now, or null. */
function useCameraBlocker() {
  const { status } = useDeviceAccess("videoinput");
  const denied = useCameraPermissionDenied();
  if (status === "none") return "Connect a camera first";
  if (denied) return "Allow camera access first";
  return null;
}

/**
 * Not now + Turn on camera. Its own component so the device scan and the
 * permission watch run only while the dialog content is mounted (open).
 */
function TurnOnFooter({
  onClose,
  onTurnOn,
}: {
  onClose: () => void;
  onTurnOn: () => void;
}) {
  const reasonId = useId();
  const blocker = useCameraBlocker();
  return (
    <>
      <ResponsiveDialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Not now
        </Button>
        <Button
          type="button"
          onClick={onTurnOn}
          disabled={Boolean(blocker)}
          aria-describedby={blocker ? reasonId : undefined}
        >
          Turn on camera
        </Button>
      </ResponsiveDialogFooter>
      {blocker ? (
        <p
          id={reasonId}
          className="mt-2 text-ui-xs text-ink-3 max-md:text-center md:text-end"
        >
          {blocker}
        </p>
      ) : null}
    </>
  );
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
  const offersTurnOn = !isCameraActive && Boolean(onToggleCamera);

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ResponsiveDialogContent
        size="lg"
        placement="top"
        className="gap-0"
        dialogClassName="flex flex-col p-0"
        drawerClassName="px-0"
      >
        <ResponsiveDialogHeader className="shrink-0 px-4 pb-3 md:px-5 md:pt-5">
          <ResponsiveDialogTitle>Camera</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Pick a camera and background. Changes save as you go.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {/* Only mounted while open, so the preview never runs hidden. */}
        <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line md:px-1">
          {isOpen ? (
            <CameraCard
              settingsUserId={settingsUserId ?? null}
              autoPreview
              bare
            />
          ) : null}
        </div>

        <div className="shrink-0 border-t border-line px-4 pt-3 pb-[max(16px,var(--safe-area-bottom,0px))] md:px-5 md:pt-4 md:pb-5">
          {offersTurnOn ? (
            <TurnOnFooter onClose={onClose} onTurnOn={turnOn} />
          ) : (
            <ResponsiveDialogFooter>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </ResponsiveDialogFooter>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
