import { clog } from "@/lib/console-logger";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import { GifProviderBranding } from "./GifProviderBranding";

const log = clog("VideoAttachment");
import { useState } from "react";
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
  poster?: string;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  showDownload?: boolean;
  /** Called when the underlying <video> fires an error — e.g. a signed URL has expired. */
  onVideoError?: () => void;
  /** 'embedded' (default): in-chat with border/shadow. 'viewer': fills container, autoplay, keyboard shortcuts */
  variant?: 'embedded' | 'viewer';
  brandingKey?: string | null;
  playbackMode?: 'default' | 'animated';
}

export default function VideoAttachment({
  src,
  filename,
  maxWidth = 550,
  maxHeight = 450,
  poster,
  referrerPolicy,
  showDownload = true,
  onVideoError,
  variant = 'embedded',
  brandingKey,
  playbackMode = 'default',
}: VideoAttachmentProps) {
  const isViewer = variant === 'viewer';
  const isAnimated = playbackMode === 'animated';
  const [mediaError, setMediaError] = useState(false);

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
  const showControlsOverlay = isAnimated ? isViewer : isViewer || hasStarted;

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
      {!isViewer && showDownload && <VideoDownloadButton src={src} filename={filename} visible={controlsVisible} />}

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
        aria-label={isAnimated ? "Play or pause animated image" : "Play or pause video"}
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
          poster={poster}
          preload="metadata"
          controls={false}
          disablePictureInPicture
          controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
          playsInline
          onError={() => {
            log.error(
              `media error src=${src} filename=${filename} poster=${poster ?? ""}`,
            );
            setMediaError(true);
            onVideoError?.();
          }}
          onCanPlay={() => setMediaError(false)}
          {...(referrerPolicy ? { referrerPolicy } : {})}
          autoPlay={isAnimated && isViewer}
          loop={isAnimated}
          muted={isAnimated ? true : undefined}
          className={cn(
            "rm-custom-video",
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

        {mediaError ? (
          <div className="absolute inset-0 z-20 flex min-h-[160px] flex-col items-center justify-center gap-3 bg-black/85 p-5 text-center text-white">
            <AlertCircle className="h-8 w-8 text-amber-300" />
            <div>
              <p className="text-sm font-bold">This video cannot be played here</p>
              <p className="mt-1 max-w-[320px] text-xs leading-5 text-white/70">
                The desktop video engine may not support this file&apos;s codec.
              </p>
            </div>
            {showDownload && (
              <a
                href={src}
                download={filename}
                onClick={(event) => event.stopPropagation()}
                className="rounded-lg border border-white/20 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
              >
                Download video
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Big play / replay overlay when paused or ended */}
            {!isAnimated && (!playing || ended) && <BigPlayOverlay isViewer={isViewer} ended={ended} />}

            {/* Center splash animation on play/pause toggle */}
            {!isAnimated && <SplashOverlay splashKey={splashKey} splashIcon={splashIcon} />}
            <GifProviderBranding fileKeyOrUrl={brandingKey} className="bottom-3 left-3" />
          </>
        )}
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
            {!isAnimated && (
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
            )}

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
              mode={playbackMode}
            />
          </div>
        </div>
      )}
    </div>
  );
}
