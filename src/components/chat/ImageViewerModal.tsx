
import { getWebOrigin } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { useImageViewerActions, useImageViewerStore } from '@/stores/useImageViewerStore';
import { formatRelative } from 'date-fns';
import { enUS } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight,
  Copy,
  CornerUpRight,
  Download,
  FileDigit,
  Info,
  Link as LinkIcon,
  MoreHorizontal,
  X, ZoomIn, ZoomOut
} from 'lucide-react';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// Discord-style friendly date formatting
const formatRelativeLocale: Record<string, string> = {
  lastWeek: "eeee 'at' p",
  yesterday: "'Yesterday at' p",
  today: "'Today at' p",
  tomorrow: "'Tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: 'P'
};

const locale = {
  ...enUS,
  formatRelative: (token: string) => formatRelativeLocale[token] || formatRelativeLocale.other
};

function formatFriendlyDate(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return formatRelative(date, new Date(), { locale });
}

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
  // State
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Track aspect ratios for thumbnail morphing
  const thumbAspects = useRef<Map<number, number>>(new Map());
  const [, forceThumbUpdate] = useState(0);

  // View State Reducer
  const [viewState, viewDispatch] = React.useReducer(viewReducer, initialViewState);
  const { scale, pan, isDragging, dragStart, hideUi } = viewState;

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Dimensions state
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  // Use refs to track prop changes for synchronization during render
  const lastInitialIndex = useRef(initialIndex);
  const lastIsOpen = useRef(isOpen);

  if (isOpen && (!lastIsOpen.current || lastInitialIndex.current !== initialIndex)) {
    setCurrentIndex(initialIndex);
    setIsLoaded(false);
    lastInitialIndex.current = initialIndex;
    lastIsOpen.current = isOpen;
  } else if (!isOpen && lastIsOpen.current) {
    lastIsOpen.current = false;
  }

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowMore(false);
        setShowDetails(false);
      }
    };
    if (showMore) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMore]);

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
    setIsLoaded(false);
    setDimensions(null);
    setCurrentIndex((prev) => (prev + 1) % images.length);
  }, [images.length]);

  const handlePrev = useCallback(() => {
    setIsLoaded(false);
    setDimensions(null);
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  }, [images.length]);

  // Zoom state (Managed by Reducer)
  // Pan state (Managed by Reducer)
  // UI Visiblity State (Managed by Reducer)

  // Reset zoom & pan on image change
  // Reset zoom & pan on image change
  useEffect(() => {
    viewDispatch({ type: 'RESET' });
    setDimensions(null);
  }, [currentIndex]);

  // Helper for bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

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
      e.preventDefault();

      const rawX = pan.x - e.deltaX;
      const rawY = pan.y - e.deltaY;
      viewDispatch({ type: 'SET_PAN', payload: getClampedPan(rawX, rawY, scale) });
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
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

  // Copy Handlers
  const handleCopyLink = () => {
    const currentImage = images[currentIndex];
    if (currentImage) {
      navigator.clipboard.writeText(getWebOrigin() + getUrl(currentImage));
      setShowMore(false);
    }
  };

  const handleCopyId = () => {
    const currentImage = images[currentIndex];
    if (currentImage) {
      navigator.clipboard.writeText(currentImage.id);
      setShowMore(false);
    }
  };

  const handleCopyImage = async () => {
    const currentImage = images[currentIndex];
    if (!currentImage) return;
    try {
      // Intentionally using raw fetch here since this returns binary Blob data,
      // not our standard ApiResponse JSON format.
      const response = await fetch(getUrl(currentImage));
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setShowMore(false);
    } catch (err) {
      console.error("Failed to copy image", err);
    }
  };

  const handleForward = () => {
    alert("Forwarding not implemented yet");
  };


  if (!isOpen) return null;

  const currentImage = images[currentIndex];
  if (!currentImage) return null;

  const isZoomed = scale > 1;

  // Format timestamp
  const formattedDate = context?.created_at ? formatFriendlyDate(context.created_at) : '';

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-rm-bg-primary/95 backdrop-blur-md animate-in fade-in duration-200">

      {/* Top Toolbar */}
      {!hideUi && (
        <div className="absolute top-0 left-0 right-0 p-2 md:p-4 flex items-center justify-between z-50 bg-gradient-to-b from-rm-bg-primary/80 to-transparent pointer-events-none">
          {/* Left: User Info */}
          <div className="flex items-center gap-3 pointer-events-auto">
            {context?.avatar_url && (
              <img src={context.avatar_url} alt={context.username || "User"} width={28} height={28} className="rounded-full md:w-8 md:h-8" />
            )}
            <div className="flex flex-col">
              <span className="text-rm-text font-bold text-sm leading-none drop-shadow-md">
                {context?.username || 'Unknown User'}
              </span>
              {formattedDate && (
                <span className="text-rm-text-muted text-[10px] font-medium drop-shadow-md">
                  {formattedDate}
                </span>
              )}
            </div>
          </div>

          {/* Right: Tools */}
          <div className="flex items-center gap-1 md:gap-2 pointer-events-auto">
            <button
              onClick={() => viewDispatch({ type: 'ZOOM_OUT' })}
              className="p-2 text-rm-text-muted hover:text-rm-text bg-rm-bg-elevated/40 hover:bg-rm-bg-hover rounded-full transition-all outline-none"
              title="Zoom Out"
            >
              <ZoomOut size={20} />
            </button>
            <button
              onClick={() => viewDispatch({ type: 'ZOOM_IN' })}
              className="p-2 text-rm-text-muted hover:text-rm-text bg-rm-bg-elevated/40 hover:bg-rm-bg-hover rounded-full transition-all outline-none"
              title="Zoom In"
            >
              <ZoomIn size={20} />
            </button>

            <div className="w-px h-4 bg-rm-border mx-1" />

            <button
              onClick={handleForward}
              className="p-2 text-rm-text-muted hover:text-rm-text bg-rm-bg-elevated/40 hover:bg-rm-bg-hover rounded-full transition-all outline-none"
              title="Forward"
            >
              <CornerUpRight size={20} />
            </button>

            <a
              href={getUrl(currentImage)}
              download={currentImage.filename}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-rm-text-muted hover:text-rm-text bg-rm-bg-elevated/40 hover:bg-rm-bg-hover rounded-full transition-all outline-none"
              title="Open Original"
            >
              <Download size={20} />
            </a>


            {/* More Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => { setShowMore(!showMore); setShowDetails(false); }}
                className={cn(
                  "p-2 text-rm-text-muted hover:text-rm-text bg-rm-bg-elevated/40 hover:bg-rm-bg-hover rounded-full transition-all outline-none",
                  showMore && "bg-primary text-primary-foreground"
                )}
              >
                <MoreHorizontal size={20} />
              </button>
              {showMore && (
                <div className="absolute top-full right-0 mt-2 w-64 bg-rm-bg-elevated border border-rm-border rounded-lg shadow-2xl overflow-visible py-1 z-[100] animate-in slide-in-from-top-2 fade-in duration-200">
                  {/* Main Menu Items - Always Visible */}
                  <button onClick={handleCopyImage} className="w-full px-3 py-2 text-left text-sm text-rm-text-secondary hover:bg-primary hover:text-primary-foreground flex items-center justify-between group outline-none">
                    Copy Image
                    <Copy size={14} className="opacity-50 group-hover:opacity-100" />
                  </button>
                  <button onClick={handleCopyLink} className="w-full px-3 py-2 text-left text-sm text-rm-text-secondary hover:bg-primary hover:text-primary-foreground flex items-center justify-between group outline-none">
                    Copy Link
                    <LinkIcon size={14} className="opacity-50 group-hover:opacity-100" />
                  </button>

                  {/* View Details Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDetails(!showDetails);
                    }}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm flex items-center justify-between group transition-colors outline-none",
                      showDetails ? "bg-primary/20 text-primary" : "text-rm-text-secondary hover:bg-primary hover:text-primary-foreground"
                    )}
                  >
                    View Details
                    <ChevronRight size={14} className={cn("transition-transform duration-200", showDetails ? "rotate-90 opacity-100" : "opacity-50 group-hover:opacity-100")} />
                  </button>

                  <div className="h-px bg-rm-border my-1" />
                  <button onClick={handleCopyId} className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive hover:text-destructive-foreground flex items-center justify-between group outline-none transition-colors">
                    Copy Attachment ID
                    <FileDigit size={14} className="opacity-50 group-hover:opacity-100" />
                  </button>

                  {/* Side Panel Details - Pops out to the left */}
                  {showDetails && (
                    <div className="absolute top-0 right-[calc(100%+8px)] w-64 bg-rm-bg-elevated border border-rm-border rounded-lg shadow-xl p-4 animate-in slide-in-from-right-4 fade-in duration-200 cursor-default outline-none"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
                      role="region"
                      aria-label="Image details panel"
                      tabIndex={-1}
                    >
                      <h3 className="text-rm-text font-semibold mb-3 text-sm flex items-center gap-2">
                        <Info size={14} className="text-primary" />
                        Image Details
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <div className="text-[10px] font-bold text-rm-text-muted uppercase mb-1">Filename</div>
                          <div className="text-xs text-rm-text break-all bg-rm-bg-surface/40 p-2 rounded border border-rm-border font-mono">
                            {currentImage.filename}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-[10px] font-bold text-rm-text-muted uppercase mb-1">Dimensions</div>
                            <div className="text-sm text-rm-text font-medium">
                              {dimensions ? `${dimensions.width}×${dimensions.height}` : '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold text-rm-text-muted uppercase mb-1">Size</div>
                            <div className="text-sm text-rm-text font-medium">
                              {formatBytes(currentImage.size_bytes)}
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-rm-text-muted uppercase mb-1">Type</div>
                          <div className="text-xs text-rm-text-muted font-mono">
                            {currentImage.content_type}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={close}
              className="p-2 text-rm-text-muted hover:text-rm-text bg-rm-bg-elevated/40 hover:bg-rm-bg-hover rounded-full transition-all outline-none"
            >
              <X size={20} />
            </button>
          </div>
        </div>
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
          "relative w-full flex-1 flex items-center justify-center overflow-hidden",
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
              setIsLoaded(true);
              setDimensions({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight });
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
      {!hideUi && images.length > 1 && (() => {
        // Responsive base dimensions: square on desktop, portrait on mobile
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
                      setCurrentIndex(idx);
                      setIsLoaded(false);
                    }}
                    className={cn(
                      "relative rounded-lg overflow-hidden flex-shrink-0 group",
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
                    <img
                      src={getUrl(img)}
                      alt={`Thumbnail ${idx + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onLoad={(e) => {
                        const el = e.currentTarget;
                        if (el.naturalWidth && el.naturalHeight && !thumbAspects.current.has(idx)) {
                          thumbAspects.current.set(idx, el.naturalWidth / el.naturalHeight);
                          // Force re-render so the selected thumb morphs to its aspect ratio
                          forceThumbUpdate(c => c + 1);
                        }
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
