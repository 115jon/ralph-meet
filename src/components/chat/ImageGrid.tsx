
import { getAuthAssetUrl } from '@/lib/platform';
import { getAttachmentUrl } from '@/lib/attachment-url';
import { createAttachmentGifFavorite } from '@/lib/gif-favorite-item';
import { shouldBlurSensitiveAttachment } from '@/lib/media-safety';
import { isAnimatedMedia } from '@/lib/media';
import type { Attachment } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useMediaSafetySettingsStore } from '@/stores/useMediaSafetySettingsStore';
import type { ViewerContext } from '@/stores/useImageViewerStore';
import { useImageViewerActions } from '@/stores/useImageViewerStore';
import { Trash2 } from 'lucide-react';
import { GifFavoriteButton } from './GifFavoriteButton';
import { GifProviderBranding } from './GifProviderBranding';
import SensitiveMediaFrame from './SensitiveMediaFrame';

import React from 'react';

interface DeleteButtonProps {
  id: string;
  onDelete: (id: string) => void;
}

const DeleteButton: React.FC<DeleteButtonProps> = ({ id, onDelete }) => {
  return (
    <div className="absolute top-1 right-1 opacity-0 group-hover/att:opacity-100 transition-opacity z-20">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm('Delete this attachment?')) {
            onDelete(id);
          }
        }}
        className="p-1.5 bg-black/50 hover:bg-rose-500 text-white/80 hover:text-white rounded-lg transition-all backdrop-blur-sm shadow-sm"
        aria-label="Delete image"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};

interface ImageGridProps {
  attachments: Attachment[];
  onDelete?: (attachmentId: string) => void;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
  messageId?: string;
  onJumpToMessage?: (messageId: string) => void;
}

