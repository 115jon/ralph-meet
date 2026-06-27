import { apiGet, apiPost, apiUpload } from "@/lib/api-client";
import { parseCustomEmojiToken } from "@/lib/emoji";
import type { GifPickerItem } from "@/lib/gif-picker";
import type { Message, User } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";
import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  allocateComposerCustomEmojiPlaceholder,
  expandComposerCustomEmojiPlaceholders,
  pruneComposerCustomEmojiMap,
  replaceTextRange,
  type ComposerCustomEmojiMap,
} from "./message-input-utils";

export interface UploadedFile {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  size: number;
  previewUrl?: string;
}

export interface PendingUpload {
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
  previewUrl?: string;
}

export interface MessageInputState {
  value: string;
  showEmoji: boolean;
  showGifPicker: boolean;
  uploadedFiles: UploadedFile[];
  pendingUploads: PendingUpload[];
  composerCustomEmojiMap: ComposerCustomEmojiMap;
  mentionQuery: { text: string; startPos: number; endPos: number } | null;
  mentionIndex: number;
  hoveredMention: string | null;
  mentionTooltipPos: { left: number; top: number };
}

function getGifFilenameExtension(contentType: GifPickerItem["send"]["contentType"]): string {
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "image/apng") return "apng";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/png") return "png";
  return "gif";
}

