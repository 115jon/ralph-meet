# Voice rosters: who is in which voice channel

One authority: the channel's **room object** (`MeetingRoom` named by the room
slug: `voice-<serverId>-<channelId>` or `dm-call-<a>-<b>`). The **global
gateway** (`MeetingRoom` named `global-gateway`) only mirrors each room's roster
into `voiceChannelMembers` for the sidebar (`VOICE_CHANNEL_STATES`,
`VOICE_CHANNEL_STATE_UPDATE`). Nothing a client sends on the global socket adds
or removes a member. Code: `voice-roster.ts` (snapshot, seq, push queue, wire
parsing) and the "Voice rosters" sections of `meeting-room.ts`.

The voice socket does not take part: VoiceRoom's
[reconnect hold](SOCKET_CORE.md#voice-reconnect-hold) keeps a participant's
media through a voice-socket reconnect, and no roster changes either way.

## Event flow

1. A room learns its channel id when it admits a room socket: the socket
   ticket's `channelId` claim (set by `/api/voice/admission`, or the
   deprecated room audience of `/api/voice/socket-ticket`, after its channel
   checks), or, for a server voice slug, the slug minus
   `voice-<serverId>-`. It keeps it in storage (`vc:roster`).
2. The roster is computed from the room's own sessions: one member per user,
   from live non-standby authenticated sessions (`connected`) and sessions held
   for resume within the 120 s grace (`reconnecting`, with `disconnected_at` and
   `reconnect_expires_at`). For a zombie (90 s without heartbeat) both count
   from its last heartbeat, not from when the alarm ended it. A live session beats a held one; between two of a
   kind the newest join wins. Fields: profile (name, username, display name,
   avatar), `self_mute`, `self_deaf`, `self_video`, `self_stream`,
   `self_stream_audio`, spatial flags, `joined_at` (when that session joined:
   Identify or standby promotion), and the roster's `started_at` (when the
   roster last went from empty to non-empty: the earliest `joined_at` at that
   moment; kept while anyone, connected or reconnecting, is on the roster; null
   when it is empty). The room stores the roster it last built (`vc:roster`:
   channel id, seq, members, `started_at`).
3. Every message, close, alarm and internal request ends in
   `flushDirtyStorage`, which recomputes the roster. If it differs from what the
   gateway last acknowledged, the room pushes the whole snapshot to the gateway
   (`POST /voice-roster`). So Identify, Resume, op 15 on the room socket, op 11,
   an abrupt close, a device takeover (4010), a kick (`/disconnect-session`), a
   moderator move, a zombie (90 s without heartbeat) and a lapsed resume grace
   all reach the sidebar the same way.
4. The gateway applies the snapshot (below), stores it (`vc:members:<id>`,
   `vc:source:<id>`), and broadcasts `VOICE_CHANNEL_STATE_UPDATE` to sessions
   that can see the channel, as before (full profiles when a member was inserted
   or a profile changed, else deltas for `supports_voice_state_deltas` clients).
   The same apply answers a ringing call (callee joined the DM's voice: ring
   stops with `accepted`), cancels a ring whose DM emptied (`abandoned`), and
   writes the `ended` call record when an answered call's channel empties.

A moderator move (`POST /api/voice/move`) is now two calls with one effect: the
route records the move grant on the gateway (must precede the client's next
admission, which spends it once for the join), then the source room ends the
user's sessions. That room's roster push
takes them off the sidebar; the former third call (`/voice-move-out` on the
gateway) is gone.

## Ordering and idempotency

- Each snapshot carries `seq`, strictly increasing per room:
  `max(previous + 1, now_ms * 1000)`, with `previous` kept in room storage, so
  a restarted room still counts upwards.
- The gateway applies a snapshot only if `seq` is above the last applied seq
  for that channel. A duplicate (equal seq) only refreshes `confirmedAt`; an
  older one is ignored. Snapshots are whole rosters, so applying the newest is
  always correct and skipping an older one loses nothing.
- A channel belongs to one room: a snapshot for it from another room slug is
  ignored.
- An emptied channel keeps its last seq for 10 min (late deliveries after that
  are not a concern for DO-to-DO requests).
