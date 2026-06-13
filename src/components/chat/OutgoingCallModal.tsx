"use client";

import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { PhoneOff } from "lucide-react";

/**
 * Modal overlay shown to the caller while waiting for the callee to answer.
 * Displays callee info, pulsing animation, and a cancel button.
 */
export function OutgoingCallModal() {
  const { status, callId, remoteUser } = useCallStore();
  const gateway = useChatStore((s) => s.gateway);

  const activeCallee = useUserResolution(remoteUser?.id, remoteUser);

  if (status !== "ringing_outgoing" || !remoteUser || !callId) return null;

  const handleCancel = () => {
    gateway?.sendCallEnd(callId);
  };

  const avatarSrc = activeCallee.avatarUrl
    ? getAuthAssetUrl(activeCallee.avatarUrl)
    : undefined;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex flex-col items-center gap-6 p-8">
        {/* Pulsing animation around avatar */}
        <div className="relative">
          <div className="absolute -inset-3 rounded-full border-2 border-blue-500/30 animate-ping" />
          <div className="absolute -inset-1 rounded-full border border-blue-500/20 animate-pulse" />
          <div className="relative h-24 w-24 rounded-full bg-rm-bg-elevated border-2 border-blue-500/40 overflow-hidden">
            {avatarSrc ? (
              <img src={avatarSrc} alt={activeCallee.displayName} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-3xl font-bold text-rm-text-muted">
                {activeCallee.displayName[0]?.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Callee info */}
        <div className="text-center">
          <h2 className="text-xl font-bold text-white">{activeCallee.displayName}</h2>
          <p className="text-sm text-rm-text-muted mt-1">
            <span className="inline-flex items-center gap-1.5">
              Calling
              <span className="inline-flex gap-0.5">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
              </span>
            </span>
          </p>
        </div>

        {/* Cancel button */}
        <button
          onClick={handleCancel}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white transition-all hover:scale-110 shadow-lg shadow-red-500/30 mt-2"
          title="Cancel Call"
        >
          <PhoneOff className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
