import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export interface DeleteMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Deletes the message. The caller closes the dialog. */
  onConfirm: () => void;
  /**
   * Read-only rendering of the message being deleted (MessageItem passes
   * itself with `previewOnly`). It is inert and hidden from assistive tech;
   * the description already says what is being deleted.
   */
  preview?: ReactNode;
}

/**
 * Confirm for deleting a message (irreversible). Holding Shift on the delete
 * action skips it; the caller owns that bypass.
 */
export function DeleteMessageDialog({
  open,
  onOpenChange,
  onConfirm,
  preview,
}: DeleteMessageDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete Message</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Are you sure you want to delete this message?
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {preview ? (
          <div
            data-slot="delete-message-preview"
            className="custom-scrollbar max-h-[40dvh] min-h-0 overflow-y-auto overscroll-contain rounded-lg border border-rm-border py-3"
          >
            <div
              inert
              aria-hidden="true"
              className="pointer-events-none select-none"
            >
              {preview}
            </div>
          </div>
        ) : null}

        <p className="text-ui-xs text-rm-text-secondary">
          Protip: you can hold down Shift when clicking delete message to bypass
          this confirmation entirely.
        </p>

        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
