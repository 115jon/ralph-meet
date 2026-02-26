"use client";

import type { MediaDeviceInfo_Custom } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { Camera, CameraOff, Headphones, LogOut, Mic, MicOff, Monitor } from "lucide-react";
import DeviceSelector from "./DeviceSelector";

interface MediaControlsProps {
  isMicOn: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isDeafened: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
  audioInputs: MediaDeviceInfo_Custom[];
  videoInputs: MediaDeviceInfo_Custom[];
  selectedAudioId: string;
  selectedVideoId: string;
  onSelectAudio: (deviceId: string) => void;
  onSelectVideo: (deviceId: string) => void;
}

export default function MediaControls({
  isMicOn,
  isCameraOn,
  isScreenSharing,
  isDeafened,
  onToggleMic,
  onToggleCamera,
  onToggleScreen,
  onToggleDeafen,
  onLeave,
  audioInputs,
  videoInputs,
  selectedAudioId,
  selectedVideoId,
  onSelectAudio,
  onSelectVideo,
}: MediaControlsProps) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <div className="flex items-center gap-1.5 p-1">
        <button
          className={cn(
            "flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl transition-all duration-200",
            isMicOn
              ? "bg-rm-bg-elevated/40 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
              : "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20"
          )}
          onClick={onToggleMic}
          title={isMicOn ? "Mute" : "Unmute"}
        >
          {isMicOn ? <Mic className="h-[20px] w-[20px]" /> : <MicOff className="h-[20px] w-[20px]" />}
        </button>

        <button
          className={cn(
            "flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl transition-all duration-200",
            !isDeafened
              ? "bg-rm-bg-elevated/40 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
              : "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20"
          )}
          onClick={onToggleDeafen}
          title={isDeafened ? "Undeafen" : "Deafen"}
        >
          <Headphones className={cn("h-[20px] w-[20px]", isDeafened && "text-rm-text")} />
        </button>

        <button
          disabled={videoInputs.length === 0}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200",
            videoInputs.length === 0
              ? "bg-rm-bg-elevated/20 text-rm-text-muted/10 cursor-not-allowed opacity-50 grayscale"
              : isCameraOn
                ? "bg-rm-text text-rm-bg-surface hover:bg-rm-text/90 shadow-lg shadow-rm-text/20"
                : "bg-destructive text-destructive-foreground hover:brightness-110"
          )}
          onClick={onToggleCamera}
          title={videoInputs.length === 0 ? "No camera detected" : isCameraOn ? "Stop Video" : "Start Video"}
        >
          {isCameraOn ? <Camera className="h-[20px] w-[20px]" /> : <CameraOff className="h-[20px] w-[20px]" />}
        </button>

        <button
          className={cn(
            "flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl transition-all duration-200",
            isScreenSharing
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
              : "bg-rm-bg-elevated/40 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
          )}
          onClick={onToggleScreen}
          title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
        >
          <Monitor className="h-[20px] w-[20px]" />
        </button>
      </div>

      <div className="h-6 w-px bg-rm-border" />

      <div className="p-1">
        <DeviceSelector
          audioInputs={audioInputs}
          videoInputs={videoInputs}
          selectedAudioId={selectedAudioId}
          selectedVideoId={selectedVideoId}
          onSelectAudio={onSelectAudio}
          onSelectVideo={onSelectVideo}
        />
      </div>

      <div className="h-6 w-px bg-rm-border" />

      <div className="p-1">
        <button
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl bg-destructive/10 text-destructive transition-all duration-200 hover:bg-destructive hover:text-destructive-foreground"
          onClick={onLeave}
          title="Leave Voice"
        >
          <LogOut className="h-[20px] w-[20px]" />
        </button>
      </div>
    </div>
  );
}
