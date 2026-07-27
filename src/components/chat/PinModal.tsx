import { getDisplayInitial, getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { Dialog, DialogPortal, DialogSurface } from "@/components/ui/dialog";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0"
          data-state={isOpen ? "open" : "closed"}
        >
          {/* Backdrop */}
          <div
            className={cn(
              "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
              "opacity-100 data-[state=closed]:opacity-0",
            )}
            onClick={onClose}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "Escape")
                onClose();
            }}
            role="presentation"
            aria-hidden="true"
          />

          {/* Modal content */}
          <DialogSurface
            showCloseButton={false}
            className={cn(
              "relative m-0 w-full max-w-[480px] overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-primary p-0 shadow-2xl outline-none transition-all duration-200",
              "opacity-100 scale-100 translate-y-0 data-[state=closed]:opacity-0 data-[state=closed]:scale-95 data-[state=closed]:translate-y-4",
            )}
            aria-labelledby="pin-modal-title"
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <h2
                  id="pin-modal-title"
                  className="text-xl font-black text-rm-text leading-tight"
                >
                  {isPin ? "Pin It. Pin It Good." : "Unpin Message"}
                </h2>
                <button
                  onClick={onClose}
                  className="text-rm-text-muted hover:text-rm-text transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="text-rm-text-muted text-[14px] mb-6 leading-relaxed">
                {isPin ? (
                  <InlineEmojiText
                    text={`Hey, just double checking that you want to pin this message to #${channelName} for posterity and greatness?`}
                  />
                ) : (
                  "You sure you want to remove this pinned message?"
                )}
              </div>

              {/* Message Preview */}
              <div className="rounded-xl border border-rm-border bg-rm-bg-elevated/40 p-4 mb-6">
                <div className="flex gap-3 mb-2">
                  <div className="relative h-10 w-10 shrink-0 overflow-visible rounded-full bg-primary/10 text-sm font-bold text-primary flex items-center justify-center border border-rm-border">
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
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <UserDisplayName
                        user={message.author}
                        className="block truncate text-[14px] font-bold text-rm-text"
                      />
                      <span className="text-[10px] text-rm-text-muted font-medium">
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="text-[14px] text-rm-text-secondary leading-relaxed wrap-break-word">
                      <MarkdownRenderer content={message.content} />
                      {message.updated_at && (
                        <span className="ml-1 text-[10px] text-rm-text-muted">
                          (edited)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {message.attachments && message.attachments.length > 0 && (
                  <div className="mt-3 pl-[52px] space-y-2">
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
                <div className="mb-6 px-1">
                  <p className="text-[11px] font-black text-primary uppercase tracking-widest mb-1.5">
                    Protip:
                  </p>
                  <p className="text-[12px] text-rm-text-muted leading-relaxed">
                    You can hold down{" "}
                    <span className="text-rm-text-secondary font-bold bg-rm-bg-elevated px-1.5 py-0.5 rounded">
                      shift
                    </span>{" "}
                    when clicking{" "}
                    <span className="text-rm-text-secondary font-bold">
                      unpin message
                    </span>{" "}
                    to bypass this confirmation entirely.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-3 rounded-xl bg-rm-bg-elevated hover:bg-rm-bg-hover text-rm-text-secondary font-bold text-[14px] transition-all outline-none"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                  className={cn(
                    "flex-1 px-4 py-3 rounded-xl font-bold text-[14px] transition-all shadow-lg",
                    isPin
                      ? "bg-primary hover:brightness-110 text-primary-foreground shadow-primary/20"
                      : "bg-destructive hover:brightness-110 text-destructive-foreground shadow-destructive/20",
                  )}
                >
                  {isPin ? "Oh yeah. Pin it" : "Remove it please!"}
                </button>
              </div>
            </div>
          </DialogSurface>
        </div>
      </DialogPortal>
    </Dialog>
  );
};
