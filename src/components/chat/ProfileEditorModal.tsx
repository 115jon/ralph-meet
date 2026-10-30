/**
 * The profile editor dialog: one frame for both ways in (Settings → Account →
 * Edit profile, and the user panel). The settings workbench shell on desktop
 * (WORKBENCH_SURFACE, 1120 x 820), a full-screen page with safe areas on
 * phones. The editor renders its own header (with the close button, in
 * every state) and the shared unsaved bar. Closing while the draft is dirty
 * nudges the bar instead of dropping the draft.
 */

import { WORKBENCH_SURFACE } from "@/components/chat/settings/SettingsWorkbench";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useUser } from "@kova/react";
import { useCallback, useRef } from "react";
import SettingsAccountTab, {
  type ProfileEditorDraft,
} from "./SettingsAccountTab";

interface ProfileEditorModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * @deprecated Stacking over another modal layer is automatic now; kept
   * for existing callers.
   */
  stacked?: boolean;
  /** Defaults to the Kova user hook's loaded flag. */
  authUserLoaded?: boolean;
  /** Fixtures and tests only: start with a dirty draft. */
  initialDraft?: ProfileEditorDraft;
  /** Fixtures and tests only: start with a failed-save message. */
  initialError?: string;
}

export default function ProfileEditorModal({
  open,
  onClose,
  authUserLoaded,
  initialDraft,
  initialError,
}: ProfileEditorModalProps) {
  const { isLoaded } = useUser();
  const closeGuard = useRef<(() => boolean) | null>(null);
  const requestClose = useCallback(() => {
    if (closeGuard.current?.()) return;
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogSurface
          showCloseButton={false}
          aria-label="Edit profile"
          tabIndex={-1}
          // Land on the surface, not the close button, so nothing draws a
          // focus ring until the person presses Tab.
          initialFocus="surface"
          className={cn(
            WORKBENCH_SURFACE,
            "z-50 flex-col max-md:pt-[var(--safe-area-top,0px)]",
          )}
        >
          <SettingsAccountTab
            authUserLoaded={authUserLoaded ?? isLoaded}
            onClose={requestClose}
            initialDraft={initialDraft}
            initialError={initialError}
            closeGuard={closeGuard}
          />
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
