import { getDisplayName } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { getWebOrigin } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { formatRelative } from "date-fns";
import { enUS } from "date-fns/locale";
import {
  ChevronRight,
  Copy,
  Download,
  FileDigit,
  Info,
  Link as LinkIcon,
  MessageSquare,
  MoreHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { AvatarImage } from "./AvatarImage";
import { UserDisplayName } from "./UserDisplayName";

const formatRelativeLocale: Record<string, string> = {
  lastWeek: "eeee 'at' p",
  yesterday: "'Yesterday at' p",
  today: "'Today at' p",
  tomorrow: "'Tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P",
};

const locale = {
  ...enUS,
  formatRelative: (token: string) =>
    formatRelativeLocale[token] || formatRelativeLocale.other,
};

export function formatFriendlyDate(dateInput: string | Date): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return formatRelative(date, new Date(), { locale });
}

export const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

interface ImageViewerToolbarProps {
  context: any;
  currentImage: any;
  showMore: boolean;
  showDetails: boolean;
  dimensions: { width: number; height: number } | null;
  setLocalState: (update: any) => void;
  viewDispatch: (action: any) => void;
  close: () => void;
  getUrl: (img: any) => string;
  isVideo?: boolean;
  isAnimatedMedia?: boolean;
}

export function ImageViewerToolbar({
  context,
  currentImage,
  showMore,
  showDetails,
  dimensions,
  setLocalState,
  viewDispatch,
  close,
  getUrl,
  isVideo,
  isAnimatedMedia,
}: ImageViewerToolbarProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setLocalState({ showMore: false, showDetails: false });
      }
    };
    if (showMore) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMore, setLocalState]);

  const handleCopyLink = () => {
    if (currentImage) {
      const url = getUrl(currentImage);
      const shareableUrl = /^https?:\/\//i.test(url)
        ? url
        : `${getWebOrigin()}${url}`;
      navigator.clipboard.writeText(shareableUrl);
      setLocalState({ showMore: false });
    }
  };

  const handleCopyId = () => {
    if (currentImage) {
      navigator.clipboard.writeText(currentImage.id);
      setLocalState({ showMore: false });
    }
  };

  const handleCopyImage = async () => {
    if (!currentImage) return;
    try {
      const response = await fetch(getUrl(currentImage));
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      setLocalState({ showMore: false });
    } catch (err) {
      console.error("Failed to copy image", err);
    }
  };

  const handleForward = () => {
    const messageId = currentImage?.message_id;
    if (!messageId || typeof context?.onJumpToMessage !== "function") return;

    close();
    setTimeout(() => {
      context.onJumpToMessage?.(messageId);
    }, 0);
  };

  const formattedDate = context?.created_at
    ? formatFriendlyDate(context.created_at)
    : "";
  const displayName = getDisplayName(context, "Unknown User");

  return (
    <div className="absolute top-0 left-0 right-0 z-50 flex items-start justify-between gap-2 bg-linear-to-b from-rm-bg-primary/80 to-transparent p-2 pointer-events-none md:items-center md:p-4">
      {/* Left: User Info */}
      <div className="flex min-w-0 items-center gap-3 pointer-events-auto">
        {context?.avatar_url && (
          <div className="h-7 w-7 overflow-visible rounded-full md:h-8 md:w-8">
            <AvatarImage
              src={getAuthAssetUrl(context.avatar_url)}
              alt={displayName}
              display={context.avatar_display}
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <UserDisplayName
            user={context}
            fallback="Unknown User"
            className="block truncate text-sm font-bold leading-none text-rm-text drop-shadow-md"
          />
          {formattedDate && (
            <span className="truncate text-[10px] font-medium text-rm-text-muted drop-shadow-md">
              {formattedDate}
            </span>
          )}
        </div>
      </div>

      {/* Right: Tool groups */}
      <div className="flex shrink-0 items-center gap-2 pointer-events-auto">
        {/* Action buttons pill group */}
        <div className="flex items-center gap-0.5 bg-rm-bg-elevated/80 backdrop-blur-md border border-rm-border rounded-xl px-1 py-1 shadow-lg">
          {!isVideo && (
            <>
              <button
                type="button"
                onClick={() => viewDispatch({ type: "ZOOM_OUT" })}
                className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all outline-none"
                aria-label="Zoom out"
                title="Zoom Out"
              >
                <ZoomOut size={18} />
              </button>
              <button
                type="button"
                onClick={() => viewDispatch({ type: "ZOOM_IN" })}
                className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all outline-none"
                aria-label="Zoom in"
                title="Zoom In"
              >
                <ZoomIn size={18} />
              </button>
            </>
          )}

          {currentImage?.message_id &&
            typeof context?.onJumpToMessage === "function" && (
              <button
                type="button"
                onClick={handleForward}
                className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all outline-none"
                aria-label="Jump to message"
                title="Jump to Message"
              >
                <MessageSquare size={18} />
              </button>
            )}

          <a
            href={getUrl(currentImage)}
            download={currentImage.filename}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all outline-none"
            aria-label="Download attachment"
            title="Download"
          >
            <Download size={18} />
          </a>

          {/* More Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => {
                setLocalState((prev: any) => ({
                  showMore: !prev.showMore,
                  showDetails: false,
                }));
              }}
              className={cn(
                "p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all outline-none",
                showMore && "bg-primary text-primary-foreground",
              )}
              aria-expanded={showMore}
              aria-haspopup="menu"
              aria-label="More attachment actions"
            >
              <MoreHorizontal size={18} />
            </button>
            {showMore && (
              <div className="absolute top-full right-0 z-100 mt-2 w-[min(16rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] overflow-visible rounded-lg border border-rm-border bg-rm-bg-elevated py-1 shadow-2xl animate-in slide-in-from-top-2 fade-in duration-200 md:w-64">
                {!isVideo && (
                  <button
                    type="button"
                    onClick={handleCopyImage}
                    className="w-full px-3 py-2 text-left text-sm text-rm-text-secondary hover:bg-primary hover:text-primary-foreground flex items-center justify-between group outline-none"
                  >
                    Copy Image
                    <Copy
                      size={14}
                      className="opacity-50 group-hover:opacity-100"
                    />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full px-3 py-2 text-left text-sm text-rm-text-secondary hover:bg-primary hover:text-primary-foreground flex items-center justify-between group outline-none"
                >
                  Copy Link
                  <LinkIcon
                    size={14}
                    className="opacity-50 group-hover:opacity-100"
                  />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocalState((prev: any) => ({
                      showDetails: !prev.showDetails,
                    }));
                  }}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm flex items-center justify-between group transition-colors outline-none",
                    showDetails
                      ? "bg-primary/20 text-primary"
                      : "text-rm-text-secondary hover:bg-primary hover:text-primary-foreground",
                  )}
                >
                  View Details
                  <ChevronRight
                    size={14}
                    className={cn(
                      "transition-transform duration-200",
                      showDetails
                        ? "rotate-90 opacity-100"
                        : "opacity-50 group-hover:opacity-100",
                    )}
                  />
                </button>

                <div className="h-px bg-rm-border my-1" />
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive hover:text-destructive-foreground flex items-center justify-between group outline-none transition-colors"
                >
                  Copy Attachment ID
                  <FileDigit
                    size={14}
                    className="opacity-50 group-hover:opacity-100"
                  />
                </button>

                {showDetails && (
                  <section
                    className="absolute top-full right-0 mt-2 w-[min(20rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] rounded-lg border border-rm-border bg-rm-bg-elevated p-4 shadow-xl animate-in slide-in-from-top-2 fade-in duration-200 cursor-default outline-none md:top-0 md:right-[calc(100%+8px)] md:mt-0 md:w-64 md:max-w-64 md:slide-in-from-right-4"
                    aria-label="Image details panel"
                  >
                    <h3 className="text-rm-text font-semibold mb-3 text-sm flex items-center gap-2">
                      <Info size={14} className="text-primary" />
                      {isAnimatedMedia
                        ? "GIF Details"
                        : isVideo
                          ? "Video Details"
                          : "Image Details"}
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <div className="text-[10px] font-bold text-rm-text-muted uppercase mb-1">
                          Filename
                        </div>
                        <div className="text-xs text-rm-text break-all bg-rm-bg-surface/40 p-2 rounded border border-rm-border font-mono">
                          {currentImage.filename}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] font-bold text-rm-text-muted uppercase mb-1">
                            Dimensions
                          </div>
                          <div className="text-sm text-rm-text font-medium">
                            {dimensions
                              ? `${dimensions.width}×${dimensions.height}`
                              : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-rm-text-muted uppercase mb-1">
                            Size
                          </div>
                          <div className="text-sm text-rm-text font-medium">
                            {formatBytes(currentImage.size_bytes)}
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-rm-text-muted uppercase mb-1">
                          Type
                        </div>
                        <div className="text-xs text-rm-text-muted font-mono">
                          {currentImage.content_type}
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Close button – own pill group */}
        <div className="bg-rm-bg-elevated/80 backdrop-blur-md border border-rm-border rounded-xl p-1 shadow-lg">
          <button
            type="button"
            onClick={close}
            className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all outline-none"
            aria-label="Close media viewer"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
