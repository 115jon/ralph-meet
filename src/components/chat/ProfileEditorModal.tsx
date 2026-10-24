/**
 * The profile editor dialog: one frame for both ways in (Settings → Account →
 * Edit profile, and the user panel). Workbench size on desktop (12.8), a
 * full-screen page with safe areas on phones (13.1). The editor renders its
 * own header (with the close button, in every state) and footer.
 */

import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useUser } from "@kova/react";
import SettingsAccountTab, {
  type ProfileEditorDraft,
} from "./SettingsAccountTab";

interface ProfileEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** Opened over the settings dialog: scrim and surface move to z-60. */
  stacked?: boolean;
  /** Defaults to the Kova user hook's loaded flag. */
  authUserLoaded?: boolean;
  /** Fixtures and tests only: start with a dirty draft. */
  initialDraft?: ProfileEditorDraft;
  /** Fixtures and tests only: start with a failed-save message. */
  initialError?: string;
}

export const PROFILE_EDITOR_SURFACE =
  "fixed inset-0 m-0 flex h-full w-full min-h-0 flex-col overflow-hidden bg-rm-bg-primary p-0 outline-none pt-[var(--safe-area-top,0px)] md:inset-auto md:left-1/2 md:top-1/2 md:h-[min(820px,calc(100dvh-32px))] md:w-[min(1120px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border md:border-rm-border md:pt-0 md:shadow-2xl animate-in fade-in duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-150 md:zoom-in-[0.98] md:data-[state=closed]:zoom-out-[0.98]";

export default function ProfileEditorModal({
  open,
  onClose,
  stacked = false,
  authUserLoaded,
  initialDraft,
  initialError,
}: ProfileEditorModalProps) {
  const { isLoaded } = useUser();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <DialogOverlay className={stacked ? "z-60" : undefined} />
        <DialogSurface
          showCloseButton={false}
          aria-label="Edit profile"
          tabIndex={-1}
          // Land on the surface, not the close button, so nothing draws a
          // focus ring until the person presses Tab.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus?.();
          }}
          className={cn(PROFILE_EDITOR_SURFACE, stacked ? "z-60" : "z-50")}
        >
          <SettingsAccountTab
            authUserLoaded={authUserLoaded ?? isLoaded}
            onClose={onClose}
            initialDraft={initialDraft}
            initialError={initialError}
          />
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
