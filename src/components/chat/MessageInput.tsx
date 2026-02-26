"use client";

import type { Message } from "@/lib/types";
import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import AttachmentList from "./AttachmentList";
import EmojiPicker from "./EmojiPicker";
import { Gift, Smile, Sticker, X } from "./Icons";

interface UploadedFile {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  size: number;
}

interface PendingUpload {
  tempId: string;
  file: File;
  progress: number;
  previewUrl?: string;
  abortController: AbortController;
}

export interface UploadedFileInfo {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  size: number;
}

interface Props {
  channelId: string;
  channelName: string;
  onSend: (content: string, replyToId?: string, attachmentIds?: string[], uploadedFiles?: UploadedFileInfo[]) => void;
  onTyping: () => void;
  replyTo?: Message | null;
  onCancelReply?: () => void;
}

export default function MessageInput({ channelId, channelName, onSend, onTyping, replyTo, onCancelReply }: Props) {
  const [value, setValue] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  const handleFileUploadRef = useRef<((files: FileList | File[]) => void) | null>(null);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);

      // Auto-resize textarea
      const ta = textareaRef.current;
      if (ta) {
        ta.style.height = "32px";
        ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
      }

      // Throttled typing indicator (once every 3s)
      const now = Date.now();
      if (now - lastTypingRef.current > 3000) {
        lastTypingRef.current = now;
        onTyping();
      }
    },
    [onTyping]
  );

  const doSend = useCallback(() => {
    const hasContent = value.trim();
    const hasFiles = uploadedFiles.length > 0;
    if (hasContent || hasFiles) {
      const attachmentIds = uploadedFiles.length > 0 ? uploadedFiles.map(f => f.id) : undefined;
      const fileInfos = uploadedFiles.length > 0 ? uploadedFiles : undefined;
      onSend(value.trim() || (hasFiles ? " " : ""), replyTo?.id, attachmentIds, fileInfos);
      setValue("");
      setUploadedFiles([]);
      lastTypingRef.current = 0; // Reset typing throttle
      if (textareaRef.current) {
        textareaRef.current.style.height = "32px";
      }
    }
  }, [value, onSend, replyTo, uploadedFiles]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape" && replyTo) {
        e.preventDefault();
        onCancelReply?.();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    },
    [doSend, replyTo, onCancelReply]
  );

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    const filesArray = Array.from(files);

    for (const file of filesArray) {
      // Max 25MB
      if (file.size > 25 * 1024 * 1024) {
        alert(`File "${file.name}" is too large (max 25MB)`);
        continue;
      }

      const tempId = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      const abortController = new AbortController();

      const pending: PendingUpload = { tempId, file, progress: 0, previewUrl, abortController };
      setPendingUploads(prev => [...prev, pending]);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`/api/channels/${channelId}/messages/upload`, {
          method: "POST",
          body: formData,
          signal: abortController.signal,
        });

        if (!res.ok) throw new Error("Upload failed");

        const data = await res.json() as {
          id: string;
          file_url: string;
          file_name: string;
          file_size: number;
          content_type: string;
        };

        setUploadedFiles(prev => [...prev, {
          id: data.id,
          url: data.file_url,
          filename: data.file_name,
          content_type: data.content_type,
          size: data.file_size,
        }]);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Upload failed:", err);
        }
      } finally {
        setPendingUploads(prev => prev.filter(p => p.tempId !== tempId));
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      }
    }
  }, [channelId]);

  // Keep ref in sync for event handler
  handleFileUploadRef.current = handleFileUpload;

  // Listen for drag-and-drop events from ChatArea
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail as FileList;
      handleFileUploadRef.current?.(files);
    };
    window.addEventListener('drop-files', handler);
    return () => window.removeEventListener('drop-files', handler);
  }, []);

  // Autofocus when replying
  useEffect(() => {
    if (replyTo) {
      textareaRef.current?.focus();
    }
  }, [replyTo]);

  const cancelUpload = useCallback((tempId: string) => {
    setPendingUploads(prev => {
      const item = prev.find(p => p.tempId === tempId);
      if (item) {
        item.abortController.abort();
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter(p => p.tempId !== tempId);
    });
  }, []);

  const removeUploadedFile = useCallback((id: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleFileUpload(e.clipboardData.files);
    }
  }, [handleFileUpload]);

  const hasAttachments = uploadedFiles.length > 0 || pendingUploads.length > 0;

  return (
    <div className="z-10 px-4 pb-6 pt-0">
      <div
        className="group flex flex-col rounded-xl bg-rm-bg-elevated shadow-sm transition-all duration-300 border border-white/5"
      >
        {/* Reply indicator */}
        {replyTo && (
          <div className="flex animate-in slide-in-from-bottom-2 items-center justify-between rounded-t-2xl border-b border-rm-border bg-primary/5 px-4 py-2 duration-200">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-widest text-primary">
                Replying to
              </span>
              <div className="flex items-center gap-1.5 overflow-hidden">
                <div className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-[8px] font-bold text-rm-text-muted border border-rm-border">
                  {replyTo.author?.avatar_url ? (
                    <div className="relative h-full w-full">
                      <NextImage
                        src={replyTo.author.avatar_url}
                        alt=""
                        fill
                        className="h-full w-full object-cover"
                        unoptimized={replyTo.author.avatar_url.startsWith('data:')}
                      />
                    </div>
                  ) : (
                    (replyTo.author?.username ?? "?")[0].toUpperCase()
                  )}
                </div>
                <span className="whitespace-nowrap text-[12px] font-bold text-primary">
                  {replyTo.author?.username ?? "Unknown"}
                </span>
              </div>
              <span className="truncate text-[12px] font-medium text-rm-text-muted ml-1">
                {replyTo.content}
              </span>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              className="rounded-lg p-1 text-rm-text-muted transition-all hover:bg-rm-bg-hover hover:text-rm-text-secondary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Attachment previews */}
        <AttachmentList
          uploadedFiles={uploadedFiles}
          pendingUploads={pendingUploads}
          onRemove={removeUploadedFile}
          onCancel={cancelUpload}
        />

        <div className="flex items-center px-4 py-2.5">
          {/* Hidden file input */}
          <input
            type="file"
            multiple
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files) handleFileUpload(e.target.files);
              e.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group/plus mr-4 flex h-6 w-6 shrink-0 items-center justify-center transition-all"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full text-[20px] font-medium text-rm-text-muted transition-colors group-hover/plus:text-rm-text pb-0.5 bg-rm-bg-primary/50 group-hover/plus:bg-rm-text-muted/20">
              +
            </div>
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={replyTo ? `Reply to ${replyTo.author?.username ?? "message"}…` : `Message #${channelName}`}
            className="custom-scrollbar flex-1 resize-none overflow-y-auto bg-transparent py-1 text-[15px] font-medium text-rm-text outline-none placeholder:text-rm-text-muted/60"
            data-gramm="false"
            autoComplete="off"
            spellCheck="false"
          />

          <div className="ml-2 flex items-center gap-4 text-rm-text-muted">
            <Gift className="h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary" />
            <Sticker className="h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary" />
            <div className="relative">
              <Smile
                className="h-5 w-5 cursor-pointer transition-all hover:scale-110 hover:text-primary"
                onClick={() => setShowEmoji(!showEmoji)}
              />
              {showEmoji && (
                <EmojiPicker
                  onSelect={(emoji) => {
                    setValue((prev) => prev + emoji);
                    textareaRef.current?.focus();
                  }}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
