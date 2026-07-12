import { CameraSettingsModal } from "@/components/CameraSettingsModal";
import { clog } from "@/lib/console-logger";
import {
  clearDesktopThumbnailToolbar,
  HIDDEN_DESKTOP_THUMBNAIL_TOOLBAR_STATE,
  listenForDesktopThumbnailToolbarActions,
  syncDesktopThumbnailToolbar,
  type DesktopThumbnailToolbarState,
} from "@/lib/desktop-thumbnail-toolbar";
import { isTauri } from "@/lib/platform";
import type { SFUClient } from "@/lib/sfu-client";
import { playCallEnd } from "@/lib/sounds";
import { handleVoiceCameraToggle } from "@/lib/voice/camera-toggle";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { useVoiceSettingsStore } from "@/stores/useVoiceSettingsStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useListenTogetherPlaybackState } from "./listen-together-playback";
import type { VoiceSessionStreamState } from "./VoiceChannelView";

interface DesktopThumbnailToolbarSyncProps {
  currentUserId?: string | null;
  localStreamState: VoiceSessionStreamState | null;
  voiceJoined: boolean;
}

interface ToolbarVoiceSession {
  hasCamera: boolean;
  isCameraOn: boolean;
  hasMicrophone: boolean;
  isMicOn: boolean;
  isDeafened: boolean;
  roomSlug: string | null;
  settingsUserId?: string;
  sfu: SFUClient | null;
  toggleCamera: (() => void | Promise<void>) | null;
  toggleDeafen: (() => void) | null;
  toggleMic: (() => void) | null;
  disconnect: () => void;
}

const listenTogetherLog = clog("ListenTogether");

function sendListenTogetherCommand(
  sfu: SFUClient | null,
  roomSlug: string | null,
  payload: Record<string, unknown>,
) {
  if (!sfu || !roomSlug) return;
  listenTogetherLog.info("Sending listen together control", {
    source: "desktop-thumbnail-toolbar",
    type: payload.type,
    roomSlug,
    paused: payload.paused ?? null,
    entryId: payload.entryId ?? null,
  });
  sfu.resumeAudioContext?.();
  sfu.voiceGW.sendAppEvent(payload);
}

async function focusCurrentDesktopWindow() {
  if (!isTauri()) return;

  const currentWindow = getCurrentWindow();
  await currentWindow.unminimize().catch(() => {
    /* window is already restored */
  });
  await currentWindow.show().catch(() => {
    /* window may already be visible */
  });
  await currentWindow.setFocus().catch(() => {
    /* focus is best-effort */
  });
}

