import { cn } from "@/lib/utils";
import { useVideoPlayer } from "./useVideoPlayer";
import { BigPlayOverlay, VideoControlBar, VideoProgressBar } from "./VideoPlayerControls";

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
    state,
    dispatch,
    controlsVisible,
    displayProgress,
    displayTime,
    togglePlay,
    toggleMute,
    handleVolumeChange,
    requestFullscreen,
    handleSeekClick,
    handleDragStart,
    scheduleHide,
  } = useVideoPlayer(isViewer);

  const { playing, duration, muted, volume, buffered, dragging } = state;

  return (
    <div
      className={cn(
        "relative select-none group/video",
        isViewer
          ? "inline-flex flex-col max-w-full max-h-[60vh] md:max-h-[75vh]"
          : "w-fit rounded-xl overflow-hidden border border-rm-border bg-rm-bg-elevated shadow-lg"
      )}
      style={isViewer ? undefined : { maxWidth }}
      onMouseEnter={() => { dispatch({ hovering: true, showControls: true }); }}
      onMouseLeave={() => { dispatch({ hovering: false }); if (playing) scheduleHide(); }}
      onMouseMove={() => { if (playing) scheduleHide(); }}
    >
      {/* Clickable video area */}
      <div
        className={cn(
          "relative bg-black cursor-pointer",
          isViewer ? "flex items-center justify-center overflow-hidden" : undefined
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
            "block",
            isViewer
              ? "max-w-full max-h-[60vh] md:max-h-[75vh] object-contain"
              : "w-auto h-auto"
          )}
          style={isViewer ? undefined : { maxWidth, maxHeight }}
        >
          <track kind="captions" />
        </video>

        {!playing && <BigPlayOverlay isViewer={isViewer} />}
      </div>

      {/* Controls overlay */}
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
          "absolute inset-0 bg-gradient-to-t from-black/70 to-transparent pointer-events-none",
          !isViewer && "rounded-b-xl"
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
            togglePlay={togglePlay}
            displayTime={displayTime}
            duration={duration}
            muted={muted}
            volume={volume}
            toggleMute={toggleMute}
            handleVolumeChange={handleVolumeChange}
            requestFullscreen={requestFullscreen}
            src={src}
            filename={filename}
          />
        </div>
      </div>
    </div>
  );
}
