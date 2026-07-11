import { AvatarImage } from "@/components/chat/AvatarImage";
import { Button } from "@/components/ui/button";
import {
  normalizeAvatarDisplay,
  type AvatarDisplay,
  type AvatarCropRect,
} from "@/lib/avatar-display";
import { cn } from "@/lib/utils";
import { Camera, Check, Image as ImageIcon, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type React from "react";

type PickedAvatarImage = {
  src: string;
  file?: File;
};

interface AvatarFrameEditorProps {
  image: PickedAvatarImage;
  initialDisplay?: AvatarDisplay | string | null;
  displayName: string;
  onCancel: () => void;
  onConfirm: (display: AvatarDisplay) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DEFAULT_VIEWPORT_SIZE = 320;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function getBaseScale(
  naturalWidth: number,
  naturalHeight: number,
  viewportSize: number,
) {
  return Math.max(viewportSize / naturalWidth, viewportSize / naturalHeight);
}

function getOffsetBounds(
  naturalWidth: number,
  naturalHeight: number,
  viewportSize: number,
  zoom: number,
) {
  const scale = getBaseScale(naturalWidth, naturalHeight, viewportSize) * zoom;
  const displayedWidth = naturalWidth * scale;
  const displayedHeight = naturalHeight * scale;

  return {
    x: Math.max(0, (displayedWidth - viewportSize) / 2),
    y: Math.max(0, (displayedHeight - viewportSize) / 2),
  };
}

function clampOffset(
  offset: { x: number; y: number },
  naturalWidth: number,
  naturalHeight: number,
  viewportSize: number,
  zoom: number,
) {
  const bounds = getOffsetBounds(
    naturalWidth,
    naturalHeight,
    viewportSize,
    zoom,
  );
  return {
    x: clamp(offset.x, -bounds.x, bounds.x),
    y: clamp(offset.y, -bounds.y, bounds.y),
  };
}

function displayFromViewport(
  naturalWidth: number,
  naturalHeight: number,
  viewportSize: number,
  zoom: number,
  offset: { x: number; y: number },
): AvatarDisplay {
  const scale = getBaseScale(naturalWidth, naturalHeight, viewportSize) * zoom;
  const displayedWidth = naturalWidth * scale;
  const displayedHeight = naturalHeight * scale;
  const left = (viewportSize - displayedWidth) / 2 + offset.x;
  const top = (viewportSize - displayedHeight) / 2 + offset.y;

  const crop: AvatarCropRect = {
    x: round(clamp((-left / scale / naturalWidth) * 100, 0, 100)),
    y: round(clamp((-top / scale / naturalHeight) * 100, 0, 100)),
    width: round(clamp((viewportSize / scale / naturalWidth) * 100, 1, 100)),
    height: round(clamp((viewportSize / scale / naturalHeight) * 100, 1, 100)),
  };

  crop.x = round(clamp(crop.x, 0, 100 - crop.width));
  crop.y = round(clamp(crop.y, 0, 100 - crop.height));

  return { version: 1, crop };
}

function viewportFromDisplay(
  display: AvatarDisplay & { crop: AvatarCropRect },
  naturalWidth: number,
  naturalHeight: number,
  viewportSize: number,
) {
  const cropWidthPx = (display.crop.width / 100) * naturalWidth;
  const scale = viewportSize / cropWidthPx;
  const zoom = clamp(
    scale / getBaseScale(naturalWidth, naturalHeight, viewportSize),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  const actualScale =
    getBaseScale(naturalWidth, naturalHeight, viewportSize) * zoom;
  const displayedWidth = naturalWidth * actualScale;
  const displayedHeight = naturalHeight * actualScale;
  const desiredLeft = -((display.crop.x / 100) * naturalWidth * actualScale);
  const desiredTop = -((display.crop.y / 100) * naturalHeight * actualScale);

  return {
    zoom,
    offset: clampOffset(
      {
        x: desiredLeft - (viewportSize - displayedWidth) / 2,
        y: desiredTop - (viewportSize - displayedHeight) / 2,
      },
      naturalWidth,
      naturalHeight,
      viewportSize,
      zoom,
    ),
  };
}

export function AvatarFrameEditor({
  image,
  initialDisplay,
  displayName,
  onCancel,
  onConfirm,
}: AvatarFrameEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState(DEFAULT_VIEWPORT_SIZE);
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [didApplyInitial, setDidApplyInitial] = useState(false);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0) setViewportSize(rect.width);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setDidApplyInitial(false);
    };
    img.src = image.src;
  }, [image.src]);

  useEffect(() => {
    if (!naturalSize || didApplyInitial) return;

    const frameId = requestAnimationFrame(() => {
      const normalized = normalizeAvatarDisplay(initialDisplay);
      if (normalized?.crop) {
        const next = viewportFromDisplay(
          { ...normalized, crop: normalized.crop },
          naturalSize.width,
          naturalSize.height,
          viewportSize,
        );
        setZoom(next.zoom);
        setOffset(next.offset);
      } else {
        setZoom(MIN_ZOOM);
        setOffset({ x: 0, y: 0 });
      }
      setDidApplyInitial(true);
    });

    return () => cancelAnimationFrame(frameId);
  }, [didApplyInitial, initialDisplay, naturalSize, viewportSize]);

  const currentDisplay = useMemo(() => {
    if (!naturalSize) return null;
    return displayFromViewport(
      naturalSize.width,
      naturalSize.height,
      viewportSize,
      zoom,
      offset,
    );
  }, [naturalSize, offset, viewportSize, zoom]);

  const previewStyle = useMemo(() => {
    if (!naturalSize) return undefined;
    const scale =
      getBaseScale(naturalSize.width, naturalSize.height, viewportSize) * zoom;
    return {
      width: naturalSize.width * scale,
      height: naturalSize.height * scale,
      transform: `translate(${offset.x}px, ${offset.y}px)`,
    };
  }, [naturalSize, offset.x, offset.y, viewportSize, zoom]);

  const updateZoom = (value: number) => {
    if (!naturalSize) return;
    const nextZoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
    setZoom(nextZoom);
    setOffset((current) =>
      clampOffset(
        current,
        naturalSize.width,
        naturalSize.height,
        viewportSize,
        nextZoom,
      ),
    );
  };

  const reset = () => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!naturalSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !naturalSize || drag.pointerId !== event.pointerId) return;

    setOffset(
      clampOffset(
        {
          x: drag.offsetX + event.clientX - drag.startX,
          y: drag.offsetY + event.clientY - drag.startY,
        },
        naturalSize.width,
        naturalSize.height,
        viewportSize,
        zoom,
      ),
    );
  };

  const stopDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const handleConfirm = () => {
    if (!currentDisplay) return;
    const existing = normalizeAvatarDisplay(initialDisplay);
    onConfirm({
      ...currentDisplay,
      collectibles: existing?.collectibles,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm md:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-frame-title"
        className="relative my-auto w-full max-w-[440px] overflow-hidden rounded-xl border border-rm-border bg-rm-bg-primary p-0 text-rm-text shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-rm-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Camera size={16} />
            </div>
            <div className="min-w-0">
              <h2
                id="avatar-frame-title"
                className="truncate text-sm font-bold text-rm-text"
              >
                Frame avatar
              </h2>
              <p className="text-xs text-rm-text-muted">
                Original image stays unchanged
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-md text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text"
            aria-label="Close avatar framing"
          >
            <X size={16} />
          </button>
        </div>

        <div className="bg-black p-4">
          <div
            ref={viewportRef}
            className="relative mx-auto aspect-square w-full max-w-[340px] touch-none overflow-hidden rounded-full bg-rm-bg-elevated"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          >
            {previewStyle ? (
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: previewStyle.width,
                  height: previewStyle.height,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-rm-text-muted">
                Loading
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-primary" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,transparent_58%,rgba(0,0,0,0.52)_59%)]" />
          </div>
        </div>

        <div className="space-y-4 border-t border-rm-border bg-rm-bg-surface px-4 py-4">
          <div className="flex items-center gap-3">
            <ImageIcon size={14} className="text-rm-text-muted" />
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(event) =>
                updateZoom(Number(event.currentTarget.value))
              }
              className="h-2 flex-1 accent-primary"
              aria-label="Avatar zoom"
            />
            <ImageIcon size={20} className="text-rm-text-secondary" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
              onClick={reset}
            >
              <RotateCcw size={14} />
              Reset
            </Button>
            {currentDisplay && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-rm-text-muted">
                  Preview
                </span>
                <div className="h-10 w-10 overflow-hidden rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  <AvatarImage
                    src={image.src}
                    alt={`${displayName} preview`}
                    display={currentDisplay}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-rm-border px-4 py-4">
          <Button
            type="button"
            variant="outline"
            className="border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!currentDisplay}
            className={cn(
              "bg-primary text-primary-foreground hover:brightness-110",
              !currentDisplay && "opacity-50",
            )}
            onClick={handleConfirm}
          >
            <Check size={16} />
            Apply
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
