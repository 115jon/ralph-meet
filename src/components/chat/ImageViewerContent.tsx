import type { Attachment } from '@/lib/types';
import { cn } from '@/lib/utils';
import React from 'react';
import { useVideoPlaybackAvailability } from '@/lib/video-playback-availability';
import { GifProviderBranding } from './GifProviderBranding';
import VideoAttachment from './VideoAttachment';
import type { ViewState } from './useImageViewerState';

interface ImageViewerContentProps {
  currentImage: Attachment;
  isVideo: boolean;
  isAnimatedMedia?: boolean;
  isLoaded: boolean;
  viewState: ViewState;
  imageRef: React.RefObject<HTMLImageElement | null>;
  handleImageClick: (e: React.MouseEvent) => void;
  setLocalState: React.Dispatch<any>;
  getUrl: (att: { url?: string; file_key: string }) => string;
  getPosterUrl: (att: Attachment) => string | undefined;
}

export function ImageViewerContent({
  currentImage,
  isVideo,
  isAnimatedMedia = false,
  isLoaded,
  viewState,
  imageRef,
  handleImageClick,
  setLocalState,
  getUrl,
  getPosterUrl,
}: ImageViewerContentProps) {
  const { scale, pan, isDragging } = viewState;
  const isZoomed = scale > 1;
  const videoSrc = isVideo ? getUrl(currentImage) : null;
  const videoPosterUrl = isVideo ? getPosterUrl(currentImage) : undefined;
  const playbackAvailability = useVideoPlaybackAvailability({
    src: videoSrc,
    contentType: currentImage.content_type,
    posterUrl: videoPosterUrl,
    sourceUrl: currentImage.sourceUrl,
    isAnimated: isAnimatedMedia,
  });

  if (isVideo) {
    const shouldRenderPosterOnly = !!videoPosterUrl && playbackAvailability !== 'playable';

    if (shouldRenderPosterOnly) {
      return (
        <div className="relative flex items-center justify-center">
          <img
            ref={imageRef}
            src={videoPosterUrl}
            alt=""
            className={cn(
              "max-w-full max-h-[60vh] md:max-h-[75vh] object-contain shadow-2xl rounded-sm transition-opacity duration-300 select-none",
              isLoaded ? "opacity-100" : "opacity-0",
            )}
            onLoad={(e) => {
              setLocalState({
                isLoaded: true,
                dimensions: {
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                },
              });
            }}
            draggable={false}
          />
          {(playbackAvailability === 'checking' || !isLoaded) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}
          <GifProviderBranding fileKeyOrUrl={currentImage.file_key || currentImage.url} className="bottom-3 left-3" />
        </div>
      );
    }

    return (
      <VideoAttachment
        src={videoSrc || getUrl(currentImage)}
        filename={currentImage.filename}
        poster={videoPosterUrl}
        variant="viewer"
        brandingKey={currentImage.file_key || currentImage.url}
        playbackMode={isAnimatedMedia ? 'animated' : 'default'}
        fallbackToPosterOnError={!!videoPosterUrl}
      />
    );
  }

  return (
    <div
      className="relative transition-transform duration-75 ease-out outline-none"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
        transition: isDragging ? 'none' : 'transform 0.2s ease-out'
      }}
      onClick={(e) => handleImageClick(e)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleImageClick(e as any);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={isZoomed ? "Zoom out" : "Zoom in"}
    >
      <img
        ref={imageRef}
        src={getUrl(currentImage)}
        alt=""
        className={cn(
          "max-w-full max-h-[60vh] md:max-h-[75vh] object-contain shadow-2xl rounded-sm transition-opacity duration-300 select-none",
          isLoaded ? "opacity-100" : "opacity-0",
          isZoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        )}
        onLoad={(e) => {
          setLocalState({ isLoaded: true, dimensions: { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight } });
        }}
        draggable={!isZoomed}
      />
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}
      <GifProviderBranding fileKeyOrUrl={currentImage.file_key || currentImage.url} className="bottom-3 left-3" />
    </div>
  );
}
