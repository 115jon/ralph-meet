# Voice session state machine

This is the contract every Yap voice client follows: the web client (through
`@ralph/voice`), the Expo app (once it adopts this package) and the native
Rust client. `src/state-machine.ts` is the same table as code; the two must
agree. Where this document says MUST, a client that does otherwise breaks
something another client or the server relies on.

A **session** is one user's presence in one voice room: a room socket
(MeetingRoom, `/api/channels/:slug/ws`), a voice socket (VoiceRoom) and one
PartyTracks media session. A client has at most one session per call surface
at a time. The server allows one voice session per user per room (the newest
join wins; the older one is closed with 4010 SessionReplaced).

## Phases

| phase          | owns a client | "joined" for the UI | meaning                                                                                        |
| -------------- | ------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `idle`         | no            | no                  | No session.                                                                                    |
| `standby`      | no (borrowed) | no                  | A pre-connected standby client is held. See [Standby](#standby).                               |
| `connecting`   | yes           | no                  | A client was started (or a standby promoted) and the room has not said `Ready` (op 2).         |
| `joined`       | yes           | yes                 | The room said `Ready` for this participant.                                                    |
| `reconnecting` | yes           | yes                 | Joined, and a socket or the peer connection dropped. Roster and media are kept.                |
| `leaving`      | no            | no                  | A teardown ran; the client is inside its leave send window and is no longer the session's own. |

"There is a session" means `connecting`, `joined` or `reconnecting`
(`isLivePhase`). "The user is in the call" means `joined` or `reconnecting`
(`isJoinedPhase`). Clients MUST derive both from the phase and nothing else.

## Events

| event                 | raised by the platform when                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `hold-standby`        | it takes a reference to a warmed standby client for this channel.                                                                         |
| `release-standby`     | it lets that reference go.                                                                                                                |
| `start`               | the user joins: a new client is created, or the held/claimed standby client is promoted.                                                  |
| `joined`              | the room socket's `Ready` (op 2) arrives, or a promoted standby replays the `Ready` snapshot it kept.                                     |
| `connection-lost`     | the room socket closes unexpectedly, or the peer connection state becomes `disconnected` or `failed`.                                     |
| `connection-restored` | the room socket resumes (`Resumed`, op 9), the voice socket is ready again (`VoiceReady`, op 101), or the peer connection is `connected`. |
| `end(reason)`         | a teardown starts; `reason` is `user-leave`, `forced-disconnect` or `component-unmount`.                                                  |
| `drained`             | the last pending leave's send window is over and its client disconnected (raised by the session itself).                                  |

## Transitions

Rows are the current phase, columns the event; a cell is the next phase.
`-` means the event does not apply: it is ignored and nothing changes (in
particular a refused `start` creates nothing and claims nothing).

| from \ event   | hold-standby | release-standby | start         | joined    | connection-lost | connection-restored | end(user-leave / unmount) | end(forced) | drained |
| -------------- | ------------ | --------------- | ------------- | --------- | --------------- | ------------------- | ------------------------- | ----------- | ------- |
| `idle`         | `standby`    | -               | `connecting`  | -         | -               | -                   | -                         | -           | -       |
| `standby`      | -            | `idle`          | `connecting`  | -         | -               | -                   | `idle` (reference only)   | `leaving`   | -       |
| `connecting`   | -            | -               | -             | `joined`  | -               | -                   | `leaving`                 | `leaving`   | -       |
| `joined`       | -            | -               | -             | `joined`¹ | `reconnecting`  | -                   | `leaving`                 | `leaving`   | -       |
| `reconnecting` | -            | -               | -             | `joined`  | `reconnecting`  | `joined`            | `leaving`                 | `leaving`   | -       |
| `leaving`      | `standby`²   | -               | `connecting`² | -         | -               | -                   | -                         | -           | `idle`³ |

1. A second `Ready` while joined (the room socket could not resume and
   identified again) re-syncs the roster. It is not a new join: no
   "connected" sound, no new presence join.
2. A leave's send window does not block a new session. The leaving client
   keeps draining on its own timer and still reports `left` when its plan
   says so; the new session is unaffected.
3. Only when no other leave is still draining.

`start` while a session is live is refused. Clients MUST check for that
before they claim a standby (claiming takes it from the pool).

## Standby

Decision: standby is **its own phase**, and a standby client is **borrowed**.

A standby is a session warmed for an occupied channel before the user joins:
the room socket identifies with `standby: true` (op 0), a silent track is
published, and the voice socket is opened but **not** identified (no
`VoiceIdentify`, op 100), so the voice room never offers it anyone's tracks
and never announces its silence. The standby pool (web:
`src/lib/voice/voice-standby.ts`) creates, owns and disposes these clients;
a voice session only holds a reference.

- `hold-standby` / `release-standby` take and drop that reference. Releasing
  never disconnects the client: the pool decides (it disposes a standby when
  its last holder lets go and nobody claimed it).
- Joining **claims** the standby from the pool (ownership moves to the
  session) and raises `start` with that client. The client then replays the
  `Ready` snapshot it kept while warm (which raises `joined`), sends
  `VoiceStateUpdate` (op 15) with `promote_standby: true` plus the current
  `self_mute`/`self_deaf`, and identifies its voice socket. From `start` on it
  is an owned client like any other and ends through the normal teardown.
- `end(user-leave)` and `end(component-unmount)` in `standby` only drop the
  reference (no sounds, no presence, no `left`).
- `end(forced-disconnect)` in `standby` runs the forced teardown of an
  unjoined session on the borrowed client: the pool disposes it first (web:
  `dropVoiceStandby`), the session's disconnect of it is then a no-op, and
  `left` is reported after the send window as for any forced end.

## Teardown

There is exactly one teardown (`VoiceSession.end`). The three ways a session
ends only choose its **plan**:

| reason              | was joined | leave sound | leave trigger | send window | release client   | `left`      | presence leave |
| ------------------- | ---------- | ----------- | ------------- | ----------- | ---------------- | ----------- | -------------- |
| `user-leave`        | yes        | unless call | yes           | 100 ms      | after disconnect | unless call | yes            |
| `user-leave`        | no         | no          | no            | 0           | now              | no          | no             |
| `forced-disconnect` | yes        | unless call | yes           | 100 ms      | after disconnect | yes         | yes            |
| `forced-disconnect` | no         | no          | no            | 100 ms      | after disconnect | yes         | no             |
| `component-unmount` | yes        | no          | yes           | 100 ms      | now              | no          | yes            |
| `component-unmount` | no         | no          | no            | 0           | now              | no          | no             |

- _was joined_: the phase was `joined` or `reconnecting` when `end` ran.
- _leave sound_: the local "disconnected" sound. A 1:1 call (`isCall`) skips
  it: the call gateway plays the call-end sound.
- _leave trigger_: the automatic soundboard leave sound, sent as a
  `VoiceAppEvent` (op 106) on the voice socket. This is why the sockets stay
  open for the **send window** (100 ms, `LEAVE_SEND_WINDOW_MS`) before the
  client disconnects.
- _release client_: when the platform stops exposing the client (web: the
  hook's `sfu` value that stats and call surfaces read).
- _`left`_: the app is told the session is over (web: `onLeft`). It fires
  only after the client disconnected, so an app that joins another channel
  on `left` (web: `useJoinVoiceAfterLeave`, which waits for the app's
  `voiceJoined` to go false) never overlaps the old sockets. A user leave
  from a 1:1 call does not report `left`: the call store ends the call.
- _presence leave_: `VoiceChannelLeave` (op 34) on the chat gateway, for
  channel sessions (not anonymous rooms).

`forced-disconnect` is what every server-initiated end becomes (below). In
the web client it also comes from the window event `force-voice-disconnect`
(a ban or server kick, or the takeover and move handlers below), which every
mounted voice session handles.

### Order

Every step runs even if an earlier one failed (failures are reported, not
thrown). For one teardown:

1. **Phase.** The phase becomes `leaving` (or `idle` when a standby
   reference is only dropped, which ends the teardown here). The client stops
   being the session's client at once: a second `end`, a join or a stale
   async callback that checks "is this still my client?" sees that it is not.
2. **Announce** (sockets still open). The leave sound, then the leave
   trigger. The platform may hand back a callback for step 7.
3. **Unsubscribe.** Every handler the session registered on the client is
   removed, so no late event (a `Ready`, a remote track, a stall) touches the
   torn-down state.
4. **Local media.** In this order: the camera background effect and its raw
   camera capture; the VAD gate binding (`setGateController(null)`); the VAD
   monitor stream; the published audio processor (noise suppression / gate
   graph); an early processor still being built; every local track
   (microphone, camera, screen; `onended` cleared first so stopping them
   raises nothing); the capture owners (pending `getUserMedia` requests are
   invalidated, so one that resolves later is stopped, not published).
5. **Session state and store.** The local participant id, speaking state,
   the roster map and participant-to-user map, remote stream aggregators,
   thumbnail captures; then the UI store reset (web: the `LEFT` reducer
   action: not joined, connection `disconnected`, no participants, streams,
   thumbnails, watchers or screen share); then the presence leave when the
   plan says so.
6. **Release client** when the plan says `now`.
7. **Disconnect**, after the send window (or at once when it is 0):
   `client.disconnect(reason)`. In order, it: stops the page-wake listener
   and the credential refresh timer; rejects pending readiness waits; sends
   `ClientDisconnect` (op 11, `d: {}`) on the room socket, then on the voice
   socket; closes the room socket, then the voice socket; disposes the
   PartyTracks session (its peer connection and every pull and
   publication); disposes native screen capture; stops the VAD and the
   playback graph; forgets the participant id, voice token, ICE servers and
   any kept standby snapshot. Then the step 2 callback (web: reset the
   automatic soundboard session). Then **release client** when the plan says
   `after-disconnect`. Then **`left`** when the plan says so. Then, if no
   other leave is draining and no new session started, the phase becomes
   `idle`.

Local media is released before the sockets close in every path, and the
platform's own per-session timers (thumbnail captures, intervals keyed on
`joined`) stop through steps 4–5 and the UI store reset.

### Idempotency

- `end` in `idle` or `leaving` does nothing and returns `none`. Leaving
  twice, a forced disconnect during a leave, or an unmount after a leave all
  run one teardown.
- `client.disconnect` MUST be idempotent (a forced end of a standby the pool
  already disposed relies on it).
- `end(component-unmount)` first **completes** every pending leave: their
  timers are cleared and step 7 runs for each at once (disconnect, release,
  `left`). Nothing is cancelled, so an unmount inside a send window cannot
  leave sockets open.
- A leave inside the send window of an earlier one is a no-op unless a new
  session started in between; then it ends that new session.

## Server-initiated ends

All of these end the session with `forced-disconnect`. None of them may
reconnect, resume or rejoin on its own.

| what arrives                                                                                                  | client event         | then                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| room socket closed with 4010 SessionReplaced, or voice socket closed 4010 / 1000 "Replaced by new connection" | `kicked`             | Joined on another device: notify the user, `end(forced-disconnect)`.                                                                                                                                |
| room `VoiceMove` (op 42), then 4010 with reason "Moved to another voice channel"                              | `voice-move`         | The app switches to the target channel (normal leave + join). If nothing takes the move: `end(forced-disconnect)`. A voice-socket move close with no `VoiceMove` within 5 s is treated as `kicked`. |
| a socket's ticket refused twice in a row (401)                                                                | `auth-failed`        | Notify, `end(forced-disconnect)`. Only if this session's client is still the current one.                                                                                                           |
| a socket closed with 4008 AdmissionRejected                                                                   | `admission-rejected` | Same as `auth-failed`. Not raised while leaving or after a move.                                                                                                                                    |

A voice-token rejection (4004 in an `Error` frame on the voice socket) is
not an end: the client asks the room socket for fresh credentials
(`RefreshVoiceCredentials`, op 40). A failed resume (4006 SessionInvalid on
the room socket) is not an end either: the room socket identifies again and
the next `Ready` re-syncs the roster (`joined` while joined).

## Reconnecting

`reconnecting` is informational: it keeps the roster and media and changes
nothing on the wire. The sockets reconnect on their own backoff
(`packages/realtime/src/policy.ts`: 500 ms base, 10 s cap, ×0.5–1 jitter). A
teardown from `reconnecting` is a joined teardown (leave trigger, presence
leave, send window).

After the voice socket is ready again (`VoiceReady`, op 101) the client
re-announces its publications (`Video`, op 12) or, if the media session has
none, republishes its local tracks.

## Remote participants

### Reconnect grace

When a remote participant's **voice** socket reconnects, VoiceRoom purges
the old connection's state and broadcasts `ClientDisconnect` (op 11, `d: {
participant_id }`) for them, and also sends `Speaking` 0 if they were
speaking, **before** their new connection re-announces its tracks (`Video`,
op 12, offered to others as tracks). The same happens when their old socket's
close is processed after the new one identified. So a `ClientDisconnect` for
a remote participant does not mean they left.

Rule: on a remote `ClientDisconnect`, a client MUST keep that participant's
roster row and audio for a grace period of `REMOTE_RECONNECT_GRACE_MS`
(3000 ms) before dropping them, and MUST cancel the drop if the same
`participant_id` offers tracks again within it. Speaking MAY be cleared at
once. Whether a participant left the **room** is decided only by the room
socket (`VoiceStateUpdate` op 15 with `action: "leave"`, or their absence
from a `Ready`/`Resumed` roster), never by the voice socket.

Web today: roster rows already follow the room socket only, so they never
flicker; pulled media is dropped at once on `ClientDisconnect` and pulled
again when the tracks are re-offered. Holding the audio through the grace is
the publication/reconnect follow-up, not this package's first version.

### Voice-state deltas

Room sockets identify with `supports_voice_state_deltas: true` (op 0). For
those clients a `VoiceStateUpdate` (op 15) with `action: "update"` carries a
**delta**: `id`, `user_id`, `tracks` and the state fields (`self_mute`,
`self_deaf`, `self_video`, `self_stream`, `self_stream_audio`, `suppress`,
`status`, `platform`, `stream_preview_url`, `spatial_audio_enabled`,
`spatial_audio_high_fidelity`), but **no** `name`,
`username`, `display_name`, `avatar_url` or `avatar_display`. Names and
avatars come only from full participant states: the `Ready` roster (op 2),
`Resumed` (op 9), `action: "join"`, and `ProfileUpdate` (op 16).

So a client MUST merge a delta over the row it already has, and MUST drop a
delta for a participant it has no row for (it cannot render a nameless
row); the next full state creates it. A full state (one with `name`) may
create a row.

## What this package does not change

Nothing on the wire: the ticket flow, `media_bootstrap`, gateway ops 0, 2,
7, 9, 11, 12, 13, 15, 33, 34, 40, 100 and 101, close codes 4004, 4006, 4008
and 4010, and PartyTracks request bodies are exactly as before. The package
only decides when the existing messages are sent.
