# Socket core and per-role opcode tables

Yap has three realtime sockets. Two Durable Object classes serve them, and
`realtime/socket-core.ts` holds what they share. This document lists which
client opcodes each socket accepts and the evidence for each entry. A client,
native ones included, should build from these tables. Keep this file in step
with `SOCKET_ROLE_OPCODES` in `socket-core.ts`. The test
`realtime/__tests__/socket-core.worker.test.ts` checks the tables against the
lists below.

## Roles

| Role   | Durable Object                   | Upgrade path                | Ticket audience |
| ------ | -------------------------------- | --------------------------- | --------------- |
| global | `MeetingRoom` `"global-gateway"` | `/api/gateway`              | `global`        |
| room   | `MeetingRoom` named by its slug  | `/api/channels/:slug/ws`    | `room`          |
| voice  | `VoiceRoom` named by its slug    | `/api/channels/:slug/voice` | `voice`         |

The room's slug decides a `MeetingRoom`'s role. A room that has not learned
its slug yet (no socket admitted since its storage was written) accepts both
MeetingRoom tables, which is how every MeetingRoom behaved before roles.

## What the core does, in order

For each upgrade:

1. **Admission.** The worker (`custom-server-entry.ts`) verifies the ticket's
   HMAC and forwards its claims as `x-ralph-realtime-*` headers. The object
   checks that the audience and room match. A mismatch returns 401, and the
   nonce is not spent there.
2. **Single use.** The object spends the nonce in its
   `realtime_ticket_nonce_uses` table. If the nonce is already spent or the
   ticket has expired, the upgrade gets 401.
3. **Accept.** The socket is accepted under the Hibernation API with its
   admission in the serialized attachment. The server sends Hello
   `{"op":8,"d":{"heartbeat_interval":15000,"gateway_version":<v>}}`. The
   101 response carries `Sec-WebSocket-Protocol: ralph.realtime.v1`
   (`SOCKET_PROTOCOL_NAME`).

For each frame:

1. **Text only:** binary → `4000 "Text websocket frames are required"`.
2. **Size:** more than 1,000,000 UTF-8 bytes →
   `4000 "Websocket frame is too large"`.
3. **JSON object with numeric `op`:** `4002 "Invalid JSON"` or
   `4001 "Missing opcode"`.
