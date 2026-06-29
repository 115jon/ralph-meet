import type { StreamContextMenuProps } from "@/components/StreamContextMenu";
import { StreamContextMenu } from "@/components/StreamContextMenu";
import { IconButton } from "@/components/ui/IconButton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VideoPlayer } from "@/components/voice/VideoPlayer";
import { cn } from "@/lib/utils";
import { ArrowLeft, MonitorX, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const DEFAULT_PREVIEW_SIZE = {
  width: 360,
  height: 220,
};

function getDefaultPosition(slotIndex: number) {
  if (typeof window === "undefined") {
    return { x: 16 + slotIndex * 20, y: 16 + slotIndex * 20 };
  }

  return {
    x: Math.max(16, Math.min(96 - slotIndex * 12, window.innerWidth - DEFAULT_PREVIEW_SIZE.width - 16 - slotIndex * 24)),
    y: Math.max(16, window.innerHeight - DEFAULT_PREVIEW_SIZE.height - 120 - slotIndex * 28),
  };
}

function clampPosition(position: { x: number; y: number }, width: number, height: number) {
  if (typeof window === "undefined") return position;

  return {
    x: Math.min(Math.max(12, position.x), Math.max(12, window.innerWidth - width - 12)),
    y: Math.min(Math.max(12, position.y), Math.max(12, window.innerHeight - height - 12)),
  };
}

interface FloatingStreamPreviewProps {
  userId: string;
  channelName: string;
  displayName: string;
  previewStream: MediaStream | null;
  slotIndex?: number;
  isPreviewPaused?: boolean;
  pausedTitle?: string;
  pausedDescription?: string;
  primaryActionTooltip: string;
  primaryActionAriaLabel: string;
  onPrimaryAction: () => void;
  onNavigateToVoiceChannel: () => void;
  menuProps: Omit<StreamContextMenuProps, "x" | "y" | "onClose" | "userId">;
}

export default function FloatingStreamPreview({
  userId,
  channelName,
  displayName,
  previewStream,
  slotIndex = 0,
  isPreviewPaused = false,
  pausedTitle = "This stream is still running!",
  pausedDescription = "We couldn't render the preview right now.",
  primaryActionTooltip,
  primaryActionAriaLabel,
  onPrimaryAction,
  onNavigateToVoiceChannel,
  menuProps,
}: FloatingStreamPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [position, setPosition] = useState(() => getDefaultPosition(slotIndex));
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const clampToViewport = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      setPosition((current) =>
        clampPosition(
          current,
          rect?.width ?? DEFAULT_PREVIEW_SIZE.width,
          rect?.height ?? DEFAULT_PREVIEW_SIZE.height,
        ),
      );
    };

    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-stream-preview-interactive='true']")) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    setPosition(
      clampPosition(
        {
          x: event.clientX - dragState.offsetX,
          y: event.clientY - dragState.offsetY,
        },
        rect?.width ?? DEFAULT_PREVIEW_SIZE.width,
        rect?.height ?? DEFAULT_PREVIEW_SIZE.height,
      ),
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div
        ref={containerRef}
        className="fixed z-[130] w-[min(360px,calc(100vw-24px))] touch-none select-none cursor-grab active:cursor-grabbing"
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="group relative aspect-video overflow-hidden rounded-[14px] border border-white/10 bg-[#06070a]/95 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          {!isPreviewPaused && previewStream && (
            <VideoPlayer
              stream={previewStream}
              muted
              label={`${displayName} stream preview`}
              className="h-full w-full object-contain bg-black"
            />
          )}

          {(isPreviewPaused || !previewStream) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black px-8 text-center">
              <p className="text-lg font-black tracking-tight text-white">{pausedTitle}</p>
              <p className="mt-2 text-sm font-medium text-white/70">{pausedDescription}</p>
            </div>
          )}

          {previewStream && !isPreviewPaused && (
            <div className="absolute inset-0 bg-linear-to-t from-black/55 via-transparent to-black/20 pointer-events-none" />
          )}

          <button
            type="button"
            data-stream-preview-interactive="true"
            onClick={onNavigateToVoiceChannel}
            className="absolute left-3 top-3 z-20 flex max-w-[70%] items-center gap-1.5 rounded-md bg-black/40 px-2.5 py-1 text-[15px] font-semibold tracking-tight text-white/90 transition hover:text-white hover:underline"
          >
            <ArrowLeft size={14} className="shrink-0" />
            <span className="truncate">{channelName}</span>
          </button>

          <div className="absolute bottom-3 left-3 z-20 max-w-[55%] rounded-md bg-black/40 px-2.5 py-1 text-sm font-bold tracking-tight text-white">
            <span className="truncate">{displayName}</span>
          </div>

          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2">
            <IconButton
              data-stream-preview-interactive="true"
              icon={Settings2}
              size="xs"
              tooltip="Stream Settings"
              aria-label="Open stream settings"
              className="border border-white/10 bg-black/55 text-white/85 hover:bg-black/70 hover:text-white"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setMenuPosition((current) =>
                  current ? null : { x: rect.right + 4, y: rect.top - 4 },
                );
              }}
            />
            <IconButton
              data-stream-preview-interactive="true"
              icon={MonitorX}
              size="xs"
              tooltip={primaryActionTooltip}
              aria-label={primaryActionAriaLabel}
              className={cn(
                "border border-white/10 bg-black/55 text-white/85 hover:bg-destructive hover:text-destructive-foreground",
                "transition-colors",
              )}
              onClick={() => {
                onPrimaryAction();
                setMenuPosition(null);
              }}
            />
          </div>
        </div>

        {menuPosition && (
          <StreamContextMenu
            {...menuProps}
            x={menuPosition.x}
            y={menuPosition.y}
            userId={userId}
            onClose={() => setMenuPosition(null)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
