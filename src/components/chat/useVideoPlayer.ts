import { useCallback, useEffect, useReducer, useRef } from "react";

export interface VideoPlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  progress: number;
  buffered: number;
  volume: number;
  muted: boolean;
  showControls: boolean;
  hovering: boolean;
  dragging: boolean;
  dragProgress: number;
}

const initialState: VideoPlayerState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  progress: 0,
  buffered: 0,
  volume: 1,
  muted: false,
  showControls: true,
  hovering: false,
  dragging: false,
  dragProgress: 0,
};

/**
 * Encapsulates all video playback state, event wiring, and control callbacks.
 * Keeps the VideoAttachment component purely presentational.
 */
export function useVideoPlayer(isViewer: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [state, dispatch] = useReducer(
    (s: VideoPlayerState, a: Partial<VideoPlayerState>) => ({ ...s, ...a }),
    initialState
  );

  const {
    playing, currentTime, duration, progress, buffered,
    volume, muted, showControls, hovering, dragging, dragProgress
  } = state;

  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // ── Control-bar auto-hide ──────────────────────────────────────
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    dispatch({ showControls: true });
    hideTimerRef.current = setTimeout(() => {
      if (!hovering) dispatch({ showControls: false });
    }, 2500);
  }, [hovering]);

  useEffect(() => {
    let t: NodeJS.Timeout;
    if (!playing) {
      t = setTimeout(() => dispatch({ showControls: true }), 0);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      t = setTimeout(() => scheduleHide(), 0);
    }
    return () => {
      clearTimeout(t);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playing, scheduleHide]);

  // ── Playback callbacks ─────────────────────────────────────────
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
    dispatch({ muted: v.muted });
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.volume = val;
    dispatch({ volume: val });
    if (val === 0) { v.muted = true; dispatch({ muted: true }); }
    else if (v.muted) { v.muted = false; dispatch({ muted: false }); }
  }, []);

  const requestFullscreen = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.requestFullscreen) { v.requestFullscreen().catch(() => { }); }
    else if ((v as any).webkitRequestFullscreen) { (v as any).webkitRequestFullscreen(); }
  }, []);

  // ── Seek / drag ────────────────────────────────────────────────
  const getRatioFromEvent = useCallback((clientX: number): number => {
    const bar = progressRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleSeekClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (dragging) return;
    const v = videoRef.current;
    if (!v || !duration) return;
    const ratio = getRatioFromEvent(e.clientX);
    v.currentTime = ratio * duration;
  }, [duration, dragging, getRatioFromEvent]);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const ratio = getRatioFromEvent(e.clientX);
    dispatch({ dragging: true, dragProgress: ratio * 100 });
  }, [getRatioFromEvent]);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const ratio = getRatioFromEvent(e.clientX);
      dispatch({ dragProgress: ratio * 100 });
    };

    const onMouseUp = (e: MouseEvent) => {
      const v = videoRef.current;
      if (v && duration) {
        const ratio = getRatioFromEvent(e.clientX);
        v.currentTime = ratio * duration;
      }
      dispatch({ dragging: false });
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, duration, getRatioFromEvent]);

  // ── Sync with <video> element events ───────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => dispatch({ playing: true });
    const onPause = () => dispatch({ playing: false });
    const onEnded = () => dispatch({ playing: false, showControls: true });
    const onTimeUpdate = () => {
      dispatch({
        currentTime: v.currentTime,
        ...(v.duration && { progress: (v.currentTime / v.duration) * 100 })
      });
    };
    const onDurationChange = () => dispatch({ duration: v.duration || 0 });
    const onProgress = () => {
      if (v.buffered.length > 0 && v.duration) {
        dispatch({ buffered: (v.buffered.end(v.buffered.length - 1) / v.duration) * 100 });
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

  // ── Auto-play in viewer mode ───────────────────────────────────
  useEffect(() => {
    if (isViewer && videoRef.current) {
      videoRef.current.play().catch(() => { });
    }
  }, [isViewer]);

  // ── Keyboard shortcuts in viewer mode ──────────────────────────
  useEffect(() => {
    if (!isViewer) return;
    const handleKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
      } else if (e.key === 'm') {
        v.muted = !v.muted;
        dispatch({ muted: v.muted });
      } else if (e.key === 'f') {
        requestFullscreen();
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation();
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      } else if (e.key === 'ArrowLeft') {
        e.stopPropagation();
        v.currentTime = Math.max(0, v.currentTime - 5);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isViewer, togglePlay, requestFullscreen]);

  // ── Derived values ─────────────────────────────────────────────
  const controlsVisible = showControls || !playing;
  const displayProgress = dragging ? dragProgress : progress;
  const displayTime = dragging ? (dragProgress / 100) * duration : currentTime;

  return {
    videoRef,
    progressRef,
    state,
    dispatch,
    // derived
    controlsVisible,
    displayProgress,
    displayTime,
    // callbacks
    togglePlay,
    toggleMute,
    handleVolumeChange,
    requestFullscreen,
    handleSeekClick,
    handleDragStart,
    scheduleHide,
  } as const;
}
