"use client";

import { cn } from "@/lib/utils";
import VideoTile from "./VideoTile";

interface StreamEntry {
  id: string;
  name: string;
  avatarUrl?: string | null;
  stream: MediaStream | null;
  isLocal: boolean;
  isScreenShare: boolean;
  isMuted: boolean;
  isCameraOff?: boolean;
  isSpeaking?: boolean;
}

interface VideoGridProps {
  streams: StreamEntry[];
}

export default function VideoGrid({ streams }: VideoGridProps) {
  const screenShares = streams.filter((s) => s.isScreenShare);
  const cameras = streams.filter((s) => !s.isScreenShare);
  const hasScreenShare = screenShares.length > 0;
  const cameraCount = cameras.length;

  if (hasScreenShare) {
    return (
      <div className="flex h-full w-full flex-col gap-3">
        {/* Featured screen share area */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {screenShares.map((entry) => (
            <VideoTile
              key={entry.id}
              stream={entry.stream}
              name={entry.name}
              avatarUrl={entry.avatarUrl}
              isLocal={entry.isLocal}
              isScreenShare={entry.isScreenShare}
              isMuted={entry.isMuted}
              isCameraOff={entry.isCameraOff}
              isSpeaking={entry.isSpeaking}
            />
          ))}
        </div>
        {/* Camera tiles in strip */}
        {cameras.length > 0 && (
          <div className="flex shrink-0 justify-center gap-2">
            {cameras.map((entry) => (
              <div key={entry.id} className="h-28 w-40">
                <VideoTile
                  stream={entry.stream}
                  name={entry.name}
                  avatarUrl={entry.avatarUrl}
                  isLocal={entry.isLocal}
                  isScreenShare={entry.isScreenShare}
                  isMuted={entry.isMuted}
                  isCameraOff={entry.isCameraOff}
                  isSpeaking={entry.isSpeaking}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid h-full w-full gap-3",
        cameraCount === 1 && "grid-cols-1 place-items-center",
        cameraCount === 2 && "grid-cols-2 place-items-center",
        cameraCount >= 3 && cameraCount <= 4 && "grid-cols-2 grid-rows-2",
        cameraCount > 4 && "grid-cols-3 auto-rows-fr"
      )}
    >
      {streams.map((entry) => (
        <VideoTile
          key={entry.id}
          stream={entry.stream}
          name={entry.name}
          avatarUrl={entry.avatarUrl}
          isLocal={entry.isLocal}
          isScreenShare={entry.isScreenShare}
          isMuted={entry.isMuted}
          isCameraOff={entry.isCameraOff}
          isSpeaking={entry.isSpeaking}
        />
      ))}
    </div>
  );
}
