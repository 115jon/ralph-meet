import { cn } from "@/lib/utils";
import { getFileIcon } from "@/lib/file-icons";
import { isPlayableVideo } from "@/lib/media";
import { getAuthAssetUrl } from "@/lib/platform";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Button, Spinner } from "@/components/ui/button";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { COMPOSER_TRAY } from "./ReplyIndicator";
import type { PendingUpload, UploadedFile } from "./useMessageInput";

interface AttachmentListProps {
  uploadedFiles: UploadedFile[];
  pendingUploads: PendingUpload[];
  onRemove: (id: string) => void;
  onToggleSensitive: (id: string) => void;
  onCancel: (tempId: string) => void;
  /** Re-run a failed upload. Without it a failed tile can only be dismissed. */
  onRetry?: (tempId: string) => void;
}

/** 96px tile (8px gaps); `rm-list-enter` gives each add its own fade-in. */
const TILE =
  "rm-list-enter group relative size-24 shrink-0 overflow-hidden rounded-md border bg-tint-2";

/** A chip on top of media: a ply-3 wash reads in every theme (no raw black). */
const MEDIA_CHIP =
  "absolute z-10 inline-flex h-5 items-center justify-center rounded-sm bg-ply-3/90 text-ink-1";

/** The 24px control in a tile's top-right corner, revealed like row actions. */
const TILE_ACTION = "absolute top-1 right-1 z-20 bg-ply-3/90";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SizeChip({ bytes }: { bytes: number }) {
  return (
    <Num
      size="xs"
      className={cn(MEDIA_CHIP, "right-1 bottom-1 px-1 text-ink-2")}
    >
      {formatFileSize(bytes)}
    </Num>
  );
}

/** The sensitive-media toggle: always visible, a 20px chip (not hover-only). */
function SensitiveToggle({
  file,
  onToggle,
}: {
  file: UploadedFile;
  onToggle: (id: string) => void;
}) {
  const on = !!file.is_nsfw;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onToggle(file.id)}
          aria-pressed={on}
          aria-label={
            on
              ? `${file.filename} is marked sensitive. Unmark it`
              : `Mark ${file.filename} as sensitive`
          }
          className={cn(
            PRESS,
            HIT,
            MEDIA_CHIP,
            "bottom-1 left-1 w-5 outline-none",
            on
              ? "text-warning-ink"
              : "text-ink-2 pointer-fine:hover:text-ink-1",
          )}
        >
          <Icon name="warning" size="xs" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {on ? "Marked sensitive" : "Mark as sensitive"}
      </TooltipContent>
    </Tooltip>
  );
}

function UploadedTile({
  file,
  onRemove,
  onToggleSensitive,
}: {
  file: UploadedFile;
  onRemove: (id: string) => void;
  onToggleSensitive: (id: string) => void;
}) {
  const nsfw = !!file.is_nsfw;
  const src = file.previewUrl || getAuthAssetUrl(file.url);
  const { icon: typeIcon } = getFileIcon(file.filename, file.content_type);
  const playable = isPlayableVideo(file.content_type);

  return (
    <li className={cn(TILE, nsfw ? "border-warning-ink" : "border-line")}>
      {file.content_type.startsWith("image/") ? (
        <img
          src={src}
          alt={file.filename}
          title={file.filename}
          data-rm-preserve-blur={nsfw ? "true" : undefined}
          className={cn(
            "size-full object-cover",
            nsfw && "blur-sm saturate-75",
          )}
        />
      ) : playable ? (
        <div className="relative size-full bg-ply-0">
          <video
            src={src}
            aria-label={file.filename}
            data-rm-preserve-blur={nsfw ? "true" : undefined}
            className={cn(
              "size-full object-cover",
              nsfw && "blur-sm saturate-75",
            )}
            preload="metadata"
            muted
          >
            <track kind="captions" />
          </video>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex size-8 items-center justify-center rounded-[2px] bg-ply-3/90 text-ink-1">
              <Icon name="play" state="active" size="sm" />
            </span>
          </div>
        </div>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 px-2 pt-1 pb-7">
          <Icon name={typeIcon} size="xl" className="text-ink-2" />
          <span
            title={file.filename}
            className="line-clamp-2 w-full text-center text-ui-xs break-all text-ink-1"
          >
            {file.filename}
          </span>
        </div>
      )}
      <SensitiveToggle file={file} onToggle={onToggleSensitive} />
      <SizeChip bytes={file.size} />
      <IconButton
        type="button"
        icon="trash"
        size={24}
        aria-label={`Remove ${file.filename}`}
        onClick={() => onRemove(file.id)}
        className={cn(TILE_ACTION, REVEAL)}
      />
    </li>
  );
}

