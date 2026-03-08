import { cn } from "@/lib/utils";
import { useVideoPlayer } from "./useVideoPlayer";
import {
  BigPlayOverlay,
  SplashOverlay,
  VideoControlBar,
  VideoDownloadButton,
  VideoProgressBar,
} from "./VideoPlayerControls";

interface VideoAttachmentProps {
  src: string;
  filename: string;
  maxWidth?: number;
  maxHeight?: number;
  /** 'embedded' (default): in-chat with border/shadow. 'viewer': fills container, autoplay, keyboard shortcuts */
  variant?: 'embedded' | 'viewer';
}

export default function VideoAttachment({
  src,
  filename,
  maxWidth = 550,
  maxHeight = 450,
  variant = 'embedded',
}: VideoAttachmentProps) {
  const isViewer = variant === 'viewer';

  const {
    videoRef,
    progressRef,
    containerRef,
    state,
    dispatch,
    controlsVisible,
    displayProgress,
    displayTime,
    togglePlay,
    toggleMute,
    handleVolumeChange,
    toggleFullscreen,
    handleSeekClick,
    handleDragStart,
    scheduleHide,
  } = useVideoPlayer(isViewer);

  const {
    playing, ended, hasStarted, duration, muted, volume, buffered, dragging,
    isFullscreen, splashKey, splashIcon
  } = state;

  // In embedded mode, only show controls after first play
  const showControlsOverlay = isViewer || hasStarted;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative select-none group/video",
        isViewer
          ? "inline-flex flex-col max-w-full max-h-[60vh] md:max-h-[75vh]"
          : "w-fit max-w-full rounded-xl overflow-hidden border border-rm-border bg-rm-bg-elevated shadow-lg",
        isFullscreen && "fixed! inset-0! z-9999! w-screen! h-screen! max-w-none! max-h-none! rounded-none! border-none! bg-black"
      )}
      style={isViewer || isFullscreen ? undefined : { maxWidth: `min(100%, ${maxWidth}px)` }}
      onMouseEnter={() => { dispatch({ hovering: true, showControls: true }); }}
      onMouseLeave={() => { dispatch({ hovering: false }); if (playing) scheduleHide(); }}
      onMouseMove={() => { if (playing) scheduleHide(); }}
    >
      {/* Download button – top-right floating (hidden in viewer/ImageViewerModal) */}
      {!isViewer && <VideoDownloadButton src={src} filename={filename} visible={controlsVisible} />}

      {/* Clickable video area */}
      <div
        className={cn(
          "relative bg-black cursor-pointer",
          isViewer || isFullscreen
            ? "flex items-center justify-center overflow-hidden w-full h-full"
            : undefined
        )}
        onClick={(e) => { e.stopPropagation(); togglePlay(); }}
        role="button"
        tabIndex={0}
        aria-label="Play or pause video"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            togglePlay();
          }
        }}
      >
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          className={cn(
            "block max-w-full",
            isViewer || isFullscreen
              ? "max-h-full object-contain"
              : "w-auto h-auto",
            isFullscreen && "w-full h-full"
          )}
          style={isViewer || isFullscreen ? undefined : { maxWidth: `min(100%, ${maxWidth}px)`, maxHeight }}
        >
          <track kind="captions" />
        </video>

        {/* Big play / replay overlay when paused or ended */}
        {(!playing || ended) && <BigPlayOverlay isViewer={isViewer} ended={ended} />}

        {/* Center splash animation on play/pause toggle */}
        <SplashOverlay splashKey={splashKey} splashIcon={splashIcon} />
      </div>

      {/* Controls overlay – hidden until first play in embedded mode */}
      {showControlsOverlay && (
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 transition-all duration-200 z-10",
            controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
          )}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
          role="presentation"
        >
          <div className={cn(
            "absolute inset-0 bg-linear-to-t from-black/70 to-transparent pointer-events-none",
            !isViewer && !isFullscreen && "rounded-b-xl"
          )} />

          <div className="relative px-3 pb-2 pt-6">
            <VideoProgressBar
              progressRef={progressRef}
              dragging={dragging}
              handleSeekClick={handleSeekClick}
              handleDragStart={handleDragStart}
              videoRef={videoRef}
              duration={duration}
              displayProgress={displayProgress}
              buffered={buffered}
              displayTime={displayTime}
            />

            <VideoControlBar
              playing={playing}
              ended={ended}
              togglePlay={togglePlay}
              displayTime={displayTime}
              duration={duration}
              muted={muted}
              volume={volume}
              toggleMute={toggleMute}
              handleVolumeChange={handleVolumeChange}
              toggleFullscreen={toggleFullscreen}
            />
          </div>
        </div>
      )}
    </div>
  );
}
