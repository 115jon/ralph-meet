# Voice rosters: who is in which voice channel

One authority: the channel's **room object** (`MeetingRoom` named by the room
slug: `voice-<serverId>-<channelId>` or `dm-call-<a>-<b>`). The **global
gateway** (`MeetingRoom` named `global-gateway`) only mirrors each room's roster
into `voiceChannelMembers` for the sidebar (`VOICE_CHANNEL_STATES`,
`VOICE_CHANNEL_STATE_UPDATE`). Nothing a client sends on the global socket adds
or removes a member. Code: `voice-roster.ts` (snapshot, seq, push queue, wire
parsing) and the "Voice rosters" sections of `meeting-room.ts`.

## Event flow

1. A room learns its channel id when it admits a room socket: the socket
   ticket's `channelId` claim (set by `/api/voice/socket-ticket` after its
   channel checks), or, for a server voice slug, the slug minus
   `voice-<serverId>-`. It keeps it in storage (`vc:roster`).
2. The roster is computed from the room's own sessions: one member per user,
   from live non-standby authenticated sessions (`connected`) and sessions held
   for resume within the 120 s grace (`reconnecting`, with `disconnected_at` and
   `reconnect_expires_at`). A live session beats a held one; between two of a
   kind the newest join wins. Fields: profile (name, username, display name,
   avatar), `self_mute`, `self_deaf`, `self_video`, `self_stream`,
   `self_stream_audio`, spatial flags, `joined_at` (when that session joined:
   Identify or standby promotion), and the roster's `started_at`.
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
ticket), then the source room ends the user's sessions. That room's roster push
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
  check, sends no Error, spends no move grant, answers no ring, and its
  `started_at` is ignored. It records `channel_id` as the session's hint
  channel (for op 15 below) and, if the gateway has not heard from that
  channel's room in 30 s, triggers a pull. Any cadence (mobile's 30 s) is fine.
- **Op 34 VoiceChannelLeave**: removes nobody; clears the hint channel; may
  trigger a pull. A client's room-socket op 11 or close is what removes it.
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
  socket's close no longer touches voice members. `started_at` is the room's
  first join; `joined_at` is the user's room join time. Expect one DO-to-DO hop
  of latency after the room event.
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
