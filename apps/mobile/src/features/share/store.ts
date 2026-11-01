import { create } from "zustand";

import type { SharePayload } from "./payload";

// A share from another app on its way to a conversation: `pending` while
// the "Send to…" picker is up, then `staged` for the chosen conversation's
// composer, which takes it once.

interface ShareState {
  readonly pending: SharePayload | null;
  readonly staged: {
    readonly channelId: string;
    readonly payload: SharePayload;
  } | null;
}

const useShareStore = create<ShareState>()(() => ({
  pending: null,
  staged: null,
}));

export function setPendingShare(payload: SharePayload | null): void {
  useShareStore.setState({ pending: payload });
}

export function usePendingShare(): SharePayload | null {
  return useShareStore((s) => s.pending);
}

/** The picker chose `channelId`: its composer takes the share. */
export function stageShare(channelId: string): void {
  const { pending } = useShareStore.getState();
  if (pending)
    useShareStore.setState({
      pending: null,
      staged: { channelId, payload: pending },
    });
}

export function useStagedShare(channelId: string): SharePayload | null {
  return useShareStore((s) =>
    s.staged?.channelId === channelId ? s.staged.payload : null,
  );
}

/** The composer took it. */
export function takeStagedShare(channelId: string): void {
  if (useShareStore.getState().staged?.channelId === channelId) {
    useShareStore.setState({ staged: null });
  }
}

export function resetShare(): void {
  useShareStore.setState({ pending: null, staged: null });
}
