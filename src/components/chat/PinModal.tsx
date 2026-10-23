import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import type { Message } from "@/lib/types";

import { isPlayableVideo } from "@/lib/media";
import React from "react";
import { AvatarImage } from "./AvatarImage";
import { ImageGrid } from "./ImageGrid";
import InlineEmojiText from "./InlineEmojiText";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { UserDisplayName } from "./UserDisplayName";
import VideoAttachment from "./VideoAttachment";

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message: Message | null;
  mode: "pin" | "unpin";
  channelName: string;
}

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
  const authorDisplayName = getDisplayName(message.author);
  const imageAttachments: typeof message.attachments = [];
  const videoAttachments: typeof message.attachments = [];

  for (const attachment of message.attachments ?? []) {
    if (attachment.content_type?.startsWith("image/")) {
      imageAttachments.push(attachment);
      continue;
    }
    if (isPlayableVideo(attachment.content_type)) {
      videoAttachments.push(attachment);
    }
  }

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {isPin ? "Pin It. Pin It Good." : "Unpin Message"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isPin ? (
              <InlineEmojiText
                text={`Hey, just double checking that you want to pin this message to #${channelName} for posterity and greatness?`}
              />
            ) : (
              "You sure you want to remove this pinned message?"
            )}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {/* Message preview */}
        <div className="rounded-lg border border-rm-border p-3">
          <div className="flex gap-3">
            <div className="relative flex size-10 shrink-0 items-center justify-center overflow-visible rounded-full bg-rm-tint-2 text-ui-sm font-semibold text-rm-text-secondary">
              {message.author?.avatar_url ? (
                <AvatarImage
                  src={getAuthAssetUrl(message.author.avatar_url)}
                  alt={authorDisplayName}
                  display={message.author.avatar_display}
                />
              ) : (
                getDisplayInitial(message.author)
              )}
            </div>
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                <UserDisplayName
                  user={message.author}
                  className="block truncate text-ui-sm font-semibold text-rm-text"
                />
                <span className="text-ui-2xs font-medium text-rm-text-muted">
                  {new Date(message.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="text-ui-sm leading-relaxed wrap-break-word text-rm-text-secondary">
                <MarkdownRenderer content={message.content} />
                {message.updated_at && (
                  <span className="ml-1 text-ui-2xs text-rm-text-muted">
                    (edited)
                  </span>
                )}
              </div>
            </div>
          </div>

          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-3 space-y-2 pl-13">
              {imageAttachments.length > 0 && (
                <ImageGrid
                  attachments={imageAttachments}
                  username={message.author?.username}
                  displayName={message.author?.display_name}
                  avatarUrl={message.author?.avatar_url}
                  avatarDisplay={message.author?.avatar_display}
                  createdAt={message.created_at}
                />
              )}
              {videoAttachments.map((att) => (
                <VideoAttachment
                  key={att.id}
                  src={att.url || `/api/${att.file_key}`}
                  filename={att.filename}
                  maxWidth={350}
                  maxHeight={200}
                />
              ))}
            </div>
          )}
        </div>

        {!isPin && (
          <p className="text-ui-xs text-rm-text-secondary">
            Protip: you can hold down{" "}
            <span className="font-semibold text-rm-text">shift</span> when
            clicking{" "}
            <span className="font-semibold text-rm-text">unpin message</span> to
            bypass this confirmation entirely.
          </p>
        )}

        <ResponsiveDialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isPin ? "default" : "destructive"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {isPin ? "Oh yeah. Pin it" : "Remove it please!"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
