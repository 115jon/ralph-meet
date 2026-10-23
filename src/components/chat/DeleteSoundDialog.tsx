import { useState, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

import EmojiToken from "./EmojiToken";
import InlineEmojiText from "./InlineEmojiText";

export interface DeleteSoundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soundName: string;
  /** The sound's related emoji, shown before its name. */
  soundEmoji?: string | null;
  /**
   * Deletes the sound. May be async; the Delete button shows a spinner until
   * it settles. The caller closes the dialog.
   */
  onConfirm: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
}

/**
 * Confirm for deleting a soundboard sound (irreversible). Opened from inside
 * the soundboard picker; it portals after the picker so it paints above it,
 * and the dialog stack gives it Escape and back before the picker.
 */
export function DeleteSoundDialog({
  open,
  onOpenChange,
  soundName,
  soundEmoji,
  onConfirm,
}: DeleteSoundDialogProps) {
  const [pending, setPending] = useState(false);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete Sound</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Are you sure you want to delete this sound?
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex min-w-0 items-center justify-center gap-2 rounded-lg border border-rm-border p-3 text-ui-sm font-semibold text-rm-text">
          {soundEmoji && (
            <EmojiToken
              value={soundEmoji}
              className="size-5 shrink-0"
              fallbackClassName="text-ui-md"
            />
          )}
          <span className="min-w-0 truncate">
            <InlineEmojiText text={soundName} />
          </span>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={async (event) => {
              setPending(true);
              try {
                await onConfirm(event);
              } finally {
                setPending(false);
              }
            }}
          >
            Delete
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
