"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@clerk/nextjs";
import { Camera } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface JoinFormProps {
  initialRoom?: string;
  onJoin: (name: string, room: string) => void;
}

export default function JoinForm({ initialRoom, onJoin }: JoinFormProps) {
  const { user } = useUser();

  const username = user?.username || "guest";
  const displayName =
    (user?.unsafeMetadata?.displayName as string) ||
    user?.fullName ||
    user?.firstName ||
    null;
  const avatarUrl = user?.imageUrl || null;

  const [room, setRoom] = useState(initialRoom ?? "");
  const [previewActive, setPreviewActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    roomInputRef.current?.focus();
  }, []);

  const enablePreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setPreviewActive(true);
    } catch {
      // Camera not available or denied
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedRoom = room.trim();
    if (!trimmedRoom) return;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    onJoin(username, trimmedRoom);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-rm-bg-primary p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-rm-border bg-rm-bg-elevated shadow-2xl">
        {/* Camera preview */}
        <div className="relative aspect-video w-full overflow-hidden bg-rm-bg-surface">
          {previewActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <Camera className="h-10 w-10 text-rm-text-muted/20" />
              <button
                type="button"
                className="cursor-pointer rounded-lg border border-rm-border bg-rm-bg-elevated px-4 py-2 text-xs font-semibold text-rm-text transition-colors hover:bg-rm-bg-hover outline-none"
                onClick={enablePreview}
              >
                Turn on Camera
              </button>
              <span className="text-[10px] text-rm-text-muted/40 transition-colors">Optional</span>
            </div>
          )}
          {previewActive && (
            <div className="absolute bottom-2 left-2 rounded-md bg-rm-bg-primary/60 px-2 py-1 text-[10px] font-medium text-rm-text">
              Camera Preview
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <h1 className="text-xl font-bold text-rm-text">Join Meeting</h1>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-rm-text-muted">Joining as</Label>
            <div className="flex items-center gap-2.5">
              {avatarUrl && (
                <Image
                  src={avatarUrl}
                  alt={username}
                  width={32}
                  height={32}
                  className="rounded-full"
                />
              )}
              <div className="min-w-0">
                <span className="block truncate text-sm font-semibold text-rm-text">@{username}</span>
                {displayName && (
                  <span className="block truncate text-xs text-rm-text-muted">{displayName}</span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="room-input" className="text-xs font-semibold text-rm-text-muted">
              Room Code
            </Label>
            <Input
              id="room-input"
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. team-standup"
              className="border-rm-border bg-rm-bg-surface text-rm-text placeholder:text-rm-text-muted/40 focus-visible:border-primary outline-none"
              ref={roomInputRef}
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-primary py-5 text-base font-bold shadow-lg shadow-primary/20 transition-all duration-300 hover:brightness-110 hover:shadow-xl disabled:opacity-40"
            disabled={!room.trim()}
          >
            Join Room →
          </Button>
          {!room.trim() && (
            <p className="text-center text-xs text-rm-text-muted">Enter a room code to continue</p>
          )}
        </form>
      </div>
    </div>
  );
}
