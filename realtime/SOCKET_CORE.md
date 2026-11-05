# Socket core and per-role opcode tables

Yap has three realtime sockets. Two Durable Object classes serve them, and
`realtime/socket-core.ts` holds what they share. This document lists which
client opcodes each socket accepts and the evidence for each entry. A client,
native ones included, should build from these tables. Keep this file in step
with `SOCKET_ROLE_OPCODES` in `socket-core.ts`. The test
`realtime/__tests__/socket-core.worker.test.ts` checks the tables against the
lists below.

## Roles

| Role   | Durable Object                   | Upgrade path                | Ticket audience | Ticket from                                  |
| ------ | -------------------------------- | --------------------------- | --------------- | -------------------------------------------- |
| global | `MeetingRoom` `"global-gateway"` | `/api/gateway`              | `global`        | `POST /api/voice/socket-ticket`              |
| room   | `MeetingRoom` named by its slug  | `/api/channels/:slug/ws`    | `room`          | `POST /api/voice/admission` (`room_ticket`)  |
| voice  | `VoiceRoom` named by its slug    | `/api/channels/:slug/voice` | `voice`         | `POST /api/voice/admission` (`voice_ticket`) |

One admission request returns both call tickets and the participant's voice
credentials; [ADMISSION.md](./ADMISSION.md) is the contract. The room and
voice audiences of `/api/voice/socket-ticket` still work for clients up to
v3.12.0 and mobile-v0.5.1 and are deprecated.

The room's slug decides a `MeetingRoom`'s role. A room that has not learned
its slug yet (no socket admitted since its storage was written) accepts both
MeetingRoom tables, which is how every MeetingRoom behaved before roles.

## What the core does, in order

For each upgrade:

1. **Admission.** The worker (`custom-server-entry.ts`) verifies the ticket's
   HMAC and forwards its claims as `x-ralph-realtime-*` headers. The object
   checks that the audience and room match. A mismatch returns 401, and the
   nonce is not spent there. Admission tickets also carry `media` (room) and
   `participant` (voice), forwarded as `x-ralph-realtime-media` and
   `x-ralph-realtime-bound-participant`; what the objects do with them is in
   ADMISSION.md.
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

## Voice reconnect hold

A participant's PartyTracks session (its peer connection to the SFU)
outlives its voice socket, and a voice-socket reconnect keeps the
`participant_id` (the reconnect's ticket is bound to it, see
[ADMISSION.md](ADMISSION.md)). So VoiceRoom does not withdraw a
participant's tracks when only the socket went away
(`VOICE_RECONNECT_HOLD_MS` = 5000 ms in `voice-room.ts`).

**Hold.** It starts when an identified voice socket closes or errors
without the participant's `ClientDisconnect` (op 11), and when a
`VoiceIdentify` (op 100) names a participant that still has a row (its old
socket closed and held, or still open; the old socket is then closed with
`1000 "Replaced by new connection"`). Each time:

- `participants.held_until` = now + 5000 ms, and every track of the
  participant is marked `held`.
- If it was speaking: `Speaking` `{participant_id, speaking: 0}` (op 5) to
  the others at once.
- A native screen share (tracks without `sfu_track_name`) is closed at
  once, as before: `StopTracks` (op 13) for those tracks only, and the
  stream watchers of the participant go with it (a `stream.watch.snapshot`
  if that changed them), as for any stopped `screen-` track.
- Nothing else: no `ClientDisconnect` (op 11), no `StopTracks` for its
  PartyTracks tracks. The row, its PartyTracks tracks and (without a native
  share) its stream watchers stay.

While held, a joiner's `VoiceReady` (op 101) lists the held tracks.

**Release.** A `Video` (op 12) from the participant's new connection
records the offered tracks as before (same `track_name`: the row is
replaced) and clears their `held` mark; the op 12 is broadcast as before,
unchanged offers included.

**Expiry** (the alarm, at `held_until`):

- The participant has identified again: `StopTracks` (op 13) for its tracks
  still marked `held` (those it did not offer again), if any. No op 11.
