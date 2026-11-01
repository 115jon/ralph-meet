import type { Message } from "@/features/chat/schema";

import { fetchDms, fetchLatestMessage } from "./api";
import { useDmsStore } from "./store";

const { getState, setState } = useDmsStore;

/** Rows past this get their preview when the list is next loaded. */
const PREVIEW_LIMIT = 30;

async function loadPreview(channelId: string): Promise<void> {
  try {
    const message = await fetchLatestMessage(channelId);
    setState((s) => ({ previews: { ...s.previews, [channelId]: message } }));
  } catch {
    // The row still opens; it just shows no preview.
  }
}

/** Loads the DM list and the preview line of each conversation. */
export async function loadDms(): Promise<void> {
  if (getState().dms.length === 0) setState({ status: "loading" });
  try {
    const dms = await fetchDms();
    setState({ status: "ready", dms });
    await Promise.all(
      dms.slice(0, PREVIEW_LIMIT).map((dm) => loadPreview(dm.id)),
    );
  } catch {
    if (getState().dms.length === 0) setState({ status: "error" });
  }
}

// ── Gateway events ─────────────────────────────────────────────────────────

export function isDm(channelId: string): boolean {
  return getState().dms.some((dm) => dm.id === channelId);
}

export function notePreview(message: Message): void {
  if (!isDm(message.channel_id)) return;
  setState((s) => ({
    previews: { ...s.previews, [message.channel_id]: message },
  }));
}

/** An edit or delete touched a preview: fetch the newest message again. */
export function refreshPreviewFor(messageId: string): void {
  const entry = Object.entries(getState().previews).find(
    ([, message]) => message?.id === messageId,
  );
  if (entry) void loadPreview(entry[0]);
}

export function setPresence(userId: string, status: string): void {
  setState((s) => ({
    dms: s.dms.map((dm) =>
      dm.recipient.id === userId
        ? { ...dm, recipient: { ...dm.recipient, status } }
        : dm,
    ),
  }));
}
