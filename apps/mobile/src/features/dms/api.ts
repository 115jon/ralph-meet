import { Schema } from "effect";

import { MessagePageSchema } from "@/features/chat/schema";
import { apiJson } from "@/lib/api";

import { DmChannelSchema } from "./schema";

/** GET /api/dms: every DM the user is in, newest first. */
export function fetchDms() {
  return apiJson("/api/dms", Schema.Array(DmChannelSchema));
}

/**
 * The newest message of a DM, for its preview line. The list endpoint has
 * no last message, so each row asks for a one-message page.
 */
export async function fetchLatestMessage(channelId: string) {
  const page = await apiJson(
    `/api/channels/${encodeURIComponent(channelId)}/messages?limit=1`,
    MessagePageSchema,
  );
  return page.messages.at(-1) ?? null;
}
