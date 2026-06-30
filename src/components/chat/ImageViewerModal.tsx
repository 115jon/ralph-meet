import { BaseModal } from '@/components/ui/BaseModal';
import { shouldBlurSensitiveAttachment } from '@/lib/media-safety';
import { isAnimatedMedia, isVideo } from '@/lib/media';
import { getAuthAssetUrl, getMediaUrl } from '@/lib/platform';
import { buildProxyMediaPath } from '@/lib/proxy-media-url';
import { primeVideoPlaybackAvailability } from '@/lib/video-playback-availability';
import { cn } from '@/lib/utils';
import { useImageViewerActions, useImageViewerStore } from '@/stores/useImageViewerStore';
import { useMediaSafetySettingsStore } from '@/stores/useMediaSafetySettingsStore';
import { X } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { useDelayUnmount } from '@/hooks/useDelayUnmount';
import { ImageViewerContent } from './ImageViewerContent';
import { ImageViewerNavigation } from './ImageViewerNavigation';
import { ImageViewerThumbnails } from './ImageViewerThumbnails';
import { ImageViewerToolbar } from './ImageViewerToolbar';
import { useImageViewerState } from './useImageViewerState';

export const ImageViewerModal: React.FC = () => {
  const { isOpen, images, initialIndex, context } = useImageViewerStore();
  const shouldRender = useDelayUnmount(isOpen, 200);
  const { close } = useImageViewerActions();
  const [localState, setLocalState] = React.useReducer(
    (state: any, action: any) => ({ ...state, ...(typeof action === "function" ? action(state) : action) }),
    {
      currentIndex: initialIndex,
      isLoaded: false,
      showMore: false,
      showDetails: false,
      thumbUpdate: 0,
      dimensions: null as { width: number; height: number } | null,
    }
  );

  const { currentIndex, isLoaded, showMore, showDetails, dimensions } = localState;

  // Track aspect ratios for thumbnail morphing
  const thumbAspects = useRef<Map<number, number> | null>(null);
  if (!thumbAspects.current) {
    thumbAspects.current = new Map<number, number>();
  }

  // View State (zoom/pan/drag)
  const {
    viewState,
    viewDispatch,
    containerRef,
    imageRef,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleImageClick,
  } = useImageViewerState(isOpen);

  const { scale, hideUi } = viewState;

  // Use refs to track prop changes for synchronization during render
  const lastInitialIndex = useRef(initialIndex);
  const lastIsOpen = useRef(isOpen);

  if (isOpen && (!lastIsOpen.current || lastInitialIndex.current !== initialIndex)) {
    setLocalState({ currentIndex: initialIndex, isLoaded: false });
    lastInitialIndex.current = initialIndex;
    lastIsOpen.current = isOpen;
  } else if (!isOpen && lastIsOpen.current) {
    lastIsOpen.current = false;
  }

  // Navigation
  const handleNext = useCallback(() => {
    setLocalState((prev: any) => ({
      isLoaded: false,
      dimensions: null,
      currentIndex: (prev.currentIndex + 1) % images.length,
    }));
  }, [images.length]);

  const handlePrev = useCallback(() => {
    setLocalState((prev: any) => ({
      isLoaded: false,
      dimensions: null,
      currentIndex: (prev.currentIndex - 1 + images.length) % images.length,
    }));
  }, [images.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, images.length]);

  // Reset zoom & pan on image change
  useEffect(() => {
    viewDispatch({ type: 'RESET' });
    setLocalState({ dimensions: null });
  }, [currentIndex, viewDispatch]);

  // Resolve URL
  const getUrl = useCallback((att: { url?: string; file_key: string; content_type?: string }) => {
    const raw = att.url || `/api/${att.file_key}`;
    // Videos need range requests for seeking; route them through the real
    // backend to bypass Tauri's custom protocol which breaks range support.
    return isVideo(att.content_type) ? getMediaUrl(raw) : getAuthAssetUrl(raw);
  }, []);

  const getPosterUrl = useCallback((att: { thumbnailUrl?: string | null; sourceUrl?: string | null }) => {
    const thumbnailUrl = att.thumbnailUrl?.trim();
    if (!thumbnailUrl) return undefined;

    const raw = /^https?:\/\//i.test(thumbnailUrl)
      ? (att.sourceUrl ? buildProxyMediaPath(thumbnailUrl, att.sourceUrl) : thumbnailUrl)
      : (thumbnailUrl.startsWith("/") ? thumbnailUrl : `/api/${thumbnailUrl}`);

    return getAuthAssetUrl(raw);
  }, []);

  const currentImage = images[currentIndex];
  const contentFilter = useMediaSafetySettingsStore((state) => state.getSettings(state.currentUser).contentFilter);
  const isZoomed = scale > 1;
  const isItemVideo = currentImage ? isVideo(currentImage.content_type) : false;
  const isItemAnimatedMedia = currentImage
    ? isAnimatedMedia(currentImage.content_type, currentImage.isGif, currentImage.url || currentImage.file_key)
    : false;
  const blurSensitiveMedia = currentImage
    ? shouldBlurSensitiveAttachment(currentImage, contentFilter)
    : false;

  useEffect(() => {
    if (!isOpen || images.length === 0) return;

    const indices = new Set([
      currentIndex,
      (currentIndex + 1) % images.length,
      (currentIndex - 1 + images.length) % images.length,
    ]);

    for (const index of indices) {
      const item = images[index];
      if (!item || !isVideo(item.content_type)) continue;

      void primeVideoPlaybackAvailability({
        src: getUrl(item),
        contentType: item.content_type,
        posterUrl: getPosterUrl(item),
        sourceUrl: item.sourceUrl,
        isAnimated: isAnimatedMedia(item.content_type, item.isGif, item.url || item.file_key),
      });
    }
  }, [currentIndex, getPosterUrl, getUrl, images, isOpen]);

  if (!shouldRender) return null;
  if (!currentImage) return null;

  return (
    <BaseModal onClose={close} portal={false}>
      <div className={cn("fixed inset-0 z-200 flex flex-col items-center justify-center bg-rm-bg-primary/95 backdrop-blur-md duration-200", !isOpen ? "animate-out fade-out" : "animate-in fade-in")}>

        {/* Top Toolbar */}
        {!hideUi && (
          <ImageViewerToolbar
            context={context}
            currentImage={currentImage}
            showMore={showMore}
            showDetails={showDetails}
            dimensions={dimensions}
            setLocalState={setLocalState}
            viewDispatch={viewDispatch}
            close={close}
            getUrl={getUrl}
            isVideo={isItemVideo}
            isAnimatedMedia={isItemAnimatedMedia}
          />
        )}

        {/* Floating X button when clean mode active */}
        {hideUi && (
          <div className="absolute top-4 right-4 z-60 bg-rm-bg-elevated/80 backdrop-blur-md border border-rm-border rounded-xl p-1 shadow-lg">
            <button
              onClick={close}
              className="p-2 text-rm-text-muted hover:text-rm-text hover:bg-rm-bg-hover rounded-lg transition-all outline-none"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Main Content Container */}
        <div
          ref={containerRef}
          className={cn(
            "relative w-full flex-1 flex items-center justify-center overflow-hidden touch-none overscroll-none",
            hideUi ? "p-0" : "pt-14 pb-24 px-4 md:pt-16 md:pb-32 md:px-8",
            isItemVideo ? "cursor-default" : isZoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
          )}
          onMouseDown={isItemVideo ? undefined : handleMouseDown}
          onMouseMove={isItemVideo ? undefined : handleMouseMove}
          onMouseUp={isItemVideo ? undefined : handleMouseUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          role="presentation"
        >
          <ImageViewerContent
            currentImage={currentImage}
            isVideo={!!isItemVideo}
            isAnimatedMedia={isItemAnimatedMedia}
            blurSensitiveMedia={blurSensitiveMedia}
            isLoaded={isLoaded}
            viewState={viewState}
            imageRef={imageRef}
            handleImageClick={handleImageClick}
            setLocalState={setLocalState}
            getUrl={getUrl}
            getPosterUrl={getPosterUrl}
          />

          {/* Navigation Arrows */}
          {!hideUi && images.length > 1 && (
            <ImageViewerNavigation onPrev={handlePrev} onNext={handleNext} />
          )}
        </div>

        {/* Bottom Thumbnail Strip */}
        {!hideUi && images.length > 1 && (
          <ImageViewerThumbnails
            images={images}
            currentIndex={currentIndex}
            contentFilter={contentFilter}
            thumbAspects={thumbAspects as React.MutableRefObject<Map<number, number>>}
            setLocalState={setLocalState}
            getUrl={getUrl}
            getPosterUrl={getPosterUrl}
          />
        )}
      </div>
    </BaseModal >
  );
};

