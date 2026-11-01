import { Schema } from "effect";

import { useSession } from "@/features/auth/session";
import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch } from "@/features/realtime/gateway";

import { applySelfPresence } from "./actions";
import { applyPresence, setPresenceList } from "./live";
import { isUserStatus } from "./status";

/** PRESENCE_UPDATE; custom_status comes only from /api/presence's broadcast. */
const PresenceSchema = Schema.Struct({
  user_id: Schema.String,
  status: Schema.String,
  custom_status: Schema.optional(Schema.NullOr(Schema.String)),
});
/** PRESENCE_LIST: everyone connected, sent on each channel subscribe. */
const PresenceListSchema = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      user_id: Schema.String,
      status: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});
const decodePresence = eventDecoder(PresenceSchema);
const decodeList = eventDecoder(PresenceListSchema);

function handle(event: string, data: unknown): void {
  if (event === "PRESENCE_LIST") {
    const d = decodeList(data);
    if (d) setPresenceList(d.users);
    return;
  }
  if (event !== "PRESENCE_UPDATE") return;
  const d = decodePresence(data);
  if (!d) return;
  applyPresence(d.user_id, d.status, d.custom_status);
  if (!isUserStatus(d.status)) return;
  if (d.user_id !== useSession.getState().user?.id) return;
  applySelfPresence(d.status, d.custom_status);
}

/**
 * Keeps presence live: the panel's own status when it changes elsewhere,
 * and everyone else's for the member list, friends and profiles. Returns
 * the unsubscribe.
 */
export function startPresenceEvents(): () => void {
  return onDispatch(handle);
}
