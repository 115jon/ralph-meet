import { AvatarImage } from "@/components/chat/AvatarImage";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  normalizeAvatarDisplay,
  type AvatarDisplay,
  type AvatarCropRect,
} from "@/lib/avatar-display";
import { Icon } from "@/components/ui/icon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  return (
    // Always a centred dialog: dragging the image to frame it would fight a
    // phone drawer's swipe-to-dismiss. Stacked over settings (11.1).
    <ResponsiveDialog
      open
      forceMode="dialog"
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <ResponsiveDialogContent className="z-60 max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain md:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Frame your avatar</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Drag to reposition and zoom to crop. The original image stays
            unchanged.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="rounded-lg bg-rm-tint-1 p-4">
          <div
            ref={viewportRef}
            role="img"
            aria-label={`${displayName}'s avatar crop`}
            className="relative mx-auto aspect-square w-full max-w-80 cursor-grab touch-none overflow-hidden rounded-full bg-rm-tint-2 active:cursor-grabbing"
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
                className="absolute top-1/2 left-1/2 max-w-none select-none"
                style={{
                  width: previewStyle.width,
                  height: previewStyle.height,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
              />
            ) : (
              <div className="flex size-full items-center justify-center text-ui-sm text-rm-text-muted">
                Loading image…
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-rm-accent-ink ring-inset" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Icon
            name="image"
            size="sm"
            className="shrink-0 text-rm-text-muted"
          />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!naturalSize}
            onChange={(event) => updateZoom(Number(event.currentTarget.value))}
            className="rm-settings-range min-w-0 flex-1"
            aria-label="Zoom"
            aria-valuetext={`${Math.round(zoom * 100)}%`}
          />
          <Icon
            name="image"
            size="lg"
            className="shrink-0 text-rm-text-secondary"
          />
          {currentDisplay ? (
            <div className="size-10 shrink-0 overflow-hidden rounded-full bg-rm-tint-2">
              <AvatarImage
                src={image.src}
                alt={`${displayName} preview`}
                display={currentDisplay}
              />
            </div>
          ) : null}
        </div>

        <ResponsiveDialogFooter className="max-md:[&_button]:min-h-11 max-md:[&_button]:w-full md:justify-between">
          <Button type="button" variant="ghost" onClick={reset}>
            <Icon name="reset" size="sm" />
            Reset
          </Button>
          <div className="flex flex-col-reverse gap-2 md:flex-row">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!currentDisplay}
              onClick={handleConfirm}
            >
              Apply
            </Button>
          </div>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
