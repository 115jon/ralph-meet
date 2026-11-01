import { Schema } from "effect";

import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch } from "@/features/realtime/gateway";

import { noteProfileChanged } from "./store";

const decodeUpdate = eventDecoder(Schema.Struct({ user_id: Schema.String }));

function handle(event: string, data: unknown): void {
  if (event !== "USER_PROFILE_UPDATE") return;
  const d = decodeUpdate(data);
  if (d) noteProfileChanged(d.user_id);
}

/** An open profile follows edits made to it; returns the unsubscribe. */
export function startProfileEvents(): () => void {
  return onDispatch(handle);
}
