
import type { Message } from '@/lib/types';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

import React, { useEffect, useState } from 'react';
import { ImageGrid } from './ImageGrid';
import { MarkdownRenderer } from './MarkdownRenderer';
import VideoAttachment from './VideoAttachment';

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message: Message | null;
  mode: 'pin' | 'unpin';
  channelName: string;
}

export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  message,
  mode,
  channelName
}) => {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const timeout = setTimeout(() => setIsClosing(false), 0);
      return () => clearTimeout(timeout);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200);
  };

  if (!isOpen && !isClosing) return null;
  if (!message) return null;

  const isPin = mode === 'pin';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          isClosing ? "opacity-0" : "opacity-100"
        )}
        onClick={handleClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") handleClose(); }}
        role="presentation"
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        className={cn(
          "relative w-full max-w-[480px] rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl transition-all duration-200 overflow-hidden",
          isClosing ? "opacity-0 scale-95 translate-y-4" : "opacity-100 scale-100 translate-y-0"
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-modal-title"
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <h2 id="pin-modal-title" className="text-xl font-black text-rm-text leading-tight">
              {isPin ? "Pin It. Pin It Good." : "Unpin Message"}
            </h2>
            <button
              onClick={handleClose}
              className="text-rm-text-muted hover:text-rm-text transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <p className="text-rm-text-muted text-[14px] mb-6 leading-relaxed">
            {isPin
              ? `Hey, just double checking that you want to pin this message to #${channelName} for posterity and greatness?`
              : "You sure you want to remove this pinned message?"}
          </p>

          {/* Message Preview */}
          <div className="rounded-xl border border-rm-border bg-rm-bg-elevated/40 p-4 mb-6">
            <div className="flex gap-3 mb-2">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-primary/10 text-sm font-bold text-primary flex items-center justify-center border border-rm-border">
                {message.author?.avatar_url ? (
                  <img src={message.author.avatar_url} alt={message.author.username} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} className="object-cover" />
                ) : (
                  (message.author?.username ?? "?")[0].toUpperCase()
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[14px] text-rm-text truncate">{message.author?.username || "Unknown"}</span>
                  <span className="text-[10px] text-rm-text-muted font-medium">
                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-[14px] text-rm-text-secondary leading-relaxed break-words">
                  <MarkdownRenderer content={message.content} />
                  {message.updated_at && (
                    <span className="ml-1 text-[10px] text-rm-text-muted">(edited)</span>
                  )}
                </div>
              </div>
            </div>

            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-3 pl-[52px] space-y-2">
                {message.attachments.some(a => a.content_type?.startsWith('image/')) && (
                  <ImageGrid
                    attachments={message.attachments.filter(a => a.content_type?.startsWith('image/'))}
                    username={message.author?.username}
                    avatarUrl={message.author?.avatar_url}
                    createdAt={message.created_at}
                  />
                )}
                {message.attachments.filter(a => a.content_type?.startsWith('video/')).map((att) => (
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
              <p className="text-[11px] font-black text-primary uppercase tracking-widest mb-1.5">Protip:</p>
              <p className="text-[12px] text-rm-text-muted leading-relaxed">
                You can hold down <span className="text-rm-text-secondary font-bold bg-rm-bg-elevated px-1.5 py-0.5 rounded">shift</span> when clicking <span className="text-rm-text-secondary font-bold">unpin message</span> to bypass this confirmation entirely.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-3 rounded-xl bg-rm-bg-elevated hover:bg-rm-bg-hover text-rm-text-secondary font-bold text-[14px] transition-all outline-none"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onConfirm();
                handleClose();
              }}
              className={cn(
                "flex-1 px-4 py-3 rounded-xl font-bold text-[14px] transition-all shadow-lg",
                isPin
                  ? "bg-primary hover:brightness-110 text-primary-foreground shadow-primary/20"
                  : "bg-destructive hover:brightness-110 text-destructive-foreground shadow-destructive/20"
              )}
            >
              {isPin ? "Oh yeah. Pin it" : "Remove it please!"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
