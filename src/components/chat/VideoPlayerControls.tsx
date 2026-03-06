import { cn } from "@/lib/utils";
import { Download } from "./Icons";
import {
  BigPlayIcon,
  ExpandIcon,
  PauseIcon,
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
  togglePlay: () => void;
  displayTime: number;
  duration: number;
  muted: boolean;
  volume: number;
  toggleMute: () => void;
  handleVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  requestFullscreen: () => void;
  src: string;
  filename: string;
}

export function VideoControlBar({
  playing,
  togglePlay,
  displayTime,
  duration,
  muted,
  volume,
  toggleMute,
  handleVolumeChange,
  requestFullscreen,
  src,
  filename,
}: VideoControlBarProps) {
  return (
    <div className="flex items-center gap-1 text-white/90">
      <button
        onClick={togglePlay}
        className="p-1 rounded-md hover:bg-white/10 transition-colors"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <span className="text-[10px] font-medium tabular-nums text-white/60 ml-1">
        {formatDuration(displayTime)} / {formatDuration(duration)}
      </span>

      <div className="flex-1" />

      <div className="flex items-center group/vol">
        <button
          onClick={toggleMute}
          className="p-1 rounded-md hover:bg-white/10 transition-colors"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted || volume === 0 ? <VolumeMuteIcon /> : volume < 0.5 ? <VolumeLowIcon /> : <VolumeHighIcon />}
        </button>
        <div className="overflow-hidden w-0 group-hover/vol:w-14 transition-all duration-200">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-14 h-1 accent-primary cursor-pointer"
            aria-label="Volume"
          />
        </div>
      </div>

      <button
        onClick={requestFullscreen}
        className="p-1 rounded-md hover:bg-white/10 transition-colors"
        aria-label="Fullscreen"
      >
        <ExpandIcon />
      </button>

      <a
        href={src}
        download={filename}
        className="p-1 rounded-md hover:bg-white/10 transition-colors"
        aria-label="Download"
      >
        <Download className="w-[14px] h-[14px]" />
      </a>
    </div>
  );
}

// ── Big play overlay ─────────────────────────────────────────────

interface BigPlayOverlayProps {
  isViewer: boolean;
}

export function BigPlayOverlay({ isViewer }: BigPlayOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className={cn(
        "rounded-full backdrop-blur-sm flex items-center justify-center text-primary-foreground transition-transform group-hover/video:scale-110",
        isViewer
          ? "w-16 h-16 bg-black/50 border border-white/10 shadow-2xl"
          : "w-14 h-14 bg-primary/90 shadow-xl shadow-primary/30"
      )}>
        <BigPlayIcon />
      </div>
    </div>
  );
}
