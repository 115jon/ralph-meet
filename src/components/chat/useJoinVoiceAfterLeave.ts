// Joining another voice channel from the one you are in. The old session's
// leave reports itself (onLeft) only after the leave sound's send window, and
// that report clears the auto-join flag a sidebar click sets. So the switch
// navigates at once and asks for the join here, which waits until the old
// session is gone.

import { useCallback, useEffect, useState } from "react";

/** A leave that never reports back is given up on, so no join lands late. */
export const VOICE_SWITCH_JOIN_TIMEOUT_MS = 5_000;

export function useJoinVoiceAfterLeave({
  activeChannelId,
  voiceJoined,
  joinChannel,
}: {
  activeChannelId: string | null;
  /** The current voice channel session has joined (and not yet left). */
  voiceJoined: boolean;
  joinChannel: (channelId: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    // Gone elsewhere before the leave finished: the switch is off.
    if (activeChannelId !== pending) {
      // eslint-disable-next-line react-hooks-js/set-state-in-effect
      setPending(null);
      return;
    }
    if (voiceJoined) return;
    setPending(null);
    joinChannel(pending);
  }, [activeChannelId, joinChannel, pending, voiceJoined]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(
      () => setPending(null),
      VOICE_SWITCH_JOIN_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [pending]);

  return useCallback((channelId: string) => setPending(channelId), []);
}
