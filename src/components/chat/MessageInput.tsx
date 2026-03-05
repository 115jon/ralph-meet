import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCallback } from "react";
import AttachmentList from "./AttachmentList";
import { InputMentionOverlay } from "./InputMentionOverlay";

import { useMessageInput, type MessageInputState, type PendingUpload, type UploadedFile, type UploadedFileInfo } from "./useMessageInput";

export type { PendingUpload, UploadedFile, UploadedFileInfo };

interface Props {
  channelId: string;
  channelName: string;
  onSend: (content: string, replyToId?: string, attachmentIds?: string[], uploadedFiles?: UploadedFileInfo[]) => void;
  onTyping: () => void;
  replyTo?: Message | null;
  onCancelReply?: () => void;
}

// --- Subcomponents ---

import { HoveredMentionTooltip } from "./HoveredMentionTooltip";
import { InputControls } from "./InputControls";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { ReplyIndicator } from "./ReplyIndicator";


export default function MessageInput({ channelId, channelName, onSend, onTyping, replyTo, onCancelReply }: Props) {
  const {
    value,
    showEmoji,
    uploadedFiles,
    pendingUploads,
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
    enforceAtomicMentions,
    insertMention,
    handleKeyDown,
    handleFileUpload,
    cancelUpload,
    removeUploadedFile,
    handlePaste,
  } = useMessageInput({ channelId, onSend, onTyping, replyTo, onCancelReply });

  const handleEmojiSelect = useCallback((emoji: string) => {
    setLocalState((prev: MessageInputState) => ({ value: prev.value + emoji }));
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="z-10 px-2 md:px-4 pb-2 md:pb-6 pt-0 relative">
      <div className="group flex flex-col rounded-xl bg-rm-bg-elevated shadow-sm transition-all duration-300 border border-white/5 relative">
        {replyTo && (
          <ReplyIndicator replyTo={replyTo} onCancelReply={onCancelReply} />
        )}

        <MentionAutocomplete
          mentionQuery={mentionQuery}
          mentionCandidates={mentionCandidates}
          mentionIndex={mentionIndex}
          setLocalState={setLocalState}
          insertMention={insertMention}
        />

        <HoveredMentionTooltip hoveredMember={hoveredMember} pos={mentionTooltipPos} />

        <AttachmentList
          uploadedFiles={uploadedFiles}
          pendingUploads={pendingUploads}
          onRemove={removeUploadedFile}
          onCancel={cancelUpload}
        />

        <div className="flex items-start px-4 py-2.5">
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
            {!mentionQuery && (
              <div
                ref={twinRef}
                aria-hidden="true"
                className="absolute inset-0 z-0 whitespace-pre-wrap break-words py-1 text-[15px] font-medium leading-normal text-rm-text overflow-y-hidden pointer-events-none custom-scrollbar"
              >
                <InputMentionOverlay text={value} />
              </div>
            )}

            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onScroll={handleScroll}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setLocalState({ hoveredMention: null })}
              onSelect={enforceAtomicMentions}
              onClick={enforceAtomicMentions}
              placeholder={replyTo ? `Reply to ${replyTo.author?.username ?? "message"}…` : `Message #${channelName}`}
              className={cn(
                "custom-scrollbar relative z-10 w-full resize-none overflow-y-auto py-1 text-[15px] font-medium leading-normal outline-none placeholder:text-rm-text-muted/60",
                !mentionQuery ? "text-transparent bg-transparent" : "text-rm-text bg-transparent"
              )}
              style={{
                caretColor: "rgba(226, 232, 240, 0.9)"
              }}
              data-gramm="false"
              autoComplete="off"
              spellCheck="false"
            />
          </div>

          <InputControls
            showEmoji={showEmoji}
            setLocalState={setLocalState}
            handleEmojiSelect={handleEmojiSelect}
          />
        </div>
      </div>
    </div>
  );
}