export function DesktopThumbnailToolbarSync({
  currentUserId,
  localStreamState,
  voiceJoined,
}: DesktopThumbnailToolbarSyncProps) {
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);

  const callStatus = useCallStore((state) => state.status);
  const callHasJoinedSFU = useCallStore((state) => state.hasJoinedSFU);
  const endCall = useCallStore((state) => state.endCall);
  const callVoice = useCallVoiceStore(
    useShallow((state) => ({
      handleLeave: state.handleLeave,
      hasCamera: state.hasCamera,
      hasMicrophone: state.hasMicrophone,
      isCameraActive: state.isCameraActive,
      isDeafened: state.isDeafened,
      isMicOn: state.isMicOn,
      roomSlug: state.roomSlug,
      sfu: state.sfu,
      toggleCamera: state.toggleCamera,
      toggleDeafen: state.toggleDeafen,
      toggleMic: state.toggleMic,
    })),
  );

  const activeSession = useMemo<ToolbarVoiceSession | null>(() => {
    if (callStatus === "active" && callHasJoinedSFU && callVoice.handleLeave) {
      return {
        hasCamera: callVoice.hasCamera,
        isCameraOn: callVoice.isCameraActive,
        hasMicrophone: callVoice.hasMicrophone,
        isMicOn: callVoice.isMicOn,
        isDeafened: callVoice.isDeafened,
        roomSlug: callVoice.roomSlug,
        settingsUserId: currentUserId ?? undefined,
        sfu: callVoice.sfu,
        toggleCamera: callVoice.toggleCamera,
        toggleDeafen: callVoice.toggleDeafen,
        toggleMic: callVoice.toggleMic,
        disconnect: () => {
          playCallEnd();
          callVoice.handleLeave?.();
          endCall("left");
        },
      };
    }

    if (voiceJoined && localStreamState) {
      return {
        hasCamera: localStreamState.hasCamera,
        isCameraOn: localStreamState.isCameraActive,
        hasMicrophone: localStreamState.hasMicrophone,
        isMicOn: localStreamState.isMicOn,
        isDeafened: localStreamState.isDeafened,
        roomSlug: localStreamState.roomSlug,
        settingsUserId: localStreamState.settingsUserId,
        sfu: localStreamState.sfu,
        toggleCamera: localStreamState.toggleCamera,
        toggleDeafen: localStreamState.toggleDeafen,
        toggleMic: localStreamState.toggleMic,
        disconnect: localStreamState.handleLeave,
      };
    }

    return null;
  }, [
    callHasJoinedSFU,
    callStatus,
    callVoice,
    currentUserId,
    endCall,
    localStreamState,
    voiceJoined,
  ]);

  const voiceSettings = useVoiceSettingsStore((state) =>
    state.getSettings(activeSession?.settingsUserId),
  );
  const playback = useListenTogetherPlaybackState(activeSession?.roomSlug);

  const mediaControls = useMemo(
    () =>
      activeSession?.sfu && activeSession.roomSlug && playback.currentEntry
        ? {
            paused: playback.isPaused,
            positionMs: playback.effectiveSeekValue,
            roomSlug: activeSession.roomSlug,
            setLocalPlayback: playback.setLocalPlayback,
            sfu: activeSession.sfu,
          }
        : null,
    [
      activeSession,
      playback.currentEntry,
      playback.effectiveSeekValue,
      playback.isPaused,
      playback.setLocalPlayback,
    ],
  );

  const activeSessionRef = useRef<ToolbarVoiceSession | null>(activeSession);
  const mediaControlsRef = useRef(mediaControls);
  const alwaysPreviewVideoRef = useRef(voiceSettings.alwaysPreviewVideo);

  useEffect(() => {
    activeSessionRef.current = activeSession;
    mediaControlsRef.current = mediaControls;
    alwaysPreviewVideoRef.current = voiceSettings.alwaysPreviewVideo;
  }, [activeSession, mediaControls, voiceSettings.alwaysPreviewVideo]);

  useEffect(() => {
    if (!isTauri()) return;
    const nextToolbarState: DesktopThumbnailToolbarState = activeSession
      ? {
          visible: true,
          hasCamera: activeSession.hasCamera,
          isCameraOn: activeSession.isCameraOn,
          hasMicrophone: activeSession.hasMicrophone,
          isMuted: activeSession.isDeafened || !activeSession.isMicOn,
          isDeafened: activeSession.isDeafened,
          hasMediaControls: !!mediaControls,
          isMediaPaused: mediaControls?.paused ?? false,
        }
      : HIDDEN_DESKTOP_THUMBNAIL_TOOLBAR_STATE;
    void syncDesktopThumbnailToolbar(nextToolbarState);
  }, [activeSession, mediaControls]);

  useEffect(() => {
    if (!isTauri()) return;

    let isDisposed = false;
    let unlisten: (() => void) | undefined;

    void listenForDesktopThumbnailToolbarActions(async ({ action }) => {
      if (isDisposed) return;

      const session = activeSessionRef.current;
      const media = mediaControlsRef.current;

      switch (action) {
        case "toggle-camera":
          if (!session) return;
          await handleVoiceCameraToggle({
            hasCamera: session.hasCamera,
            isCameraActive: session.isCameraOn,
            alwaysPreviewVideo: alwaysPreviewVideoRef.current,
            onToggleCamera: session.toggleCamera,
            onOpenPreviewModal: () => setIsCameraModalOpen(true),
            beforeOpenPreviewModal: focusCurrentDesktopWindow,
          });
          return;
        case "toggle-mic":
          session?.toggleMic?.();
          return;
        case "toggle-deafen":
          session?.toggleDeafen?.();
          return;
        case "disconnect":
          session?.disconnect();
          return;
        case "toggle-media-playback":
          if (!media) return;
          sendListenTogetherCommand(media.sfu, media.roomSlug, {
            type: "listen_together.pause",
            room_slug: media.roomSlug,
            paused: !media.paused,
          });
          media.setLocalPlayback(media.roomSlug, {
            paused: !media.paused,
            positionMs: media.positionMs,
          });
          return;
        case "skip-media":
          if (!media) return;
          sendListenTogetherCommand(media.sfu, media.roomSlug, {
            type: "listen_together.skip",
            room_slug: media.roomSlug,
          });
          return;
      }
    }).then((dispose) => {
      if (isDisposed) {
        dispose?.();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      void clearDesktopThumbnailToolbar();
    };
  }, []);

  const modalSession =
    activeSession && isCameraModalOpen ? activeSession : null;

  return (
    <CameraSettingsModal
      isOpen={!!modalSession}
      onClose={() => setIsCameraModalOpen(false)}
      isCameraActive={!!modalSession?.isCameraOn}
      onToggleCamera={
        modalSession?.toggleCamera
          ? () => {
              void Promise.resolve(modalSession.toggleCamera?.());
            }
          : undefined
      }
      settingsUserId={modalSession?.settingsUserId}
    />
  );
}
