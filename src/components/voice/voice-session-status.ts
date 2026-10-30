import { create } from "zustand";

/**
 * What the call strip needs to know about the channel voice session, without
 * a prop chain through the shell: the connection state, when you joined, and
 * how to retry after a failure. VoiceChannelView publishes it; the call strip
 * (VoiceDashboard via UserPanel) reads it. DM calls use useCallVoiceStore.
 *
 * Scalars only, so a subscriber re-renders when its one field changes.
 */
interface VoiceSessionStatus {
  channelId: string | null;
  connectionState: string;
  joinedAt: number | null;
  retry: (() => void) | null;
}

export const useVoiceSessionStatus = create<VoiceSessionStatus>(() => ({
  channelId: null,
  connectionState: "new",
  joinedAt: null,
  retry: null,
}));

export function publishVoiceSessionStatus(next: Partial<VoiceSessionStatus>) {
  useVoiceSessionStatus.setState(next);
}

export function clearVoiceSessionStatus(channelId: string) {
  if (useVoiceSessionStatus.getState().channelId !== channelId) return;
  useVoiceSessionStatus.setState({
    channelId: null,
    connectionState: "new",
    joinedAt: null,
    retry: null,
  });
}
