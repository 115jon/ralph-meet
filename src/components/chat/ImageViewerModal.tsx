import { BaseModal } from "@/components/ui/BaseModal";
import { shouldBlurSensitiveAttachment } from "@/lib/media-safety";
import { isAnimatedMedia, isVideo } from "@/lib/media";
import { getAuthAssetUrl, getMediaUrl } from "@/lib/platform";
import { buildProxyMediaPath } from "@/lib/proxy-media-url";
import { primeVideoPlaybackAvailability } from "@/lib/video-playback-availability";
import { cn } from "@/lib/utils";
import {
  useImageViewerActions,
  useImageViewerStore,
} from "@/stores/useImageViewerStore";
import { useMediaSafetySettingsStore } from "@/stores/useMediaSafetySettingsStore";
import { X } from "lucide-react";
import React, { useCallback, useEffect, useRef } from "react";
import { useDelayUnmount } from "@/hooks/useDelayUnmount";
import { ImageViewerContent } from "./ImageViewerContent";
import { ImageViewerNavigation } from "./ImageViewerNavigation";
import { ImageViewerThumbnails } from "./ImageViewerThumbnails";
import { ImageViewerToolbar } from "./ImageViewerToolbar";
import { useImageViewerState } from "./useImageViewerState";

export const ImageViewerModal: React.FC = () => {
  const { isOpen, images, initialIndex, context } = useImageViewerStore();
  const shouldRender = useDelayUnmount(isOpen, 200);
  const { close } = useImageViewerActions();
  const [swipeOffset, setSwipeOffset] = React.useState(0);
  const [isSwipeDragging, setIsSwipeDragging] = React.useState(false);
  const [localState, setLocalState] = React.useReducer(
    (state: any, action: any) => ({
      ...state,
      ...(typeof action === "function" ? action(state) : action),
    }),
    {
      currentIndex: initialIndex,
      isLoaded: false,
      showMore: false,
      showDetails: false,
      thumbUpdate: 0,
      dimensions: null as { width: number; height: number } | null,
    },
  );

  const { currentIndex, isLoaded, showMore, showDetails, dimensions } =
    localState;

  // Track aspect ratios for thumbnail morphing
  const thumbAspects = useRef<Map<number, number> | null>(null);
  if (!thumbAspects.current) {
    thumbAspects.current = new Map<number, number>();
  }
  const suppressImageClickRef = useRef(false);
  const swipeGestureRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    deltaX: 0,
    hasHorizontalIntent: false,
  });

  // View State (zoom/pan/drag)
  const {
    viewState,
    viewDispatch,
    containerRef,
    imageRef,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleImageClick,
  } = useImageViewerState(isOpen);

  const { scale, hideUi } = viewState;

  // Use refs to track prop changes for synchronization during render
  const lastInitialIndex = useRef(initialIndex);
  const lastIsOpen = useRef(isOpen);

  if (
    isOpen &&
    (!lastIsOpen.current || lastInitialIndex.current !== initialIndex)
  ) {
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
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "ArrowRight") handleNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, images.length]);

  // Reset zoom & pan on image change
  useEffect(() => {
    viewDispatch({ type: "RESET" });
    setLocalState({ dimensions: null });
  }, [currentIndex, viewDispatch]);

  useEffect(() => {
    if (!isOpen) return;
    context?.onIndexChange?.(currentIndex);
  }, [context, currentIndex, isOpen]);

  // Resolve URL
  const getUrl = useCallback(
    (att: { url?: string; file_key: string; content_type?: string }) => {
      const raw = att.url || `/api/${att.file_key}`;
      // Videos need range requests for seeking; route them through the real
      // backend to bypass Tauri's custom protocol which breaks range support.
      return isVideo(att.content_type)
        ? getMediaUrl(raw)
        : getAuthAssetUrl(raw);
    },
    [],
  );

  const getPosterUrl = useCallback(
    (att: { thumbnailUrl?: string | null; sourceUrl?: string | null }) => {
      const thumbnailUrl = att.thumbnailUrl?.trim();
      if (!thumbnailUrl) return undefined;

      const raw = /^https?:\/\//i.test(thumbnailUrl)
        ? att.sourceUrl
          ? buildProxyMediaPath(thumbnailUrl, att.sourceUrl)
          : thumbnailUrl
        : thumbnailUrl.startsWith("/")
          ? thumbnailUrl
          : `/api/${thumbnailUrl}`;

      return getAuthAssetUrl(raw);
    },
    [],
  );

  const currentImage = images[currentIndex];
  const contentFilter = useMediaSafetySettingsStore(
    (state) => state.getSettings(state.currentUser).contentFilter,
  );
  const isZoomed = scale > 1;
  const isItemVideo = currentImage ? isVideo(currentImage.content_type) : false;
  const canSwipeBetweenImages = images.length > 1 && !isItemVideo && !isZoomed;
  const isItemAnimatedMedia = currentImage
    ? isAnimatedMedia(
        currentImage.content_type,
        currentImage.isGif,
        currentImage.url || currentImage.file_key,
      )
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
        isAnimated: isAnimatedMedia(
          item.content_type,
          item.isGif,
          item.url || item.file_key,
        ),
      });
    }
  }, [currentIndex, getPosterUrl, getUrl, images, isOpen]);

  const resetSwipeGesture = useCallback(() => {
    swipeGestureRef.current = {
      active: false,
      startX: 0,
      startY: 0,
      deltaX: 0,
      hasHorizontalIntent: false,
    };
    setSwipeOffset(0);
    setIsSwipeDragging(false);
  }, []);

  const beginSwipeGesture = useCallback((clientX: number, clientY: number) => {
    swipeGestureRef.current = {
      active: true,
      startX: clientX,
      startY: clientY,
      deltaX: 0,
      hasHorizontalIntent: false,
    };
    setIsSwipeDragging(true);
  }, []);

  const updateSwipeGesture = useCallback(
    (clientX: number, clientY: number): boolean => {
      const gesture = swipeGestureRef.current;
      if (!gesture.active) return false;

      const deltaX = clientX - gesture.startX;
      const deltaY = clientY - gesture.startY;

      if (!gesture.hasHorizontalIntent) {
        if (Math.abs(deltaY) > 12 && Math.abs(deltaY) > Math.abs(deltaX)) {
          resetSwipeGesture();
          return false;
        }

        if (Math.abs(deltaX) < 6) {
          return true;
        }

        gesture.hasHorizontalIntent = Math.abs(deltaX) >= Math.abs(deltaY);
        if (!gesture.hasHorizontalIntent) {
          resetSwipeGesture();
          return false;
        }
      }

      gesture.deltaX = deltaX;
      if (Math.abs(deltaX) > 8) {
        suppressImageClickRef.current = true;
      }
      setSwipeOffset(deltaX);
      return true;
    },
    [resetSwipeGesture],
  );

  const completeSwipeGesture = useCallback(
    (containerWidth: number) => {
      const gesture = swipeGestureRef.current;
      if (!gesture.active) return false;

      const deltaX = gesture.deltaX;
      const hadHorizontalIntent = gesture.hasHorizontalIntent;
      resetSwipeGesture();

      if (!hadHorizontalIntent) return false;

      const threshold = Math.max(56, containerWidth * 0.16);
      if (deltaX <= -threshold) {
        handleNext();
        return true;
      }
      if (deltaX >= threshold) {
        handlePrev();
        return true;
      }

      return true;
    },
    [handleNext, handlePrev, resetSwipeGesture],
  );

  useEffect(() => {
    suppressImageClickRef.current = false;
    resetSwipeGesture();
  }, [currentIndex, resetSwipeGesture]);

  const handleStageMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (canSwipeBetweenImages && event.button === 0) {
        suppressImageClickRef.current = false;
        beginSwipeGesture(event.clientX, event.clientY);
        return;
      }

      if (!isItemVideo) {
        handleMouseDown(event);
      }
    },
    [beginSwipeGesture, canSwipeBetweenImages, handleMouseDown, isItemVideo],
  );

  const handleStageMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (swipeGestureRef.current.active) {
        if (updateSwipeGesture(event.clientX, event.clientY)) {
          event.preventDefault();
          return;
        }
      }

      if (!isItemVideo) {
        handleMouseMove(event);
      }
    },
    [handleMouseMove, isItemVideo, updateSwipeGesture],
  );

  const handleStageMouseUp = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (swipeGestureRef.current.active) {
        const handled = completeSwipeGesture(
          event.currentTarget.clientWidth || 1,
        );
        if (handled) {
          event.preventDefault();
          return;
        }
      }

      if (!isItemVideo) {
        handleMouseUp();
      }
    },
    [completeSwipeGesture, handleMouseUp, isItemVideo],
  );

  const handleStageTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (canSwipeBetweenImages && event.touches.length === 1) {
        suppressImageClickRef.current = false;
        const touch = event.touches[0];
        beginSwipeGesture(touch.clientX, touch.clientY);
      }

      if (!isItemVideo) {
        handleTouchStart(event);
      }
    },
    [beginSwipeGesture, canSwipeBetweenImages, handleTouchStart, isItemVideo],
  );

  const handleStageTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (swipeGestureRef.current.active && event.touches.length === 1) {
        const touch = event.touches[0];
        if (updateSwipeGesture(touch.clientX, touch.clientY)) {
          event.preventDefault();
          return;
        }
      }

      if (!isItemVideo) {
        handleTouchMove(event);
      }
    },
    [handleTouchMove, isItemVideo, updateSwipeGesture],
  );

  const handleStageTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (swipeGestureRef.current.active) {
        completeSwipeGesture(event.currentTarget.clientWidth || 1);
      }

      if (!isItemVideo) {
        handleTouchEnd();
      }
    },
    [completeSwipeGesture, handleTouchEnd, isItemVideo],
  );

  const handleStageTouchCancel = useCallback(() => {
    resetSwipeGesture();
    if (!isItemVideo) {
      handleTouchEnd();
    }
  }, [handleTouchEnd, isItemVideo, resetSwipeGesture]);

  const handleContentImageClick = useCallback(
    (event: React.MouseEvent) => {
      if (suppressImageClickRef.current) {
        suppressImageClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      handleImageClick(event);
    },
    [handleImageClick],
  );

  if (!shouldRender) return null;
  if (!currentImage) return null;

  return (
    <BaseModal onClose={close} portal={false} aria-label="Image viewer">
      <div
        className={cn(
          "fixed inset-0 z-200 flex flex-col items-center justify-center bg-rm-bg-primary/95 backdrop-blur-md duration-200",
          !isOpen ? "animate-out fade-out" : "animate-in fade-in",
        )}
      >
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
          data-testid="image-viewer-stage"
          className={cn(
            "relative w-full flex-1 flex items-center justify-center overflow-hidden touch-none overscroll-none",
            hideUi ? "p-0" : "pt-14 pb-24 px-4 md:pt-16 md:pb-32 md:px-8",
            isItemVideo
              ? "cursor-default"
              : isZoomed
                ? "cursor-grab active:cursor-grabbing"
                : "cursor-zoom-in",
          )}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onTouchStart={handleStageTouchStart}
          onTouchMove={handleStageTouchMove}
          onTouchEnd={handleStageTouchEnd}
          onTouchCancel={handleStageTouchCancel}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
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
            handleImageClick={handleContentImageClick}
            setLocalState={setLocalState}
            getUrl={getUrl}
            getPosterUrl={getPosterUrl}
            swipeOffset={swipeOffset}
            isSwipeDragging={isSwipeDragging}
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
            thumbAspects={
              thumbAspects as React.MutableRefObject<Map<number, number>>
            }
            setLocalState={setLocalState}
            getUrl={getUrl}
            getPosterUrl={getPosterUrl}
          />
        )}
      </div>
    </BaseModal>
  );
};
