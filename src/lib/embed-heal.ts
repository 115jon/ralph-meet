// ── embed-heal ──────────────────────────────────────────────────────────────
// Messages keep their embeds in D1. Before 2026-11 the TikTok resolver could
// store an "unavailable" tombstone for a post that was only age-gated or that
// one scraper failed to read, and such a message showed "no longer
// available" forever. Tombstones written since then carry `checkedAt` (the
// server had a positive "gone" answer). A message that renders an older
// tombstone asks the server, once per session, to re-resolve it through the
// existing refresh endpoint, which persists and broadcasts the result.
//
// Bounded on purpose: only legacy TikTok tombstones that actually render
// (the list is virtualised), each message at most once per session, at most
// MAX_PER_SESSION messages, batched per channel. The server also throttles
// each URL for 20 minutes (`refreshMessageEmbeds`).

import type { EmbedInfo } from "@/lib/types";

const MAX_PER_SESSION = 30;
const MAX_PER_BATCH = 10;
const BATCH_DELAY_MS = 1500;

const requested = new Set<string>();
const pending = new Map<string, Set<string>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function isTikTokEmbed(embed: EmbedInfo): boolean {
  if (embed.provider?.name?.toLowerCase() === "tiktok") return true;
  try {
    return new URL(embed.url).hostname.toLowerCase().includes("tiktok.com");
  } catch {
    return false;
  }
}

/** A tombstone from the resolver that could not tell gated from gone. */
export function hasLegacyTombstone(embeds: EmbedInfo[] | undefined): boolean {
  return Boolean(
    embeds?.some(
      (embed) => embed.unavailable && !embed.checkedAt && isTikTokEmbed(embed),
    ),
  );
}

export type EmbedHealSender = (
  channelId: string,
  messageIds: string[],
) => Promise<void>;

function flush(send: EmbedHealSender): void {
  timer = null;
  for (const [channelId, ids] of pending) {
    const list = [...ids];
    for (let start = 0; start < list.length; start += MAX_PER_BATCH) {
      void send(channelId, list.slice(start, start + MAX_PER_BATCH)).catch(
        () => undefined,
      );
    }
  }
  pending.clear();
}

/**
 * Queue a message whose stored embeds include a legacy tombstone. Returns
 * whether it was queued (false when already asked or over the session cap).
 */
export function requestEmbedHeal(
  channelId: string,
  messageId: string,
  send: EmbedHealSender,
): boolean {
  if (requested.has(messageId) || requested.size >= MAX_PER_SESSION) {
    return false;
  }
  requested.add(messageId);
  let ids = pending.get(channelId);
  if (!ids) {
    ids = new Set();
    pending.set(channelId, ids);
  }
  ids.add(messageId);
  timer ??= setTimeout(() => flush(send), BATCH_DELAY_MS);
  return true;
}

/** Test hook. */
export function resetEmbedHeal(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  requested.clear();
  pending.clear();
}
