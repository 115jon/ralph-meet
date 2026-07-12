import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

import type { SFUClient } from "@/lib/sfu-client";
import { ListenTogetherNowPlayingCard } from "./ListenTogetherNowPlayingCard";
import type { ListenTogetherPlaybackState } from "./listen-together-playback";

interface FloatingListenTogetherPlayerProps {
  playback: ListenTogetherPlaybackState;
  sfu: SFUClient | null;
  roomSlug?: string | null;
  onOpenQueue?: () => void;
}

const DEFAULT_PLAYER_SIZE = { width: 340, height: 170 };

function getDefaultPosition() {
  if (typeof window === "undefined") return { x: 16, y: 16 };

  return {
    x: Math.max(16, window.innerWidth - DEFAULT_PLAYER_SIZE.width - 16),
    y: Math.max(16, window.innerHeight - DEFAULT_PLAYER_SIZE.height - 120),
  };
}

function clampPosition(
  position: { x: number; y: number },
  width: number,
  height: number,
) {
  if (typeof window === "undefined") return position;

  return {
    x: Math.min(
      Math.max(12, position.x),
      Math.max(12, window.innerWidth - width - 12),
    ),
    y: Math.min(
      Math.max(12, position.y),
      Math.max(12, window.innerHeight - height - 12),
    ),
  };
}

export function FloatingListenTogetherPlayer({
  playback,
  sfu,
  roomSlug,
  onOpenQueue,
}: FloatingListenTogetherPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [position, setPosition] = useState(getDefaultPosition);

  useEffect(() => {
    const clampToViewport = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      setPosition((current) =>
        clampPosition(
          current,
          rect?.width ?? DEFAULT_PLAYER_SIZE.width,
          rect?.height ?? DEFAULT_PLAYER_SIZE.height,
        ),
      );
    };

    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, input, a")) return;

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
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const rect = containerRef.current?.getBoundingClientRect();
    setPosition(
      clampPosition(
        {
          x: event.clientX - dragState.offsetX,
          y: event.clientY - dragState.offsetY,
        },
        rect?.width ?? DEFAULT_PLAYER_SIZE.width,
        rect?.height ?? DEFAULT_PLAYER_SIZE.height,
      ),
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      !dragStateRef.current ||
      dragStateRef.current.pointerId !== event.pointerId
    ) {
      return;
    }

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!playback.currentEntry || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={containerRef}
      data-testid="floating-listen-together-player"
      className="fixed z-[130] w-[min(340px,calc(100vw-24px))] touch-none select-none cursor-grab active:cursor-grabbing"
      style={{ left: position.x, top: position.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <ListenTogetherNowPlayingCard
        playback={playback}
        sfu={sfu}
        roomSlug={roomSlug}
        variant="mini"
        onOpenQueue={onOpenQueue}
        className="w-full"
      />
    </div>,
    document.body,
  );
}
