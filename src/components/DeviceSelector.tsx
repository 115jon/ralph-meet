"use client";

import type { MediaDeviceInfo_Custom } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { Camera, Check, Mic, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface DeviceSelectorProps {
  audioInputs: MediaDeviceInfo_Custom[];
  videoInputs: MediaDeviceInfo_Custom[];
  selectedAudioId: string;
  selectedVideoId: string;
  onSelectAudio: (deviceId: string) => void;
  onSelectVideo: (deviceId: string) => void;
}

export default function DeviceSelector({
  audioInputs,
  videoInputs,
  selectedAudioId,
  selectedVideoId,
  onSelectAudio,
  onSelectVideo,
}: DeviceSelectorProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-none bg-rm-bg-elevated/40 px-4 py-2 text-rm-text transition-all duration-200 hover:bg-rm-bg-hover outline-none"
        onClick={() => setOpen(!open)}
        title="Device settings"
      >
        <span className="flex h-5 w-5 items-center justify-center">
          <Settings className="h-[18px] w-[18px]" />
        </span>
        <span className="text-[10px] font-medium opacity-70">Devices</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-1/2 mb-3 w-72 -translate-x-1/2 rounded-xl border border-rm-border bg-rm-bg-elevated p-3 shadow-2xl">
          <div className="mb-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-rm-text-muted/40">
              <Mic className="h-3.5 w-3.5" />
              Microphone
            </div>
            {audioInputs.length === 0 ? (
              <div className="py-2 text-center text-xs text-rm-text-muted/40">No microphones found</div>
            ) : (
              audioInputs.map((d) => (
                <button
                  key={d.deviceId}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md border-none px-2.5 py-2 text-left text-xs transition-colors",
                    d.deviceId === selectedAudioId || d.deviceId === selectedVideoId
                      ? "bg-rm-bg-active text-rm-text"
                      : "bg-transparent text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary"
                  )}
                  onClick={() => {
                    onSelectAudio(d.deviceId);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{d.label}</span>
                  {d.deviceId === selectedAudioId && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>

          <div className="my-2 h-px bg-rm-border" />

          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-rm-text-muted/40">
              <Camera className="h-3.5 w-3.5" />
              Camera
            </div>
            {videoInputs.length === 0 ? (
              <div className="py-2 text-center text-xs text-rm-text-muted/40">No cameras found</div>
            ) : (
              videoInputs.map((d) => (
                <button
                  key={d.deviceId}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md border-none px-2.5 py-2 text-left text-xs transition-colors",
                    d.deviceId === selectedVideoId
                      ? "bg-rm-bg-active text-rm-text"
                      : "bg-transparent text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text-secondary"
                  )}
                  onClick={() => {
                    onSelectVideo(d.deviceId);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{d.label}</span>
                  {d.deviceId === selectedVideoId && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
