"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import { resumeSoundContext } from "@/lib/sounds";
import { prewarmAudioContext } from "@/lib/voice/audio-pipeline";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { Phone, X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * Simple centered popup shown to the callee when receiving an incoming call.
 * No overlay or blur — just a floating card with caller info and two buttons.
 */
export function IncomingCallModal() {
  const { status, callId, remoteUser, channelId: callChannelId } = useCallStore();
  const gateway = useChatStore((s) => s.gateway);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const dispatch = useChatStore((s) => s.dispatch);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeCaller = useUserResolution(remoteUser?.id, remoteUser);

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
  if (activeChannelId === callChannelId) return null; // Already viewing the DM, inline region handles it!

  const handleAccept = () => {
    // Prewarm AudioContext during this user gesture (see audio-pipeline.ts)
    prewarmAudioContext();
    resumeSoundContext();
    window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
    gateway?.sendCallAccept(callId);

    // Navigate to the DM channel
    if (callChannelId) {
      if (useChatStore.getState().activeServerId !== "@me") {
        dispatch({ type: "SWITCH_SERVER", serverId: "@me", channelId: callChannelId });
      } else {
        dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: callChannelId });
      }
    }
  };

  const handleDecline = () => {
    gateway?.sendCallDecline(callId);
  };

  const avatarSrc = activeCaller.avatarUrl
    ? getAuthAssetUrl(activeCaller.avatarUrl)
    : undefined;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center w-[280px] rounded-xl bg-rm-bg-elevated shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Avatar with theme-aware pulsing outline */}
        <div className="relative mb-4">
          <div className="h-[72px] w-[72px] rounded-full border-[3px] border-rm-text-muted/40 animate-pulse overflow-hidden bg-rm-bg-surface">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={activeCaller.username}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-2xl font-bold text-rm-text-muted">
                {activeCaller.displayName[0]?.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Caller info */}
        <h2 className="text-sm font-bold text-rm-text">{activeCaller.displayName}</h2>
        <p className="text-xs text-rm-text-muted mt-0.5 mb-5">Incoming Call...</p>

        {/* Buttons */}
        <div className="flex items-center gap-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleDecline}
                  className="flex h-10 w-16 items-center justify-center rounded-md bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Dismiss</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleAccept}
                  className="flex h-10 w-16 items-center justify-center rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  <Phone className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Join Call</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}
