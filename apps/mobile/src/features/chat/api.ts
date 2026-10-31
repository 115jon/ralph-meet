import { apiJson } from "@/lib/api";

import { MessagePageSchema, type Message } from "./schema";

export const PAGE_SIZE = 50;

/**
 * GET /api/channels/:id/messages: the newest page, or the page before
 * `before` (oldest first, as the server sends it).
 */
export function fetchMessages(channelId: string, before?: Message) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  // The server's cursor is "created_at|id", so equal timestamps page cleanly.
  if (before) params.set("before", `${before.created_at}|${before.id}`);
  return apiJson(
    `/api/channels/${encodeURIComponent(channelId)}/messages?${params}`,
    MessagePageSchema,
  );
}
