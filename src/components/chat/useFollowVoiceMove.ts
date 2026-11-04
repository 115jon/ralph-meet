// Following a moderator's move on the chat page. The server has already ended
// the old session. Leave here (the normal leave: screen share and room-bound
// state stop), then join the target the way a sidebar click does, switching
// server first if needed. Mute and deafen live in the voice settings store,
// so they carry over.

import { useEffect, useRef, useState } from "react";

import {
  VOICE_MOVE_EVENT,
  type VoiceMoveDetail,
} from "@/lib/voice/voice-move-client";

/** A target that never shows up (deleted, access lost) is dropped. */
export const VOICE_MOVE_FOLLOW_TIMEOUT_MS = 15_000;

export function useFollowVoiceMove({
  activeServerId,
  channelIds,
  voiceJoined,
  disconnect,
  switchServer,
  joinChannel,
}: {
  activeServerId: string | null;
  /** The active server's channels. */
  channelIds: readonly string[];
  /** The current voice session has joined (and not yet left). */
  voiceJoined: boolean;
  disconnect: () => void;
  switchServer: (serverId: string, channelId: string) => void;
  joinChannel: (channelId: string) => void;
}) {
  const [pending, setPending] = useState<VoiceMoveDetail | null>(null);
  // Set once the old session's leave has been issued. `voiceJoined` alone
  // is not enough: a move can land while a join is still connecting (the
  // session is draggable from Identify), when `voiceJoined` is already
  // false, and the target join must not race the leave queued behind it.
  const [disconnected, setDisconnected] = useState(false);
  const disconnectRef = useRef(disconnect);
  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  useEffect(() => {
    const onVoiceMove = (event: Event) => {
      const detail = (event as CustomEvent<VoiceMoveDetail>).detail;
      if (!detail?.channelId || !detail.serverId) return;
      event.preventDefault();
      setDisconnected(false);
      setPending(detail);
      // Off the socket's message dispatch: the leave closes that socket.
      window.setTimeout(() => {
        disconnectRef.current();
        setDisconnected(true);
      }, 0);
    };
    window.addEventListener(VOICE_MOVE_EVENT, onVoiceMove);
    return () => window.removeEventListener(VOICE_MOVE_EVENT, onVoiceMove);
  }, []);

  useEffect(() => {
    if (!pending || !disconnected || voiceJoined) return;
    if (activeServerId !== pending.serverId) {
      switchServer(pending.serverId, pending.channelId);
      return;
    }
    // Wait for the server's channels (after a server switch).
    if (!channelIds.includes(pending.channelId)) return;
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setPending(null);
    joinChannel(pending.channelId);
  }, [
    activeServerId,
    channelIds,
    disconnected,
    joinChannel,
    pending,
    switchServer,
    voiceJoined,
  ]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(
      () => setPending(null),
      VOICE_MOVE_FOLLOW_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [pending]);
}
