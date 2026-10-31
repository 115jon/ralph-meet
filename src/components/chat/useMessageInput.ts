import { toast } from "@/components/ui/toast";
import { apiGet, apiPost, apiUpload } from "@/lib/api-client";
import { describeApiError } from "@/lib/api-errors";
import { parseCustomEmojiToken } from "@/lib/emoji";
import type { GifPickerItem, GifPickerMediaType } from "@/lib/gif-picker";
import type { Message, User } from "@/lib/types";
import { COMPOSER_RESTORE_EVENT } from "@/stores/chat-actions";
import { useChatStore } from "@/stores/chat-store";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import {
  allocateComposerCustomEmojiPlaceholder,
  expandComposerCustomEmojiPlaceholders,
  pruneComposerCustomEmojiMap,
  replaceTextRange,
  type ComposerCustomEmojiMap,
} from "./message-input-utils";

/**
 * The composer field's floor, in px: one line of text plus its vertical
 * padding (13+22+13 desktop, 12+24+12 phone). Matches the 48px slot keys and
 * the plate's `min-h-12`. Heights are set inline, so this must not drift.
 */
const COMPOSER_MIN_HEIGHT_PX = 48;

export interface UploadedFile {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  size: number;
  is_nsfw?: boolean;
  previewUrl?: string;
}

export interface PendingUpload {
  tempId: string;
  file: File;
  /** 0..1 once a transport reports it. `fetch` can't, so today it stays 0. */
  progress: number;
  previewUrl?: string;
  abortController: AbortController;
  /** Set when the upload failed: the tile stays with a Retry instead of vanishing. */
  error?: string;
}

export interface UploadedFileInfo {
  id: string;
  url: string;
  filename: string;
  content_type: string;
  size: number;
  is_nsfw?: boolean;
  previewUrl?: string;
}

export interface MessageInputState {
  value: string;
  showEmoji: boolean;
  showGifPicker: boolean;
  gifPickerMediaType: GifPickerMediaType;
  uploadedFiles: UploadedFile[];
  pendingUploads: PendingUpload[];
  composerCustomEmojiMap: ComposerCustomEmojiMap;
  mentionQuery: { text: string; startPos: number; endPos: number } | null;
  mentionIndex: number;
  hoveredMention: string | null;
  mentionTooltipPos: { left: number; top: number };
}

