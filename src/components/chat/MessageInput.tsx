import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { getDisplayName } from "@/lib/display-name";
import type { Message } from "@/lib/types";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/icon";
import { useAnimateEnter } from "@/components/ui/tree";
import { cn } from "@/lib/utils";
import AttachmentList from "./AttachmentList";
import { InputMentionOverlay } from "./InputMentionOverlay";
import {
  composerPrompt,
  MessageInputPlaceholder,
} from "./MessageInputPlaceholder";

import {
  useMessageInput,
  type PendingUpload,
  type UploadedFile,
  type UploadedFileInfo,
} from "./useMessageInput";

export type { PendingUpload, UploadedFile, UploadedFileInfo };

interface Props {
  channelId: string;
  channelName: string;
  onSend: (
    content: string,
    replyToId?: string,
    attachmentIds?: string[],
    uploadedFiles?: UploadedFileInfo[],
  ) => void;
  onTyping: () => void;
  replyTo?: Message | null;
  onCancelReply?: () => void;
  /** A DM: the prompt names the person ("Message @Ada"), not a channel. */
  isDM?: boolean;
}

// --- Subcomponents ---

import { HoveredMentionTooltip } from "./HoveredMentionTooltip";
import { InputControls } from "./InputControls";
import { MentionAutocomplete, mentionOptionId } from "./MentionAutocomplete";
import { ReplyIndicator } from "./ReplyIndicator";

/** The reply bar fades out over this long (ReplyIndicator: `--dur-1`). */
const REPLY_EXIT_MS = 100;

/**
 * Keeps the last reply target mounted for the exit fade after `replyTo` is
 * cleared (sent, cancelled, Esc), then drops it. The target is held in state
 * and swapped during render, so there is never a frame without the bar.
 */
