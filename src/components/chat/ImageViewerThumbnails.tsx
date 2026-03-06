import { cn } from '@/lib/utils';
import React from 'react';

interface ImageViewerThumbnailsProps {
  images: any[];
  currentIndex: number;
  thumbAspects: React.MutableRefObject<Map<number, number>>;
  setLocalState: (update: any) => void;
  getUrl: (img: any) => string;
}

export function ImageViewerThumbnails({
  images, currentIndex, thumbAspects, setLocalState, getUrl
}: ImageViewerThumbnailsProps) {
  const isWide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
  const thumbH = isWide ? 56 : 44;
  const baseW = isWide ? 56 : 30; // square on desktop, portrait on mobile

  return (
    <div className="absolute bottom-3 md:bottom-6 left-1/2 -translate-x-1/2 max-w-[92vw] md:max-w-[90vw] z-50">
      <div className="flex items-center gap-2 p-2 bg-rm-bg-primary/40 backdrop-blur-xl rounded-2xl border border-rm-border overflow-x-auto shadow-2xl custom-scrollbar no-scrollbar">
        {images.map((img, idx) => {
          const isSelected = idx === currentIndex;
          const aspect = thumbAspects.current.get(idx);
          // Selected thumbnail morphs width to match aspect ratio; others use base width
          // Cap aspect at 3:1 to prevent ultra-wide thumbnails
          const clampedAspect = aspect ? Math.min(Math.max(aspect, 0.5), 3) : 1;
          const thumbWidth = isSelected && aspect ? Math.round(thumbH * clampedAspect) : baseW;

          return (
            <button
              key={(img.url || img.file_key) + idx}
              onClick={(e) => {
                e.stopPropagation();
                setLocalState({ currentIndex: idx, isLoaded: false });
              }}
              className={cn(
                "relative rounded-lg overflow-hidden shrink-0 group",
                isSelected
                  ? "ring-2 ring-indigo-500 opacity-100"
                  : "opacity-50 hover:opacity-100 hover:scale-105"
              )}
              style={{
                height: thumbH,
                width: thumbWidth,
                transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1), transform 200ms, opacity 200ms',
              }}
            >
              {img.content_type?.startsWith('video/') ? (
                <>
                  <video
                    src={getUrl(img)}
                    muted
                    preload="metadata"
                    className="w-full h-full object-cover"
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget;
                      if (el.videoWidth && el.videoHeight && !thumbAspects.current.has(idx)) {
                        thumbAspects.current.set(idx, el.videoWidth / el.videoHeight);
                        setLocalState((prev: any) => ({ thumbUpdate: prev.thumbUpdate + 1 }));
                      }
                    }}
                  />
                  {/* Small play badge on video thumbnails */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white drop-shadow-md" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </>
              ) : (
                <img
                  src={getUrl(img)}
                  alt={`Thumbnail ${idx + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    if (el.naturalWidth && el.naturalHeight && !thumbAspects.current.has(idx)) {
                      thumbAspects.current.set(idx, el.naturalWidth / el.naturalHeight);
                      setLocalState((prev: any) => ({ thumbUpdate: prev.thumbUpdate + 1 }));
                    }
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
