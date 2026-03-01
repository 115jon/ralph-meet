import { apiUpload } from "@/lib/api-client";
import type { Message, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatState } from "@/stores/chat-store";

import { useCallback, useEffect, useRef, useState } from "react";
import AttachmentList from "./AttachmentList";
import EmojiPicker from "./EmojiPicker";
import { Gift, Smile, Sticker, X } from "./Icons";
import { InputMentionOverlay } from "./InputMentionOverlay";

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
  const twinRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  const handleFileUploadRef = useRef<((files: FileList | File[]) => void) | null>(null);

  const state = useChatState();

  // Sync scroll between textarea and twin div
  const handleScroll = useCallback(() => {
    if (textareaRef.current && twinRef.current) {
      twinRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // Set twin div height
  const syncHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "32px";
      const newHeight = Math.min(ta.scrollHeight, 200);
      ta.style.height = newHeight + "px";
      if (twinRef.current) {
        twinRef.current.style.height = newHeight + "px";
      }
    }
  }, []);

  // Autocomplete state
  const [mentionQuery, setMentionQuery] = useState<{ text: string; startPos: number; endPos: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Mention Tooltip state
  const [hoveredMention, setHoveredMention] = useState<string | null>(null);
  const [mentionTooltipPos, setMentionTooltipPos] = useState({ left: 0, top: 0 });

  const hoveredMember = hoveredMention
    ? state.members.find(m => m.user.username.toLowerCase() === hoveredMention.toLowerCase())
    : null;

  // Filter members based on query
  const mentionCandidates = mentionQuery
    ? state.members
      .map((m) => m.user)
      .filter((u) => u.username.toLowerCase().includes(mentionQuery.text.toLowerCase()))
      .slice(0, 5)
    : [];

  const updateMentionQuery = useCallback((textValue: string, selectionStart: number) => {
    // Look backwards from cursor to find a @
    const textBeforeCursor = textValue.slice(0, selectionStart);
    const lastAtPos = textBeforeCursor.lastIndexOf("@");

    if (lastAtPos !== -1) {
      // Must be at start of string or preceded by whitespace
      if (lastAtPos === 0 || /\s/.test(textBeforeCursor[lastAtPos - 1])) {
        const queryText = textBeforeCursor.slice(lastAtPos + 1);
        // If there's no space in the query, it's valid
        if (!/\s/.test(queryText)) {
          setMentionQuery({ text: queryText, startPos: lastAtPos, endPos: selectionStart });
          setMentionIndex(0);
          return;
        }
      }
    }
    setMentionQuery(null);
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);

      // Auto-resize textarea
      syncHeight();

      // Throttled typing indicator (once every 3s)
      const now = Date.now();
      if (now - lastTypingRef.current > 3000) {
        lastTypingRef.current = now;
        onTyping();
      }

      updateMentionQuery(e.target.value, e.target.selectionStart);
    },
    [onTyping, updateMentionQuery, syncHeight]
  );

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current;
    if (!ta) return;

    ta.style.setProperty("pointer-events", "none", "important");
    const el = document.elementFromPoint(e.clientX, e.clientY);
    ta.style.removeProperty("pointer-events");

    if (el && el.hasAttribute("data-mention")) {
      const username = el.getAttribute("data-mention");
      if (username) {
        setHoveredMention(username);
        const rect = el.getBoundingClientRect();
        setMentionTooltipPos({
          left: rect.left + rect.width / 2,
          top: rect.top,
        });
        return;
      }
    }
    setHoveredMention(null);
  }, []);

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
      setMentionQuery(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "32px";
      }
      if (twinRef.current) {
        twinRef.current.style.height = "32px";
      }
    }
  }, [value, onSend, replyTo, uploadedFiles]);

  const getValidMentions = useCallback(() => {
    const regex = /@([a-zA-Z0-9_]+)/g;
    const mentions: { start: number; end: number; username: string }[] = [];
    let match;
    while ((match = regex.exec(value)) !== null) {
      const username = match[1];
      const isMember = state.members.some(
        (m) => m.user.username.toLowerCase() === username.toLowerCase()
      );
      if (isMember) {
        mentions.push({ start: match.index, end: match.index + match[0].length, username });
      }
    }
    return mentions;
  }, [value, state.members]);

  const enforceAtomicMentions = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    let newStart = start;
    let newEnd = end;
    let changed = false;

    for (const m of getValidMentions()) {
      if (start > m.start && start <= m.end && start === end) {
        // Simple cursor inside mention, snap to nearest boundary
        const middle = m.start + (m.end - m.start) / 2;
        if (start < middle) {
          newStart = m.start;
          newEnd = m.start;
        } else {
          newStart = (value[m.end] === " ") ? m.end + 1 : m.end;
          newEnd = newStart;
        }
        changed = true;
      } else if (start > m.start && start < m.end) {
        // Selection starts inside mention
        newStart = m.start;
        changed = true;
      }

      if (end > m.start && end < m.end) {
        // Selection ends inside mention
        const newPos = (value[m.end] === " ") ? m.end + 1 : m.end;
        newEnd = newPos;
        changed = true;
      }
    }

    if (changed) {
      ta.setSelectionRange(newStart, newEnd);
    }
  }, [getValidMentions, value]);

  const insertMention = useCallback((user: User) => {
    if (!mentionQuery || !textareaRef.current) return;

    const ta = textareaRef.current;

    // Calculate what exactly we want to insert and replace
    const insertText = `@${user.username} `;

    // We want to replace everything from startPos to endPos with insertText.
    ta.focus();
    ta.setSelectionRange(mentionQuery.startPos, mentionQuery.endPos);

    // Use execCommand to insert text so it registers in the browser's undo stack
    // execCommand is widely supported in modern browsers for simple text insertion in standard textareas
    document.execCommand("insertText", false, insertText);

    setMentionQuery(null);
  }, [mentionQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current;

      // Handle atomic mention navigation skipping
      if (e.key === "ArrowLeft" && ta) {
        const cursor = ta.selectionStart;
        if (cursor === ta.selectionEnd) {
          const m = getValidMentions().find(
            (m) => cursor === m.end || (cursor === m.end + 1 && value[m.end] === " ")
          );
          if (m) {
            e.preventDefault();
            ta.setSelectionRange(m.start, m.start);
            return;
          }
        }
      }

      if (e.key === "ArrowRight" && ta) {
        const cursor = ta.selectionStart;
        if (cursor === ta.selectionEnd) {
          const m = getValidMentions().find((m) => cursor === m.start);
          if (m) {
            e.preventDefault();
            const newPos = (value[m.end] === " ") ? m.end + 1 : m.end;
            ta.setSelectionRange(newPos, newPos);
            return;
          }
        }
      }

      // Handle atomic mention deletion
      if (e.key === "Backspace" && ta) {
        const cursor = ta.selectionStart;
        if (cursor === ta.selectionEnd && cursor > 0) {
          // Check if cursor is immediately after a mention, or after a space following a mention
          const mentions = getValidMentions();
          const m = mentions.find(m => cursor === m.end || (cursor === m.end + 1 && value[m.end] === " "));

          if (m) {
            e.preventDefault();
            ta.setSelectionRange(m.start, cursor);
            document.execCommand("insertText", false, "");
            setMentionQuery(null);
            return;
          }
        }
      }

      if (mentionQuery && mentionCandidates.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % mentionCandidates.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(mentionCandidates[mentionIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMentionQuery(null);
          return;
        }
      }

      if (e.key === "Escape" && replyTo) {
        e.preventDefault();
        onCancelReply?.();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
        return;
      }
      // ↑ Arrow on empty input → edit last own message (Discord behavior)
      if (e.key === "ArrowUp" && !value.trim()) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("edit-last-message"));
      }
    },
    [doSend, replyTo, onCancelReply, value, mentionQuery, mentionCandidates, mentionIndex, insertMention]
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

        const data = await apiUpload<{
          id: string;
          file_url: string;
          file_name: string;
          file_size: number;
          content_type: string;
        }>(`/api/channels/${channelId}/messages/upload`, formData, {
          signal: abortController.signal,
        });

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

  // Initial sync
  useEffect(() => {
    syncHeight();
  }, [syncHeight]);

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
                      <img
                        src={replyTo.author.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
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

        {/* Mention Autocomplete Popover */}
        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="absolute bottom-[calc(100%+8px)] left-0 w-64 rounded-lg bg-rm-bg-elevated border border-rm-border shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="px-3 py-2 bg-rm-bg-surface border-b border-rm-border/50">
              <span className="text-xs font-semibold text-rm-text-primary uppercase tracking-wider">
                Members
              </span>
            </div>
            <div className="py-1">
              {mentionCandidates.map((user, i) => (
                <button
                  key={user.id}
                  onClick={() => insertMention(user)}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 transition-colors",
                    i === mentionIndex ? "bg-indigo-500/10" : "hover:bg-rm-bg-hover"
                  )}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-[10px] font-bold text-rm-text-muted border border-rm-border">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (user.username ?? "?")[0].toUpperCase()
                    )}
                  </div>
                  <span className={cn(
                    "text-[13px] font-medium truncate",
                    i === mentionIndex ? "text-indigo-400" : "text-rm-text-primary"
                  )}>
                    {user.username}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hover Tooltip for Input Mentions */}
        {hoveredMember && (
          <div
            className="fixed flex flex-col items-center animate-in fade-in zoom-in-95 duration-100 z-[100] pointer-events-none"
            style={{
              left: mentionTooltipPos.left,
              top: mentionTooltipPos.top - 4,
              transform: "translate(-50%, -100%)"
            }}
          >
            <div className="flex items-center gap-2 rounded-lg bg-rm-bg-elevated border border-rm-border px-3 py-1.5 shadow-xl min-w-max">
              <div className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-surface text-[8px] font-bold text-rm-text-muted border border-rm-border">
                {hoveredMember.user.avatar_url ? (
                  <img
                    src={hoveredMember.user.avatar_url}
                    alt=""
                    className="object-cover"
                  />
                ) : (
                  hoveredMember.user.username[0].toUpperCase()
                )}
              </div>
              <span className="text-xs font-semibold text-rm-text-primary">
                {hoveredMember.user.username}
              </span>
            </div>
            <div className="h-1.5 w-3 -mt-[1px]">
              <svg viewBox="0 0 12 6" className="fill-rm-bg-elevated stroke-rm-border drop-shadow-sm h-full w-full">
                <path d="M0 0l6 6 6-6H0z" />
              </svg>
            </div>
          </div>
        )}

        {/* Attachment previews */}
        <AttachmentList
          uploadedFiles={uploadedFiles}
          pendingUploads={pendingUploads}
          onRemove={removeUploadedFile}
          onCancel={cancelUpload}
        />

        <div className="flex items-start px-4 py-2.5">
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
            className="group/plus mr-4 mt-[3px] flex h-6 w-6 shrink-0 items-center justify-center transition-all"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full text-[20px] font-medium text-rm-text-muted transition-colors group-hover/plus:text-rm-text pb-0.5 bg-rm-bg-primary/50 group-hover/plus:bg-rm-text-muted/20">
              +
            </div>
          </button>

          <div className="relative flex-1 min-h-[32px] overflow-hidden">
            {/* The twin div perfectly mirrors the textarea but renders mentions and all text */}
            {!mentionQuery && (
              <div
                ref={twinRef}
                aria-hidden="true"
                className="absolute inset-0 z-0 whitespace-pre-wrap break-words py-1 text-[15px] font-medium leading-normal text-rm-text overflow-y-hidden pointer-events-none custom-scrollbar"
              >
                <InputMentionOverlay text={value} />
              </div>
            )}

            {/* Foreground Transparent Textarea */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onScroll={handleScroll}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoveredMention(null)}
              onSelect={enforceAtomicMentions}
              onClick={enforceAtomicMentions}
              placeholder={replyTo ? `Reply to ${replyTo.author?.username ?? "message"}…` : `Message #${channelName}`}
              className={cn(
                "custom-scrollbar relative z-10 w-full resize-none overflow-y-auto py-1 text-[15px] font-medium leading-normal outline-none placeholder:text-rm-text-muted/60",
                !mentionQuery ? "text-transparent bg-transparent" : "text-rm-text bg-transparent"
              )}
              style={{
                caretColor: "rgba(226, 232, 240, 0.9)" // text-slate-200 roughly
              }}
              data-gramm="false"
              autoComplete="off"
              spellCheck="false"
            />
          </div>

          <div className="ml-2 mt-[4px] flex items-center gap-4 text-rm-text-muted">
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
