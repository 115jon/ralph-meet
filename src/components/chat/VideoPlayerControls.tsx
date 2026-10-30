import { ButtonBase } from "@/components/ui/button-base";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDownloadUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { HIT, PRESS } from "@/components/ui/interaction";
import { useEffect, useRef, useState } from "react";
import { Num } from "@/components/ui/num";
import { MediaPlayButton } from "./embeds/MediaPlayButton";
import {
  DownloadIcon,
  ExpandIcon,
  PauseIcon,
  PlayAgainIcon,
  PlayIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
} from "./VideoIcons";
import { formatDuration } from "./video-duration";

// ── Tooltip button helper ────────────────────────────────────────

function TipButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ButtonBase
          onClick={onClick}
          className={cn("rounded-md p-1.5", PRESS, HIT, className)}
          aria-label={label}
        >
          {children}
        </ButtonBase>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Download button (top-right floating) ─────────────────────────

interface VideoDownloadButtonProps {
  src: string;
  filename: string;
  visible: boolean;
}

export function VideoDownloadButton({
  src,
  filename,
  visible,
}: VideoDownloadButtonProps) {
  return (
    <div
      className={cn(
        "absolute top-2 right-2 z-20 transition-ui",
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-1 pointer-events-none",
      )}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={getDownloadUrl(src)}
              download={filename}
              onClick={(e) => e.stopPropagation()}
              className="flex size-8 items-center justify-center rounded-md border border-line bg-ply-3 text-ink-1 shadow-float outline-none transition-colors duration-(--dur-1) ease-out pointer-fine:hover:bg-ply-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              aria-label="Download"
            >
              <DownloadIcon className="size-4" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Download
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────

interface VideoProgressBarProps {
  progressRef: React.RefObject<HTMLDivElement | null>;
  dragging: boolean;
  handleSeekClick: (e: React.MouseEvent<HTMLElement>) => void;
  handleDragStart: (e: React.MouseEvent<HTMLElement>) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duration: number;
  displayProgress: number;
  buffered: number;
  displayTime: number;
}

export function VideoProgressBar({
  progressRef,
  dragging,
  handleSeekClick,
  handleDragStart,
  videoRef,
  duration,
  displayProgress,
  buffered,
  displayTime,
}: VideoProgressBarProps) {
  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const nextProgress = Number.parseFloat(e.target.value);
    if (!Number.isFinite(nextProgress)) return;
    v.currentTime = (nextProgress / 100) * duration;
  };

  return (
    <div
      ref={progressRef}
      // A 12px hit band; the 4px rail inside thickens with scaleY on hover
      // (transform only: the old height change re-laid the bar per frame).
      className="group/bar relative mb-1 h-3 cursor-pointer"
    >
      <input
        type="range"
        min="0"
        max="100"
        step="0.1"
        value={displayProgress}
        onChange={handleRangeChange}
        onClick={handleSeekClick}
        onMouseDown={handleDragStart}
        aria-label="Video progress"
        className="absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0"
      />
      <div
        className={cn(
          "absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-transform duration-(--dur-1) ease-out",
          dragging ? "scale-y-150" : "pointer-fine:group-hover/bar:scale-y-150",
        )}
      >
        <div
          className="absolute inset-0 origin-left bg-white/30"
          style={{ transform: `scaleX(${buffered / 100})` }}
        />
        <div
          className="absolute inset-0 origin-left bg-white"
          style={{ transform: `scaleX(${displayProgress / 100})` }}
        />
      </div>
      <div
        className={cn(
          "absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-white shadow-float transition-opacity duration-(--dur-1) ease-out",
          dragging
            ? "opacity-100"
            : "pointer-fine:opacity-0 pointer-fine:group-hover/bar:opacity-100",
        )}
        style={{ left: `calc(${displayProgress}% - 6px)` }}
      />
      {dragging && (
        <div
          className="pointer-events-none absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-sm border border-line bg-ply-3 px-1.5 py-0.5 text-ink-1 shadow-float"
          style={{ left: `${displayProgress}%` }}
        >
          <Num>{formatDuration(displayTime)}</Num>
        </div>
      )}
    </div>
  );
}

// ── Control bar ──────────────────────────────────────────────────

interface VideoControlBarProps {
  playing: boolean;
  ended: boolean;
  togglePlay: () => void;
  displayTime: number;
  duration: number;
  muted: boolean;
  volume: number;
  toggleMute: () => void;
  handleVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  toggleFullscreen: () => void;
  mode?: "default" | "animated";
}

export function VideoControlBar({
  playing,
  ended,
  togglePlay,
  displayTime,
  duration,
  muted,
  volume,
  toggleMute,
  handleVolumeChange,
  toggleFullscreen,
  mode = "default",
}: VideoControlBarProps) {
  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false);
  const closeVolumePopoverTimerRef =
    useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (closeVolumePopoverTimerRef.current) {
        clearTimeout(closeVolumePopoverTimerRef.current);
      }
    };
  }, []);

  const openVolumePopover = () => {
    if (closeVolumePopoverTimerRef.current) {
      clearTimeout(closeVolumePopoverTimerRef.current);
      closeVolumePopoverTimerRef.current = null;
    }
    setVolumePopoverOpen(true);
  };

  const closeVolumePopover = () => {
    if (closeVolumePopoverTimerRef.current) {
      clearTimeout(closeVolumePopoverTimerRef.current);
    }

    // Briefly defer closing so the cursor can move from the icon into the slider
    closeVolumePopoverTimerRef.current = setTimeout(() => {
      setVolumePopoverOpen(false);
      closeVolumePopoverTimerRef.current = null;
    }, 120);
  };

  const handleVolumeBlurCapture = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }

    if (closeVolumePopoverTimerRef.current) {
      clearTimeout(closeVolumePopoverTimerRef.current);
      closeVolumePopoverTimerRef.current = null;
    }
    setVolumePopoverOpen(false);
  };

  if (mode === "animated") {
    return (
      <TooltipProvider>
        <div className="flex items-center justify-end text-white/90">
          <TipButton label="Full Screen" onClick={toggleFullscreen}>
            <ExpandIcon />
          </TipButton>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5 text-white/90">
        {/* Play / Pause / Replay — no tooltip */}
        <ButtonBase
          onClick={togglePlay}
          className={cn("rounded-md p-1.5", PRESS, HIT)}
          aria-label={ended ? "Replay" : playing ? "Pause" : "Play"}
        >
          {ended ? <PlayAgainIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
        </ButtonBase>

        <Num className="ml-1 text-white/80">
          {formatDuration(displayTime)} / {formatDuration(duration)}
        </Num>

        <div className="flex-1" />

        {/* Volume – vertical popover on hover, no tooltip */}
        <div
          className="relative flex items-center"
          onMouseEnter={openVolumePopover}
          onMouseLeave={closeVolumePopover}
          onFocusCapture={openVolumePopover}
          onBlurCapture={handleVolumeBlurCapture}
        >
          <ButtonBase
            onClick={toggleMute}
            className={cn("rounded-md p-1.5", PRESS, HIT)}
            aria-label={muted ? "Unmute" : "Mute"}
            aria-expanded={volumePopoverOpen}
          >
            {muted || volume === 0 ? (
              <VolumeMuteIcon />
            ) : volume < 0.5 ? (
              <VolumeLowIcon />
            ) : (
              <VolumeHighIcon />
            )}
          </ButtonBase>

          {/* Vertical volume slider – stays open briefly on leave so the handoff
              from the icon to the slider remains interactive. */}
          <div
            className={cn(
              "absolute bottom-full left-1/2 origin-bottom -translate-x-1/2 pb-2 transition-ui",
              volumePopoverOpen
                ? "scale-100 opacity-100 pointer-events-auto"
                : "scale-95 opacity-0 pointer-events-none",
            )}
          >
            <div className="flex flex-col items-center rounded-lg border border-line bg-ply-3 px-2 py-3 shadow-float">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                className="h-20 w-1.5 cursor-pointer appearance-none rounded-full bg-tint-3 accent-primary-fill [writing-mode:vertical-lr] [direction:rtl]"
                aria-label="Volume"
              />
            </div>
          </div>
        </div>

        {/* Fullscreen — with tooltip */}
        <TipButton label="Full Screen" onClick={toggleFullscreen}>
          <ExpandIcon />
        </TipButton>
      </div>
    </TooltipProvider>
  );
}

// ── Center splash animation ──────────────────────────────────────

interface SplashOverlayProps {
  splashKey: number;
  splashIcon: "play" | "pause";
}

/**
 * A press echo after play/pause: the play disc fades out while it grows
 * (`splash`, transform and opacity, 300ms). It rests at opacity 0, so where
 * reduced motion removes the keyframes nothing is left over the video.
 */
export function SplashOverlay({ splashKey, splashIcon }: SplashOverlayProps) {
  if (splashKey === 0) return null;
  return (
    <div
      key={splashKey}
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
    >
      <MediaPlayButton
        icon={splashIcon}
        className="opacity-0 animate-[splash_300ms_var(--ease-out)_forwards]"
      />
    </div>
  );
}

// ── Big play / replay overlay ────────────────────────────────────

interface BigPlayOverlayProps {
  isViewer: boolean;
  ended: boolean;
}

/** The shared play disc, centred on the frame (the frame is the button). */
export function BigPlayOverlay({ isViewer, ended }: BigPlayOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <MediaPlayButton
        icon={ended ? "replay" : "play"}
        size={isViewer ? "lg" : "md"}
      />
    </div>
  );
}