- The gateway tells the room the seq it holds, so a room whose seq fell below
  it (its stored seq was lost and its host's clock is behind the one that made
  the gateway's seq) cannot be ignored for good. The push reply is `{applied,
seq}` (`seq` is absent when the snapshot came from a room that does not own
  the channel). When `applied` is false and `seq` is above the pushed seq, the
  room sets its seq to `max(seq + 1, now_ms * 1000)` and pushes again after the
  first backoff step. The pull body carries `min_seq` (the gateway's seq); a
  room whose seq is below it raises its seq the same way before answering. Both
  answers then pass the normal seq check, so a pull answer that crosses a newer
  push is still ignored.

## Failure and retry

- Pushes from a room go one at a time (`VoiceRosterPusher`), so they arrive in
  seq order. A failed push retries after 250 ms, 1 s, 4 s, 10 s, each time with
  the room's current roster. After that the room sets `retry_at` (now + 30 s)
  and its alarm pushes again, and again 30 s later while it keeps failing.
- The gateway pulls a channel's roster from its room (`POST
/voice-roster-pull`) when no push or pull confirmed it for 60 s (gateway
  alarm), so a push that never landed, or a room that was reset (its sockets
  dropped with no close events), cannot leave a sidebar entry behind for more
  than about a minute. The pull wakes the room, whose constructor rebuilds its
  sessions from surviving sockets and stored held sessions.

## Room reset

A reset of a room object (deploy, uncaught exception, exceeded limit) drops its
sockets with no close events, so none of their sessions is held for resume.
Without more, the room's next start would report an empty roster before any
client is back: the gateway would cancel a ring (`CALL_RING_STOP` `abandoned`,
a missed-call record), write an answered call's `ended` record, and restart
`started_at`.

So on start the room compares the roster it last built (`vc:roster`) with what
survived. A member with no live session and no held session is kept on the
roster as `reconnecting`, with `disconnected_at` set to when the room noticed
(or the member's stored `disconnected_at`, if it was already reconnecting) and
`reconnect_expires_at` 120 s after that. Its profile, voice state and
`joined_at` are the stored ones. The roster is not empty, so `started_at`, the
ring and the call carry on.

- The client's Resume gets 4006 (the session was not held), and it Identifies
  again. Its new session replaces the held entry; after that, a leave removes
  the user as usual.
- If the user is not back within the 120 s, the room alarm drops the entry. A
  roster that empties then has the usual effects: ring cancelled, `ended`
  record, `started_at` cleared.

## Gateway eviction and cold start

The gateway's mirror and per-channel source records (room slug, last seq,
`confirmedAt`, op 15 hints) are in its storage, so eviction or hibernation
loses nothing. On every start the gateway pulls, in the background, each
non-empty channel not confirmed in the last 30 s. Entries stored before this
change (no source record: they came from clients' op 33) are kept for 120 s for
their room to push, then dropped; after a deploy every client reconnects to its
room, which pushes within seconds.

## Old clients: op 33 / 34 / 15 on the global socket

The released mobile app, older desktop builds (their bundled web UI) and older
web tabs still send these. All are accepted with unchanged payload schemas:

- **Op 33 VoiceChannelJoin**: adds nobody, removes nobody, does no D1 access
  check, spends no move grant, answers no ring, and its `started_at` is
  ignored. It records `channel_id` as the session's hint channel (for op 15
  below) and, if the gateway has not heard from that channel's room in 30 s,
  triggers a pull. Any cadence (released mobile builds' 30 s) is fine. On an identified socket
  it sends no Error.
- **Op 34 VoiceChannelLeave**: removes nobody; clears the hint channel; may
  trigger a pull. A client's room-socket op 11 or close is what removes it. On
  an identified socket it sends no Error.
- **Op 33 or 34 before Identify**: unchanged. The gateway answers op 18
  `Error {code: 4003, message: "Not identified"}`, keeps the socket open and
  does nothing else.
- **Op 15 VoiceStateUpdate**: `self_mute`, `self_deaf`, `self_video`,
  `self_stream`, `self_stream_audio` no longer change the sidebar member (the
  room socket's op 15 does). `stream_preview_url`, `spatial_audio_enabled`,
  `spatial_audio_high_fidelity` and `spatial_audio_state` still apply, as hints
  on a member the room reported: in the hint channel if the room has the user
  there, else in the only channel the user is in. The S->C op 15 echo to other
  global sessions is unchanged.

## Wire changes (for client implementers)

- Socket ticket response: unchanged. The ticket now carries a `channelId`
  claim; tickets stay opaque to clients.
- `VOICE_CHANNEL_STATES` and `VOICE_CHANNEL_STATE_UPDATE`: same events, same
  payloads (`channel_id`, `members[]` with the same fields, `started_at`,
  `spatial_audio_state`; profile-less deltas as before). What changes is when
  they are sent: a member appears when the user's room session identifies,
  resumes or is promoted from standby (not on op 33) and goes when the room
  ends it. An abrupt close of the room socket shows `reconnecting`
  (`connected: false`) until a resume or the 120 s grace; a chat (global)
  socket's close no longer touches voice members. Expect one DO-to-DO hop of
  latency after the room event.
- `started_at` (in `VOICE_CHANNEL_STATE_UPDATE`, and `voice_started_at` in
  Ready): set by the room, not by clients. It is when the channel's roster last
  went from empty to non-empty, that is the `joined_at` of the earliest member
  at that moment, in ms since the epoch. It stays the same while anyone is on
  the roster, connected or reconnecting, including members a room reset dropped
  who are back within the 120 s (see "Room reset"). It is `null` in an update
  that empties the channel, and the next first join sets a new one. Before, the
  gateway took it from the first op 33 (or the earliest `started_at` an op 33
  claimed).
- `joined_at` is when that user's current room session joined voice (Identify
  or standby promotion). A user who Identifies again (after a reset, or a
  Resume that got 4006) gets a new `joined_at`.
- DM calls: the caller is no longer put on the DM channel's members when the
  ring starts, nor the callee on op 37 accept; each appears when their room
  session joins. `CALL_RING_STOP` `accepted` also fires when the callee's room
  join arrives during the ring.
- Room socket Identify: of two Identifies of one user, the one that arrived
  last wins. One that arrived earlier but finishes later gets `Error {code:
4010, message: "Voice moved to another device"}` and close 4010, no Ready
  (before, it won and ended the later session with 4010).
- Resume: unchanged wire. A Resume whose socket closes while its subscriptions
  are re-checked leaves the session held for resume, as if it never resumed.
- Web client (this release, and desktop with it): no 30 s op 33 re-send (one op
  33 when the room join completes), and mute/deafen/camera/share go only to the
  room socket's op 15. Preview and spatial fields still go to the global op 15.
  A new client does not need op 33 or op 34 at all.
- Op 33 and op 34 on the global socket: no Error on an identified socket. Op 33
  used to answer a failed access check (no access, or a refused move grant)
  with `Error {code: 4003, message: "Channel not found or access denied"}`; it
  no longer checks. Sent before Identify, either still gets op 18 `Error {code:
4003, message: "Not identified"}`, and the socket stays open.
- Internal only (DO to DO): `POST /voice-roster`, `POST /voice-roster-pull`
  added; `POST /voice-move-out` removed.

## Resume after a reset

`Error {code: 4006, message: "Session not found for resume"}` on the global
gateway means the session was never held: it lives in its socket's attachment
until a close event moves it to the held set, and an object reset (deploy,
exceeded limit, a constructor that throws or runs past 30 s) drops sockets
without close events. The client must Identify again on 4006. The gateway's
constructor used to re-check every session's subscriptions against D1 inside
`blockConcurrencyWhile` on each wake, one query per subscription per session,
which blocks every message meanwhile and can run into the 30 s limit (reset).
That check now runs only for a resuming session.

A Resume of a session that is still live on another socket (the client
changed networks and its old socket's close never arrived) takes the session
over instead: the member stays `connected` throughout, with no leave and no
`reconnecting` step. See "Resume of a session still live on another socket"
in [SOCKET_CORE.md](./SOCKET_CORE.md).