function PendingTile({
  upload,
  onCancel,
  onRetry,
}: {
  upload: PendingUpload;
  onCancel: (tempId: string) => void;
  onRetry?: (tempId: string) => void;
}) {
  const failed = !!upload.error;
  // Only an image can preview as an <img>; a video's blob URL would break.
  const imagePreview =
    upload.previewUrl && upload.file.type.startsWith("image/")
      ? upload.previewUrl
      : null;

  return (
    <li className={cn(TILE, failed ? "border-danger-ink" : "border-line")}>
      {imagePreview ? (
        <img
          src={imagePreview}
          alt=""
          className={cn(
            "absolute inset-0 size-full object-cover",
            failed ? "opacity-20" : "opacity-40",
          )}
        />
      ) : null}

      {failed ? (
        <div
          role="alert"
          className="relative z-10 flex size-full flex-col items-center justify-center gap-1 px-2"
        >
          <Icon name="alert" size="md" className="text-danger-ink" />
          <span
            title={upload.error}
            className="text-center text-ui-xs font-medium text-danger-ink"
          >
            Upload failed
          </span>
          <span className="sr-only">{upload.file.name}</span>
          {onRetry ? (
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={() => onRetry(upload.tempId)}
              aria-label={`Retry uploading ${upload.file.name}`}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          role="status"
          className="relative z-10 flex size-full flex-col items-center justify-center gap-1 px-2"
        >
          <Spinner className="size-5 text-ink-2" />
          <span className="sr-only">Uploading {upload.file.name}</span>
          <span
            aria-hidden="true"
            className="w-full truncate text-center text-ui-xs font-medium text-ink-1"
          >
            {upload.file.name}
          </span>
        </div>
      )}

      {!failed ? <SizeChip bytes={upload.file.size} /> : null}

      {/* Determinate once a transport reports progress (0..1); today's fetch
          upload doesn't, so the spinner above is the whole indicator. Scale
          is a transform, so the bar never lays out. */}
      {!failed && upload.progress > 0 ? (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent-ink transition-transform duration-(--dur-2) ease-linear"
          style={{ transform: `scaleX(${Math.min(1, upload.progress)})` }}
        />
      ) : null}

      <IconButton
        type="button"
        icon="close"
        size={24}
        aria-label={`${failed ? "Remove" : "Cancel uploading"} ${upload.file.name}`}
        onClick={() => onCancel(upload.tempId)}
        className={cn(TILE_ACTION, REVEAL)}
      />
    </li>
  );
}

/**
 * The upload tray: one `COMPOSER_TRAY` band under the reply bar. It mounts
 * only while there are files (enter: opacity + 4px, no height tween) and each
 * tile fades in on its own; leaving is instant.
 */
export default function AttachmentList({
  uploadedFiles,
  pendingUploads,
  onRemove,
  onToggleSensitive,
  onCancel,
  onRetry,
}: AttachmentListProps) {
  if (uploadedFiles.length === 0 && pendingUploads.length === 0) return null;

  return (
    <ul
      aria-label="Attachments"
      data-testid="upload-tray"
      className={cn(
        COMPOSER_TRAY,
        "custom-scrollbar flex max-h-64 flex-wrap gap-2 overflow-y-auto px-3 py-2",
      )}
    >
      {uploadedFiles.map((file) => (
        <UploadedTile
          key={file.id}
          file={file}
          onRemove={onRemove}
          onToggleSensitive={onToggleSensitive}
        />
      ))}
      {pendingUploads.map((upload) => (
        <PendingTile
          key={upload.tempId}
          upload={upload}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      ))}
    </ul>
  );
}