4. **Access-mode gate** (each object's own):
   - room, public-demo admission: only opcodes 0, 3, 7, 11, 15 and 40 →
     otherwise `4003`.
   - voice, a socket whose participant has reconnected elsewhere: its
     mutating opcodes are dropped without a reply.
5. **Role table:** an opcode outside the socket's table →
   `4001 "Unknown opcode: <op>"`, or `"Unknown voice opcode: <op>"` on
   voice. An opcode no role knows (999) gets the same reply.
6. **Rate limit:** per opcode, per session and per subject, in fixed
   60-second windows → `4290 "Operation rate limit exceeded"`.
7. **Payload decode** (`packages/protocol/src/client-payloads.ts`) → `4000`
   with the rule's message.
8. **Refused fields:** `promote_standby` on op 15 on the global socket →
   `4000 "promote_standby is not accepted on the global socket"`.

Every Error frame is `{"op":18,"d":{"code":<n>,"message":"..."}}`.

**Liveness.** Clients send `{"op":3}` every `heartbeat_interval`. A socket
not heard from for 90 s (six intervals) is ended by the object's alarm. The
last-heard time is never kept only in memory, so it survives hibernation:

- main sessions: `last_heartbeat` in the socket attachment;
- unidentified voice sockets: `last_seen_at` in the attachment;
- identified voice participants: `participants.last_heartbeat` in the
  VoiceRoom's SQLite.

**Broadcast.** Only identified sockets receive room broadcasts.
MeetingRoom's session map holds identified sessions only. VoiceRoom
broadcasts through `broadcastToIdentified`, which skips sockets that have not
sent VoiceIdentify.

## Opcode tables (client → server)

| Op  | Name                    | global | room | voice |
| --- | ----------------------- | :----: | :--: | :---: |
| 0   | Identify                |   ✓    |  ✓   |       |
| 1   | SelectProtocol          |        |      |   ✓   |
| 3   | Heartbeat               |   ✓    |  ✓   |   ✓   |
| 5   | Speaking                |        |      |   ✓   |
| 7   | Resume                  |   ✓    |  ✓   |       |
| 11  | ClientDisconnect        |   ✓    |  ✓   |   ✓   |
| 12  | Video                   |        |      |   ✓   |
| 13  | StopTracks              |        |      |   ✓   |
| 15  | VoiceStateUpdate        |   ✓¹   |  ✓   |       |
| 17  | ProfileRefresh          |   ✓    |  ✓   |       |
| 20  | MessageCreate           |   ✓    |      |       |
| 21  | MessageUpdate           |   ✓    |      |       |
| 22  | MessageDelete           |   ✓    |      |       |
| 23  | TypingStart             |   ✓    |      |       |
| 24  | ReactionAdd             |   ✓    |      |       |
| 25  | ReactionRemove          |   ✓    |      |       |
| 26  | PresenceUpdate          |   ✓    |      |       |
| 27  | ChannelSubscribe        |   ✓    |      |       |
| 28  | ChannelUnsubscribe      |   ✓    |      |       |
| 33  | VoiceChannelJoin        |   ✓    |      |       |
| 34  | VoiceChannelLeave       |   ✓    |      |       |
| 35  | ServerSubscribe         |   ✓    |      |       |
| 36  | CallInitiate            |   ✓    |      |       |
| 37  | CallAccept              |   ✓    |      |       |
| 38  | CallDecline             |   ✓    |      |       |
| 39  | CallEnd                 |   ✓    |      |       |
| 40  | RefreshVoiceCredentials |        |  ✓   |       |
| 100 | VoiceIdentify           |        |      |   ✓   |
| 102 | TracksReady             |        |      |   ✓   |
| 106 | VoiceAppEvent           |        |      |   ✓   |
| 109 | TrackUnavailable        |        |      |   ✓   |

¹ Without `promote_standby`. On the global socket op 15 sets the member's
stream preview and spatial-audio fields on the sidebar. Mute, deafen, camera
and share go on the room socket.

Rate limits (per minute):

- global: 20, 21 and 22 at 30; 24 and 25 at 60; 36 at 6; 37, 38 and 39 at
  12; 15 at 60.
- room: 15 at 60.
- voice: 1 at 20, 12 at 20, 13 at 40, 102 at 60, 106 at 60, 109 at 30.

## Evidence

The tables hold every opcode that a shipped client sends on that socket.
They also hold the global chat opcodes (20–25), which no current client
sends over the socket (chat goes through REST). Only the global gateway
handles them: MeetingRoom refused op 20 elsewhere, and 21–25 act on
persisted channel messages, which belong to the global gateway.

**Web** (`src/`, v3.0.0 through main; older web builds bundled in desktop
releases send the same set):

- global (`src/stores/chat-gateway.ts`): 0, 3, 7, 15, 26, 27, 28, 33, 34,
  35, 36, 37, 38, 39.
- room (`src/lib/voice/gateways/room-gateway.ts`, `src/lib/sfu-client.ts`):
  0, 3, 7, 11, 15, 17, 40.
  - Builds up to v3.12.0 also defined `SFUClient.sendChatMessage` (op 20 on
    the room socket). Nothing called it, and the room already refused op 20
    with `4000 "This gateway cannot create persisted channel messages"`.
- voice (`src/lib/voice/gateways/voice-gateway.ts`, `src/lib/sfu-client.ts`,
  `src/lib/voice/native-screen-share-transport.ts`): 100, 3, 1, 5, 11, 12,
  13, 102, 106, 109.
- Builds before v3.0.0 also sent voice opcodes the server dropped long ago
  (Answer, IceRestart, ResetPullSession). They are outside every table, as
  before.

**Mobile** (`apps/mobile/src`, mobile-v0.1.0 through main):

- global (`features/realtime/gateway.ts`): 0, 3, 15, 26, 27, 28, 33, 34, 35,
  36, 39.
- room (`features/voice/gateways.ts`): 0, 3, 7, 11, 15, 40.
- voice (`features/voice/gateways.ts`, `features/voice/session.ts`): 100, 3,
  5, 11, 12, 13, 106, 109.

**Native client spec** (`desktop-native/VOICE_PROTOCOL.md` on
`spike/qt-desktop`):

- global: 0, 3, 33, 34 (optional sidebar presence).
- room: 0, 3, 7, 11, 15, 17, 40.
- voice: 100, 3, 1, 5, 11, 12, 13, 102, 106, 109.

## What role gating changed on the wire

These opcodes were processed or ignored on the socket before. Now they get
the unknown-opcode error:

- room socket: 20 (previously `4000 "This gateway cannot create persisted
channel messages"`), 21–28, 33–39. Before, 33 and 34 were ignored with no
  reply. The others ran against the room object: calls rang inside the
  room, presence and subscriptions changed the room's sessions, and message
  edits, deletes and reactions reached D1.
- global socket: 40. It minted a voice token and TURN credentials for a
  global session.
- global socket, op 15 with `promote_standby` set: `4000`. It was a no-op
  for every shipped client. A global session identified with `standby`,
  which no client creates, was promoted and announced to the gateway.

No client listed above sends any of these on the socket concerned.

Not changed: everything a client sends on its own socket, including every
reply byte. The voice socket's table is exactly its decoder's, so voice
replies are unchanged. One exception on voice: the frame cap now counts
UTF-8 bytes, as MeetingRoom always did, instead of UTF-16 code units. A
voice frame of 1,000,000 or fewer code units but more than 1,000,000 bytes
now gets `"Websocket frame is too large"`.
