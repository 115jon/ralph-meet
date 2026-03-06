import React, { useCallback, useEffect, useReducer, useRef } from 'react';

// ── View state types ─────────────────────────────────────────────

export interface ViewState {
  scale: number;
  pan: { x: number; y: number };
  isDragging: boolean;
  dragStart: { x: number; y: number };
  hideUi: boolean;
}

export type ViewAction =
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

// ── Hook ─────────────────────────────────────────────────────────

/**
 * Manages zoom/pan/drag/wheel state + clamping for the image viewer.
 */
export function useImageViewerState(isOpen: boolean) {
  const [viewState, viewDispatch] = useReducer(viewReducer, initialViewState);
  const { scale, pan, isDragging, dragStart } = viewState;

  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

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
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = false;
    if (scale > 1) {
      e.preventDefault();
      viewDispatch({ type: 'START_DRAG', payload: { x: e.clientX - pan.x, y: e.clientY - pan.y } });
    }
  }, [scale, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      e.preventDefault();
      isDraggingRef.current = true;
      const rawX = e.clientX - dragStart.x;
      const rawY = e.clientY - dragStart.y;

      viewDispatch({ type: 'SET_PAN', payload: getClampedPan(rawX, rawY, scale) });
    }
  }, [isDragging, scale, dragStart, getClampedPan]);

  const handleMouseUp = useCallback(() => {
    viewDispatch({ type: 'STOP_DRAG' });
  }, []);

  // Toggle zoom on click (guards against drag-then-click)
  const handleImageClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }

    viewDispatch({ type: 'TOGGLE_ZOOM' });
  }, []);

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

  return {
    viewState,
    viewDispatch,
    containerRef,
    imageRef,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleImageClick,
  } as const;
}
