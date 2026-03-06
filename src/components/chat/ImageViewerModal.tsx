import { BaseModal } from '@/components/ui/BaseModal';
import { cn } from '@/lib/utils';
import { useImageViewerActions, useImageViewerStore } from '@/stores/useImageViewerStore';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { ImageViewerThumbnails } from './ImageViewerThumbnails';
import { ImageViewerToolbar } from './ImageViewerToolbar';

interface ViewState {
  scale: number;
  pan: { x: number; y: number };
  isDragging: boolean;
  dragStart: { x: number; y: number };
  hideUi: boolean;
}

type ViewAction =
  | { type: 'ZOOM_IN' }
  | { type: 'ZOOM_OUT' }
  | { type: 'RESET' }
  | { type: 'SET_PAN'; payload: { x: number; y: number } }
  | { type: 'START_DRAG'; payload: { x: number; y: number } }
  | { type: 'STOP_DRAG' }
  | { type: 'TOGGLE_UI' }
  | { type: 'SET_HIDE_UI'; payload: boolean }
  | { type: 'SET_SCALE'; payload: number }
  | { type: 'TOGGLE_ZOOM' };

const initialViewState: ViewState = {
  scale: 1,
  pan: { x: 0, y: 0 },
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  hideUi: false,
};

function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'ZOOM_IN': return { ...state, scale: Math.min(state.scale + 0.5, 4) };
    case 'ZOOM_OUT': return { ...state, scale: Math.max(state.scale - 0.5, 0.5) };
    case 'RESET': return initialViewState;
    case 'SET_PAN': return { ...state, pan: action.payload };
    case 'START_DRAG': return { ...state, isDragging: true, dragStart: action.payload };
    case 'STOP_DRAG': return { ...state, isDragging: false };
    case 'TOGGLE_UI': return { ...state, hideUi: !state.hideUi };
    case 'SET_HIDE_UI': return { ...state, hideUi: action.payload };
    case 'SET_SCALE': return { ...state, scale: action.payload };
    case 'TOGGLE_ZOOM':
      if (state.scale > 1) {
        return { ...state, scale: 1, pan: { x: 0, y: 0 }, hideUi: false };
      } else {
        return { ...state, scale: 2, hideUi: true };
      }
    default: return state;
  }
}

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

  // View State Reducer
  const [viewState, viewDispatch] = React.useReducer(viewReducer, initialViewState);
  const { scale, pan, isDragging, dragStart, hideUi } = viewState;

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

  // Reset zoom & pan on image change
  useEffect(() => {
    viewDispatch({ type: 'RESET' });
    setLocalState({ dimensions: null });
  }, [currentIndex]);

  // Ref to track if we are effectively dragging to prevent click-toggle
  const isDraggingRef = React.useRef(false);

  // Refs for clamping
  const containerRef = React.useRef<HTMLDivElement>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);

  // Helper to clamp pan values so we don't drag image out of view
  const getClampedPan = useCallback((newX: number, newY: number, s: number) => {
    if (!containerRef.current || !imageRef.current) return { x: newX, y: newY };

    const container = containerRef.current.getBoundingClientRect();
    const scaledWidth = imageRef.current.offsetWidth * s;
    const scaledHeight = imageRef.current.offsetHeight * s;

    const containerWidth = container.width;
    const containerHeight = container.height;

    const maxX = Math.max(0, (scaledWidth - containerWidth) / 2);
    const maxY = Math.max(0, (scaledHeight - containerHeight) / 2);

    return {
      x: Math.min(Math.max(newX, -maxX), maxX),
      y: Math.min(Math.max(newY, -maxY), maxY)
    };
  }, []);

  // Handlers for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = false;
    if (scale > 1) {
      e.preventDefault();
      viewDispatch({ type: 'START_DRAG', payload: { x: e.clientX - pan.x, y: e.clientY - pan.y } });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      e.preventDefault();
      isDraggingRef.current = true;
      const rawX = e.clientX - dragStart.x;
      const rawY = e.clientY - dragStart.y;

      viewDispatch({ type: 'SET_PAN', payload: getClampedPan(rawX, rawY, scale) });
    }
  };

  const handleMouseUp = () => {
    viewDispatch({ type: 'STOP_DRAG' });
  };

  // Wheel handler for panning when zoomed
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!isOpen || scale <= 1) return;

      const rawX = pan.x - e.deltaX;
      const rawY = pan.y - e.deltaY;
      viewDispatch({ type: 'SET_PAN', payload: getClampedPan(rawX, rawY, scale) });
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: true });
    }
    return () => {
      if (container) container.removeEventListener('wheel', handleWheel);
    };
  }, [isOpen, scale, pan, getClampedPan]);

  // Stop dragging if mouse leaves window
  useEffect(() => {
    const handleGlobalMouseUp = () => viewDispatch({ type: 'STOP_DRAG' });
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Toggle zoom on click
  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }

    viewDispatch({ type: 'TOGGLE_ZOOM' });
  };

  // Resolve URL
  const getUrl = (att: { url?: string; file_key: string }) =>
    att.url || `/api/${att.file_key}`;

  if (!isOpen) return null;

  const currentImage = images[currentIndex];
  if (!currentImage) return null;

  const isZoomed = scale > 1;

  return (
    <BaseModal onClose={close} portal={false}>
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-rm-bg-primary/95 backdrop-blur-md animate-in fade-in duration-200">

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
          />
        )}

        {/* Floating X button when clean mode active */}
        {hideUi && (
          <button
            onClick={close}
            className="absolute top-4 right-4 p-2 text-rm-text-muted hover:text-rm-text bg-rm-bg-primary/50 hover:bg-rm-bg-primary/70 rounded-full transition-all z-[60] outline-none"
          >
            <X size={20} />
          </button>
        )}

        {/* Main Image Container */}
        <div
          ref={containerRef}
          className={cn(
            "relative w-full flex-1 flex items-center justify-center overflow-hidden touch-none overscroll-none",
            hideUi ? "p-0" : "pt-14 pb-24 px-4 md:pt-16 md:pb-32 md:px-8",
            isZoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
          )}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          role="presentation"
        >
          <div
            className="relative transition-transform duration-75 ease-out outline-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transition: isDragging ? 'none' : 'transform 0.2s ease-out'
            }}
            onClick={(e) => {
              handleImageClick(e);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleImageClick(e as any);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={scale > 1 ? "Zoom out" : "Zoom in"}
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
          </div>

          {/* Navigation Arrows - Hide if clean mode */}
          {!hideUi && images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                className="absolute left-1 md:left-4 p-2 md:p-4 text-rm-text-muted/40 hover:text-rm-text hover:bg-rm-bg-hover rounded-full transition-all z-40 outline-none"
              >
                <ChevronLeft size={32} className="md:hidden" strokeWidth={1.5} />
                <ChevronLeft size={48} className="hidden md:block" strokeWidth={1.5} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleNext(); }}
                className="absolute right-1 md:right-4 p-2 md:p-4 text-rm-text-muted/40 hover:text-rm-text hover:bg-rm-bg-hover rounded-full transition-all z-40 outline-none"
              >
                <ChevronRight size={32} className="md:hidden" strokeWidth={1.5} />
                <ChevronRight size={48} className="hidden md:block" strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>

        {/* Bottom Thumbnail Strip - Hide if clean mode */}
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
    </BaseModal>
  );
};
