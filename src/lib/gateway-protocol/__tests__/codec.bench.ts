// Decode cost at the Durable Object edge. Not part of CI; run with
//   pnpm exec vitest bench --run src/lib/gateway-protocol
// "JSON.parse only" is the floor every frame paid before the codec.

import { bench, describe } from "vitest";
import {
  decodeMainGatewayClientFrame,
  HEARTBEAT_FRAME,
  parseGatewayFrame,
} from "@/lib/gateway-protocol";

const MESSAGE_CREATE = JSON.stringify({
  op: 20,
  d: {
    channel_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    content:
      "Hey, are we still on for the call at five? I can share my screen.",
    reply_to_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    nonce: "0.6180339887",
  },
});
const TYPING_START = JSON.stringify({
  op: 23,
  d: { channel_id: "0f8fad5b-d9cb-469f-a165-70867728950e" },
});

function decode(raw: string) {
  const parsed = parseGatewayFrame(raw);
  if (!parsed.ok) throw new Error(parsed.message);
  const decoded = decodeMainGatewayClientFrame(parsed.frame);
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.message;
}

describe("MessageCreate (op 20)", () => {
  bench("JSON.parse only", () => {
    JSON.parse(MESSAGE_CREATE);
  });
  bench("parseGatewayFrame + schema decode", () => {
    decode(MESSAGE_CREATE);
  });
});

describe("TypingStart (op 23)", () => {
  bench("JSON.parse only", () => {
    JSON.parse(TYPING_START);
  });
  bench("parseGatewayFrame + schema decode", () => {
    decode(TYPING_START);
  });
});

describe("Heartbeat (op 3, not schema-decoded)", () => {
  bench("JSON.parse only", () => {
    JSON.parse(HEARTBEAT_FRAME);
  });
  bench("parseGatewayFrame + decoder lookup", () => {
    decode(HEARTBEAT_FRAME);
  });
});
