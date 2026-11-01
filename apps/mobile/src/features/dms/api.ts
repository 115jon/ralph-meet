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

/** POST /api/dms {target_user_id}: the DM with them, opened or created. */
export function postDm(userId: string) {
  return apiJson("/api/dms", Schema.Struct({ id: Schema.String }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_user_id: userId }),
  });
}