- It has not: the purge a leave does. `ClientDisconnect`
  `{participant_id}` (op 11), then `StopTracks` (op 13) for all its tracks,
  and the row is deleted.

**Not held.** Op 11 on the voice socket, `/disconnect-participant` (a room
leave or a kick, also during a hold), a device takeover or move
(`SessionReplaced`), a revoked join grant and a zombie (90 s without
heartbeat) purge at once, as before: op 5 (if speaking), op 11, op 13.

**Before** (VoiceRoom up to v3.13.0): every voice-socket close, and every
`VoiceIdentify` of a participant that had a row, purged at once (op 5 if
speaking, op 11, op 13 for every track), and the new connection's op 12
offered the same tracks again a moment later. Shipped clients closed their
audio pull on that op 13 and pulled again on the op 12. Web and desktop
from v3.0.0 and mobile from mobile-v0.1.0 (their `offerTracks`) ignore an
op 12 that repeats a track they already pull with the same metadata, and
move the pull when its `session_id` or `sfu_track_name` differs; none
needs an op 11 before a re-offer. All of them re-announce their
publications after `VoiceReady` on a voice reconnect.

## Resume of a session still live on another socket

Global and room sockets (`MeetingRoom`). A client that changes networks
(Wi-Fi to mobile data, a new address) loses its old socket without a close
reaching the server: the TCP connection is half open, so the session stays
live (not held for resume) until the zombie alarm ends it 90 s later.

A `Resume` (op 7) whose `session_id` names a session that is live on
another socket of this object is handled like a Resume of a held session,
with the same checks:

- **Subject.** The resuming socket's admission subject must equal the
  session's. Otherwise: `Error {code: 4008, message: "Resume subject
mismatch"}` and close `4008`. The live session and its socket are not
  touched. (Participant ids are visible to the room, so the id alone proves
  nothing.)
- **Replay cursor** (`seq_ack`), as for a held session. If continuity is
  lost: `Error {code: 4006}`, and the live session is left as it is. The
  client's Identify that follows replaces it (one voice session per user),
  or the zombie alarm ends it.
- No resume grace applies: the session never closed.

If both pass, the session moves to the resuming socket:

- The old socket's attachment forgets the session, and the old socket is
  closed with `4006 "Session resumed on another connection"`
  (`RESUMED_ELSEWHERE_REASON` in `@ralph/protocol`). No Error frame is sent
  on it.
- Nothing a close would do happens: no `PRESENCE_UPDATE`, no call cleanup,
  no voice-grant change, no `VoiceStateUpdate` leave, and the room's roster
  never shows the member as reconnecting.
- The participant id, voice state and voice join order are kept. The new
  socket gets the replay and `Resumed` (op 9) as for any resume, and the
  room hears a `VoiceStateUpdate` `update` for the participant, as for any
  resume.

A socket mid-resume (its own Resume has not finished) is not taken over;
the second Resume gets `4006 "Session not found for resume"`.

**Before** (up to v3.13.0): such a Resume got
`Error {code: 4006, message: "Session not found for resume"}`. The client
Identified as a new participant and rebuilt its call, and the old session
stayed on the roster until the zombie alarm or the new Identify replaced
it.

**Old clients.** A client only resumes on a new socket after it has left
the old one, so it never reads the old socket's close. No shipped client
(web and desktop up to v3.13.0, mobile up to mobile-v0.5.1) acts on close
code 4006 or on its reason: a client that did hear it would retry and
resume as after any drop. The native client treats a 4006 close as
SessionInvalid and Identifies fresh; that is only reachable when another
device of the same user resumed its session id, and the fresh Identify
then replaces that device (4010). Clients act on close
codes 4008 and 4010, and on `1000 "Replaced by new connection"` (the voice
socket's), which this close is none of.

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
  36, 39. Main no longer sends 15 (the mute/deafen mirror) and sends 33 once
  per room `Ready` instead of every 30 s; released builds still send both.
- room (`features/voice/gateways.ts`): 0, 3, 7, 11, 15, 40.
- voice (`features/voice/gateways.ts`, `features/voice/connection.ts`): 100,
  3, 5, 11, 12, 13, 106, 109.

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
