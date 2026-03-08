import { BaseModal } from '@/components/ui/BaseModal';
import { isVideo } from '@/lib/media';
import { getAuthAssetUrl, getMediaUrl } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { useImageViewerActions, useImageViewerStore } from '@/stores/useImageViewerStore';
import { X } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { ImageViewerContent } from './ImageViewerContent';
import { ImageViewerNavigation } from './ImageViewerNavigation';
import { ImageViewerThumbnails } from './ImageViewerThumbnails';
import { ImageViewerToolbar } from './ImageViewerToolbar';
import { useImageViewerState } from './useImageViewerState';

export const ImageViewerModal: React.FC = () => {
  const { isOpen, images, initialIndex, context } = useImageViewerStore();
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
  const thumbAspects = useRef<Map<number, number>>(new Map());

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
  const getUrl = (att: { url?: string; file_key: string; content_type?: string }) => {
    const raw = att.url || `/api/${att.file_key}`;
    // Videos need range requests for seeking; route them through the real
    // backend to bypass Tauri's custom protocol which breaks range support.
    return isVideo(att.content_type) ? getMediaUrl(raw) : getAuthAssetUrl(raw);
  };

  if (!isOpen) return null;

  const currentImage = images[currentIndex];
  if (!currentImage) return null;

  const isZoomed = scale > 1;
  const isItemVideo = isVideo(currentImage.content_type);

  return (
    <BaseModal onClose={close} portal={false}>
      <div className="fixed inset-0 z-200 flex flex-col items-center justify-center bg-rm-bg-primary/95 backdrop-blur-md animate-in fade-in duration-200">

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
            isLoaded={isLoaded}
            viewState={viewState}
            imageRef={imageRef}
            handleImageClick={handleImageClick}
            setLocalState={setLocalState}
            getUrl={getUrl}
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
            thumbAspects={thumbAspects}
            setLocalState={setLocalState}
            getUrl={getUrl}
          />
        )}
      </div>
    </BaseModal >
  );
};