export function useMessageInput({
  channelId,
  onSend,
  onTyping,
  replyTo,
  onCancelReply,
}: {
  channelId: string;
  onSend: (content: string, replyToId?: string, attachmentIds?: string[], uploadedFiles?: UploadedFileInfo[]) => void;
  onTyping: () => void;
  replyTo?: Message | null;
  onCancelReply?: () => void;
}) {
  const [{
    value,
    showEmoji,
    showGifPicker,
    uploadedFiles,
    pendingUploads,
    composerCustomEmojiMap,
    mentionQuery,
    mentionIndex,
    hoveredMention,
    mentionTooltipPos
  }, setLocalState] = useReducer(
    (state: MessageInputState, payload: Partial<MessageInputState> | ((prev: MessageInputState) => Partial<MessageInputState>)) => {
      const updates = typeof payload === "function" ? payload(state) : payload;
      return { ...state, ...updates };
    },
    {
      value: "",
      showEmoji: false,
      showGifPicker: false,
      uploadedFiles: [] as UploadedFile[],
      pendingUploads: [] as PendingUpload[],
      composerCustomEmojiMap: {},
      mentionQuery: null,
      mentionIndex: 0,
      hoveredMention: null,
      mentionTooltipPos: { left: 0, top: 0 },
    }
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const twinRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  const handleFileUploadRef = useRef<((files: FileList | File[]) => void) | null>(null);

  const members = useChatStore(s => s.members);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && twinRef.current) {
      twinRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

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

  useEffect(() => {
    syncHeight();

    const raf1 = requestAnimationFrame(() => syncHeight());
    const raf2 = requestAnimationFrame(() => syncHeight());

    const observed = textareaRef.current?.parentElement;
    if (!observed || typeof ResizeObserver === "undefined") {
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }

    const observer = new ResizeObserver(() => {
      syncHeight();
    });

    observer.observe(observed);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      observer.disconnect();
    };
  }, [syncHeight]);

  const hoveredMember = hoveredMention
    ? members.find((m: any) => m.user.username.toLowerCase() === hoveredMention.toLowerCase())
    : null;

  const mentionCandidates = mentionQuery
    ? members
      .map((m: any) => m.user)
      .filter((u: User) => u.username.toLowerCase().includes(mentionQuery.text.toLowerCase()))
      .slice(0, 5)
    : [];

  const updateMentionQuery = useCallback((textValue: string, selectionStart: number) => {
    const textBeforeCursor = textValue.slice(0, selectionStart);
    const lastAtPos = textBeforeCursor.lastIndexOf("@");

    if (lastAtPos !== -1) {
      if (lastAtPos === 0 || /\s/.test(textBeforeCursor[lastAtPos - 1])) {
        // Don't trigger mention autocomplete if the @ is inside a URL
        const before = textValue.slice(0, lastAtPos);
        const lastSpace = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t"));
        const tokenStart = lastSpace + 1;
        const token = textValue.slice(tokenStart).split(/\s/)[0];
        if (/^https?:\/\//i.test(token)) {
          setLocalState({ mentionQuery: null });
          return;
        }

        const queryText = textBeforeCursor.slice(lastAtPos + 1);
        if (!/\s/.test(queryText)) {
          setLocalState({ mentionQuery: { text: queryText, startPos: lastAtPos, endPos: selectionStart } });
          setLocalState({ mentionIndex: 0 });
          return;
        }
      }
    }
    setLocalState({ mentionQuery: null });
  }, []);

  const applyComposerEdit = useCallback((
    replacement: string,
    options?: {
      start?: number;
      end?: number;
      nextState?: Partial<MessageInputState>;
    },
  ) => {
    const ta = textareaRef.current;
    const start = options?.start ?? ta?.selectionStart ?? value.length;
    const end = options?.end ?? ta?.selectionEnd ?? start;
    const next = replaceTextRange(value, replacement, start, end);
    const resolvedComposerCustomEmojiMap = pruneComposerCustomEmojiMap(
      next.value,
      options?.nextState?.composerCustomEmojiMap ?? composerCustomEmojiMap,
    );

    setLocalState({
      value: next.value,
      ...(options?.nextState ?? {}),
      composerCustomEmojiMap: resolvedComposerCustomEmojiMap,
    });

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.focus();
      textarea.setSelectionRange(next.cursor, next.cursor);
      syncHeight();
      updateMentionQuery(next.value, next.cursor);
    });

    return next;
  }, [composerCustomEmojiMap, syncHeight, updateMentionQuery, value]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalState({
        value: e.target.value,
        composerCustomEmojiMap: pruneComposerCustomEmojiMap(e.target.value, composerCustomEmojiMap),
      });
      syncHeight();

      const now = Date.now();
      if (now - lastTypingRef.current > 3000) {
        lastTypingRef.current = now;
        onTyping();
      }

      updateMentionQuery(e.target.value, e.target.selectionStart);
    },
    [composerCustomEmojiMap, onTyping, updateMentionQuery, syncHeight]
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
        setLocalState({ hoveredMention: username });
        const rect = el.getBoundingClientRect();
        setLocalState({
          mentionTooltipPos: {
            left: rect.left + rect.width / 2,
            top: rect.top,
          }
        });
        return;
      }
    }
    setLocalState({ hoveredMention: null });
  }, []);

  const doSend = useCallback(() => {
    const hasContent = value.trim();
    const hasFiles = uploadedFiles.length > 0;
    if (hasContent || hasFiles) {
      const attachmentIds = uploadedFiles.length > 0 ? uploadedFiles.map(f => f.id) : undefined;
      const fileInfos = uploadedFiles.length > 0 ? uploadedFiles : undefined;
      const content = value.trim() || (hasFiles ? " " : "");
      onSend(
        expandComposerCustomEmojiPlaceholders(content, composerCustomEmojiMap),
        replyTo?.id,
        attachmentIds,
        fileInfos,
      );
      setLocalState({ value: "" });
      uploadedFiles.forEach(f => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
      setLocalState({ uploadedFiles: [] });
      setLocalState({ composerCustomEmojiMap: {} });
      lastTypingRef.current = 0;
      setLocalState({ mentionQuery: null });
      if (textareaRef.current) {
        textareaRef.current.style.height = "32px";
      }
      if (twinRef.current) {
        twinRef.current.style.height = "32px";
      }
    }
  }, [composerCustomEmojiMap, onSend, replyTo, uploadedFiles, value]);

  const getValidMentions = useCallback(() => {
    const regex = /@([a-zA-Z0-9_]+)/g;
    const mentions: { start: number; end: number; username: string }[] = [];
    let match;
    while ((match = regex.exec(value)) !== null) {
      // Skip @mentions that are part of a URL (e.g. tiktok.com/@user/...)
      const before = value.slice(0, match.index);
      const lastSpace = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n"), before.lastIndexOf("\t"));
      const tokenStart = lastSpace + 1;
      const token = value.slice(tokenStart).split(/\s/)[0];
      if (/^https?:\/\//i.test(token)) continue;

      const username = match[1];
      const isMember = members.some(
        (m: any) => m.user.username.toLowerCase() === username.toLowerCase()
      );
      if (isMember) {
        mentions.push({ start: match.index, end: match.index + match[0].length, username });
      }
    }
    return mentions;
  }, [value, members]);

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
        newStart = m.start;
        changed = true;
      }

      if (end > m.start && end < m.end) {
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
    if (!mentionQuery) return;

    applyComposerEdit(`@${user.username} `, {
      start: mentionQuery.startPos,
      end: mentionQuery.endPos,
      nextState: { mentionQuery: null },
    });
  }, [applyComposerEdit, mentionQuery]);

  const insertEmoji = useCallback((emoji: string) => {
    const customEmoji = parseCustomEmojiToken(emoji);
    if (customEmoji) {
      const placeholder = allocateComposerCustomEmojiPlaceholder(value, composerCustomEmojiMap);

      applyComposerEdit(placeholder, {
        nextState: {
          composerCustomEmojiMap: {
            ...composerCustomEmojiMap,
            [placeholder]: {
              id: customEmoji.id,
              shortcode: customEmoji.shortcode,
            },
          },
        },
      });
      return;
    }

    applyComposerEdit(emoji);
  }, [applyComposerEdit, composerCustomEmojiMap, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current;

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

      if (e.key === "Backspace" && ta) {
        const cursor = ta.selectionStart;
        if (cursor === ta.selectionEnd && cursor > 0) {
          const mentions = getValidMentions();
          const m = mentions.find(m => cursor === m.end || (cursor === m.end + 1 && value[m.end] === " "));

          if (m) {
            e.preventDefault();
            applyComposerEdit("", {
              start: m.start,
              end: cursor,
              nextState: { mentionQuery: null },
            });
            return;
          }
        }
      }

      if (mentionQuery && mentionCandidates.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setLocalState((prev: { mentionIndex: number }) => ({ mentionIndex: (prev.mentionIndex + 1) % mentionCandidates.length }));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setLocalState((prev: { mentionIndex: number }) => ({ mentionIndex: (prev.mentionIndex - 1 + mentionCandidates.length) % mentionCandidates.length }));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(mentionCandidates[mentionIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setLocalState({ mentionQuery: null });
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
      if (e.key === "ArrowUp" && !value.trim()) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("edit-last-message"));
      }
    },
    [applyComposerEdit, doSend, replyTo, onCancelReply, value, mentionQuery, mentionCandidates, mentionIndex, insertMention, getValidMentions]
  );

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    const filesArray = Array.from(files);

    for (const file of filesArray) {
      if (file.size > 25 * 1024 * 1024) {
        alert(`File "${file.name}" is too large (max 25MB)`);
        continue;
      }

      const tempId = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : undefined;
      const abortController = new AbortController();

      const pending: PendingUpload = { tempId, file, progress: 0, previewUrl, abortController };
      setLocalState((prev: { pendingUploads: PendingUpload[] }) => ({ pendingUploads: [...prev.pendingUploads, pending] }));

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

        setLocalState((prev: { uploadedFiles: UploadedFile[] }) => ({
          uploadedFiles: [...prev.uploadedFiles, {
            id: data.id,
            url: data.file_url,
            filename: data.file_name,
            content_type: file.type || data.content_type,
            size: data.file_size,
            previewUrl,
          }]
        }));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Upload failed:", err);
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      } finally {
        setLocalState((prev: { pendingUploads: PendingUpload[] }) => ({ pendingUploads: prev.pendingUploads.filter(p => p.tempId !== tempId) }));
      }
    }
  }, [channelId]);

  handleFileUploadRef.current = handleFileUpload;

  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail as FileList;
      handleFileUploadRef.current?.(files);
    };
    window.addEventListener('drop-files', handler);
    return () => window.removeEventListener('drop-files', handler);
  }, []);

  const handleReplyChange = useCallback(() => {
    if (replyTo) {
      textareaRef.current?.focus();
    }
  }, [replyTo]);

  useEffect(() => {
    handleReplyChange();
  }, [handleReplyChange]);

  useEffect(() => {
    syncHeight();
  }, [syncHeight]);

  const cancelUpload = useCallback((tempId: string) => {
    setLocalState((prev: { pendingUploads: PendingUpload[] }) => {
      const item = prev.pendingUploads.find(p => p.tempId === tempId);
      if (item) {
        item.abortController.abort();
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return { pendingUploads: prev.pendingUploads.filter(p => p.tempId !== tempId) };
    });
  }, []);

  const removeUploadedFile = useCallback((id: string) => {
    setLocalState((prev: { uploadedFiles: UploadedFile[] }) => {
      const f = prev.uploadedFiles.find(x => x.id === id);
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return { uploadedFiles: prev.uploadedFiles.filter(f => f.id !== id) };
    });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleFileUpload(e.clipboardData.files);
    }
  }, [handleFileUpload]);

  const handleGifSelect = useCallback(async (gif: GifPickerItem) => {
    try {
      const data = await apiPost<{
        id: string;
        file_url: string;
        file_name: string;
        file_size: number;
        content_type: string;
      }, {
        source_url: string;
        filename: string;
        content_type: string;
        provider: GifPickerItem["provider"];
        size_bytes: number;
      }>(`/api/channels/${channelId}/messages/gif`, {
        source_url: gif.send.url,
        filename: `${gif.mediaType || "gif"}_${gif.id}.${getGifFilenameExtension(gif.send.contentType)}`,
        content_type: gif.send.contentType,
        provider: gif.provider,
        size_bytes: gif.send.sizeBytes,
      });

      const gifFile: UploadedFileInfo = {
        id: data.id,
        url: data.file_url,
        filename: data.file_name,
        content_type: data.content_type,
        size: data.file_size,
      };

      if (gif.provider === "klipy") {
        void apiGet(`/api/gifs?mode=register-share&provider=klipy&id=${encodeURIComponent(gif.id)}${gif.query ? `&q=${encodeURIComponent(gif.query)}` : ""}`).catch(() => undefined);
      }

      onSend(" ", replyTo?.id, [gifFile.id], [gifFile]);
      setLocalState({ showGifPicker: false });
      textareaRef.current?.focus();
    } catch (error) {
      console.error("GIF send failed:", error);
      alert("Failed to send GIF");
    }
  }, [channelId, onSend, replyTo?.id]);

  return {
    value,
    showEmoji,
    showGifPicker,
    uploadedFiles,
    pendingUploads,
    composerCustomEmojiMap,
    mentionQuery,
    mentionIndex,
    hoveredMention,
    mentionTooltipPos,
    setLocalState,
    textareaRef,
    twinRef,
    fileInputRef,
    hoveredMember,
    mentionCandidates,
    handleScroll,
    handleInput,
    handleMouseMove,
    doSend,
    insertEmoji,
    enforceAtomicMentions,
    insertMention,
    handleKeyDown,
    handleFileUpload,
    cancelUpload,
    removeUploadedFile,
    handlePaste,
    handleGifSelect,
  };
}
