import { getAuthAssetUrl } from "@/lib/platform";
import { getAttachmentUrl } from "@/lib/attachment-url";
import { createAttachmentGifFavorite } from "@/lib/gif-favorite-item";
import { shouldBlurSensitiveAttachment } from "@/lib/media-safety";
import { isAnimatedMedia } from "@/lib/media";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import type { ViewerContext } from "@/stores/useImageViewerStore";
import { useImageViewerActions } from "@/stores/useImageViewerStore";
import type { AvatarDisplay } from "@/lib/avatar-display";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { HIT } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import { getDirectMediaBox } from "./embed-layout";
import { GifFavoriteButton } from "./GifFavoriteButton";
import { GifProviderBranding } from "./GifProviderBranding";
import SensitiveMediaFrame from "./SensitiveMediaFrame";

import React from "react";

interface DeleteButtonProps {
  id: string;
  onDelete: (id: string) => void | Promise<unknown>;
}

const DeleteButton: React.FC<DeleteButtonProps> = ({ id, onDelete }) => {
  const [confirming, setConfirming] = React.useState(false);
  return (
    <div className="absolute top-1 right-1 pointer-fine:opacity-0 pointer-fine:group-hover/att:opacity-100 pointer-fine:group-focus-within/att:opacity-100 transition-opacity z-20">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        className={cn(
          "relative flex size-7 items-center justify-center rounded-sm border border-line bg-ply-3 text-ink-1 shadow-float outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-danger-fill pointer-fine:hover:text-on-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          HIT,
        )}
        aria-label="Delete attachment"
      >
        <Icon name="trash" size="sm" />
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete attachment"
        description="This image will be removed from the message. This can't be undone."
        confirmLabel="Delete attachment"
        irreversible
        errorAction="delete this attachment"
        onConfirm={() => onDelete(id)}
      />
    </div>
  );
};

/**
 * Intrinsic size, when the upload or the server recorded one. Attachments do
 * not carry it yet (see the handoff in the change log); when they do, the
 * single image reserves its real box instead of reflowing on load.
 */
function getIntrinsicSize(
  att: Attachment,
): { width: number; height: number } | null {
  const sized = att as Attachment & { width?: unknown; height?: unknown };
  return typeof sized.width === "number" && typeof sized.height === "number"
    ? { width: sized.width, height: sized.height }
    : null;
}

/** "+3" over the last visible tile when more images are hidden. */
function MoreOverlay({ count }: { count: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-scrim">
      <span className="rounded-md bg-ply-3 px-2 py-1 text-ink-1">
        <Num size="sm">+{count}</Num>
      </span>
    </div>
  );
}

