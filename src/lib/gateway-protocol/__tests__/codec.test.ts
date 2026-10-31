import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeChatGatewayServerFrame,
  decodeMainGatewayClientFrame,
  decodeRoomGatewayServerFrame,
  decodeVoiceGatewayClientFrame,
  decodeVoiceGatewayServerFrame,
  GatewayCloseCode,
  GatewayOp,
  HEARTBEAT_FRAME,
  mainGatewayClientRules,
  compilePayloadDecoder,
  parseGatewayFrame,
  readReplaySeq,
  voiceGatewayClientRules,
  type GatewayFrame,
  type PayloadRules,
} from "@/lib/gateway-protocol";
import { Schema } from "effect";

const frame = (op: number, d?: unknown): GatewayFrame => ({ op, d });

function ruleOps(rules: PayloadRules, withPayload: boolean): number[] {
  return Object.entries(rules)
    .filter(([, rule]) => (rule !== null) === withPayload)
    .map(([op]) => Number(op))
    .sort((a, b) => a - b);
}

function sortedKeys(table: Record<number, unknown>): number[] {
  return Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
}

describe("parseGatewayFrame", () => {
  it("answers non-JSON with 4002 Invalid JSON", () => {
    expect(parseGatewayFrame("not-json")).toEqual({
      ok: false,
      code: GatewayCloseCode.InvalidJson,
      message: "Invalid JSON",
    });
  });

  it.each(["null", "[]", '"text"', "7", "{}", '{"op":"3"}', '{"op":null}'])(
    "answers %s with 4001 Missing opcode",
    (raw) => {
      expect(parseGatewayFrame(raw)).toEqual({
        ok: false,
        code: GatewayCloseCode.UnknownOpcode,
        message: "Missing opcode",
      });
    },
  );

  it("keeps op and d and does not inspect d", () => {
    expect(parseGatewayFrame('{"op":20,"d":"anything","x":1}')).toEqual({
      ok: true,
      frame: { op: 20, d: "anything" },
    });
    expect(parseGatewayFrame(HEARTBEAT_FRAME)).toEqual({
      ok: true,
      frame: { op: GatewayOp.Heartbeat, d: undefined },
    });
  });
});

describe("wire constants", () => {
  it("keeps the raw heartbeat byte-stable", () => {
    expect(HEARTBEAT_FRAME).toBe('{"op":3}');
    expect(JSON.stringify({ op: GatewayOp.Heartbeat })).toBe(HEARTBEAT_FRAME);
  });

  it("serializes opcodes and codes as the same numbers as before", () => {
    expect(
      JSON.stringify({
        op: GatewayOp.Error,
        d: { code: GatewayCloseCode.InvalidPayload, message: "m" },
      }),
    ).toBe('{"op":18,"d":{"code":4000,"message":"m"}}');
    expect([
      GatewayCloseCode.UnknownOpcode,
      GatewayCloseCode.InvalidJson,
      GatewayCloseCode.NotAuthenticated,
      GatewayCloseCode.SessionInvalid,
      GatewayCloseCode.AdmissionRejected,
      GatewayCloseCode.RateLimited,
    ]).toEqual([4001, 4002, 4003, 4006, 4008, 4290]);
  });
});

describe("readReplaySeq", () => {
  it("reads an integer d.seq from any opcode but HeartbeatACK", () => {
    expect(readReplaySeq(frame(GatewayOp.Dispatch, { seq: 4 }))).toBe(4);
    expect(readReplaySeq(frame(4242, { seq: 9 }))).toBe(9);
    expect(readReplaySeq(frame(GatewayOp.HeartbeatACK, { seq: 9 }))).toBe(
      undefined,
    );
    expect(readReplaySeq(frame(GatewayOp.Dispatch, { seq: 1.5 }))).toBe(
      undefined,
    );
    expect(readReplaySeq(frame(GatewayOp.Dispatch, { seq: "4" }))).toBe(
      undefined,
    );
    expect(readReplaySeq(frame(GatewayOp.Dispatch, null))).toBe(undefined);
  });
});

