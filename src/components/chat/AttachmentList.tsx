import { cn } from "@/lib/utils";
import { getFileIcon } from "@/lib/file-icons";
import { isPlayableVideo } from "@/lib/media";
import { getAuthAssetUrl } from "@/lib/platform";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/button";
import { HIT, PRESS, REVEAL } from "@/components/ui/interaction";
import { UploadedFileInfo } from "./MessageInput";

interface PendingUpload {
  tempId: string;
  file: File;
  progress: number;
  previewUrl?: string;
  abortController: AbortController;
}

interface AttachmentListProps {
  uploadedFiles: UploadedFileInfo[];
  pendingUploads: PendingUpload[];
  onRemove: (id: string) => void;
  onToggleSensitive: (id: string) => void;
  onCancel: (tempId: string) => void;
}

export default function AttachmentList({
  uploadedFiles,
  pendingUploads,
  onRemove,
  onToggleSensitive,
  onCancel,
}: AttachmentListProps) {
  const hasFiles = uploadedFiles.length > 0 || pendingUploads.length > 0;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-3 border-rm-border bg-rm-bg-elevated rounded-t-2xl transition-ui ease-out overflow-hidden",
        hasFiles
          ? "p-4 border-b max-h-[400px] opacity-100 translate-y-0"
          : "max-h-0 p-0 border-b-0 opacity-0 translate-y-2 pointer-events-none",
      )}
    >
      {uploadedFiles.map((att) => (
        <div
          key={att.id}
          className={cn(
            "group relative size-28 overflow-hidden rounded-lg border bg-rm-bg-surface animate-in fade-in slide-in-from-bottom-2 duration-200",
            att.is_nsfw ? "border-rm-warning-ink" : "border-rm-border",
          )}
        >
          {att.content_type.startsWith("image/") || att.previewUrl ? (
            <img
              src={att.previewUrl || getAuthAssetUrl(att.url)}
              alt={att.filename}
              title={att.filename}
              data-rm-preserve-blur={att.is_nsfw ? "true" : undefined}
              className={cn(
                "w-full h-full object-cover",
                att.is_nsfw && "blur-sm saturate-75",
              )}
            />
          ) : isPlayableVideo(att.content_type) ? (
            <div className="w-full h-full bg-black flex items-center justify-center relative">
              <video
                src={att.previewUrl || getAuthAssetUrl(att.url)}
                aria-label={att.filename}
                data-rm-preserve-blur={att.is_nsfw ? "true" : undefined}
                className={cn(
                  "w-full h-full object-cover",
                  att.is_nsfw && "blur-sm saturate-75",
                )}
                preload="metadata"
                muted
              >
                <track kind="captions" />
              </video>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                  <svg
                    viewBox="0 0 24 24"
                    fill="white"
                    className="w-4 h-4 ml-0.5"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </div>
          ) : (
            (() => {
              const { icon: typeIcon, colorClass } = getFileIcon(
                att.filename,
                att.content_type,
              );
              return (
                <div className="w-full h-full flex flex-col items-center justify-center p-3">
                  <div
                    className={`p-2 rounded-lg mb-2 ${colorClass} bg-rm-bg-surface`}
                  >
                    <Icon name={typeIcon} size="xl" />
                  </div>
                  <span className="text-ui-2xs text-rm-text font-medium text-center line-clamp-2 px-1">
                    {att.filename}
                  </span>
                </div>
              );
            })()
          )}
          <button
            type="button"
            onClick={() => onToggleSensitive(att.id)}
            className={cn(
              // Media overlay chip over the preview (6.5).
              "absolute bottom-1 left-1 inline-flex h-6 items-center gap-1 rounded-sm bg-black/60 px-1.5 text-ui-2xs font-semibold text-white",
              PRESS,
              HIT,
              "absolute",
            )}
            aria-pressed={att.is_nsfw}
            aria-label={
              att.is_nsfw
                ? `${att.filename} is marked sensitive. Unmark it`
                : `Mark ${att.filename} as sensitive`
            }
          >
            <Icon name="warning" size="xs" />
            {att.is_nsfw ? "Sensitive" : "Not sensitive"}
          </button>
          <button
            type="button"
            onClick={() => onRemove(att.id)}
            aria-label={`Remove ${att.filename}`}
            className={cn(
              "absolute top-1 right-1 z-10 flex size-7 items-center justify-center rounded-md bg-black/60 text-white",
              PRESS,
              HIT,
              "absolute",
              REVEAL,
            )}
          >
            <Icon name="trash" size="sm" />
          </button>
        </div>
      ))}
      {pendingUploads.map((p) => (
        <div
          key={p.tempId}
          className="group relative flex size-28 flex-col items-center justify-center overflow-hidden rounded-lg border border-rm-border bg-rm-bg-surface"
        >
          {p.previewUrl ? (
            <img
              src={p.previewUrl}
              alt="Upload preview"
              className="absolute inset-0 w-full h-full object-cover opacity-40"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              {(() => {
                const { icon: pendingIcon } = getFileIcon(
                  p.file.name,
                  p.file.type,
                );
                return (
                  <Icon
                    name={pendingIcon}
                    size="3xl"
                    className="text-rm-text"
                  />
                );
              })()}
            </div>
          )}
          <div
            role="status"
            className="z-10 flex h-full w-full flex-col items-center justify-center gap-2 p-3"
          >
            <Spinner className="size-6 text-rm-accent-ink" />
            <span className="sr-only">Uploading</span>
            <span className="w-full truncate px-1 text-center text-ui-2xs font-medium text-rm-text-secondary">
              {p.file.name}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onCancel(p.tempId)}
            aria-label={`Cancel uploading ${p.file.name}`}
            className={cn(
              "absolute top-1 right-1 z-20 flex size-7 items-center justify-center rounded-md bg-black/60 text-white",
              PRESS,
              HIT,
              "absolute",
              REVEAL,
            )}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
