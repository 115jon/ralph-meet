"use client";

import { CALL_ACCEPT } from "@/components/ui/dock";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPortal,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import { resumeSoundContext } from "@/lib/sounds";
import {
  disposePrewarmedAudioContext,
  prewarmAudioContext,
} from "@/lib/voice/audio-pipeline";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { Icon } from "@/components/ui/icon";
import { useEffect, useState } from "react";
import { AvatarImage } from "./AvatarImage";
import InlineEmojiText from "./InlineEmojiText";

/**
 * Simple centered popup shown to the callee when receiving an incoming call.
 * No overlay or blur — just a floating card with caller info and two buttons.
 */
export function IncomingCallModal() {
  const {
    status,
    callId,
    remoteUser,
    channelId: callChannelId,
  } = useCallStore();
  const gateway = useChatStore((s) => s.gateway);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const dispatch = useChatStore((s) => s.dispatch);
  const [renderedCall, setRenderedCall] = useState<{
    callId: string;
    channelId: string | null;
    remoteUser: NonNullable<typeof remoteUser>;
  } | null>(null);

  const activeCaller = useUserResolution(
    renderedCall?.remoteUser.id ?? remoteUser?.id,
    renderedCall?.remoteUser ?? remoteUser,
  );

  useEffect(() => {
    if (status === "ringing_incoming" && remoteUser && callId) {
      // Retain caller data while the controlled Dialog exits.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRenderedCall({ callId, channelId: callChannelId, remoteUser });
    }
  }, [callChannelId, callId, remoteUser, status]);

  const shouldRender =
    status === "ringing_incoming" && !!remoteUser && !!callId;
  const activeCall =
    renderedCall ??
    (remoteUser && callId
      ? { callId, channelId: callChannelId, remoteUser }
      : null);
  const dialogOpen =
    shouldRender &&
    activeCall !== null &&
    activeChannelId !== activeCall.channelId;
  if (!activeCall) return null;

  const handleAccept = () => {
    // Prewarm AudioContext during this user gesture (see audio-pipeline.ts)
    prewarmAudioContext();
    resumeSoundContext();
    window.dispatchEvent(new CustomEvent("force-voice-disconnect"));
    gateway?.sendCallAccept(activeCall.callId);

    // Navigate to the DM channel
    if (callChannelId) {
      if (useChatStore.getState().activeServerId !== "@me") {
        dispatch({
          type: "SWITCH_SERVER",
          serverId: "@me",
          channelId: callChannelId,
        });
      } else {
        dispatch({ type: "SET_ACTIVE_CHANNEL", channelId: callChannelId });
      }
    }
  };

  const handleDecline = () => {
    disposePrewarmedAudioContext();
    gateway?.sendCallDecline(activeCall.callId);
  };

  const avatarSrc = activeCaller.avatarUrl
    ? getAuthAssetUrl(activeCaller.avatarUrl)
    : undefined;

  return (
    <Dialog
      open={dialogOpen}
      modal={false}
      onOpenChange={(open) => !open && handleDecline()}
    >
      <DialogPortal forceMount>
        <DialogSurface
          showCloseButton={false}
          forceMount
          className="fixed inset-0 z-100 flex items-center justify-center bg-transparent p-4 transition-opacity duration-200 data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0"
        >
          <div
            data-state={dialogOpen ? "open" : "closed"}
            className="pointer-events-auto flex w-[280px] flex-col items-center rounded-xl border border-rm-border bg-rm-bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-[0.97] duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-[0.97] dark:bg-rm-bg-elevated"
          >
            {/* Avatar with theme-aware pulsing outline */}
            <div className="relative mb-4">
              <div className="size-18 overflow-visible rounded-full bg-rm-tint-2 ring-2 ring-rm-status-online/60 motion-safe:animate-pulse">
                {avatarSrc ? (
                  <AvatarImage
                    src={avatarSrc}
                    alt={activeCaller.displayName}
                    display={activeCaller.avatarDisplay}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ui-2xl font-semibold text-rm-text">
                    {activeCaller.displayName[0]?.toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            {/* Caller info */}
            <DialogTitle className="text-ui-md font-semibold text-rm-text">
              <InlineEmojiText text={activeCaller.displayName} />
            </DialogTitle>
            <DialogDescription className="mt-1 mb-6 text-ui-sm text-rm-text-secondary">
              Incoming call…
            </DialogDescription>

            {/* Buttons */}
            <div className="flex items-center gap-3">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DialogClose asChild>
                      <Button
                        variant="destructive"
                        size="lg"
                        aria-label="Dismiss"
                        className="w-16"
                      >
                        <Icon name="close" size="lg" />
                      </Button>
                    </DialogClose>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Dismiss</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="lg"
                      onClick={handleAccept}
                      aria-label="Join call"
                      className={cn("w-16", CALL_ACCEPT)}
                    >
                      <Icon name="call" size="lg" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Join call</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
