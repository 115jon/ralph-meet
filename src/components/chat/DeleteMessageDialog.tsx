import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { Message } from "@/lib/types";
import { MessagePreviewCard } from "./MessagePreviewCard";

export interface DeleteMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Deletes the message. The caller closes the dialog. */
  onConfirm: () => void;
  /**
   * The message being deleted, shown as the shared compact
   * `MessagePreviewCard`. Preferred over `preview`.
   */
  message?: Message | null;
  /**
   * Legacy: a custom read-only rendering of the message, used only when
   * `message` is absent.
   */
  preview?: ReactNode;
}

/**
 * Confirm for deleting a message (irreversible, so solid `danger`). Holding
 * Shift on the delete action skips it; the caller owns that bypass. The
 * preview is inert and hidden from assistive tech; the description already
 * says what is being deleted.
 */
export function DeleteMessageDialog({
  open,
  onOpenChange,
  onConfirm,
  message,
  preview,
}: DeleteMessageDialogProps) {
  const body = message ? <MessagePreviewCard message={message} /> : preview;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent size="sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete message</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This deletes the message for everyone. You can't undo it.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {body ? (
          <div
            data-slot="delete-message-preview"
            className="max-h-[40dvh] min-h-0 overflow-y-auto overscroll-contain"
          >
            <div
              inert
              aria-hidden="true"
              className="pointer-events-none select-none"
            >
              {body}
            </div>
          </div>
        ) : null}

        <p className="text-ui-xs text-pretty text-ink-3">
          Hold <Kbd>Shift</Kbd> when you click Delete to skip this.
        </p>

        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
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
