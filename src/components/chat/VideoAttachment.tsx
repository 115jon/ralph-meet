"use client";

import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "./Icons";

interface VideoAttachmentProps {
  src: string;
  filename: string;
  /** Max width constraint */
  maxWidth?: number;
  /** Max height constraint */
  maxHeight?: number;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}


// ─── SVG Icons ──────────────────────────────────────────────────────────────
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
  </svg>
);
const BigPlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 ml-1">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const VolumeHighIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[14px] h-[14px]">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);
const VolumeLowIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[14px] h-[14px]">
    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
  </svg>
);
const VolumeMuteIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[14px] h-[14px]">
    <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zM12 4L9.91 6.09 12 8.18V4z" />
  </svg>
);
const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[14px] h-[14px]">
    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
  </svg>
);

export default function VideoAttachment({
  src,
  filename,
  maxWidth = 550,
  maxHeight = 450,
}: VideoAttachmentProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Auto-hide controls after 2.5s while playing (unless hovering)
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setShowControls(true);
    hideTimerRef.current = setTimeout(() => {
      if (!hovering) setShowControls(false);
    }, 2500);
  }, [hovering]);

  useEffect(() => {
    if (!playing) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      scheduleHide();
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [playing, scheduleHide]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => { }); }
    else { v.pause(); }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.volume = val;
    setVolume(val);
    if (val === 0) { v.muted = true; setMuted(true); }
    else if (v.muted) { v.muted = false; setMuted(false); }
  }, []);

  const requestFullscreen = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // Use the video element's native fullscreen — works cross-browser
    if (v.requestFullscreen) { v.requestFullscreen().catch(() => { }); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    else if ((v as any).webkitRequestFullscreen) { (v as any).webkitRequestFullscreen(); }
  }, []);

  // ── Scrubbing logic ─────────────────────────────────────────────────
  const getRatioFromEvent = useCallback((clientX: number): number => {
    const bar = progressRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleSeekClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle direct clicks, not drag releases (those are handled by mouseup)
    if (dragging) return;
    const v = videoRef.current;
    if (!v || !duration) return;
    const ratio = getRatioFromEvent(e.clientX);
    v.currentTime = ratio * duration;
  }, [duration, dragging, getRatioFromEvent]);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    const ratio = getRatioFromEvent(e.clientX);
    setDragProgress(ratio * 100);
  }, [getRatioFromEvent]);

  // Document-level mousemove/mouseup for free dragging
  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const ratio = getRatioFromEvent(e.clientX);
      setDragProgress(ratio * 100);
    };

    const onMouseUp = (e: MouseEvent) => {
      const v = videoRef.current;
      if (v && duration) {
        const ratio = getRatioFromEvent(e.clientX);
        v.currentTime = ratio * duration;
      }
      setDragging(false);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, duration, getRatioFromEvent]);

  // Video event handlers
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setShowControls(true); };
    const onTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      if (v.duration) setProgress((v.currentTime / v.duration) * 100);
    };
    const onDurationChange = () => setDuration(v.duration || 0);
    const onProgress = () => {
      if (v.buffered.length > 0 && v.duration) {
        setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
      }
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("durationchange", onDurationChange);
    v.addEventListener("progress", onProgress);

    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("durationchange", onDurationChange);
      v.removeEventListener("progress", onProgress);
    };
  }, []);

  const controlsVisible = showControls || !playing;
  // During drag, show drag position; otherwise show actual progress
  const displayProgress = dragging ? dragProgress : progress;
  const displayTime = dragging ? (dragProgress / 100) * duration : currentTime;

  return (
    <div
      className="w-fit rounded-xl overflow-hidden border border-rm-border bg-rm-bg-elevated shadow-lg relative select-none group/video"
      style={{ maxWidth }}
      onMouseEnter={() => { setHovering(true); setShowControls(true); }}
      onMouseLeave={() => { setHovering(false); if (playing) scheduleHide(); }}
      onMouseMove={() => { if (playing) scheduleHide(); }}
    >
      {/* Video */}
      <div className="relative bg-black cursor-pointer" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          className="block w-auto h-auto"
          style={{ maxWidth, maxHeight }}
        >
          <track kind="captions" />
        </video>

        {/* Big center play overlay */}
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-primary/90 backdrop-blur-sm flex items-center justify-center shadow-xl shadow-primary/30 text-primary-foreground transition-transform group-hover/video:scale-110">
              <BigPlayIcon />
            </div>
          </div>
        )}
      </div>

      {/* Controls overlay — sits on top of the video */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 transition-all duration-200 z-10",
          controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent pointer-events-none rounded-b-xl" />

        <div className="relative px-3 pb-2 pt-6">
          {/* Progress bar */}
          <div
            ref={progressRef}
            className={cn(
              "group/bar relative rounded-full cursor-pointer mb-2 transition-all",
              dragging ? "h-2" : "h-1 hover:h-1.5"
            )}
            onClick={handleSeekClick}
            onMouseDown={handleDragStart}
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
            {/* Thumb */}
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg transition-opacity",
                dragging ? "w-3.5 h-3.5 opacity-100" : "w-2.5 h-2.5 opacity-0 group-hover/bar:opacity-100"
              )}
              style={{ left: `calc(${displayProgress}% - ${dragging ? 7 : 5}px)` }}
            />
            {/* Timestamp tooltip while dragging */}
            {dragging && (
              <div
                className="absolute -top-8 -translate-x-1/2 px-2 py-0.5 rounded-md bg-rm-bg-elevated border border-rm-border shadow-lg text-[10px] font-mono font-bold text-rm-text tabular-nums whitespace-nowrap pointer-events-none"
                style={{ left: `${displayProgress}%` }}
              >
                {formatDuration(displayTime)}
              </div>
            )}
          </div>

          {/* Control buttons row */}
          <div className="flex items-center gap-1 text-white/90">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="p-1 rounded-md hover:bg-white/10 transition-colors"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>

            {/* Time */}
            <span className="text-[10px] font-medium tabular-nums text-white/60 ml-1">
              {formatDuration(displayTime)} / {formatDuration(duration)}
            </span>

            <div className="flex-1" />

            {/* Volume */}
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

            {/* Fullscreen */}
            <button
              onClick={requestFullscreen}
              className="p-1 rounded-md hover:bg-white/10 transition-colors"
              aria-label="Fullscreen"
            >
              <ExpandIcon />
            </button>

            {/* Download */}
            <a
              href={src}
              download={filename}
              className="p-1 rounded-md hover:bg-white/10 transition-colors"
              aria-label="Download"
            >
              <Download className="w-[14px] h-[14px]" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
