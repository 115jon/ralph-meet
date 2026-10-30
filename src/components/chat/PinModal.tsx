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

import React from "react";
import InlineEmojiText from "./InlineEmojiText";
import { MessagePreviewCard } from "./MessagePreviewCard";

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message: Message | null;
  mode: "pin" | "unpin";
  channelName: string;
}

/**
 * Confirm for pinning or unpinning a message. Both are reversible, so the
 * confirm is the primary button for pin and the soft `destructive` tint for
 * unpin; solid `danger` is kept for irreversible deletes. Shift on the unpin
 * action skips this; the caller owns that bypass.
 */
export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  message,
  mode,
  channelName,
}) => {
  if (!message) return null;

  const isPin = mode === "pin";

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent size="sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {isPin ? "Pin message" : "Unpin message"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isPin ? (
              <InlineEmojiText
                text={`Pin this message to #${channelName}. Everyone in the channel can find it in Pinned messages.`}
              />
            ) : (
              <InlineEmojiText
                text={`Remove this message from the pins in #${channelName}.`}
              />
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div
          inert
          aria-hidden="true"
          className="pointer-events-none select-none"
        >
          <MessagePreviewCard message={message} />
        </div>

        {!isPin && (
          <p className="text-ui-xs text-pretty text-ink-3">
            Hold <Kbd>Shift</Kbd> when you click Unpin to skip this.
          </p>
        )}

        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isPin ? "primary" : "destructive"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {isPin ? "Pin" : "Unpin"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