export const ImageGrid: React.FC<ImageGridProps> = ({
  attachments,
  onDelete,
  username,
  displayName,
  avatarUrl,
  createdAt,
  messageId,
  onJumpToMessage,
}) => {
  const count = attachments.length;
  const { open } = useImageViewerActions();
  const contentFilter = useMediaSafetySettingsStore((state) => state.getSettings(state.currentUser).contentFilter);

  const handleOpen = (idx: number) => {
    const viewerAttachments = attachments.map((attachment) => (
      attachment.message_id || !messageId
        ? attachment
        : { ...attachment, message_id: messageId }
    ));
    const context: ViewerContext = {
      username,
      display_name: displayName,
      avatar_url: avatarUrl,
      created_at: createdAt,
      onJumpToMessage,
    };
    open(viewerAttachments, idx, context);
  };

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOpen(idx);
    }
  };

  if (count === 0) return null;

  // Resolve URL — use `url` if available, otherwise build from file_key
  const getRawUrl = (att: Attachment) => att.url || getAttachmentUrl(att.file_key);
  const getUrl = (att: Attachment) => getAuthAssetUrl(getRawUrl(att));
  const getFavorite = (att: Attachment) => {
    if (!isAnimatedMedia(att.content_type, att.isGif, att.url || att.file_key)) return null;
    const rawUrl = getRawUrl(att);
    return createAttachmentGifFavorite({
      id: att.id || rawUrl,
      filename: att.filename,
      fileKeyOrUrl: att.file_key || att.url,
      title: att.filename,
      sourceUrl: rawUrl,
      previewUrl: rawUrl,
      sendUrl: rawUrl,
      contentType: att.content_type,
      sizeBytes: att.size_bytes,
    });
  };

  const renderTile = (
    att: Attachment,
    idx: number,
    options: {
      frameClassName: string;
      interactiveClassName?: string;
      imageClassName: string;
      width: number;
      height: number;
    }
  ) => {
    const url = getUrl(att);
    const favorite = getFavorite(att);
    const shouldBlur = shouldBlurSensitiveAttachment(att, contentFilter);

    return (
      <SensitiveMediaFrame
        key={att.id}
        attachmentId={att.id}
        blur={shouldBlur}
        className={options.frameClassName}
      >
        {({ revealed }) => {
          const interactive = !shouldBlur || revealed;
          return (
            <div
              className={cn(options.interactiveClassName, interactive && "cursor-zoom-in")}
              onClick={interactive ? () => handleOpen(idx) : undefined}
              onKeyDown={interactive ? (e) => handleKeyDown(e, idx) : undefined}
              role="button"
              tabIndex={interactive ? 0 : -1}
            >
              <img
                src={url}
                alt={att.filename}
                width={options.width}
                height={options.height}
                className={options.imageClassName}
              />
              {favorite && <GifFavoriteButton gif={favorite} />}
              <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
              {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
            </div>
          );
        }}
      </SensitiveMediaFrame>
    );
  };

  if (count === 1) {
    const att = attachments[0];
    return renderTile(att, 0, {
      frameClassName: "w-fit rounded-xl overflow-hidden border border-rm-border group/att relative shadow-xl hover:shadow-primary/5 transition-all",
      imageClassName: "max-w-full max-h-[450px] w-auto h-auto object-contain hover:brightness-105 transition-all",
      width: 800,
      height: 450,
    });
  }

  // Multi-image container settings
  const containerClasses = "grid gap-1 rounded-xl overflow-hidden max-w-[550px] border border-rm-border shadow-xl bg-rm-bg-elevated";

  // 2 Images: Two vertical columns
  if (count === 2) {
    return (
      <div className={cn(containerClasses, "grid-cols-2 h-[300px]")}>
        {attachments.map((att, idx) => renderTile(att, idx, {
          frameClassName: "h-full w-full overflow-hidden group/att relative bg-rm-bg-primary/50",
          imageClassName: "w-full h-full object-cover hover:brightness-105 transition-all duration-500",
          width: 300,
          height: 300,
        }))}
      </div>
    );
  }

  // 3 Images: 1 large on left, 2 stacked on right
  if (count === 3) {
    return (
      <div className={cn(containerClasses, "grid-cols-2 grid-rows-2 h-[350px]")}>
        {[0, 1, 2].map((idx) => {
          const att = attachments[idx];
          return renderTile(att, idx, {
            frameClassName: cn(
              "overflow-hidden group/att relative bg-[#0a0a0c]",
              idx === 0 && "row-span-2"
            ),
            imageClassName: "w-full h-full object-cover hover:brightness-105 transition-all duration-500",
            width: idx === 0 ? 350 : 250,
            height: idx === 0 ? 350 : 175,
          });
        })}
      </div>
    );
  }

  // 4 Images: balanced 2x2
  if (count === 4) {
    return (
      <div className={cn(containerClasses, "grid-cols-2 grid-rows-2 h-[400px]")}>
        {attachments.map((att, idx) => renderTile(att, idx, {
          frameClassName: "h-full w-full overflow-hidden group/att relative bg-rm-bg-primary/50",
          imageClassName: "w-full h-full object-cover hover:brightness-105 transition-all duration-500",
          width: 250,
          height: 200,
        }))}
      </div>
    );
  }

  // 5 Images: 2 top, 3 bottom (Discord logic)
  if (count === 5) {
    return (
      <div className={cn(containerClasses, "grid-cols-6")}>
        {attachments.map((att, idx) => renderTile(att, idx, {
          frameClassName: cn(
            "h-full w-full overflow-hidden group/att relative bg-[#0a0a0c]",
            idx < 2 ? "col-span-3 aspect-video" : "col-span-2 aspect-square"
          ),
          imageClassName: "w-full h-full object-cover hover:brightness-105 transition-all duration-500",
          width: idx < 2 ? 300 : 200,
          height: idx < 2 ? 170 : 200,
        }))}
      </div>
    );
  }

  // 6+ Images: 1 big top row, 3-column rows below (Discord Feature Grid)
  const displayCount = Math.min(count, 10);

  return (
    <div className={cn(containerClasses, "grid-cols-3")}>
      {attachments.slice(0, displayCount).map((att, idx) => {
        const isFirst = idx === 0;
        const isLastVisible = idx === 9;
        const hasMore = count > 10;

        return (
          <SensitiveMediaFrame
            key={att.id}
            attachmentId={att.id}
            blur={shouldBlurSensitiveAttachment(att, contentFilter)}
            className={cn(
              "h-full w-full overflow-hidden group/att relative bg-[#0a0a0c] cursor-zoom-in",
              isFirst ? "col-span-3 h-[250px]" : "col-span-1 aspect-square"
            )}
          >
            {({ revealed }) => {
              const interactive = !shouldBlurSensitiveAttachment(att, contentFilter) || revealed;
              const favorite = getFavorite(att);
              return (
                <div
                  onClick={interactive ? () => handleOpen(idx) : undefined}
                  onKeyDown={interactive ? (e) => handleKeyDown(e, idx) : undefined}
                  role="button"
                  tabIndex={interactive ? 0 : -1}
                  className={cn("h-full w-full", interactive && "cursor-zoom-in")}
                >
                  <img
                    src={getUrl(att)}
                    alt={att.filename}
                    width={isFirst ? 550 : 180}
                    height={isFirst ? 250 : 180}
                    className="w-full h-full object-cover hover:brightness-105 transition-all duration-500"
                  />
                  {favorite && <GifFavoriteButton gif={favorite} />}
                  <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
                  {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
                  {isLastVisible && hasMore && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-[2px] pointer-events-none">
                      <span className="text-2xl font-black text-white">+{count - 10}</span>
                    </div>
                  )}
                </div>
              );
            }}
          </SensitiveMediaFrame>
        );
      })}
    </div>
  );
};
