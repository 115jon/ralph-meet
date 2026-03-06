import { cn } from '@/lib/utils';
import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface VideoPlayerProps {
  src: string;
  className?: string;
  autoPlay?: boolean;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VideoPlayer({ src, className, autoPlay = true }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [playing, setPlaying] = useState(autoPlay);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (playing && !isScrubbing) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 2500);
    }
  }, [playing, isScrubbing]);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [playing, resetHideTimer]);

  // Video event handlers
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || isScrubbing) return;
    setCurrentTime(v.currentTime);
    setProgress(v.duration ? (v.currentTime / v.duration) * 100 : 0);
    if (v.buffered.length > 0) {
      setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
    }
  }, [isScrubbing]);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      setDuration(v.duration);
      if (autoPlay) v.play().catch(() => { });
    }
  }, [autoPlay]);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    setShowControls(true);
  }, []);

  // Play/pause toggle
  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => { });
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  // Mute toggle
  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  // Fullscreen toggle
  const toggleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      container.requestFullscreen().catch(() => { });
      setIsFullscreen(true);
    }
  }, []);

  // Listen for fullscreen changes (e.g. pressing Escape)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Scrubbing
  const scrub = useCallback((clientX: number) => {
    const bar = progressRef.current;
    const v = videoRef.current;
    if (!bar || !v) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setProgress(pct * 100);
    setCurrentTime(pct * v.duration);
  }, []);

  const commitScrub = useCallback((clientX: number) => {
    const bar = progressRef.current;
    const v = videoRef.current;
    if (!bar || !v) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    setIsScrubbing(false);
  }, []);

  const handleScrubStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsScrubbing(true);
    scrub(e.clientX);
  }, [scrub]);

  // Global mouse handlers for scrubbing
  useEffect(() => {
    if (!isScrubbing) return;
    const handleMove = (e: MouseEvent) => scrub(e.clientX);
    const handleUp = (e: MouseEvent) => commitScrub(e.clientX);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isScrubbing, scrub, commitScrub]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'm') {
        const v = videoRef.current;
        if (v) { v.muted = !v.muted; setMuted(v.muted); }
      } else if (e.key === 'f') {
        const container = containerRef.current;
        if (container) {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            container.requestFullscreen().catch(() => { });
          }
        }
      } else if (e.key === 'ArrowRight') {
        const v = videoRef.current;
        if (v) v.currentTime = Math.min(v.duration, v.currentTime + 5);
      } else if (e.key === 'ArrowLeft') {
        const v = videoRef.current;
        if (v) v.currentTime = Math.max(0, v.currentTime - 5);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [togglePlay]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative select-none group/vp",
        isFullscreen ? "w-screen h-screen bg-black" : "",
        className
      )}
      onMouseMove={resetHideTimer}
      onClick={(e) => {
        e.stopPropagation();
        togglePlay();
      }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        src={src}
        className={cn(
          "w-full h-full object-contain",
          isFullscreen ? "max-h-screen" : "max-h-[60vh] md:max-h-[75vh]"
        )}
        playsInline
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Big center play button (when paused) */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-200",
          !playing && showControls ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-2xl">
          <Play size={28} className="text-white ml-1" fill="white" />
        </div>
      </div>

      {/* Bottom controls overlay */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 transition-opacity duration-300",
          showControls || isScrubbing ? "opacity-100" : "opacity-0"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

        {/* Scrub bar */}
        <div className="relative px-3 pt-6 pb-3">
          {/* Progress bar container — larger hit area */}
          <div
            ref={progressRef}
            className="relative h-6 flex items-end cursor-pointer group/scrub"
            onMouseDown={handleScrubStart}
          >
            {/* Track */}
            <div className="w-full h-1 group-hover/scrub:h-1.5 transition-all duration-150 rounded-full bg-white/20 relative overflow-hidden">
              {/* Buffered */}
              <div
                className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
                style={{ width: `${buffered}%` }}
              />
              {/* Progress */}
              <div
                className="absolute inset-y-0 left-0 bg-white rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            {/* Scrub handle */}
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg transition-all duration-150",
                isScrubbing ? "scale-125" : "scale-0 group-hover/scrub:scale-100"
              )}
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>

          {/* Time + controls row */}
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                className="text-white hover:text-white/80 transition-colors p-0.5"
              >
                {playing ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" className="ml-0.5" />}
              </button>

              {/* Mute */}
              <button
                onClick={toggleMute}
                className="text-white/70 hover:text-white transition-colors p-0.5"
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>

              {/* Time */}
              <span className="text-white/80 text-xs font-mono tabular-nums tracking-tight">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="text-white/70 hover:text-white transition-colors p-0.5"
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