interface ImageGridProps {
  attachments: Attachment[];
  onDelete?: (attachmentId: string) => void | Promise<unknown>;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  avatarDisplay?: AvatarDisplay | string | null;
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
  avatarDisplay,
  createdAt,
  messageId,
  onJumpToMessage,
}) => {
  const count = attachments.length;
  const { open } = useImageViewerActions();
  const contentFilter = useMediaSafetySettingsStore(
    (state) => state.getSettings(state.currentUser).contentFilter,
  );

  const handleOpen = (idx: number) => {
    const viewerAttachments = attachments.map((attachment) =>
      attachment.message_id || !messageId
        ? attachment
        : { ...attachment, message_id: messageId },
    );
    const context: ViewerContext = {
      username,
      display_name: displayName,
      avatar_url: avatarUrl,
      avatar_display: avatarDisplay,
      created_at: createdAt,
      onJumpToMessage,
    };
    open(viewerAttachments, idx, context);
  };

  if (count === 0) return null;

  // Resolve URL — use `url` if available, otherwise build from file_key
  const getRawUrl = (att: Attachment) =>
    att.url || getAttachmentUrl(att.file_key);
  const getUrl = (att: Attachment) => getAuthAssetUrl(getRawUrl(att));
  const getFavorite = (att: Attachment) => {
    if (!isAnimatedMedia(att.content_type, att.isGif, att.url || att.file_key))
      return null;
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

  const renderViewerButton = (
    att: Attachment,
    idx: number,
    interactive: boolean,
  ) => (
    <button
      type="button"
      onClick={() => handleOpen(idx)}
      disabled={!interactive}
      aria-label={att.filename ? `Open ${att.filename}` : "Open image"}
      className={cn(
        // Hover is an ink tint over the image (colour at --dur-1), not a
        // brightness filter; focus draws the ring inside the clipped tile.
        "absolute inset-0 z-10 outline-none transition-colors duration-(--dur-1) ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        interactive && "cursor-zoom-in pointer-fine:hover:bg-tint-1",
      )}
    />
  );

  const renderTile = (
    att: Attachment,
    idx: number,
    options: {
      frameClassName: string;
      frameStyle?: React.CSSProperties;
      interactiveClassName?: string;
      imageClassName: string;
      width?: number;
      height?: number;
    },
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
        style={options.frameStyle}
      >
        {({ revealed }) => {
          const interactive = !shouldBlur || revealed;
          return (
            <div
              className={cn(
                "relative",
                options.interactiveClassName,
                interactive && "cursor-zoom-in",
              )}
              data-media-element="true"
              data-media-url={getRawUrl(att)}
              data-media-download-url={url}
              data-media-filename={att.filename}
            >
              {renderViewerButton(att, idx, interactive)}
              <img
                src={url}
                alt={att.filename}
                width={options.width}
                height={options.height}
                decoding="async"
                className={cn(options.imageClassName, "pointer-events-none")}
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

  // One image fits the media box (640x400, never upscaled) at radius 12. With
  // a known size the box is reserved up front; without one the image sizes
  // itself (no fake 800x450 placeholder that reflows when it decodes).
  if (count === 1) {
    const att = attachments[0];
    const size = getIntrinsicSize(att);
    const box = size ? getDirectMediaBox(size.width, size.height) : null;
    return renderTile(att, 0, {
      frameClassName:
        "group/att relative w-fit max-w-full overflow-hidden rounded-xl border border-line bg-tint-1",
      frameStyle: box
        ? { width: `min(100%, ${box.width}px)`, aspectRatio: box.aspectRatio }
        : undefined,
      interactiveClassName: box ? "h-full w-full" : undefined,
      imageClassName: box
        ? "block h-full w-full object-contain"
        : "block h-auto max-h-100 w-auto max-w-[min(100%,40rem)] object-contain",
      width: size?.width,
      height: size?.height,
    });
  }

  // Multi-image grids sit at the standard embed width (520), radius 12.
  const containerClasses =
    "grid max-w-130 gap-1 overflow-hidden rounded-xl border border-line bg-ply-2";
  // Multi-image tiles fill their grid cell.
  const fill = "h-full w-full";

  // 2 Images: Two vertical columns
  if (count === 2) {
    return (
      <div className={cn(containerClasses, "grid-cols-2 aspect-video")}>
        {attachments.map((att, idx) =>
          renderTile(att, idx, {
            frameClassName:
              "group/att relative h-full w-full overflow-hidden bg-tint-1",
            interactiveClassName: fill,
            imageClassName: "h-full w-full object-cover",
            width: 300,
            height: 300,
          }),
        )}
      </div>
    );
  }

  // 3 Images: 1 large on left, 2 stacked on right
  if (count === 3) {
    return (
      <div
        className={cn(containerClasses, "grid-cols-2 grid-rows-2 aspect-3/2")}
      >
        {[0, 1, 2].map((idx) => {
          const att = attachments[idx];
          return renderTile(att, idx, {
            frameClassName: cn(
              "group/att relative overflow-hidden bg-tint-1",
              idx === 0 && "row-span-2",
            ),
            interactiveClassName: fill,
            imageClassName: "h-full w-full object-cover",
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
      <div
        className={cn(containerClasses, "grid-cols-2 grid-rows-2 aspect-4/3")}
      >
        {attachments.map((att, idx) =>
          renderTile(att, idx, {
            frameClassName:
              "group/att relative h-full w-full overflow-hidden bg-tint-1",
            interactiveClassName: fill,
            imageClassName: "h-full w-full object-cover",
            width: 250,
            height: 200,
          }),
        )}
      </div>
    );
  }

  // 5 Images: 2 top, 3 bottom (Discord logic)
  if (count === 5) {
    return (
      <div className={cn(containerClasses, "grid-cols-6")}>
        {attachments.map((att, idx) =>
          renderTile(att, idx, {
            frameClassName: cn(
              "group/att relative h-full w-full overflow-hidden bg-tint-1",
              idx < 2 ? "col-span-3 aspect-video" : "col-span-2 aspect-square",
            ),
            interactiveClassName: fill,
            imageClassName: "h-full w-full object-cover",
            width: idx < 2 ? 300 : 200,
            height: idx < 2 ? 170 : 200,
          }),
        )}
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
              "group/att relative h-full w-full overflow-hidden bg-tint-1",
              isFirst ? "col-span-3 aspect-2/1" : "col-span-1 aspect-square",
            )}
          >
            {({ revealed }) => {
              const interactive =
                !shouldBlurSensitiveAttachment(att, contentFilter) || revealed;
              const favorite = getFavorite(att);
              return (
                <div
                  className={cn(
                    "relative h-full w-full",
                    interactive && "cursor-zoom-in",
                  )}
                  data-media-element="true"
                  data-media-url={getRawUrl(att)}
                  data-media-download-url={getUrl(att)}
                  data-media-filename={att.filename}
                >
                  {renderViewerButton(att, idx, interactive)}
                  <img
                    src={getUrl(att)}
                    alt={att.filename}
                    width={isFirst ? 550 : 180}
                    height={isFirst ? 250 : 180}
                    decoding="async"
                    className="pointer-events-none h-full w-full object-cover"
                  />
                  {favorite && <GifFavoriteButton gif={favorite} />}
                  <GifProviderBranding fileKeyOrUrl={att.file_key || att.url} />
                  {onDelete && <DeleteButton id={att.id} onDelete={onDelete} />}
                  {isLastVisible && hasMore && (
                    <MoreOverlay count={count - 10} />
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
