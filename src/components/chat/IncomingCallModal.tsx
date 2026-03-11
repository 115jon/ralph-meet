"use client";

import { prewarmAudioContext } from "@/lib/voice/audio-pipeline";
import { resumeSoundContext } from "@/lib/sounds";
import { getAuthAssetUrl } from "@/lib/platform";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { Phone, PhoneOff } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * Full-screen overlay shown to the callee when receiving an incoming call.
 * Displays caller info, animated ring effect, and accept/decline buttons.
 */
export function IncomingCallModal() {
  const { status, callId, remoteUser } = useCallStore();
  const gateway = useChatStore((s) => s.gateway);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after 30s (server also times out, but this is a client safety net)
  useEffect(() => {
    if (status !== "ringing_incoming") return;
    timerRef.current = setTimeout(() => {
      // Don't dispatch from here — the server will send CALL_END on timeout
    }, 31_000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [status]);

  if (status !== "ringing_incoming" || !remoteUser || !callId) return null;

  const handleAccept = () => {
    // Prewarm AudioContext during this user gesture (see audio-pipeline.ts)
    prewarmAudioContext();
    resumeSoundContext();
    window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
    gateway?.sendCallAccept(callId);
  };

  const handleDecline = () => {
    gateway?.sendCallDecline(callId);
  };

  const avatarSrc = remoteUser.avatar_url
    ? getAuthAssetUrl(remoteUser.avatar_url)
    : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex flex-col items-center gap-6 p-8">
        {/* Pulsing ring effect */}
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-green-500/20 animate-ping" />
          <div className="absolute -inset-2 rounded-full bg-green-500/10 animate-pulse" />
          <div className="relative h-24 w-24 rounded-full bg-rm-bg-elevated border-2 border-green-500/50 overflow-hidden">
            {avatarSrc ? (
              <img src={avatarSrc} alt={remoteUser.username} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-3xl font-bold text-rm-text-muted">
                {remoteUser.username[0]?.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Caller info */}
        <div className="text-center">
          <h2 className="text-xl font-bold text-white">{remoteUser.username}</h2>
          <p className="text-sm text-rm-text-muted mt-1 animate-pulse">Incoming Call...</p>
        </div>

        {/* Accept / Decline buttons */}
        <div className="flex items-center gap-8 mt-2">
          <button
            onClick={handleDecline}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white transition-all hover:scale-110 shadow-lg shadow-red-500/30"
            title="Decline"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
          <button
            onClick={handleAccept}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 hover:bg-green-600 text-white transition-all hover:scale-110 shadow-lg shadow-green-500/30"
            title="Accept"
          >
            <Phone className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
