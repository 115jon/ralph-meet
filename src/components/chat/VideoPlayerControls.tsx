import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getDownloadUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  BigPlayIcon,
  DownloadIcon,
  ExpandIcon,
  PauseIcon,
  PlayAgainIcon,
  PlayIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
} from "./VideoIcons";

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
        <button
          onClick={onClick}
          className={cn("p-1.5 rounded-md hover:bg-white/10 transition-colors", className)}
          aria-label={label}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── Download button (top-right floating) ─────────────────────────

interface VideoDownloadButtonProps {
  src: string;
  filename: string;
  visible: boolean;
}

export function VideoDownloadButton({ src, filename, visible }: VideoDownloadButtonProps) {
  return (
    <div
      className={cn(
        "absolute top-2 right-2 z-20 transition-all duration-200",
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
      )}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={getDownloadUrl(src)}
              download={filename}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm text-white/80 hover:text-white hover:bg-black/70 transition-all border border-white/10"
              aria-label="Download"
            >
              <DownloadIcon />
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>Download</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────

interface VideoProgressBarProps {
  progressRef: React.RefObject<HTMLDivElement | null>;
  dragging: boolean;
  handleSeekClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleDragStart: (e: React.MouseEvent<HTMLDivElement>) => void;
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
  return (
    <div
      ref={progressRef}
      className={cn(
        "group/bar relative rounded-full cursor-pointer mb-2 transition-all",
        dragging ? "h-2" : "h-1 hover:h-1.5"
      )}
      onClick={handleSeekClick}
      onMouseDown={handleDragStart}
      onKeyDown={(e) => {
        const v = videoRef.current;
        if (!v || !duration) return;
        if (e.key === "ArrowRight") {
          v.currentTime = Math.min(duration, v.currentTime + 5);
        } else if (e.key === "ArrowLeft") {
          v.currentTime = Math.max(0, v.currentTime - 5);
        }
      }}
      role="slider"
      aria-label="Video progress"
      aria-valuenow={displayProgress}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
    >
      <div className="absolute inset-0 rounded-full bg-white/15" />
      <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${buffered}%` }} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${displayProgress}%`, transition: dragging ? 'none' : 'width 0.1s' }} />
      <div
        className={cn(
          "absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg transition-opacity",
          dragging ? "w-3.5 h-3.5 opacity-100" : "w-2.5 h-2.5 opacity-0 group-hover/bar:opacity-100"
        )}
        style={{ left: `calc(${displayProgress}% - ${dragging ? 7 : 5}px)` }}
      />
      {dragging && (
        <div
          className="absolute -top-8 -translate-x-1/2 px-2 py-0.5 rounded-md bg-rm-bg-elevated border border-rm-border shadow-lg text-[10px] font-mono font-bold text-rm-text tabular-nums whitespace-nowrap pointer-events-none"
          style={{ left: `${displayProgress}%` }}
        >
          {formatDuration(displayTime)}
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
  mode?: 'default' | 'animated';
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
  mode = 'default',
}: VideoControlBarProps) {
  if (mode === 'animated') {
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
        <button
          onClick={togglePlay}
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
          aria-label={ended ? "Replay" : playing ? "Pause" : "Play"}
        >
          {ended ? <PlayAgainIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <span className="text-[10px] font-medium tabular-nums text-white/60 ml-1">
          {formatDuration(displayTime)} / {formatDuration(duration)}
        </span>

        <div className="flex-1" />

        {/* Volume – vertical popover on hover, no tooltip */}
        <div className="relative flex items-center group/vol">
          <button
            onClick={toggleMute}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? <VolumeMuteIcon /> : volume < 0.5 ? <VolumeLowIcon /> : <VolumeHighIcon />}
          </button>

          {/* Vertical volume slider – appears above the mute button on hover.
              pb-2 inside ensures visual gap without breaking hover continuity. */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 opacity-0 scale-95 pointer-events-none group-hover/vol:opacity-100 group-hover/vol:scale-100 group-hover/vol:pointer-events-auto transition-all duration-200 origin-bottom pb-2">
            <div className="flex flex-col items-center bg-black/70 backdrop-blur-md rounded-lg px-2 py-3 border border-white/10 shadow-xl">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-1.5 h-20 accent-primary cursor-pointer appearance-none rounded-full bg-white/20 [writing-mode:vertical-lr] [direction:rtl]"
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
  splashIcon: 'play' | 'pause';
}

export function SplashOverlay({ splashKey, splashIcon }: SplashOverlayProps) {
  if (splashKey === 0) return null;
  return (
    <div
      key={splashKey}
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
    >
      <div className="w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white animate-[splash_0.5s_ease-out_forwards]">
        {splashIcon === 'play' ? <PlayIcon className="w-6 h-6" /> : <PauseIcon />}
      </div>
    </div>
  );
}

// ── Big play / replay overlay ────────────────────────────────────

interface BigPlayOverlayProps {
  isViewer: boolean;
  ended: boolean;
}

export function BigPlayOverlay({ isViewer, ended }: BigPlayOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className={cn(
        "rounded-full backdrop-blur-sm flex items-center justify-center transition-transform group-hover/video:scale-110",
        "w-14 h-14 bg-black/50 border border-white/10 shadow-2xl text-white",
        isViewer && "w-16 h-16"
      )}>
        {ended ? <PlayAgainIcon /> : <BigPlayIcon />}
      </div>
    </div>
  );
}
