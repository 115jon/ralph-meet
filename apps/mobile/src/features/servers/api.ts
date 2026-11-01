import { Schema } from "effect";

import { apiFetch, apiJson } from "@/lib/api";

import { ReadStatesSchema, ServerChannelsSchema, ServerSchema } from "./schema";

/** GET /api/servers: the servers the user is a member of. */
export function fetchServers() {
  return apiJson("/api/servers", Schema.Array(ServerSchema));
}

/** GET /api/servers/:id/channels: categories by rank, visible channels by position. */
export function fetchServerChannels(serverId: string) {
  return apiJson(
    `/api/servers/${encodeURIComponent(serverId)}/channels`,
    ServerChannelsSchema,
  );
}

/** GET /api/read-states: last read and last message time per channel. */
export function fetchReadStates() {
  return apiJson("/api/read-states", ReadStatesSchema);
}

/** PUT /api/channels/:id/read-state: marks the channel read up to now. */
export async function markChannelRead(channelId: string): Promise<void> {
  await apiFetch(`/api/channels/${encodeURIComponent(channelId)}/read-state`, {
    method: "PUT",
  });
}
