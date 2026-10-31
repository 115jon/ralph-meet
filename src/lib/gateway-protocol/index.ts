// The gateway wire protocol: opcodes, codes, per-opcode payload schemas for
// both directions, and the codec the Durable Objects and browser gateways
// decode frames with. Imported by realtime/ (relative path) and src/ (@/…).
// Schema only: no Effect runtime modules, no browser or Worker globals.

import {
  compilePayloadDecoder,
  type DecodedMessage,
  type PayloadOf,
} from "./codec";
import {
  mainGatewayClientRules,
  voiceGatewayClientRules,
} from "./client-payloads";
import {
  chatGatewayServerRules,
  roomGatewayServerRules,
  voiceGatewayServerRules,
} from "./server-payloads";

export * from "./opcodes";
export * from "./codec";
export * from "./client-payloads";
export * from "./server-payloads";

// ── Decoders, built once ───────────────────────────────────────────────────

/** MeetingRoom: client frames on the main gateway. */
export const decodeMainGatewayClientFrame = compilePayloadDecoder(
  mainGatewayClientRules,
);
/** VoiceRoom: client frames on the voice gateway. */
export const decodeVoiceGatewayClientFrame = compilePayloadDecoder(
  voiceGatewayClientRules,
);
/** Chat store: server frames on the main gateway. */
export const decodeChatGatewayServerFrame = compilePayloadDecoder(
  chatGatewayServerRules,
);
/** RoomGateway: server frames on the main gateway. */
export const decodeRoomGatewayServerFrame = compilePayloadDecoder(
  roomGatewayServerRules,
);
/** VoiceGateway: server frames on the voice gateway. */
export const decodeVoiceGatewayServerFrame = compilePayloadDecoder(
  voiceGatewayServerRules,
);

// ── Message types ──────────────────────────────────────────────────────────

type MainClientRules = typeof mainGatewayClientRules;
type VoiceClientRules = typeof voiceGatewayClientRules;

export type MainGatewayClientMessage = DecodedMessage<MainClientRules>;
export type VoiceGatewayClientMessage = DecodedMessage<VoiceClientRules>;
export type ChatGatewayServerMessage = DecodedMessage<
  typeof chatGatewayServerRules
>;
export type RoomGatewayServerMessage = DecodedMessage<
  typeof roomGatewayServerRules
>;
export type VoiceGatewayServerMessage = DecodedMessage<
  typeof voiceGatewayServerRules
>;

/** `d` of a main-gateway client opcode, as the MeetingRoom handler gets it. */
export type MainClientPayload<K extends keyof MainClientRules & number> =
  PayloadOf<MainClientRules, K>;
/** `d` of a voice-gateway client opcode, as the VoiceRoom handler gets it. */
export type VoiceClientPayload<K extends keyof VoiceClientRules & number> =
  PayloadOf<VoiceClientRules, K>;
