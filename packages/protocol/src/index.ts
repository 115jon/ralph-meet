// The gateway wire protocol shared by every client and the Durable Objects:
// opcodes, codes, the codec, every client payload schema, the server payloads
// of the chat socket, and the DM call record. Schema only: no Effect runtime
// modules, no browser, React Native or Worker globals.
//
// The web app re-exports this from src/lib/gateway-protocol, which adds the
// call sockets' server rules (they carry the web app's voice types).

import {
  compilePayloadDecoder,
  type DecodedMessage,
  type PayloadOf,
} from "./codec";
import {
  mainGatewayClientRules,
  voiceGatewayClientRules,
} from "./client-payloads";
import { chatGatewayServerRules } from "./server-payloads";

export * from "./opcodes";
export * from "./codec";
export * from "./client-payloads";
export * from "./server-payloads";
export * from "./call-record";

// ── Decoders, built once ───────────────────────────────────────────────────

/** MeetingRoom: client frames on the main gateway. */
export const decodeMainGatewayClientFrame = compilePayloadDecoder(
  mainGatewayClientRules,
);
/** VoiceRoom: client frames on the voice gateway. */
export const decodeVoiceGatewayClientFrame = compilePayloadDecoder(
  voiceGatewayClientRules,
);
/** Chat clients: server frames on the main gateway. */
export const decodeChatGatewayServerFrame = compilePayloadDecoder(
  chatGatewayServerRules,
);

// ── Message types ──────────────────────────────────────────────────────────

type MainClientRules = typeof mainGatewayClientRules;
type VoiceClientRules = typeof voiceGatewayClientRules;

export type MainGatewayClientMessage = DecodedMessage<MainClientRules>;
export type VoiceGatewayClientMessage = DecodedMessage<VoiceClientRules>;
export type ChatGatewayServerMessage = DecodedMessage<
  typeof chatGatewayServerRules
>;

/** `d` of a main-gateway client opcode, as the MeetingRoom handler gets it. */
export type MainClientPayload<K extends keyof MainClientRules & number> =
  PayloadOf<MainClientRules, K>;
/** `d` of a voice-gateway client opcode, as the VoiceRoom handler gets it. */
export type VoiceClientPayload<K extends keyof VoiceClientRules & number> =
  PayloadOf<VoiceClientRules, K>;