describe("compilePayloadDecoder", () => {
  const decode = compilePayloadDecoder({
    [GatewayOp.Heartbeat]: null,
    [GatewayOp.TypingStart]: {
      schema: Schema.Struct({ channel_id: Schema.String }),
      invalid: "Invalid typing payload",
    },
  });

  it("reports opcodes missing from the table as unknown", () => {
    expect(decode(frame(4242, {}))).toEqual({
      ok: false,
      reason: "unknown-op",
    });
  });

  it("does not look at the payload of a payload-less opcode", () => {
    expect(decode(frame(GatewayOp.Heartbeat))).toEqual({
      ok: true,
      message: { op: GatewayOp.Heartbeat, d: undefined },
    });
    expect(decode(frame(GatewayOp.Heartbeat, "junk")).ok).toBe(true);
  });

  it("returns the parsed object itself, unknown keys included", () => {
    const parsed = frame(GatewayOp.TypingStart, {
      channel_id: "c",
      added_later: { nested: true },
    });
    const result = decode(parsed);
    expect(result).toEqual({ ok: true, message: parsed });
    expect(result.ok && result.message).toBe(parsed);
  });

  it.each([null, [], "c", 1, {}, { channel_id: 1 }])(
    "rejects %j with the rule's message",
    (d) => {
      expect(decode(frame(GatewayOp.TypingStart, d))).toEqual({
        ok: false,
        reason: "invalid-payload",
        invalid: "Invalid typing payload",
      });
    },
  );
});

// ── Client → server ────────────────────────────────────────────────────────
// One payload per opcode in the shape today's clients send (and old clients
// sent). If a schema rejects one of these, it would break a deploy.

const AVATAR_DISPLAY = { version: 1, crop: { x: 0, y: 0, size: 1 } };

const VALID_MAIN_CLIENT_PAYLOADS = {
  [GatewayOp.Identify]: [
    // chat store
    {
      name: "ChatClient",
      clerk_user_id: "user-1",
      platform: "web",
      supports_voice_state_deltas: true,
    },
    // RoomGateway, with an AvatarDisplay object and nulls
    {
      name: "Guest",
      display_name: null,
      avatar_display: AVATAR_DISPLAY,
      supports_voice_state_deltas: true,
      standby: true,
    },
    { name: "Old client", avatar_url: null, username: null },
  ],
  [GatewayOp.Resume]: [{ session_id: "session-1", seq_ack: 0 }],
  [GatewayOp.VoiceStateUpdate]: [
    {},
    { self_mute: true, self_deaf: false, self_video: false },
    { stream_preview_url: null },
    {
      spatial_audio_enabled: true,
      spatial_audio_high_fidelity: false,
      spatial_audio_state: { enabled: true, placementMode: "auto" },
    },
    { promote_standby: true, self_mute: true },
  ],
  [GatewayOp.MessageCreate]: [
    { channel_id: "c", content: "hi" },
    { channel_id: "c", content: "hi", reply_to_id: "m", nonce: "0.1" },
    { channel_id: "c", content: "hi", nsfw_attachment_ids: ["a"] },
  ],
  [GatewayOp.MessageUpdate]: [{ message_id: "m", content: "edited" }],
  [GatewayOp.MessageDelete]: [{ message_id: "m", channel_id: "c" }],
  [GatewayOp.TypingStart]: [{ channel_id: "c" }],
  [GatewayOp.ReactionAdd]: [{ channel_id: "c", message_id: "m", emoji: "👍" }],
  [GatewayOp.ReactionRemove]: [
    { channel_id: "c", message_id: "m", emoji: "👍" },
  ],
  [GatewayOp.ChannelSubscribe]: [{ channel_id: "c" }],
  [GatewayOp.ChannelUnsubscribe]: [{ channel_id: "c" }],
  [GatewayOp.PresenceUpdate]: [{ status: "idle" }, { status: "invisible" }],
  [GatewayOp.VoiceChannelJoin]: [
    { channel_id: "c", self_mute: true },
    { channel_id: "c", self_mute: false, started_at: 1_700_000_000_000 },
  ],
  [GatewayOp.VoiceChannelLeave]: [{}, { channel_id: "c" }],
  [GatewayOp.ServerSubscribe]: [{ server_id: "s" }],
  [GatewayOp.CallInitiate]: [{ target_user_id: "u", channel_id: "c" }],
  [GatewayOp.CallAccept]: [{ call_id: "call" }],
  [GatewayOp.CallDecline]: [{ call_id: "call" }],
  [GatewayOp.CallEnd]: [{ call_id: "call" }],
} satisfies Record<number, unknown[]>;

