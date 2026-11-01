// The gateway wire protocol. Everything but the call sockets' server rules
// lives in @ralph/protocol (shared with apps/mobile); this module re-exports
// it and adds RoomGateway's and VoiceGateway's rules, which carry the web
// app's voice types. Imported by realtime/ (relative path) and src/ (@/…).
// Schema only: no Effect runtime modules, no browser or Worker globals.

import { compilePayloadDecoder, type DecodedMessage } from "@ralph/protocol";
import {
  roomGatewayServerRules,
  voiceGatewayServerRules,
} from "./server-payloads";

export * from "@ralph/protocol";
export * from "./server-payloads";

// ── Decoders, built once ───────────────────────────────────────────────────

/** RoomGateway: server frames on the main gateway. */
export const decodeRoomGatewayServerFrame = compilePayloadDecoder(
  roomGatewayServerRules,
);
/** VoiceGateway: server frames on the voice gateway. */
export const decodeVoiceGatewayServerFrame = compilePayloadDecoder(
  voiceGatewayServerRules,
);

// ── Message types ──────────────────────────────────────────────────────────

export type RoomGatewayServerMessage = DecodedMessage<
  typeof roomGatewayServerRules
>;
export type VoiceGatewayServerMessage = DecodedMessage<
  typeof voiceGatewayServerRules
>;