function useLingeringReply(replyTo: Message | null | undefined) {
  const [lingering, setLingering] = useState<Message | null>(replyTo ?? null);
  if (replyTo && replyTo !== lingering) setLingering(replyTo);

  const closing = !replyTo && lingering !== null;
  useEffect(() => {
    if (!closing) return;
    const id = window.setTimeout(() => setLingering(null), REPLY_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [closing]);

  return { shown: replyTo ?? lingering, closing };
}

/**
 * The composer plate (component kit, C1 field): min 48, 2px corners, ply-2,
 * a `--line-field` edge (>= 3:1 on ply-2). It clips its trays (reply bar,
 * upload tray) to its own corners; while anything inside has focus the edge
 * turns ink-1 and a 1px ring joins it into one 2px ink edge (no glow).
 * Portalled children (mention list, pickers, tooltips) are not clipped.
 */
const COMPOSER_BOX =
  "rm-composer relative flex min-h-12 flex-col overflow-hidden rounded-[2px] border border-line-field bg-ply-2";

/** The input row: flush 48px icon slots at both ends, the text between. */
const COMPOSER_ROW = "flex items-start";

/**
 * A 48px slot key inside the plate. The plate clips, so the focus ring
 * draws inside the key.
 */
export const COMPOSER_SLOT = "rounded-none focus-visible:outline-offset-[-2px]";

/**
 * Text metrics shared by the textarea, its transparent-text twin, the
 * placeholder and the read-only copy, so they overlay exactly: 15/22 on
 * desktop (one line plus 13+13 is the 48px slot), 16/24 below `md` so iOS
 * never zooms the field.
 */
const COMPOSER_TEXT =
  "py-[13px] text-ui-base font-normal max-md:py-3 max-md:text-ui-md";

/** Outer gutter: 16px on desktop, 8px on phones, above the home indicator. */
function ComposerGutter({ children }: { children: ReactNode }) {
  return (
    <div
      data-floating-avoid=""
      className="relative z-10 px-2 pt-0 md:px-4"
      // 16px on desktop; on phones the home indicator inset replaces most of it.
      style={{
        paddingBottom: "calc(max(8px, var(--safe-area-bottom, 0px)) + 8px)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * The composer for a channel you can read but not write in. Same gutter, box,
 * row and text metrics as `MessageInput`, so the column never jumps when a
 * permission changes: a lock where the attach button sits, then the reason.
 */
export function ComposerReadOnly({
  message = "You don't have permission to send messages in this channel.",
}: {
  message?: string;
}) {
  return (
    <ComposerGutter>
      <div
        data-testid="composer-read-only"
        aria-disabled="true"
        className={cn(COMPOSER_BOX, "select-none")}
      >
        <div className={COMPOSER_ROW}>
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center text-ink-3"
          >
            <Icon name="lock" size="lg" />
          </span>
          <p
            className={cn(
              COMPOSER_TEXT,
              "min-w-0 flex-1 pr-3 text-pretty text-ink-3",
            )}
          >
            {message}
          </p>
        </div>
      </div>
    </ComposerGutter>
  );
}

export default function MessageInput({
  channelId,
  channelName,
  onSend,
  onTyping,
  replyTo,
  onCancelReply,
  isDM = false,
}: Props) {
  const reply = useLingeringReply(replyTo);
  const replyDisplayName = replyTo
    ? getDisplayName(replyTo.author, "message")
    : null;

  const {
    value,
    showEmoji,
    showGifPicker,
    gifPickerMediaType,
    uploadedFiles,
    pendingUploads,
    composerCustomEmojiMap,
    mentionQuery,
    mentionIndex,
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
    enforceAtomicMentions,
    insertEmoji,
    insertMention,
    handleKeyDown,
    handleFileUpload,
    cancelUpload,
    retryUpload,
    removeUploadedFile,
    toggleUploadedFileSensitive,
    handlePaste,
    handleGifSelect,
    doSend,
  } = useMessageInput({ channelId, onSend, onTyping, replyTo, onCancelReply });

  const composerRef = useRef<HTMLDivElement>(null);
  const mentionListId = useId();
  const mentionListOpen = !!mentionQuery && mentionCandidates.length > 0;
  // Trays (reply bar, uploads) enter with a fade + 4px only after first paint.
  const animateEnter = useAnimateEnter();

  const prompt = composerPrompt({ channelName, replyDisplayName, isDM });

  return (
    <ComposerGutter>
      <div
        ref={composerRef}
        data-animate-enter={animateEnter ? "" : undefined}
        className={cn(
          COMPOSER_BOX,
          // No `group` here: tiles and rows inside own their own `group-hover`.
          "transition-[border-color] duration-(--dur-1) ease-out focus-within:border-ink-1 focus-within:ring-1 focus-within:ring-ink-1",
        )}
      >
        {reply.shown && (
          <ReplyIndicator
            replyTo={reply.shown}
            onCancelReply={onCancelReply}
            isClosing={reply.closing}
          />
        )}

        <MentionAutocomplete
          mentionQuery={mentionQuery}
          mentionCandidates={mentionCandidates}
          mentionIndex={mentionIndex}
          setLocalState={setLocalState}
          insertMention={insertMention}
          anchor={composerRef}
          listId={mentionListId}
        />

        <HoveredMentionTooltip
          hoveredMember={hoveredMember}
          pos={mentionTooltipPos}
        />

        <AttachmentList
          uploadedFiles={uploadedFiles}
          pendingUploads={pendingUploads}
          onRemove={removeUploadedFile}
          onToggleSensitive={toggleUploadedFileSensitive}
          onCancel={cancelUpload}
          onRetry={retryUpload}
        />

        <div className={COMPOSER_ROW}>
          <input
            type="file"
            multiple
            className="hidden"
            ref={fileInputRef}
            aria-label="Upload attachments"
            onChange={(e) => {
              if (e.target.files) handleFileUpload(e.target.files);
              e.target.value = "";
            }}
          />

          <IconButton
            icon="add"
            size="lg"
            className={COMPOSER_SLOT}
            aria-label="Add attachment"
            tooltip="Add attachment"
            onClick={() => fileInputRef.current?.click()}
          />

          <div className="relative min-h-12 min-w-0 flex-1 overflow-hidden">
            {value.length === 0 && (
              <div
                aria-hidden="true"
                className="custom-scrollbar pointer-events-none absolute inset-0 z-0 overflow-y-hidden"
              >
                <MessageInputPlaceholder
                  channelName={channelName}
                  replyDisplayName={replyDisplayName}
                  isDM={isDM}
                  className={cn(COMPOSER_TEXT, "text-ink-3")}
                />
              </div>
            )}

            <div
              ref={twinRef}
              aria-hidden="true"
              className={cn(
                COMPOSER_TEXT,
                "custom-scrollbar pointer-events-none absolute inset-0 z-0 overflow-y-hidden wrap-break-word whitespace-pre-wrap text-ink-1",
              )}
            >
              <InputMentionOverlay
                text={value}
                composerCustomEmojiMap={composerCustomEmojiMap}
              />
            </div>

            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              aria-label={replyTo ? `Reply to ${replyDisplayName}` : prompt}
              aria-placeholder={prompt}
              aria-autocomplete="list"
              aria-controls={mentionListOpen ? mentionListId : undefined}
              aria-activedescendant={
                mentionListOpen
                  ? mentionOptionId(mentionListId, mentionIndex)
                  : undefined
              }
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onScroll={handleScroll}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setLocalState({ hoveredMention: null })}
              onSelect={enforceAtomicMentions}
              onClick={enforceAtomicMentions}
              placeholder=""
              className={cn(
                COMPOSER_TEXT,
                "custom-scrollbar relative z-10 block w-full resize-none overflow-y-auto bg-transparent text-transparent caret-accent-ink outline-none selection:bg-(--selection) selection:text-transparent",
              )}
              data-gramm="false"
              autoComplete="off"
              spellCheck
            />
          </div>

          <InputControls
            showEmoji={showEmoji}
            showGifPicker={showGifPicker}
            gifPickerMediaType={gifPickerMediaType}
            setLocalState={setLocalState}
            handleEmojiSelect={insertEmoji}
            handleGifSelect={handleGifSelect}
            canSend={value.trim().length > 0 || uploadedFiles.length > 0}
            onSend={doSend}
          />
        </div>
      </div>
    </ComposerGutter>
  );
}