const VALID_VOICE_CLIENT_PAYLOADS = {
  [GatewayOp.VoiceIdentify]: [
    { participant_id: "p", voice_token: "t" },
    {
      participant_id: "p",
      voice_token: "t",
      supports_listen_together_snapshot_events: true,
    },
  ],
  [GatewayOp.SelectProtocol]: [
    {
      sdp: "v=0",
      push_prefix: "screen",
      push_tracks: [{ track_name: "screen-video-p", mid: "0", kind: "video" }],
      pull_tracks: [],
      request_id: "r1",
    },
  ],
  [GatewayOp.Video]: [
    {
      tracks: [
        {
          participant_id: "p",
          track_name: "cam-audio-p",
          sfu_track_name: "opaque",
          session_id: "s".repeat(1_000),
          kind: "audio",
        },
        {
          participant_id: "p",
          track_name: "cam-video-p",
          session_id: "session",
          mid: "1",
          kind: "video",
        },
      ],
    },
  ],
  [GatewayOp.StopTracks]: [{ track_names: ["cam-video-p"] }],
  [GatewayOp.TracksReady]: [{ track_names: ["screen-video-p"] }],
  [GatewayOp.Speaking]: [{ speaking: 1 }, { speaking: 0, delay: 0, ssrc: 1 }],
  [GatewayOp.VoiceAppEvent]: [{ type: "soundboard.play", sound_id: "x" }],
} satisfies Record<number, unknown[]>;

describe("client → server rules", () => {
  it("has a sample for every opcode with a payload", () => {
    expect(sortedKeys(VALID_MAIN_CLIENT_PAYLOADS)).toEqual(
      ruleOps(mainGatewayClientRules, true),
    );
    expect(sortedKeys(VALID_VOICE_CLIENT_PAYLOADS)).toEqual(
      ruleOps(voiceGatewayClientRules, true),
    );
  });

  it.each(
    Object.entries(VALID_MAIN_CLIENT_PAYLOADS).flatMap(([op, samples]) =>
      samples.map((d) => [Number(op), d] as const),
    ),
  )("main gateway accepts op %s: %j", (op, d) => {
    expect(decodeMainGatewayClientFrame(frame(op, d))).toMatchObject({
      ok: true,
    });
  });

  it.each(
    Object.entries(VALID_VOICE_CLIENT_PAYLOADS).flatMap(([op, samples]) =>
      samples.map((d) => [Number(op), d] as const),
    ),
  )("voice gateway accepts op %s: %j", (op, d) => {
    expect(decodeVoiceGatewayClientFrame(frame(op, d))).toMatchObject({
      ok: true,
    });
  });

  it.each([null, [], "text", 7, true])(
    "every payload opcode rejects a non-object d (%j)",
    (d) => {
      for (const op of ruleOps(mainGatewayClientRules, true)) {
        expect(decodeMainGatewayClientFrame(frame(op, d)).ok).toBe(false);
      }
      for (const op of ruleOps(voiceGatewayClientRules, true)) {
        expect(decodeVoiceGatewayClientFrame(frame(op, d)).ok).toBe(false);
      }
    },
  );

  it("never decodes heartbeats or other payload-less opcodes", () => {
    for (const op of ruleOps(mainGatewayClientRules, false)) {
      expect(decodeMainGatewayClientFrame(frame(op, "junk")).ok).toBe(true);
    }
    for (const op of ruleOps(voiceGatewayClientRules, false)) {
      expect(decodeVoiceGatewayClientFrame(frame(op, "junk")).ok).toBe(true);
    }
  });

  it("keeps the wire limits the rooms enforced before", () => {
    const track = {
      participant_id: "p",
      track_name: "cam-video-p",
      session_id: "s".repeat(201),
      kind: "video",
    };
    const video = (tracks: unknown[]) =>
      decodeVoiceGatewayClientFrame(frame(GatewayOp.Video, { tracks })).ok;
    expect(video([track])).toBe(false);
    expect(video([{ ...track, sfu_track_name: "opaque" }])).toBe(true);
    expect(video([{ ...track, session_id: "s", track_name: "" }])).toBe(false);
    expect(video([{ ...track, session_id: "s", kind: "data" }])).toBe(false);
    expect(
      video(Array.from({ length: 33 }, () => ({ ...track, session_id: "s" }))),
    ).toBe(false);

    const select = (patch: Record<string, unknown>) =>
      decodeVoiceGatewayClientFrame(
        frame(GatewayOp.SelectProtocol, {
          ...(VALID_VOICE_CLIENT_PAYLOADS[
            GatewayOp.SelectProtocol
          ]![0] as object),
          ...patch,
        }),
      );
    expect(select({ pull_tracks: [{ track_name: "x" }] })).toMatchObject({
      ok: false,
      invalid: "Browser SFU negotiation is unsupported",
    });
    expect(select({ media_mode: "sfu" }).ok).toBe(false);
    expect(select({ push_tracks: [] }).ok).toBe(false);
    expect(select({ request_id: "" }).ok).toBe(false);
  });
});

// ── Server → client ────────────────────────────────────────────────────────
// Frames in the shape the Durable Objects send them today.

