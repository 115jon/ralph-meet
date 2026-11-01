import type { ChannelCache, ChannelMessages } from "./store";

// The message cache must not grow for as long as a call keeps the app open:
// only the most recently opened conversations stay cached, and one that is
// closed keeps only its newest messages (reopening reloads the latest page).

export const MAX_CACHED_CONVERSATIONS = 20;
export const MAX_CACHED_MESSAGES = 200;

/** `channel` cut to its newest `max` messages; unsent rows always stay. */
export function trimChannel(
  channel: ChannelMessages,
  max = MAX_CACHED_MESSAGES,
): ChannelMessages {
  if (channel.messages.length <= max) return channel;
  // Newest first, so the head is what stays.
  const messages = channel.messages.filter(
    (message, index) => index < max || message.send,
  );
  return { ...channel, messages, hasMore: true, loadingOlder: false };
}

/** Only the channels among the `max` most recently opened (most recent first). */
export function evictChannels(
  channels: ChannelCache,
  recent: readonly string[],
  max = MAX_CACHED_CONVERSATIONS,
): ChannelCache {
  const keep = new Set(recent.slice(0, max));
  const ids = Object.keys(channels);
  if (ids.every((id) => keep.has(id))) return channels;
  const next: Record<string, ChannelMessages> = {};
  for (const id of ids) {
    const channel = channels[id];
    if (channel && keep.has(id)) next[id] = channel;
  }
  return next;
}
