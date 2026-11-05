import { cn } from "@/lib/utils";
import { videoRenderDemand } from "@ralph/voice-media";
import React, { useEffect, useRef } from "react";

interface VideoPlayerProps {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
  label?: string;
  isLocal?: boolean;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  stream,
  muted,
  className,
  label,
  isLocal,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
    }

    return () => {
      if (video) video.srcObject = null;
    };
  }, [stream, label]);

  // Reports this element's size so a remote camera is pulled at the
  // simulcast layer it is shown at (see video-layers.ts).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || isLocal || typeof ResizeObserver === "undefined")
      return;
    const owner = Symbol("video-render");
    const report = () => {
      const scale = window.devicePixelRatio || 1;
      videoRenderDemand.report(owner, stream, {
        width: Math.round(video.clientWidth * scale),
        height: Math.round(video.clientHeight * scale),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(video);
    return () => {
      observer.disconnect();
      videoRenderDemand.withdraw(owner);
    };
  }, [stream, isLocal]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      aria-label={label}
      className={cn(className, isLocal && "-scale-x-100")}
    >
      <track kind="captions" />
    </video>
  );
};
