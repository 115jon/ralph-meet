import { useId, useRef } from "react";
import { getDisplayName } from "@/lib/display-name";
import type { Message } from "@/lib/types";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";
import AttachmentList from "./AttachmentList";
import { InputMentionOverlay } from "./InputMentionOverlay";
import {
  composerPrompt,
  MessageInputPlaceholder,
} from "./MessageInputPlaceholder";
import { Icon } from "@/components/ui/icon";

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

export default function MessageInput({
  channelId,
  channelName,
  onSend,
  onTyping,
  replyTo,
  onCancelReply,
  isDM = false,
}: Props) {
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
    removeUploadedFile,
    toggleUploadedFileSensitive,
    handlePaste,
    handleGifSelect,
    doSend,
  } = useMessageInput({ channelId, onSend, onTyping, replyTo, onCancelReply });

  const composerRef = useRef<HTMLDivElement>(null);
  const mentionListId = useId();
  const mentionListOpen = !!mentionQuery && mentionCandidates.length > 0;

  const prompt = composerPrompt({ channelName, replyDisplayName, isDM });
  const showReply = !!replyTo;
  const shouldRenderReply = showReply;

  return (
    <div
      data-floating-avoid=""
      className="z-10 px-2 md:px-4 pt-0 relative"
      // 16px on desktop; on phones the home indicator inset replaces most of it.
      style={{
        paddingBottom: "calc(max(8px, var(--safe-area-bottom, 0px)) + 8px)",
      }}
    >
      <div
        ref={composerRef}
        className="rm-composer group relative flex flex-col rounded-lg border border-rm-border bg-rm-bg-elevated transition-[border-color,box-shadow] focus-within:border-rm-border-strong"
      >
        {shouldRenderReply && replyTo && (
          <ReplyIndicator
            replyTo={replyTo}
            onCancelReply={onCancelReply}
            isClosing={!showReply}
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
        />

        <div className="flex items-start px-3 py-2.5">
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
            size="sm"
            variant="muted"
            aria-label="Add attachment"
            onClick={() => fileInputRef.current?.click()}
            className="mr-2 bg-rm-tint-1"
          />

          <div className="relative min-h-8 flex-1 overflow-hidden">
            {value.length === 0 && (
              <div
                aria-hidden="true"
                className="absolute inset-0 z-0 overflow-y-hidden pointer-events-none custom-scrollbar"
              >
                <MessageInputPlaceholder
                  channelName={channelName}
                  replyDisplayName={replyDisplayName}
                  isDM={isDM}
                  className="py-1 text-ui-base font-normal leading-[1.375] text-rm-text-muted max-md:text-ui-md"
                />
              </div>
            )}

            <div
              ref={twinRef}
              aria-hidden="true"
              className="absolute inset-0 z-0 whitespace-pre-wrap wrap-break-word py-1 text-ui-base font-normal leading-[1.375] text-rm-text overflow-y-hidden pointer-events-none custom-scrollbar max-md:text-ui-md"
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
                "custom-scrollbar relative z-10 w-full resize-none overflow-y-auto bg-transparent py-1 text-ui-base font-normal leading-[1.375] text-transparent outline-none placeholder:text-rm-text-muted selection:bg-(--rm-selection) selection:text-transparent max-md:text-ui-md",
              )}
              style={{
                caretColor: "var(--rm-accent)",
              }}
              data-gramm="false"
              autoComplete="off"
              spellCheck="false"
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
    </div>
  );
}