function getGifFilenameExtension(
  contentType: GifPickerItem["send"]["contentType"],
): string {
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
  onSend: (
    content: string,
    replyToId?: string,
    attachmentIds?: string[],
    uploadedFiles?: UploadedFileInfo[],
    nsfwAttachmentIds?: string[],
  ) => void;
  onTyping: () => void;
  replyTo?: Message | null;
  onCancelReply?: () => void;
}) {
  const [
    {
      value,
      showEmoji,
      showGifPicker,
      gifPickerMediaType,
      uploadedFiles,
      pendingUploads,
      composerCustomEmojiMap,
      mentionQuery,
      mentionIndex,
      hoveredMention,
      mentionTooltipPos,
    },
    setLocalState,
  ] = useReducer(
    (
      state: MessageInputState,
      payload:
        | Partial<MessageInputState>
        | ((prev: MessageInputState) => Partial<MessageInputState>),
    ) => {
      const updates = typeof payload === "function" ? payload(state) : payload;
      const keys = Object.keys(updates) as (keyof MessageInputState)[];
      // Nothing changed (a hover that stays on the same chip, a scroll with no
      // tooltip open): keep the state object so React skips the render.
      if (keys.every((key) => Object.is(state[key], updates[key]))) {
        return state;
      }
      return { ...state, ...updates };
    },
    {
      value: "",
      showEmoji: false,
      showGifPicker: false,
      gifPickerMediaType: "gifs",
      uploadedFiles: [] as UploadedFile[],
      pendingUploads: [] as PendingUpload[],
      composerCustomEmojiMap: {},
      mentionQuery: null,
      mentionIndex: 0,
      hoveredMention: null,
      mentionTooltipPos: { left: 0, top: 0 },
    },
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const twinRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  const handleFileUploadRef = useRef<
    ((files: FileList | File[]) => void) | null
  >(null);
  // Latest state for listeners that must not re-subscribe on every keystroke.
  const valueRef = useRef("");
  valueRef.current = value;
  const pendingUploadsRef = useRef<PendingUpload[]>([]);
  pendingUploadsRef.current = pendingUploads;

  const members = useChatStore((s) => s.members);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && twinRef.current) {
      twinRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    // The tooltip is anchored to viewport coordinates measured on hover, so
    // anything that moves the chips under it must drop it.
    setLocalState({ hoveredMention: null });
  }, []);

  const syncHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = `${COMPOSER_MIN_HEIGHT_PX}px`;
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
    ? members.find(
        (m: any) =>
          m.user.username.toLowerCase() === hoveredMention.toLowerCase(),
      )
    : null;

  const mentionCandidates = useMemo(
    () =>
      mentionQuery
        ? members
            .map((m: any) => m.user)
            .filter((u: User) =>
              u.username
                .toLowerCase()
                .includes(mentionQuery.text.toLowerCase()),
            )
            .slice(0, 5)
        : [],
    [members, mentionQuery],
  );

  const updateMentionQuery = useCallback(
    (textValue: string, selectionStart: number) => {
      const textBeforeCursor = textValue.slice(0, selectionStart);
      const lastAtPos = textBeforeCursor.lastIndexOf("@");

      if (lastAtPos !== -1) {
        if (lastAtPos === 0 || /\s/.test(textBeforeCursor[lastAtPos - 1])) {
          // Don't trigger mention autocomplete if the @ is inside a URL
          const before = textValue.slice(0, lastAtPos);
          const lastSpace = Math.max(
            before.lastIndexOf(" "),
            before.lastIndexOf("\n"),
            before.lastIndexOf("\t"),
          );
          const tokenStart = lastSpace + 1;
          const token = textValue.slice(tokenStart).split(/\s/)[0];
          if (/^https?:\/\//i.test(token)) {
            setLocalState({ mentionQuery: null });
            return;
          }

          const queryText = textBeforeCursor.slice(lastAtPos + 1);
          if (!/\s/.test(queryText)) {
            setLocalState({
              mentionQuery: {
                text: queryText,
                startPos: lastAtPos,
                endPos: selectionStart,
              },
            });
            setLocalState({ mentionIndex: 0 });
            return;
          }
        }
      }
      setLocalState({ mentionQuery: null });
    },
    [],
  );

  const applyComposerEdit = useCallback(
    (
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
    },
    [composerCustomEmojiMap, syncHeight, updateMentionQuery, value],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalState({
        value: e.target.value,
        hoveredMention: null,
        composerCustomEmojiMap: pruneComposerCustomEmojiMap(
          e.target.value,
          composerCustomEmojiMap,
        ),
      });
      syncHeight();

      const now = Date.now();
      if (now - lastTypingRef.current > 3000) {
        lastTypingRef.current = now;
        onTyping();
      }

      updateMentionQuery(e.target.value, e.target.selectionStart);
    },
    [composerCustomEmojiMap, onTyping, updateMentionQuery, syncHeight],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current;
      if (!ta) return;

      ta.style.setProperty("pointer-events", "none", "important");
      const el = document.elementFromPoint(e.clientX, e.clientY);
      ta.style.removeProperty("pointer-events");

      const username = el?.getAttribute("data-mention");
      if (el && username) {
        const rect = el.getBoundingClientRect();
        const left = rect.left + rect.width / 2;
        const top = rect.top;
        setLocalState((prev: MessageInputState) =>
          prev.hoveredMention === username &&
          prev.mentionTooltipPos.left === left &&
          prev.mentionTooltipPos.top === top
            ? {}
            : { hoveredMention: username, mentionTooltipPos: { left, top } },
        );
        return;
      }
      setLocalState({ hoveredMention: null });
    },
    [],
  );

  const doSend = useCallback(() => {
    const hasContent = value.trim();
    const hasFiles = uploadedFiles.length > 0;
    if (hasContent || hasFiles) {
      const attachmentIds =
        uploadedFiles.length > 0 ? uploadedFiles.map((f) => f.id) : undefined;
      const fileInfos = uploadedFiles.length > 0 ? uploadedFiles : undefined;
      const nsfwAttachmentIds = uploadedFiles
        .filter((file) => file.is_nsfw)
        .map((file) => file.id);
      const content = value.trim() || (hasFiles ? " " : "");
      onSend(
        expandComposerCustomEmojiPlaceholders(content, composerCustomEmojiMap),
        replyTo?.id,
        attachmentIds,
        fileInfos,
        nsfwAttachmentIds.length > 0 ? nsfwAttachmentIds : undefined,
      );
      setLocalState({ value: "", hoveredMention: null });
      uploadedFiles.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
      setLocalState({ uploadedFiles: [] });
      setLocalState({ composerCustomEmojiMap: {} });
      lastTypingRef.current = 0;
      setLocalState({ mentionQuery: null });
      if (textareaRef.current) {
        textareaRef.current.style.height = `${COMPOSER_MIN_HEIGHT_PX}px`;
      }
      if (twinRef.current) {
        twinRef.current.style.height = `${COMPOSER_MIN_HEIGHT_PX}px`;
      }
      // Sending from the phone key (or a keyboard-focused button) must not
      // strand focus on a control that is about to unmount.
      textareaRef.current?.focus();
    }
  }, [composerCustomEmojiMap, onSend, replyTo, uploadedFiles, value]);

  const getValidMentions = useCallback(() => {
    const regex = /@([a-zA-Z0-9_]+)/g;
    const mentions: { start: number; end: number; username: string }[] = [];
    let match;
    while ((match = regex.exec(value)) !== null) {
      // Skip @mentions that are part of a URL (e.g. tiktok.com/@user/...)
      const before = value.slice(0, match.index);
      const lastSpace = Math.max(
        before.lastIndexOf(" "),
        before.lastIndexOf("\n"),
        before.lastIndexOf("\t"),
      );
      const tokenStart = lastSpace + 1;
      const token = value.slice(tokenStart).split(/\s/)[0];
      if (/^https?:\/\//i.test(token)) continue;

      const username = match[1];
      const isMember = members.some(
        (m: any) => m.user.username.toLowerCase() === username.toLowerCase(),
      );
      if (isMember) {
        mentions.push({
          start: match.index,
          end: match.index + match[0].length,
          username,
        });
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
          newStart = value[m.end] === " " ? m.end + 1 : m.end;
          newEnd = newStart;
        }
        changed = true;
      } else if (start > m.start && start < m.end) {
        newStart = m.start;
        changed = true;
      }

      if (end > m.start && end < m.end) {
        const newPos = value[m.end] === " " ? m.end + 1 : m.end;
        newEnd = newPos;
        changed = true;
      }
    }

    if (changed) {
      ta.setSelectionRange(newStart, newEnd);
    }
  }, [getValidMentions, value]);

  const insertMention = useCallback(
    (user: User) => {
      if (!mentionQuery) return;

      applyComposerEdit(`@${user.username} `, {
        start: mentionQuery.startPos,
        end: mentionQuery.endPos,
        nextState: { mentionQuery: null },
      });
    },
    [applyComposerEdit, mentionQuery],
  );

  const insertEmoji = useCallback(
    (emoji: string) => {
      const customEmoji = parseCustomEmojiToken(emoji);
      if (customEmoji) {
        const placeholder = allocateComposerCustomEmojiPlaceholder(
          value,
          composerCustomEmojiMap,
        );

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
    },
    [applyComposerEdit, composerCustomEmojiMap, value],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // An IME is mid-composition: Enter/Tab/arrows/Escape belong to its
      // candidate window (keyCode 229 covers Safari's keydown-after-end).
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      const ta = textareaRef.current;

      if (e.key === "ArrowLeft" && ta) {
        const cursor = ta.selectionStart;
        if (cursor === ta.selectionEnd) {
          const m = getValidMentions().find(
            (m) =>
              cursor === m.end ||
              (cursor === m.end + 1 && value[m.end] === " "),
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
            const newPos = value[m.end] === " " ? m.end + 1 : m.end;
            ta.setSelectionRange(newPos, newPos);
            return;
          }
        }
      }

      if (e.key === "Backspace" && ta) {
        const cursor = ta.selectionStart;
        if (cursor === ta.selectionEnd && cursor > 0) {
          const mentions = getValidMentions();
          const m = mentions.find(
            (m) =>
              cursor === m.end ||
              (cursor === m.end + 1 && value[m.end] === " "),
          );

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
          setLocalState((prev: { mentionIndex: number }) => ({
            mentionIndex: (prev.mentionIndex + 1) % mentionCandidates.length,
          }));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setLocalState((prev: { mentionIndex: number }) => ({
            mentionIndex:
              (prev.mentionIndex - 1 + mentionCandidates.length) %
              mentionCandidates.length,
          }));
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
    [
      applyComposerEdit,
      doSend,
      replyTo,
      onCancelReply,
      value,
      mentionQuery,
      mentionCandidates,
      mentionIndex,
      insertMention,
      getValidMentions,
    ],
  );

  const handleFileUpload = useCallback(
    async (files: FileList | File[]) => {
      const filesArray = Array.from(files);

      for (const file of filesArray) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} is too large to upload`, {
            description: "Files can be up to 25 MB.",
          });
          continue;
        }

        const tempId = crypto.randomUUID();
        const previewUrl =
          file.type.startsWith("image/") || file.type.startsWith("video/")
            ? URL.createObjectURL(file)
            : undefined;
        const abortController = new AbortController();

        const pending: PendingUpload = {
          tempId,
          file,
          progress: 0,
          previewUrl,
          abortController,
        };
        setLocalState((prev: { pendingUploads: PendingUpload[] }) => ({
          pendingUploads: [...prev.pendingUploads, pending],
        }));

        let failure: string | null = null;
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
            uploadedFiles: [
              ...prev.uploadedFiles,
              {
                id: data.id,
                url: data.file_url,
                filename: data.file_name,
                content_type: file.type || data.content_type,
                size: data.file_size,
                previewUrl,
              },
            ],
          }));
        } catch (err) {
          if ((err as Error).name === "AbortError") {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
          } else {
            // Keep the tile (and its preview) so the file can be retried.
            console.error("Upload failed:", err);
            failure = describeApiError(err, "upload that file");
          }
        } finally {
          const failed = failure;
          setLocalState((prev: { pendingUploads: PendingUpload[] }) => ({
            pendingUploads: failed
              ? prev.pendingUploads.map((p) =>
                  p.tempId === tempId ? { ...p, error: failed } : p,
                )
              : prev.pendingUploads.filter((p) => p.tempId !== tempId),
          }));
        }
      }
    },
    [channelId],
  );

  handleFileUploadRef.current = handleFileUpload;

  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent).detail as FileList;
      handleFileUploadRef.current?.(files);
    };
    window.addEventListener("drop-files", handler);
    return () => window.removeEventListener("drop-files", handler);
  }, []);

  // A failed send was deleted (`COMPOSER_RESTORE_EVENT`, detail
  // `{ channelId, content }`): put its text back, but only into an empty
  // composer for the same channel, so nothing the user typed is overwritten.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ channelId?: string; content?: string } | undefined>
      ).detail;
      if (!detail?.content || detail.channelId !== channelId) return;
      if (valueRef.current.trim().length > 0) return;
      e.preventDefault();
      const content = detail.content;
      setLocalState({ value: content, mentionQuery: null });
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(content.length, content.length);
        syncHeight();
      });
    };
    window.addEventListener(COMPOSER_RESTORE_EVENT, handler);
    return () => window.removeEventListener(COMPOSER_RESTORE_EVENT, handler);
  }, [channelId, syncHeight]);

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
      const item = prev.pendingUploads.find((p) => p.tempId === tempId);
      if (item) {
        item.abortController.abort();
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return {
        pendingUploads: prev.pendingUploads.filter((p) => p.tempId !== tempId),
      };
    });
  }, []);

  /** Re-run a failed upload: the failed tile is replaced by a fresh one. */
  const retryUpload = useCallback(
    (tempId: string) => {
      const failed = pendingUploadsRef.current.find((p) => p.tempId === tempId);
      if (!failed) return;
      if (failed.previewUrl) URL.revokeObjectURL(failed.previewUrl);
      setLocalState((prev: { pendingUploads: PendingUpload[] }) => ({
        pendingUploads: prev.pendingUploads.filter((p) => p.tempId !== tempId),
      }));
      void handleFileUpload([failed.file]);
    },
    [handleFileUpload],
  );

  const removeUploadedFile = useCallback((id: string) => {
    setLocalState((prev: { uploadedFiles: UploadedFile[] }) => {
      const f = prev.uploadedFiles.find((x) => x.id === id);
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return { uploadedFiles: prev.uploadedFiles.filter((f) => f.id !== id) };
    });
  }, []);

  const toggleUploadedFileSensitive = useCallback((id: string) => {
    setLocalState((prev: { uploadedFiles: UploadedFile[] }) => ({
      uploadedFiles: prev.uploadedFiles.map((file) =>
        file.id === id ? { ...file, is_nsfw: !file.is_nsfw } : file,
      ),
    }));
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (e.clipboardData.files && e.clipboardData.files.length > 0) {
        e.preventDefault();
        handleFileUpload(e.clipboardData.files);
      }
    },
    [handleFileUpload],
  );

  const handleGifSelect = useCallback(
    async (gif: GifPickerItem) => {
      try {
        const data = await apiPost<
          {
            id: string;
            file_url: string;
            file_name: string;
            file_size: number;
            content_type: string;
          },
          {
            source_url: string;
            filename: string;
            content_type: string;
            provider: GifPickerItem["provider"];
            size_bytes: number;
          }
        >(`/api/channels/${channelId}/messages/gif`, {
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
          void apiGet(
            `/api/gifs?mode=register-share&provider=klipy&id=${encodeURIComponent(gif.id)}${gif.query ? `&q=${encodeURIComponent(gif.query)}` : ""}`,
          ).catch(() => undefined);
        }

        onSend(" ", replyTo?.id, [gifFile.id], [gifFile]);
        setLocalState({ showGifPicker: false, gifPickerMediaType: "gifs" });
        textareaRef.current?.focus();
      } catch (error) {
        console.error("GIF send failed:", error);
        toast.error(describeApiError(error, "send that GIF"), {
          id: "rm-gif-send",
        });
      }
    },
    [channelId, onSend, replyTo?.id],
  );

  return {
    value,
    showEmoji,
    showGifPicker,
    gifPickerMediaType,
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
    retryUpload,
    removeUploadedFile,
    toggleUploadedFileSensitive,
    handlePaste,
    handleGifSelect,
  };
}
