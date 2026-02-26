"use client";

import { cn } from "@/lib/utils";
import { MicOff, Monitor } from "lucide-react";
import NextImage from "next/image";
import { memo, useEffect, useRef, useState } from "react";

interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  avatarUrl?: string | null;
  isLocal?: boolean;
  isScreenShare?: boolean;
  isMuted?: boolean;
  isCameraOff?: boolean;
  isSpeaking?: boolean;
}

const VideoTile = memo(function VideoTile({
  stream,
  name,
  avatarUrl,
  isLocal = false,
  isScreenShare = false,
  isMuted = false,
  isCameraOff = false,
  isSpeaking = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFlowing, setVideoFlowing] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!stream) {
      el.srcObject = null;
      setVideoFlowing(false);
      return;
    }

    el.muted = true;
    el.volume = 0;
    el.srcObject = stream;

    const videoTrack = stream.getVideoTracks()[0];
    setVideoFlowing(!!videoTrack && !videoTrack.muted && videoTrack.readyState === "live" && videoTrack.enabled);

    let interactionCleanup: (() => void) | null = null;
    if (!isLocal) {
      const onInteraction = () => {
        if (el.srcObject) {
          el.muted = false;
          el.volume = 1;
        }
        document.removeEventListener("click", onInteraction);
        document.removeEventListener("keydown", onInteraction);
      };
      const testUnmute = () => {
        el.muted = false;
        el.volume = 1;
        const p = el.play();
        if (p) {
          p.catch(() => {
            el.muted = true;
            el.volume = 0;
            el.play().catch(() => { });
            document.addEventListener("click", onInteraction);
            document.addEventListener("keydown", onInteraction);
          });
        }
      };
      interactionCleanup = () => {
        document.removeEventListener("click", onInteraction);
        document.removeEventListener("keydown", onInteraction);
      };
      const onFirstPlay = () => {
        el.removeEventListener("playing", onFirstPlay);
        testUnmute();
      };
      el.addEventListener("playing", onFirstPlay);
    }

    const tryPlay = () => {
      if (el.paused && el.srcObject) {
        el.play().catch(() => { });
      }
    };

    tryPlay();

    const onLoadedMetadata = () => {
      tryPlay();
    };

    el.addEventListener("loadedmetadata", onLoadedMetadata);

    const trackListeners: Array<{ track: MediaStreamTrack; event: string; fn: () => void }> = [];

    const setupTrackListeners = (track: MediaStreamTrack) => {
      if (track.kind === "video") {
        const onMute = () => {
          setVideoFlowing(false);
        };
        const onUnmute = () => {
          setVideoFlowing(true);
          tryPlay();
        };
        const onEnded = () => {
          setVideoFlowing(false);
        };
        track.addEventListener("mute", onMute);
        track.addEventListener("unmute", onUnmute);
        track.addEventListener("ended", onEnded);
        trackListeners.push({ track, event: "mute", fn: onMute });
        trackListeners.push({ track, event: "unmute", fn: onUnmute });
        trackListeners.push({ track, event: "ended", fn: onEnded });
      } else {
        const onUnmute = () => tryPlay();
        track.addEventListener("unmute", onUnmute);
        trackListeners.push({ track, event: "unmute", fn: onUnmute });
      }
    };

    for (const track of stream.getTracks()) {
      setupTrackListeners(track);
    }

    const onAddTrack = (e: MediaStreamTrackEvent) => {
      setupTrackListeners(e.track);
      tryPlay();
      if (e.track.kind === "video") {
        setVideoFlowing(!e.track.muted && e.track.readyState === "live");
      }
    };
    stream.addEventListener("addtrack", onAddTrack);

    const onRemoveTrack = (e: MediaStreamTrackEvent) => {
      if (e.track.kind === "video") {
        setVideoFlowing(false);
      }
    };
    stream.addEventListener("removetrack", onRemoveTrack);

    return () => {
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      stream.removeEventListener("addtrack", onAddTrack);
      stream.removeEventListener("removetrack", onRemoveTrack);
      interactionCleanup?.();
      for (const { track, event, fn } of trackListeners) {
        track.removeEventListener(event, fn);
      }
    };
  }, [stream, isLocal]);

  const initials = name
    .split(/[\s_.]/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || name.slice(0, 2).toUpperCase();

  const showAvatar = !stream || isCameraOff || (!isLocal && !isScreenShare && isCameraOff !== false && !videoFlowing);
  const hideVideo = showAvatar && !isScreenShare;

  return (
    <div
      className={cn(
        "group relative flex items-center justify-center overflow-hidden rounded-2xl bg-rm-bg-primary transition-all duration-300",
        isScreenShare ? "aspect-video" : "aspect-video",
        isSpeaking && "ring-2 ring-emerald-500 ring-offset-4 ring-offset-rm-bg-primary"
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "h-full w-full object-cover transition-opacity duration-500",
          isScreenShare && "object-contain",
          isLocal && !isScreenShare && "-scale-x-100",
          hideVideo ? "opacity-0" : "opacity-100"
        )}
      />

      {showAvatar && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-rm-bg-surface">
          <div className="relative">
            {isSpeaking && (
              <div className="absolute inset-0 animate-pulse rounded-full bg-emerald-500/20 blur-xl" />
            )}
            {avatarUrl ? (
              <NextImage
                src={avatarUrl}
                alt={name}
                width={96}
                height={96}
                className={cn(
                  "relative h-24 w-24 rounded-full object-cover shadow-2xl transition-all duration-300",
                  isSpeaking && "scale-110"
                )}
              />
            ) : (
              <div className={cn(
                "relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-3xl font-bold text-indigo-300 shadow-2xl transition-all duration-300",
                isSpeaking && "scale-110"
              )}>
                {initials}
              </div>
            )}
          </div>
        </div>
      )}

      {isScreenShare && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-blue-500 px-2 py-1 text-[10px] font-bold text-white shadow-xl">
          <Monitor className="h-3 w-3" />
          SCREEN
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/60 via-black/20 to-transparent px-4 py-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-white truncate max-w-[120px]">
            {name}
            {isLocal && " (You)"}
          </span>
          {isMuted && (
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-destructive transition-colors">
              <MicOff className="h-3 w-3 text-destructive-foreground" />
            </div>
          )}
        </div>
      </div>

      {/* Permanent name tag for when not hovered */}
      {!isScreenShare && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 transition-opacity duration-300 group-hover:opacity-0">
          <div className="rounded-md bg-rm-bg-floating/60 px-2 py-1 backdrop-blur-md transition-colors">
            <span className="text-[11px] font-bold text-rm-text">
              {name}
            </span>
          </div>
          {isMuted && (
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-rm-bg-floating/60 backdrop-blur-md transition-colors">
              <MicOff className="h-3 w-3 text-destructive" />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default VideoTile;
