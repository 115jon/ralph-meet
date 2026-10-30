import type { MediaContentFilter } from "@/lib/media-content-filter";
import { shouldBlurSensitiveAttachment } from "@/lib/media-safety";
import { isAnimatedMedia, isVideo } from "@/lib/media";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import React from "react";

interface ImageViewerThumbnailsProps {
  images: any[];
  currentIndex: number;
  contentFilter: MediaContentFilter;
  thumbAspects: React.MutableRefObject<Map<number, number>>;
  setLocalState: (update: any) => void;
  getUrl: (img: any) => string;
  getPosterUrl: (img: any) => string | undefined;
}

export function ImageViewerThumbnails({
  images,
  currentIndex,
  contentFilter,
  thumbAspects,
  setLocalState,
  getUrl,
  getPosterUrl,
}: ImageViewerThumbnailsProps) {
  const isWide =
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 768px)").matches;
  const thumbH = isWide ? 48 : 40;
  const baseW = thumbH; // whole square cells; the selected one takes its aspect

  return (
    <div className="absolute bottom-[calc(12px+var(--safe-area-bottom,0px))] left-1/2 z-50 max-w-[calc(100vw-24px)] -translate-x-1/2 md:bottom-5">
      <div
        role="group"
        aria-label="Media in this message"
        className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-ply-3 p-1.5 shadow-float"
      >
        {images.map((img, idx) => {
          const isSelected = idx === currentIndex;
          const isAnimated = isAnimatedMedia(
            img.content_type,
            img.isGif,
            img.url || img.file_key,
          );
          const isVideoItem = isVideo(img.content_type);
          const shouldBlur = shouldBlurSensitiveAttachment(img, contentFilter);
          const posterUrl =
            !isAnimated && isVideoItem ? getPosterUrl(img) : undefined;
          const aspect = thumbAspects.current.get(idx);
          // Selected thumbnail morphs width to match aspect ratio; others use base width
          // Cap aspect at 3:1 to prevent ultra-wide thumbnails
          const clampedAspect = aspect ? Math.min(Math.max(aspect, 0.5), 3) : 1;
          const thumbWidth =
            isSelected && aspect ? Math.round(thumbH * clampedAspect) : baseW;

          return (
            <button
              key={(img.url || img.file_key) + idx}
              onClick={(e) => {
                e.stopPropagation();
                setLocalState({ currentIndex: idx, isLoaded: false });
              }}
              aria-current={isSelected ? "true" : undefined}
              aria-label={
                shouldBlur
                  ? `Sensitive media thumbnail ${idx + 1}`
                  : `Media thumbnail ${idx + 1}`
              }
              title={shouldBlur ? "Sensitive media" : undefined}
              className={cn(
                "group relative shrink-0 overflow-hidden rounded-md bg-tint-1 transition-opacity duration-(--dur-1) ease-out",
                isSelected
                  ? "opacity-100 ring-2 ring-accent-ink ring-offset-2 ring-offset-ply-3"
                  : "opacity-55 pointer-fine:hover:opacity-100",
              )}
              style={{
                height: thumbH,
                width: thumbWidth,
              }}
            >
              {isVideoItem ? (
                <>
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={`Video thumbnail ${idx + 1}`}
                      data-rm-preserve-blur={shouldBlur ? "true" : undefined}
                      className={cn(
                        "w-full h-full object-cover",
                        shouldBlur && "scale-110 blur-sm saturate-50",
                      )}
                      loading="lazy"
                      onLoad={(e) => {
                        const el = e.currentTarget;
                        if (
                          el.naturalWidth &&
                          el.naturalHeight &&
                          !thumbAspects.current.has(idx)
                        ) {
                          thumbAspects.current.set(
                            idx,
                            el.naturalWidth / el.naturalHeight,
                          );
                          setLocalState((prev: any) => ({
                            thumbUpdate: prev.thumbUpdate + 1,
                          }));
                        }
                      }}
                    />
                  ) : (
                    <video
                      src={getUrl(img)}
                      aria-label="Media thumbnail preview"
                      data-rm-preserve-blur={shouldBlur ? "true" : undefined}
                      muted
                      playsInline
                      preload="metadata"
                      className={cn(
                        "w-full h-full object-cover",
                        shouldBlur && "scale-110 blur-sm saturate-50",
                      )}
                      onLoadedMetadata={(e) => {
                        const el = e.currentTarget;
                        if (
                          el.videoWidth &&
                          el.videoHeight &&
                          !thumbAspects.current.has(idx)
                        ) {
                          thumbAspects.current.set(
                            idx,
                            el.videoWidth / el.videoHeight,
                          );
                          setLocalState((prev: any) => ({
                            thumbUpdate: prev.thumbUpdate + 1,
                          }));
                        }
                      }}
                    />
                  )}
                  {!isAnimated && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex size-5 items-center justify-center rounded-full bg-ply-3 text-ink-1 shadow-float">
                        <Icon name="play" size="xs" state="active" />
                      </span>
                    </span>
                  )}
                </>
              ) : (
                <img
                  src={getUrl(img)}
                  alt={`Thumbnail ${idx + 1}`}
                  data-rm-preserve-blur={shouldBlur ? "true" : undefined}
                  className={cn(
                    "w-full h-full object-cover",
                    shouldBlur && "scale-110 blur-sm saturate-50",
                  )}
                  loading="lazy"
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    if (
                      el.naturalWidth &&
                      el.naturalHeight &&
                      !thumbAspects.current.has(idx)
                    ) {
                      thumbAspects.current.set(
                        idx,
                        el.naturalWidth / el.naturalHeight,
                      );
                      setLocalState((prev: any) => ({
                        thumbUpdate: prev.thumbUpdate + 1,
                      }));
                    }
                  }}
                />
              )}
              {shouldBlur && (
                <div className="pointer-events-none absolute inset-0 bg-scrim" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
