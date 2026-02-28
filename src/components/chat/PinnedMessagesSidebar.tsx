"use client";

import { useUserResolution } from '@/hooks/useUserResolution';
import type { Message } from '@/lib/types';
import { Download, FileIcon, Loader2 } from 'lucide-react';
import NextImage from 'next/image';
import React from 'react';
import { Pin, X } from './Icons';
import { ImageGrid } from './ImageGrid';
import { MarkdownRenderer } from './MarkdownRenderer';
import VideoAttachment from './VideoAttachment';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PinnedMessagesSidebarProps {
  messages: Message[];
  isLoading: boolean;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  onUnpin: (messageId: string, skipConfirm: boolean) => void;
  canUnpin: boolean;
}

export const PinnedMessagesSidebar: React.FC<PinnedMessagesSidebarProps> = ({
  messages,
  isLoading,
  onClose,
  onJumpToMessage,
  onUnpin,
  canUnpin
}) => {
  return (
    <div className="w-[420px] max-h-[calc(100vh-120px)] rounded-2xl border border-rm-border bg-rm-bg-primary shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <header className="h-16 flex-none border-b border-rm-border flex items-center gap-3 px-6 bg-rm-bg-elevated/40 backdrop-blur-md">
        <Pin size={20} className="text-rm-text-muted rotate-45" />
        <h2 className="font-bold text-lg text-rm-text">Pinned Messages</h2>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-rm-bg-elevated hover:bg-rm-bg-hover text-rm-text-muted hover:text-rm-text transition-all outline-none"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-rm-bg-primary">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-rm-text-muted">
            <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
            <span className="text-xs font-bold uppercase tracking-widest">Loading Pins...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-4 text-center px-4">
            <div className="w-16 h-16 rounded-3xl bg-rm-bg-elevated/40 flex items-center justify-center border border-rm-border shadow-xl rotate-12">
              <Pin size={32} className="opacity-10 rotate-45 text-rm-text-muted" />
            </div>
            <div>
              <p className="text-rm-text-secondary font-bold mb-1">No pinned messages</p>
              <p className="text-[11px] text-rm-text-muted leading-relaxed">
                Pin important messages to see them here.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {messages.map((msg) => (
              <PinnedMessageItem
                key={msg.id}
                msg={msg}
                onJumpToMessage={onJumpToMessage}
                onUnpin={onUnpin}
                canUnpin={canUnpin}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PinnedMessageItem = ({ msg, onJumpToMessage, onUnpin, canUnpin }: {
  msg: Message;
  onJumpToMessage: (id: string) => void;
  onUnpin: (id: string, skipConfirm: boolean) => void;
  canUnpin: boolean;
}) => {
  const authorInfo = useUserResolution(msg.author_id, msg.author);

  return (
    <div
      className="group p-5 rounded-2xl border border-rm-border bg-rm-bg-elevated/40 hover:bg-rm-bg-elevated/80 transition-all relative overflow-hidden flex flex-col gap-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-4 min-w-0">
          <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-base font-bold text-primary border border-rm-border transition-transform group-hover:scale-105 duration-300">
            {authorInfo.avatarUrl ? (
              <div className="relative h-full w-full">
                <NextImage src={authorInfo.avatarUrl} alt="" fill className="object-cover" />
              </div>
            ) : (
              authorInfo.username[0].toUpperCase()
            )}
          </div>
          <div className="flex flex-col min-w-0 pt-0.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-[15px] text-rm-text truncate">{authorInfo.username}</span>
              <span className="text-[11px] text-rm-text-muted font-medium shrink-0">
                {new Date(msg.created_at).toLocaleDateString()}
              </span>
            </div>

            {msg.content && (
              <div className="text-[14px] text-rm-text-secondary leading-[1.4] break-words">
                <MarkdownRenderer content={msg.content} />
                {msg.updated_at && (
                  <span className="ml-1.5 text-[10px] text-rm-text-muted font-medium" title={`Edited ${new Date(msg.updated_at).toLocaleString()}`}>(edited)</span>
                )}
              </div>
            )}

            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-3 space-y-2.5">
                {/* Images first */}
                {msg.attachments.some(a => a.content_type?.startsWith('image/')) && (
                  <div className="max-w-full">
                    <ImageGrid
                      attachments={msg.attachments.filter(a => a.content_type?.startsWith('image/'))}
                      username={authorInfo.username}
                      avatarUrl={authorInfo.avatarUrl}
                      createdAt={msg.created_at}
                    />
                  </div>
                )}

                {/* Videos */}
                {msg.attachments.filter(a => a.content_type?.startsWith('video/')).map((att) => (
                  <VideoAttachment
                    key={att.id}
                    src={att.url || `/api/${att.file_key}`}
                    filename={att.filename}
                    maxWidth={280}
                    maxHeight={200}
                  />
                ))}

                {/* Other files */}
                {msg.attachments.filter(a => !a.content_type?.startsWith('image/') && !a.content_type?.startsWith('video/')).map((att) => (
                  <a
                    key={att.id}
                    href={att.url || `/api/${att.file_key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-rm-border bg-rm-bg-primary/20 px-4 py-3 transition-all hover:border-rm-border hover:bg-rm-bg-hover group/file max-w-[280px]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileIcon className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-bold text-primary group-hover/file:underline">{att.filename}</p>
                      <p className="text-[10px] text-rm-text-muted font-medium uppercase tracking-tighter">{formatFileSize(att.size_bytes)}</p>
                    </div>
                    <Download className="h-4 w-4 shrink-0 text-rm-text-muted transition-colors group-hover/file:text-rm-text-secondary" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 -translate-y-1 group-hover:translate-y-0">
          <button
            onClick={() => onJumpToMessage(msg.id)}
            className="px-4 py-1.5 bg-primary hover:brightness-110 text-primary-foreground font-bold text-[11px] rounded-lg transition-all shadow-lg shadow-primary/10"
          >
            Jump
          </button>
          {canUnpin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnpin(msg.id, e.shiftKey);
              }}
              className="p-1.5 hover:bg-destructive/10 text-rm-text-muted hover:text-destructive transition-all rounded-lg outline-none"
              title="Unpin (Shift-click to bypass confirmation)"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Decoration */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/[0.02] blur-3xl rounded-full pointer-events-none" />
    </div>
  );
};
