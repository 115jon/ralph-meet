import {
  Dialog,
  DialogPortal,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useExternalLinkConfirmation } from "@/hooks/useExternalLinkConfirmation";
import {
  copyMediaLink,
  getPublicMediaUrl,
  saveMedia,
} from "@/lib/media-actions";
import { getFxTwitterGifWebpUrl } from "@/lib/gif-favorite-item";
import { unwrapProxyMediaUrl } from "@/lib/proxy-media-url";
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
import { Icon } from "@/components/ui/icon";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ImageViewerContent } from "./ImageViewerContent";
import { ImageViewerNavigation } from "./ImageViewerNavigation";
import { ImageViewerThumbnails } from "./ImageViewerThumbnails";
import { ImageViewerToolbar } from "./ImageViewerToolbar";
import ContextMenu from "./ContextMenu";
import { VIEWER_BAR, VIEWER_BUTTON } from "./ImageViewerToolbar";
import type { ContextMenuItem } from "./ContextMenu";
import { useImageViewerState } from "./useImageViewerState";

/**
 * Image open and close (messages audit, motion plan): the media scales
 * .96 -> 1 with a fade over 200ms on the way in and to .98 over 150ms on the
 * way out, from the centre. Keyboard opens skip the scale. Reduced motion
 * zeroes the scale globally.
 */
const MEDIA_PRESENCE =
  "ease-out group-data-[state=open]/viewer:animate-in group-data-[state=open]/viewer:fade-in-0 group-data-[state=open]/viewer:zoom-in-[0.96] group-data-[state=open]/viewer:duration-(--dur-3) group-data-[state=closed]/viewer:animate-out group-data-[state=closed]/viewer:fade-out-0 group-data-[state=closed]/viewer:zoom-out-[0.98] group-data-[state=closed]/viewer:duration-(--dur-2) group-data-keyboard/viewer:zoom-in-100 group-data-keyboard/viewer:zoom-out-100";

