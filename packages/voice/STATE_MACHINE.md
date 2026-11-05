# Voice session state machine

This is the contract every Yap voice client follows: the web client (through
`@ralph/voice`), the Expo app (`apps/mobile`, also through it) and the native
Rust client. `src/state-machine.ts` is the same table as code; the two must
agree. Device choice, fallback, persistence and output routing are in
[DEVICES.md](DEVICES.md); screen sharing and watching shares are in
[SCREEN_SHARE.md](SCREEN_SHARE.md). Where this document says MUST, a client that does otherwise breaks
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
   identified again) re-syncs the roster. The phase stays `joined` and no
   "connected" sound plays. The client still re-announces itself as on a
   first `Ready`: it re-sends the presence join (`VoiceChannelJoin`, op 33,
   on the chat gateway) and the automatic "join" soundboard trigger, because
   the server may have dropped both with the old room session.
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
  client disconnects. A platform with no leave trigger (the Expo app) passes
  `leaveTrigger: false`: no trigger and a send window of 0 in every row, so
  the client disconnects within the teardown, in the same turn as the app's
  own release of the call (a phone's call service and audio session), and
  the OS cannot suspend it in between with the room still holding it.
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
4. **Local media.** In this order: the screen share module (it releases its
   captures, now and any still in flight, and withdraws nothing; see
   [SCREEN_SHARE.md](SCREEN_SHARE.md#teardown)); the camera background effect and its raw
   camera capture; the VAD gate binding (`setGateController(null)`); the VAD
   monitor stream; the published audio processor (noise suppression / gate
   graph); an early processor still being built; every local track
   (microphone, camera; `onended` cleared first so stopping them
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
(`RefreshVoiceCredentials`, op 40). Credentials come from the join's one
admission request (`realtime/ADMISSION.md`); a room `Ready` or `Resumed`
after that carries none, so the client keeps them and refreshes them with op
40 45 minutes after they arrived. A failed resume (4006 SessionInvalid on
the room socket) is not an end either: the room socket identifies again and
the next `Ready` re-syncs the roster (`joined` while joined).

## Reconnecting

`reconnecting` is informational: it keeps the roster and media and changes
nothing on the wire. The sockets reconnect on their own backoff
(`packages/realtime/src/policy.ts`: 500 ms base, 10 s cap, ×0.5–1 jitter). A
teardown from `reconnecting` is a joined teardown (leave trigger, presence
leave, send window).

Each socket's reconnect asks `/api/voice/admission` for its own ticket only
(`sockets: ["room"]` or `["voice"]`, `media: false`): one request, no new
credentials. After the voice socket is ready again (`VoiceReady`, op 101)
the client re-announces its publications (`Video`, op 12) or, if the media session has
none, republishes its local tracks through a
[connection reset](#reconnect-republish) of the publication reconciler.

## Publication

`src/publication.ts`. One **publication reconciler** per client owns what the
client publishes on its microphone, camera and screen share. It is the only
code that publishes, replaces or unpublishes those; every other path (the
first publication after a join, a device or settings change, a camera
toggle, a screen share starting, restarting or stopping, an outbound-stall
recovery, the republish after a voice reconnect, unmute replacing a promoted
standby's silence) only changes the **intent** and asks for a **reconcile**.
The `screen` slot holds a share's tracks as one value, published and
withdrawn together; a native share (published by its own pipeline) is
**adopted** there so that withdrawing it is still the reconciler's
`unpublish`. Only the share module (`src/screen-share.ts`,
[SCREEN_SHARE.md](SCREEN_SHARE.md)) sets it. Getting the tracks (`getUserMedia`, audio processors, camera effects) is
the platform's job; the reconciler only receives the finished track. Which
device to open, when to open it again and what to save are in
[DEVICES.md](DEVICES.md) (`src/devices.ts`).

### Inputs

- **Intent**, per slot (`microphone`, `camera`, `screen`): `track` (the
  track to publish, or none; for `screen`, a share's tracks) and `enabled`
  (whether it sends: the microphone's mute; for `screen`, the share's audio).
  The platform sets them with `setTrack(slot, track)` and
  `setEnabled(slot, enabled)`.
- **Applied**, per slot, kept by the reconciler for the current connection:
  the track it last published or swapped in (or none once unpublished) and
  the `enabled` it last applied to it. A slot with no record is **unknown**:
  nothing was done on this connection yet, or a swap found no publication.
- **Published?**, per slot, asked of the media session (web: SFUClient has a
  live publication for `cam-audio-<participant>` /
  `cam-video-<participant>` / `screen-video-<participant>`). It is only consulted for a slot with **no
  record** on this connection. Once this connection unpublished a slot, the
  slot is "none" whatever the media session reports: a camera withdrawn with
  a keepalive keeps its sender, and a platform MAY report it as published.
  Consulting it there would plan `unpublish` forever.

### Operations

The platform's media interface, all of which may fail:

| operation              | web (SFUClient)                                 | wire                                                                          |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `publish(slot, track)` | `publishTracks(stream, "cam")`                  | PartyTracks push (or resume of a withdrawn one), announced as `Video` (op 12) |
| `replace(slot, track)` | `replaceTrack(name, track)`; false: none exists | none (`RTCRtpSender.replaceTrack`)                                            |
| `unpublish(slot)`      | `unpublishTrack(name)`                          | `StopTracks` (op 13); a camera's SFU track is kept alive (`keepalive`)        |
| `setEnabled(slot, on)` | `setPublishedTrackEnabled(name, on)`            | none                                                                          |
| `isPublished(slot)`    | `getPublishedTrack(name) !== null`              | none                                                                          |

On `screen`: `publish` and `replace` are `publishTracks(stream, "screen")`
with the share's live tracks (a published or kept-alive share has its
sources swapped), and do nothing for an adopted native share; `unpublish`
is `stopTracks([screen-video-<id>, screen-audio-<id>])` in one call (the
video kept alive, `StopTracks` op 13 for names PartyTracks does not hold);
`setEnabled` acts on `screen-audio-<id>`.

`publish` on a slot that is already published (or withdrawn and kept alive)
MUST act as a swap of its source, so publishing twice is harmless; PartyTracks
does that (`publishStream`). The camera's simulcast encodings are chosen by
the platform when it first pushes the camera, as before.

### Plan

For each slot, microphone first (what peers hear matters most), then
camera, then screen:

| intent    | applied on this connection | published? | operations                  |
| --------- | -------------------------- | ---------- | --------------------------- |
| none      | a track                    | not asked  | `unpublish`                 |
| none      | none (unpublished)         | not asked  | nothing                     |
| none      | unknown                    | yes        | `unpublish`                 |
| none      | unknown                    | no         | nothing                     |
| track _T_ | _T_                        | not asked  | `set-enabled` if it differs |
| track _T_ | another track              | not asked  | `replace`, `set-enabled`    |
| track _T_ | unknown, or none           | not asked  | `publish`, `set-enabled`    |

`planPublication` is this table as a pure function. A `set-enabled` applies
the intent's `enabled` **as it is when the operation runs**, not when it was
planned.

### Running

- One run at a time per connection. `reconcile()` starts a run, or joins the
  one in flight, and resolves when a plan comes out empty (`converged`), the
  retry budget is spent (`failed`) or the reconciler is disposed
  (`disposed`).
- Operations run one after another. Before each one the run checks whether
  a slot's intended track changed (`setTrack`); if it did, it plans again
  from what is applied now. (A mute needs no re-plan: see `set-enabled`
  above and [Mute](#mute).) After the last operation it always plans again;
  it ends only on an empty plan. So a caller that set an intent and awaited
  `reconcile()` sees `converged` only once the **latest** intent is on the
  wire, which may no longer be its own (see generations).
- A successful `publish` or `replace` records the track as applied with
  `enabled` unknown, so the next plan applies `enabled`. A successful
  `unpublish` records none. A `replace` that finds no publication records the
  slot as unknown, so the next plan publishes; this is not a failure.

### Retry and backoff

A failed operation (it threw or rejected) counts one failure. Under
`PUBLICATION_RETRY` (3 attempts, 150 ms base, doubling, 1000 ms cap) the run
waits 150 ms after the first failure and 300 ms after the second, then plans
again; the third failure in a row **sets that slot aside** for the rest of
the run, and the run carries on with the other slots (so a microphone that
cannot publish does not keep a camera or a screen share off the wire, or a
stopped share published). When the plan for the remaining slots comes out
empty, the run ends as `failed` with the first set-aside operation and its
error, and `failedSlots` listing every set-aside slot; otherwise
`converged`. The intent is kept. A `setTrack` on a set-aside slot gives it a
fresh budget in the same run. The count resets when a plan comes out empty,
when the budget is spent, and on a connection reset. A `setTrack` or
`reconcile()` during a wait ends the wait at once (the count is kept).
Callers decide on their own slot: web treats a `failed` run as its failure
only when `failedSlots` includes the slot it changed. After `failed`,
nothing retries on its own: the next `reconcile()` or connection reset
starts a fresh run.

### Generations

There is one generation model. It replaces the web client's separate
counters (a local media generation that every mute bumped, and the
initial-publication tokens).

- **Connection generation.** Moves on every `connectionReset()`. An operation
  result is recorded only if its connection is still the current one; a run
  of an older connection stops at its next step without touching anything.
- **Slot intent generation.** Moves when a slot's intended **track** changes
  (`setTrack` with a different track, or `adopt` filling an empty intent).
  `setEnabled` never moves it. A caller that sets an intent keeps the
  generation it got (`generation`) and after awaiting asks
  `isCurrent(generation, slot)`: true means its track is still the one
  wanted (and, after `converged`, published); false means another caller
  replaced it and the caller MUST NOT commit (and releases what it built for
  it). A connection reset does not end a caller's intent: the same intent is
  published again on the new connection.

### Mute

`setEnabled(slot, enabled)` updates the intent and, if this connection has a
track applied on the slot, applies it **at once** (even while a run is in
flight on that slot). It moves no generation, so a mute or unmute never
cancels or restarts a first publication, a device swap, an outbound-stall
recovery or a reconnect republish. If a `publish` or `replace` is in flight,
the run applies the then-current `enabled` to the new track after it lands.
On web, mute is also not an input of the capture sync any more: muting does
not reopen the microphone.

### Adopt

`adopt(slot, track)` records a track that something else already published
on this connection as applied (web: a promoted standby's silence), and takes
it as the intent if the slot wants nothing yet. Swapping in the live
microphone is then a `replace`, never a second publication.

### Reconnect republish

When the voice socket is ready again and the media session has no
publications (web: `voice-reconnected`, raised from `VoiceReady` op 101),
the platform calls `connectionReset()` and `reconcile()`. Applied state is
forgotten (the new media session has nothing), the retry budget is reset, a
run of the old connection is abandoned (its late results are ignored), and a
new run publishes every wanted track afresh, microphone first, each followed
by `set-enabled` with the current mute. A first publication that was still in
flight when the reset came is published again on the new connection; the
capture sync that asked for it commits it once that run converges. If the
media session kept its publications the client only re-announces them
(`Video`, op 12) and the reconciler is not involved.

### Ownership on web

`useVoiceChannel` creates the reconciler for a client on first use and
disposes it in teardown step 4 (local media), before the client disconnects.
The capture sync keeps its own **capture generation** for what it acquires
(a newer capture sync or camera toggle drops an older one's captures). When
a capture run is dropped after it set an intent, it hands each slot whose
intent is still its own back to the session's **committed** track and waits
for that to be published again before releasing its tracks. The committed
track is the live one the session last committed: for the microphone the
published audio processor's output, else the capture track, else a promoted
standby's silence; for the camera the committed camera track; none if that
track has ended. Never the intent it displaced: that may belong to another
dropped run and be released already. A device-swap failure after the retry
budget, and a stall recovery that is no longer wanted or failed, do the
same.

## Remote participants

### Reconnect hold (server)

When a remote participant's **voice** socket reconnects, VoiceRoom holds
their tracks instead of withdrawing them
([realtime/SOCKET_CORE.md](../../realtime/SOCKET_CORE.md#voice-reconnect-hold),
`VOICE_RECONNECT_HOLD_MS`, 5000 ms). What others receive:

- At once: `Speaking` (op 5) with `speaking: 0` if they were speaking, and
  `StopTracks` (op 13) for a native screen share's tracks only (that
  publisher starts a new Calls session after a reconnect).
- If they identify again within the hold and offer the same tracks
  (`Video`, op 12, the same `track_name`, `session_id` and
  `sfu_track_name`): that op 12 and nothing else. **No** `ClientDisconnect`
  (op 11) and **no** `StopTracks` (op 13). An unchanged offer of a track
  that is already pulled MUST leave the pull as it is (no gap).
- If they offer a track again with another `session_id` or
  `sfu_track_name` (their PartyTracks session was rebuilt): that op 12;
  the client moves the pull to it.
- Tracks they have not offered again when the hold runs out (counted from
  their new `VoiceIdentify`): one `StopTracks` (op 13) for those only. No
  op 11.
- If they do not identify again within the hold (5000 ms after the close):
  `ClientDisconnect` (op 11) and `StopTracks` (op 13) for all their tracks,
  as for a leave.
- A leave is not held: their op 11 on the voice socket, a room leave, a
  move, a kick or a takeover gives op 11 and op 13 at once.

So a client receives a re-offer of tracks it already has, without a
`ClientDisconnect` before it, and keeps pulling them. A participant who
joins during a hold is offered the held tracks in its `VoiceReady`.

VoiceRoom up to v3.13.0 purged at once on every voice-socket close and on
every `VoiceIdentify` of a participant it already had: op 11 and op 13 for
all their tracks, **before** the new connection re-announced them. The
client grace below was written for that, and still covers a reconnect that
takes longer than the hold.

### Reconnect grace (client)

A `ClientDisconnect` for a remote participant does not mean they left the
room.

Rule: on a remote `ClientDisconnect`, a client MUST keep that participant's
roster row and audio for a grace period of `REMOTE_RECONNECT_GRACE_MS`
(3000 ms) before dropping them, and MUST cancel the drop if the same
`participant_id` offers tracks again within it. Speaking MAY be cleared at
once. Whether a participant left the **room** is decided only by the room
socket (`VoiceStateUpdate` op 15 with `action: "leave"`, or their absence
from a `Ready`/`Resumed` roster), never by the voice socket.

`RemoteReconnectGrace` (`src/remote-participants.ts`) is this rule with
injected timers:

- `disconnected(id)` on a voice `ClientDisconnect` for a remote participant:
  start the grace (a second one restarts it and forgets what was offered
  during the first).
- `offered(id, trackName)` for every track offered by a participant
  (`Video`/track offer, op 12, and the track list of our own `VoiceReady`,
  op 101): inside a grace it is recorded as offered again.
- `left(id)` when the room socket says they left: the grace is cancelled and
  the client drops them at once.
- When the grace runs out, `expire(id, reoffered)`: if nothing was offered
  again, everything of theirs is dropped (pulls and pending offers); else
  only their tracks that were not offered again are.
- `dispose()` at teardown cancels every grace without dropping anything.

Web: roster rows follow the room socket only, so they never flicker.
SFUClient clears the participant's speaking at once and keeps their pulls
through the grace. A track offered again with the same SFU track keeps its
pull running (no gap); one with a new SFU track moves the pull to it. A
`StopTracks` still closes an audio pull (and parks a video one) inside the
grace; with the server's hold that only happens once the hold has run out.

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

Nothing on the wire: the ticket flow (since replaced by one admission
request per join, `realtime/ADMISSION.md`), `media_bootstrap`, gateway ops
0, 2, 7, 9, 11, 12, 13, 15, 33, 34, 40, 100 and 101, close codes 4004, 4006, 4008
and 4010, and PartyTracks request bodies are exactly as before. The package
only decides when the existing messages are sent.
