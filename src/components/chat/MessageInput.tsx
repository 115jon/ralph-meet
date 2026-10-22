import { getDisplayName } from "@/lib/display-name";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import AttachmentList from "./AttachmentList";
import { InputMentionOverlay } from "./InputMentionOverlay";
import { MessageInputPlaceholder } from "./MessageInputPlaceholder";
import { Plus } from "./Icons";

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
}

// --- Subcomponents ---

import { HoveredMentionTooltip } from "./HoveredMentionTooltip";
import { InputControls } from "./InputControls";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { ReplyIndicator } from "./ReplyIndicator";

export default function MessageInput({
  channelId,
  channelName,
  onSend,
  onTyping,
  replyTo,
  onCancelReply,
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

  const showReply = !!replyTo;
  const shouldRenderReply = showReply;

  return (
    <div
      className="z-10 px-2 md:px-4 pt-0 relative"
      style={{ paddingBottom: "calc(16px + var(--safe-area-bottom, 0px))" }}
    >
      <div className="rm-composer group relative flex flex-col rounded-lg border border-rm-border bg-rm-bg-elevated transition-[border-color,box-shadow] focus-within:border-rm-border-strong">
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

          <button
            type="button"
            aria-label="Add attachment"
            onClick={() => fileInputRef.current?.click()}
            className="mr-3 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rm-bg-hover text-rm-text-muted transition-ui hover:bg-rm-bg-active hover:text-rm-text enabled:active:scale-[0.96]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>

          <div className="relative flex-1 min-h-[32px] overflow-hidden">
            {value.length === 0 && (
              <div
                aria-hidden="true"
                className="absolute inset-0 z-0 overflow-y-hidden pointer-events-none custom-scrollbar"
              >
                <MessageInputPlaceholder
                  channelName={channelName}
                  replyDisplayName={replyDisplayName}
                  className="py-1 text-ui-base font-normal leading-[1.375] text-rm-text-muted/60 max-md:text-ui-md"
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
              aria-label={
                replyTo
                  ? `Reply to ${replyDisplayName}`
                  : `Message #${channelName}`
              }
              aria-placeholder={
                replyTo
                  ? `Reply to ${replyDisplayName}…`
                  : `Message #${channelName}`
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
                "custom-scrollbar relative z-10 w-full resize-none overflow-y-auto bg-transparent py-1 text-ui-base font-normal leading-[1.375] text-transparent outline-none placeholder:text-rm-text-muted/60 selection:bg-primary/30 selection:text-transparent max-md:text-ui-md",
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