export const ImageViewerModal: React.FC = () => {
  // The store keeps its images through the exit animation.
  const { isOpen, images, initialIndex, context } = useImageViewerStore();
  const { close } = useImageViewerActions();
  const {
    menu,
    openMenu,
    closeMenu,
    shouldRender: shouldRenderContextMenu,
    isClosing,
  } = useContextMenu();
  const { requestOpen: requestOpenExternalLink, confirmation } =
    useExternalLinkConfirmation();
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
      thumbUpdate: 0,
      dimensions: null as { width: number; height: number } | null,
    },
  );

  const { currentIndex, isLoaded, dimensions } = localState;

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
    setLocalState({
      currentIndex: initialIndex,
      isLoaded: false,
      dimensions: null,
    });
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
      if (menu.isOpen) return;
      if (confirmation) return;
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "ArrowRight") handleNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    close,
    confirmation,
    handleNext,
    handlePrev,
    images.length,
    isOpen,
    menu.isOpen,
  ]);

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

  useEffect(() => {
    if (menu.isOpen) closeMenu();
    // The menu should close only when the active media changes, not when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    closeMenu,
    currentImage?.downloadUrl,
    currentImage?.file_key,
    currentImage?.filename,
    currentImage?.url,
    currentIndex,
  ]);

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

  const mediaContextItems = useMemo<ContextMenuItem[] | null>(() => {
    if (!currentImage) return null;

    const storedMediaUrl =
      currentImage.url ||
      (currentImage.file_key.startsWith("/")
        ? currentImage.file_key
        : `/api/${currentImage.file_key}`);
    const rawMediaUrl = unwrapProxyMediaUrl(storedMediaUrl);
    const gifMediaUrl =
      currentImage.isGif &&
      currentImage.filename.toLowerCase().endsWith(".webp")
        ? getFxTwitterGifWebpUrl(rawMediaUrl)
        : null;
    const resolvedMediaUrl = gifMediaUrl ?? rawMediaUrl;
    const mediaUrl = resolvedMediaUrl;
    const downloadUrl = currentImage.isGif
      ? gifMediaUrl
        ? getAuthAssetUrl(
            buildProxyMediaPath(gifMediaUrl, currentImage.sourceUrl),
          )
        : getUrl(currentImage)
      : getUrl(currentImage);
    const filename = gifMediaUrl
      ? currentImage.filename.replace(/\.mp4$/i, ".webp")
      : currentImage.filename;

    return [
      {
        label: "Save image",
        rightIcon: <Icon name="download" size="sm" />,
        onClick: () => {
          void saveMedia({
            url: getPublicMediaUrl(mediaUrl),
            downloadUrl,
            filename,
          });
        },
        divider: true,
      },
      {
        label: "Copy media link",
        rightIcon: <Icon name="copy" size="sm" />,
        onClick: () => {
          void copyMediaLink(getPublicMediaUrl(mediaUrl));
        },
      },
      {
        label: "Open media link",
        rightIcon: <Icon name="externalLink" size="sm" />,
        onClick: () => requestOpenExternalLink(getPublicMediaUrl(mediaUrl)),
      },
    ];
  }, [currentImage, getUrl, requestOpenExternalLink]);

  const handleMediaContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target?.closest("img,video,canvas")) return;
      if (!mediaContextItems) return;
      openMenu(event, mediaContextItems);
    },
    [mediaContextItems, openMenu],
  );

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

  if (!currentImage) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogPortal>
        <DialogSurface
          showCloseButton={false}
          initialFocus="surface"
          onEscapeKeyDown={(event) => {
            if (menu.isOpen || confirmation) event.preventDefault();
          }}
          className={cn(
            // The surface is the scrim (no Radix overlay: its scroll lock
            // fights the stage's own touch and wheel handling). Media needs a
            // quieter backdrop than a confirm, so the scrim is laid twice
            // (about .8 in dark): the chat behind stops competing with the
            // image while staying recognisable.
            "group/viewer fixed inset-0 z-50 flex flex-col items-center justify-center bg-scrim outline-none before:pointer-events-none before:absolute before:inset-0 before:bg-scrim before:content-['']",
            // Phones: the viewer takes the whole screen on solid ply-0. A
            // see-through scrim let the channel header and the sticky day
            // label read through the viewer's header bar.
            "max-md:bg-ply-0 max-md:before:hidden",
            "ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--dur-3) data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-(--dur-2)",
          )}
        >
          {/* Names the dialog after the attachment (else Radix's "Dialog"). */}
          <DialogTitle className="sr-only">
            {currentImage.filename || "Media viewer"}
          </DialogTitle>

          {/* Top Toolbar */}
          {!hideUi && (
            <ImageViewerToolbar
              context={context}
              currentImage={currentImage}
              dimensions={dimensions}
              viewDispatch={viewDispatch}
              close={close}
              getUrl={getUrl}
              isVideo={isItemVideo}
              isAnimatedMedia={isItemAnimatedMedia}
            />
          )}

          {/* Floating X button when clean mode active */}
          {hideUi && (
            <div
              className={cn(
                VIEWER_BAR,
                "absolute top-[calc(12px+var(--safe-area-top,0px))] right-3 z-60 max-md:border max-md:border-line max-md:bg-ply-3 md:top-[calc(16px+var(--safe-area-top,0px))] md:right-4",
              )}
            >
              <button
                type="button"
                onClick={close}
                className={VIEWER_BUTTON}
                aria-label="Close media viewer"
              >
                <Icon name="close" size="md" />
              </button>
            </div>
          )}

          {/* Main Content Container */}
          <div
            ref={containerRef}
            data-testid="image-viewer-stage"
            className={cn(
              "relative w-full flex-1 flex items-center justify-center overflow-hidden touch-none overscroll-none",
              hideUi
                ? "p-0"
                : "pt-[calc(64px+var(--safe-area-top,0px))] pb-24 px-4 md:pt-[calc(72px+var(--safe-area-top,0px))] md:pb-28 md:px-20",
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
            onContextMenu={handleMediaContextMenu}
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
            role="presentation"
          >
            <div
              className={cn(
                "pointer-events-none flex max-h-full max-w-full items-center justify-center *:pointer-events-auto",
                MEDIA_PRESENCE,
              )}
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
            </div>

            {/* Navigation Arrows */}
            {!hideUi && images.length > 1 && (
              <ImageViewerNavigation onPrev={handlePrev} onNext={handleNext} />
            )}
          </div>

          {shouldRenderContextMenu && menu.isOpen && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={menu.items}
              onClose={closeMenu}
              isClosing={isClosing}
            />
          )}

          {confirmation}

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
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
};
