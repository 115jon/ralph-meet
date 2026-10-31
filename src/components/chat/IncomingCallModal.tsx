"use client";

import { CALL_ACCEPT } from "@/components/ui/dock";
import { TileAvatar } from "@/components/voice/TileParts";
import { TILE_SURFACE, useTileTintStyle } from "@/components/voice/tile-utils";
import { cn } from "@/lib/utils";
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
import { resumeSoundContext } from "@/lib/sounds";
import {
  disposePrewarmedAudioContext,
  prewarmAudioContext,
} from "@/lib/voice/audio-pipeline";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { Icon } from "@/components/ui/icon";
import { LedLabel } from "@/components/ui/led";
import { useEffect, useRef, useState } from "react";
import InlineEmojiText from "./InlineEmojiText";

/**
 * The incoming call card (talk-tree-spec §8 Voice): a 320px float at the
 * top-right, no scrim, so whatever you were doing stays readable. The caller
 * is drawn as a call tile (their colour, square avatar and the ringing ring,
 * the one loop allowed in a call, unmounted when ringing ends), named in
 * Bricolage with a Ringing LED word. Keys are 48: Decline is the solid
 * danger fill, Accept the talk-green key. Focus lands on Accept; Escape
 * declines.
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
  const tintStyle = useTileTintStyle(
    renderedCall?.remoteUser.id ?? remoteUser?.id,
  );
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (status === "ringing_incoming" && remoteUser && callId) {
      // Retain caller data while the controlled Dialog exits.
      // eslint-disable-next-line react-hooks-js/set-state-in-effect
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
          onOpenAutoFocus={(event) => {
            // Enter answers, not declines: focus lands on Accept.
            event.preventDefault();
            acceptRef.current?.focus();
          }}
          className="pointer-events-none fixed inset-0 z-100 flex items-start justify-end bg-transparent px-4 pt-[max(1rem,var(--safe-area-top,0px))] pb-[max(1rem,var(--safe-area-bottom,0px))] transition-opacity duration-(--dur-3) data-[state=closed]:opacity-0"
        >
          <div
            data-state={dialogOpen ? "open" : "closed"}
            data-incoming-call=""
            style={tintStyle}
            className="pointer-events-auto w-80 max-w-full overflow-hidden rounded-[2px] border border-line-strong border-t-2 border-t-ink-1 bg-ply-3 shadow-modal animate-in fade-in slide-in-from-top-2 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out"
          >
            {/* The caller as a tile: their colour, their avatar, the ring. */}
            <div
              className={cn(
                "flex items-center gap-3 border-b border-line p-4",
                TILE_SURFACE,
              )}
            >
              <TileAvatar
                name={activeCaller.displayName}
                avatar={activeCaller.avatarUrl}
                avatarDisplay={activeCaller.avatarDisplay}
                sizeClassName="size-10"
                initialClassName="text-ui-md"
                ringing={dialogOpen}
              />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-[18px] leading-6 font-extrabold tracking-[-0.02em] text-ink-1">
                  <InlineEmojiText text={activeCaller.displayName} />
                </DialogTitle>
                <DialogDescription className="mt-0.5 flex text-[11px] leading-[14px]">
                  <LedLabel state="idle">Incoming voice call</LedLabel>
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 p-3">
              <DialogClose asChild>
                <Button variant="danger" size="lg" className="flex-1">
                  <Icon name="disconnect" size="sm" />
                  Decline
                </Button>
              </DialogClose>
              <Button
                ref={acceptRef}
                size="lg"
                // The talk-green key is a solid C1 key: the notch cap is the
                // primary's, and it paints the fill through --key-fill.
                notch={false}
                onClick={handleAccept}
                className={cn("flex-1", CALL_ACCEPT)}
              >
                <Icon name="call" state="active" size="sm" />
                Accept
              </Button>
            </div>
          </div>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
