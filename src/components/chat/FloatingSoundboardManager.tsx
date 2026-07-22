import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { AudioWaveform, ChevronDown } from "lucide-react";

import type { SFUClient } from "@/lib/sfu-client";
import { getSoundboardServerKey } from "@/lib/voice/soundboard";
import { useVoiceSoundboardStore } from "@/stores/useVoiceSoundboardStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SoundboardPlaybackRow } from "./ActiveSoundboardEffectList";

interface FloatingSoundboardManagerProps {
  serverId?: string | null;
  serverKey?: string;
  localUserId?: string | null;
  sfu: SFUClient | null;
}

export function FloatingSoundboardManager({
  serverId,
  serverKey: explicitServerKey,
  localUserId,
  sfu,
}: FloatingSoundboardManagerProps) {
  const activePlaybacks = useVoiceSoundboardStore(
    (state) => state.activePlaybacks,
  );
  const serverKey = explicitServerKey ?? getSoundboardServerKey(serverId);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState(() => {
    if (typeof window === "undefined") return { x: 16, y: 16 };
    return {
      x: Math.max(16, window.innerWidth - 360 - 16),
      y: 16,
    };
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressHandleClickRef = useRef(false);

  const scopedPlaybacks = useMemo(
    () =>
      Object.values(activePlaybacks)
        .filter(
          (playback) =>
            playback.serverKey === serverKey &&
            playback.ownerId === localUserId,
        )
        .sort((a, b) => b.startedAt - a.startedAt),
    [activePlaybacks, localUserId, serverKey],
  );

  useEffect(() => {
    const clampToViewport = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      setPosition((current) => ({
        x: Math.min(
          Math.max(12, current.x),
          Math.max(12, window.innerWidth - (rect?.width ?? 360) - 12),
        ),
        y: Math.min(
          Math.max(12, current.y),
          Math.max(12, window.innerHeight - (rect?.height ?? 320) - 12),
        ),
      }));
    };

    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  useEffect(() => {
    toggleRef.current?.focus({ preventScroll: true });
  }, [collapsed]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (
      !(event.target as HTMLElement).closest(
        '[data-soundboard-drag-handle="true"]',
      )
    ) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const hasMoved =
      Math.abs(event.clientX - dragState.startX) > 4 ||
      Math.abs(event.clientY - dragState.startY) > 4;
    if (!hasMoved) return;

    dragState.moved = true;
    suppressHandleClickRef.current = true;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const rect = containerRef.current?.getBoundingClientRect();
    setPosition({
      x: Math.min(
        Math.max(12, event.clientX - dragState.offsetX),
        Math.max(12, window.innerWidth - (rect?.width ?? 360) - 12),
      ),
      y: Math.min(
        Math.max(12, event.clientY - dragState.offsetY),
        Math.max(12, window.innerHeight - (rect?.height ?? 320) - 12),
      ),
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !dragStateRef.current ||
      dragStateRef.current.pointerId !== event.pointerId
    ) {
      return;
    }

    if (dragStateRef.current.moved) {
      window.setTimeout(() => {
        suppressHandleClickRef.current = false;
      }, 0);
    }
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleDragHandleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!suppressHandleClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressHandleClickRef.current = false;
  };

  if (scopedPlaybacks.length === 0 || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <TooltipProvider delayDuration={100}>
      <aside
        ref={containerRef}
        data-testid="floating-soundboard-manager"
        aria-label="Soundboard manager"
        className="fixed z-[130] w-[min(360px,calc(100vw-24px))] touch-none select-none"
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => {
          dragStateRef.current = null;
        }}
      >
        {collapsed ? (
          <button
            ref={toggleRef}
            type="button"
            data-soundboard-drag-handle="true"
            aria-label="Open soundboard manager"
            aria-expanded="false"
            aria-controls="soundboard-manager-panel"
            onClick={() => setCollapsed(false)}
            onClickCapture={handleDragHandleClick}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-rm-border bg-rm-bg-floating/95 px-3 text-sm font-bold text-rm-text shadow-[0_18px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-[background-color,color,transform] duration-200 hover:bg-rm-bg-hover hover:text-rm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.96]"
          >
            <AudioWaveform className="h-4 w-4 text-primary" />
            Soundboard
          </button>
        ) : (
          <div
            id="soundboard-manager-panel"
            className="overflow-hidden rounded-xl border border-rm-border bg-rm-bg-floating/95 text-rm-text shadow-[0_18px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
          >
            <button
              ref={toggleRef}
              type="button"
              data-soundboard-drag-handle="true"
              aria-expanded="true"
              aria-controls="soundboard-manager-panel"
              aria-label="Collapse soundboard manager"
              onClick={() => setCollapsed(true)}
              onClickCapture={handleDragHandleClick}
              className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-rm-border/70 px-3 py-2.5 text-left transition-[background-color,color] duration-200 hover:bg-rm-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                <AudioWaveform className="h-4 w-4 shrink-0 text-primary" />
                Soundboard
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-rm-text-muted" />
            </button>
            <div className="max-h-[min(360px,calc(100vh-112px))] space-y-2 overflow-y-auto p-2.5">
              {scopedPlaybacks.map((playback) => (
                <SoundboardPlaybackRow
                  key={playback.playbackId}
                  playback={playback}
                  localUserId={localUserId}
                  serverKey={serverKey}
                  sfu={sfu}
                  variant="floating"
                />
              ))}
            </div>
          </div>
        )}
      </aside>
    </TooltipProvider>,
    document.body,
  );
}
