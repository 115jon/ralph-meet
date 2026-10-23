"use client";

import { useUserResolution } from "@/hooks/useUserResolution";
import { getAuthAssetUrl } from "@/lib/platform";
import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { disposePrewarmedAudioContext } from "@/lib/voice/audio-pipeline";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DialogPortal, DialogSurface } from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { AvatarImage } from "./AvatarImage";
import InlineEmojiText from "./InlineEmojiText";

/**
 * Modal overlay shown to the caller while waiting for the callee to answer.
 * Displays callee info, pulsing animation, and a cancel button.
 */
export function OutgoingCallModal() {
  const isMobile = useIsMobile();
  const { status, callId, remoteUser } = useCallStore();
  const gateway = useChatStore((s) => s.gateway);

  const activeCallee = useUserResolution(remoteUser?.id, remoteUser);

  const shouldRender =
    status === "ringing_outgoing" && !!remoteUser && !!callId;

  if (!shouldRender || !remoteUser || !callId) return null;

  const handleCancel = () => {
    disposePrewarmedAudioContext();
    gateway?.sendCallEnd(callId);
  };

  const avatarSrc = activeCallee.avatarUrl
    ? getAuthAssetUrl(activeCallee.avatarUrl)
    : undefined;

  const content = (
    <div className="flex flex-col items-center gap-6 p-8">
      {/* Pulsing animation around avatar */}
      <div className="relative">
        <div className="absolute -inset-3 rounded-full border-2 border-blue-500/30 animate-ping" />
        <div className="absolute -inset-1 rounded-full border border-blue-500/20 animate-pulse" />
        <div className="relative h-24 w-24 rounded-full bg-rm-bg-elevated border-2 border-blue-500/40 overflow-visible">
          {avatarSrc ? (
            <AvatarImage
              src={avatarSrc}
              alt={activeCallee.displayName}
              display={activeCallee.avatarDisplay}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-ui-2xl font-semibold text-rm-text-muted">
              {activeCallee.displayName[0]?.toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Callee info */}
      <div className="text-center">
        <h2 className="text-ui-xl font-semibold text-rm-text md:text-white">
          <InlineEmojiText text={activeCallee.displayName} />
        </h2>
        <p className="text-ui-sm text-rm-text-muted mt-1">
          <span className="inline-flex items-center gap-1.5">
            Calling
            <span className="inline-flex gap-0.5">
              <span className="animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite]">
                .
              </span>
              <span className="animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:150ms]">
                .
              </span>
              <span className="animate-[pulse_900ms_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:300ms]">
                .
              </span>
            </span>
          </span>
        </p>
      </div>

      {/* Cancel button */}
      <Button
        variant="danger"
        size="icon-lg"
        onClick={handleCancel}
        className="size-14 rounded-full mt-2"
        title="Cancel Call"
        aria-label="Cancel Call"
      >
        <Icon name="disconnect" size="xl" />
      </Button>
    </div>
  );

  return (
    <ResponsiveDialog
      open
      onOpenChange={(nextOpen) => !nextOpen && handleCancel()}
    >
      {isMobile ? (
        <ResponsiveDialogContent showCloseButton={false}>
          <ResponsiveDialogTitle className="sr-only">
            Calling {activeCallee.displayName}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            Waiting for them to answer. Close to cancel the call.
          </ResponsiveDialogDescription>
          {content}
        </ResponsiveDialogContent>
      ) : (
        <DialogPortal>
          <DialogSurface
            showCloseButton={false}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 outline-none backdrop-blur-md animate-in fade-in duration-200"
          >
            <ResponsiveDialogTitle className="sr-only">
              Calling {activeCallee.displayName}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="sr-only">
              Waiting for them to answer. Press Escape to cancel the call.
            </ResponsiveDialogDescription>
            {content}
          </DialogSurface>
        </DialogPortal>
      )}
    </ResponsiveDialog>
  );
}
