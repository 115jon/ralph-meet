import { Schema } from "effect";

import { useSession } from "@/features/auth/session";
import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch } from "@/features/realtime/gateway";

import { applySelfPresence } from "./actions";
import { isUserStatus } from "./status";

/** PRESENCE_UPDATE; custom_status comes only from /api/presence's broadcast. */
const SelfPresenceSchema = Schema.Struct({
  user_id: Schema.String,
  status: Schema.String,
  custom_status: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodePresence = eventDecoder(SelfPresenceSchema);

function handle(event: string, data: unknown): void {
  if (event !== "PRESENCE_UPDATE") return;
  const d = decodePresence(data);
  if (!d || !isUserStatus(d.status)) return;
  if (d.user_id !== useSession.getState().user?.id) return;
  applySelfPresence(d.status, d.custom_status);
}

/** Keeps the panel's own status live when it changes elsewhere; returns the unsubscribe. */
export function startPresenceEvents(): () => void {
  return onDispatch(handle);
}