const PARTICIPANT = {
  id: "p",
  name: "Test",
  self_mute: false,
  self_deaf: false,
  self_stream: false,
  self_video: false,
  suppress: false,
  tracks: [],
};

describe("server → client rules", () => {
  it.each([
    [GatewayOp.Hello, { heartbeat_interval: 15_000, gateway_version: 1 }],
    [GatewayOp.HeartbeatACK, undefined],
    [
      GatewayOp.MediaReady,
      {
        participant_id: "p",
        ice_servers: [{ urls: ["stun:x"] }],
        voice_token: "t",
      },
    ],
    [
      GatewayOp.Ready,
      {
        participant_id: "p",
        ice_servers: [],
        participants: [PARTICIPANT],
        heartbeat_interval: 15_000,
        voice_token: "t",
      },
    ],
    [
      GatewayOp.Resumed,
      { voice_token: "t", ice_servers: [], participants: [] },
    ],
    [
      GatewayOp.VoiceStateUpdate,
      { participant: PARTICIPANT, action: "join", seq: 2 },
    ],
    [
      GatewayOp.VoiceStateUpdate,
      { participant: { id: "p", tracks: [] }, action: "update" },
    ],
    [
      GatewayOp.ProfileUpdate,
      {
        participant_id: "p",
        name: "n",
        display_name: null,
        avatar_url: null,
        avatar_display: null,
      },
    ],
    [
      GatewayOp.Error,
      { code: 4006, message: "Gateway continuity lost; reconcile from REST" },
    ],
    [
      GatewayOp.Dispatch,
      { event: "MESSAGE_CREATE", data: { id: "m" }, seq: 3 },
    ],
  ] as const)("RoomGateway / chat accept op %s", (op, d) => {
    const room = decodeRoomGatewayServerFrame(frame(op, d));
    const chat = decodeChatGatewayServerFrame(frame(op, d));
    // Each client knows only the opcodes it handles; neither rejects a
    // well-formed frame it knows.
    expect(room.ok || room.reason === "unknown-op").toBe(true);
    expect(chat.ok || chat.reason === "unknown-op").toBe(true);
    expect(room.ok || chat.ok).toBe(true);
  });

  it.each([
    [GatewayOp.Hello, { heartbeat_interval: 15_000, gateway_version: 1 }],
    [
      GatewayOp.VoiceReady,
      { participant_id: "p", tracks: [], speaking: { p: 1 }, join_wait_ms: 3 },
    ],
    [
      GatewayOp.SessionDescription,
      {
        sdp: "v=0",
        session_id: "s",
        tracks: [],
        sdp_type: "answer",
        push_prefix: "screen",
        operation: "push",
      },
    ],
    [
      GatewayOp.NegotiationDone,
      { session_id: "s", operation: "push", push_prefix: "screen" },
    ],
    [GatewayOp.Video, { participant_id: "p", tracks: [{ track_name: "t" }] }],
    [
      GatewayOp.Error,
      {
        code: 0,
        message: "m",
        request_id: "r",
        operation: "push",
        push_prefix: "screen",
      },
    ],
    [GatewayOp.Speaking, { participant_id: "p", speaking: 0 }],
    [GatewayOp.ClientDisconnect, { participant_id: "p" }],
    [
      GatewayOp.StopTracks,
      { participant_id: "p", track_names: ["t"], tracks: [] },
    ],
    [GatewayOp.VoiceAppEvent, { type: "listen_together.state", state: {} }],
  ] as const)("VoiceGateway accepts op %s", (op, d) => {
    expect(decodeVoiceGatewayServerFrame(frame(op, d))).toMatchObject({
      ok: true,
    });
  });

  it("ignores opcodes a client does not handle", () => {
    expect(
      decodeVoiceGatewayServerFrame(frame(GatewayOp.Dispatch, {})),
    ).toEqual({
      ok: false,
      reason: "unknown-op",
    });
    expect(decodeChatGatewayServerFrame(frame(4242, {}))).toEqual({
      ok: false,
      reason: "unknown-op",
    });
  });
});

// ── Module boundary ────────────────────────────────────────────────────────

describe("gateway-protocol imports", () => {
  it("uses only Schema from effect and type-only app imports", () => {
    const dir = path.resolve(__dirname, "..");
    for (const file of readdirSync(dir).filter((name) =>
      name.endsWith(".ts"),
    )) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const [, clause, from] of source.matchAll(
        /^import\s+(.+?)\s+from\s+"([^"]+)";/gms,
      )) {
        if (from === "effect") {
          expect(clause, file).toBe("{ Schema }");
        } else if (!from.startsWith("./")) {
          expect(clause.startsWith("type "), `${file}: ${from}`).toBe(true);
        }
      }
    }
  });
});
