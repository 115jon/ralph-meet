import { useCallback, useEffect, useReducer, useRef } from "react";
import { useMediaPlaybackSettingsStore } from "@/stores/useMediaPlaybackSettingsStore";

export interface VideoPlayerState {
  playing: boolean;
  ended: boolean;
  /** True after the user has played the video at least once */
  hasStarted: boolean;
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
  isFullscreen: boolean;
  /** Brief splash animation key – incremented on each play/pause toggle */
  splashKey: number;
  /** Which icon to show in the splash: 'play' | 'pause' */
  splashIcon: 'play' | 'pause';
}

const initialState: VideoPlayerState = {
  playing: false,
  ended: false,
  hasStarted: false,
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
  isFullscreen: false,
  splashKey: 0,
  splashIcon: 'play',
};

/**
 * Encapsulates all video playback state, event wiring, and control callbacks.
 * Keeps the VideoAttachment component purely presentational.
 */
interface UseVideoPlayerOptions {
  persistVolumePreference?: boolean;
}

export function useVideoPlayer(
  isViewer: boolean,
  {
    persistVolumePreference = true,
  }: UseVideoPlayerOptions = {},
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  /** Outer container – used for custom fullscreen instead of native video fullscreen */
  const containerRef = useRef<HTMLDivElement>(null);
  const preferredVolume = useMediaPlaybackSettingsStore((state) => state.videoVolume);
  const preferredMuted = useMediaPlaybackSettingsStore((state) => state.videoMuted);
  const updatePlaybackSettings = useMediaPlaybackSettingsStore((state) => state.updateSettings);

  const [state, dispatch] = useReducer(
    (s: VideoPlayerState, a: Partial<VideoPlayerState>) => ({ ...s, ...a }),
    undefined,
    () => ({
      ...initialState,
      volume: persistVolumePreference ? preferredVolume : initialState.volume,
      muted: persistVolumePreference ? (preferredMuted || preferredVolume === 0) : initialState.muted,
    }),
  );

  const {
    playing, currentTime, duration, progress, buffered,
    volume, muted, showControls, hovering, dragging, dragProgress, splashKey
  } = state;

  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const shouldPersistPreference = useCallback(() => (
    persistVolumePreference && !(videoRef.current?.defaultMuted ?? false)
  ), [persistVolumePreference]);

  const persistPlaybackSettings = useCallback((updates: { volume?: number; muted?: boolean }) => {
    if (!shouldPersistPreference()) return;
    updatePlaybackSettings({
      ...(updates.volume !== undefined ? { videoVolume: updates.volume } : {}),
      ...(updates.muted !== undefined ? { videoMuted: updates.muted } : {}),
    });
  }, [shouldPersistPreference, updatePlaybackSettings]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (!shouldPersistPreference()) {
      dispatch({ volume: v.volume, muted: v.muted });
      return;
    }

    const nextMuted = preferredMuted || preferredVolume === 0;
    v.volume = preferredVolume;
    v.muted = nextMuted;
    dispatch({ volume: preferredVolume, muted: nextMuted });
  }, [preferredMuted, preferredVolume, shouldPersistPreference]);

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
    if (v.ended) {
      v.currentTime = 0;
      v.play().catch(() => { });
      dispatch({ splashKey: splashKey + 1, splashIcon: 'play' });
    } else if (v.paused) {
      v.play().catch(() => { });
      dispatch({ splashKey: splashKey + 1, splashIcon: 'play' });
    } else {
      v.pause();
      dispatch({ splashKey: splashKey + 1, splashIcon: 'pause' });
    }
  }, [splashKey]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const nextMuted = !v.muted;
    v.muted = nextMuted;
    dispatch({ muted: nextMuted });
    persistPlaybackSettings({ muted: nextMuted });
  }, [persistPlaybackSettings]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const val = Math.min(1, Math.max(0, parseFloat(e.target.value)));
    const nextMuted = val === 0;
    v.volume = val;
    v.muted = nextMuted;
    dispatch({ volume: val, muted: nextMuted });
    persistPlaybackSettings({ volume: val, muted: nextMuted });
  }, [persistPlaybackSettings]);

  // ── Custom fullscreen (container, not <video>) ─────────────────
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { });
    } else {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => { });
      } else if ((el as any).webkitRequestFullscreen) {
        (el as any).webkitRequestFullscreen();
      }
    }
  }, []);

  // Listen for fullscreenchange to keep state in sync
  useEffect(() => {
    const onFsChange = () => {
      dispatch({ isFullscreen: !!document.fullscreenElement });
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Seek / drag ────────────────────────────────────────────────
  const getRatioFromEvent = useCallback((clientX: number): number => {
    const bar = progressRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleSeekClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (dragging) return;
    const v = videoRef.current;
    if (!v || !duration) return;
    const ratio = getRatioFromEvent(e.clientX);
    v.currentTime = ratio * duration;
  }, [duration, dragging, getRatioFromEvent]);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLElement>) => {
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

    const onPlay = () => dispatch({ playing: true, ended: false, hasStarted: true });
    const onPause = () => dispatch({ playing: false });
    const onEnded = () => dispatch({ playing: false, ended: true, showControls: true });
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
        const nextMuted = !v.muted;
        v.muted = nextMuted;
        dispatch({ muted: nextMuted });
        persistPlaybackSettings({ muted: nextMuted });
      } else if (e.key === 'f') {
        toggleFullscreen();
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
  }, [isViewer, persistPlaybackSettings, togglePlay, toggleFullscreen]);

  // ── Derived values ─────────────────────────────────────────────
  const controlsVisible = showControls || !playing;
  const displayProgress = dragging ? dragProgress : progress;
  const displayTime = dragging ? (dragProgress / 100) * duration : currentTime;

  return {
    videoRef,
    progressRef,
    containerRef,
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
    toggleFullscreen,
    handleSeekClick,
    handleDragStart,
    scheduleHide,
  } as const;
}
