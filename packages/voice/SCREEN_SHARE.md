# Screen share

How a Yap client shares its screen and watches other people's shares. The
web client follows it through `src/screen-share.ts` (`ScreenShare`) and the
`screen` slot of the publication reconciler (`src/publication.ts`); the
native Rust client MUST follow the same rules. The session around it is in
[STATE_MACHINE.md](STATE_MACHINE.md). Where this document says MUST, a
client that does otherwise breaks something another client or the server
relies on.

A client has at most one share per session. One `ScreenShare` owns it: it
is created for the session's client and disposed by the session's teardown.

## Track names

| track                           | carries                                       | published by                                     |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `screen-video-<participant_id>` | the share's video, one layer (no simulcast)   | the reconciler (browser path) or the native pipe |
| `screen-audio-<participant_id>` | the source's audio, when the share carries it | the same, alongside the video                    |

The prefix is `screen` (camera and microphone use `cam`). A share is
single-layer: only the camera is pushed with simulcast encodings. The voice
state reports the share as `self_stream` (sharing) and `self_stream_audio`
(the share carries audio), sent on the room socket (`VoiceStateUpdate`,
op 15) whenever either changes.

## Paths

A share is captured and published one of two ways. The platform injects
both as **sources**; the module decides which one runs.

- **Native**: the native pipeline captures, encodes (hardware H.264) and
  publishes the share by itself. Web desktop: the Rust publisher behind
  `NativeScreenShareTransport`, which negotiates over the voice socket
  (`SelectProtocol` with `push_prefix: "screen"`, then `TracksReady`) and
  sends source audio from WASAPI loopback. Its loopback is fixed when it
  starts, so its audio cannot change in place.
- **Browser**: the platform's media stack captures the source (web: CEF
  desktop capture of a picked window or monitor, or `getDisplayMedia` with
  the system picker) and the reconciler publishes the tracks (web:
  PartyTracks).

A request uses the native path when it prefers it (`preferNative`; false
after a native share lost its connection) and the native source says it is
**eligible** (web: a picked desktop source that is not a capture device,
and a hardware H.264 encoder was found).

## States

| phase        | meaning                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `off`        | No share.                                                                                                        |
| `starting`   | The first capture is in flight. Nothing was announced.                                                           |
| `live`       | A share is captured and published, and nothing is in flight.                                                     |
| `restarting` | A share was announced and a new capture for it is in flight (a new source, or a native audio or quality change). |
| `stopping`   | The share is being withdrawn and released, or a stop waits for the capture in flight to land.                    |

The UI shows a share as on (`self_stream`) from its `started` event to its
`ended` event, not from the phase: during `restarting` peers still see the
old share (browser path) or the native pipeline's last frames.

## Commands

Commands only change what is **wanted**; they never run media work
themselves.

| command                 | wanted becomes                                     |
| ----------------------- | -------------------------------------------------- |
| `start(request)`        | `request`, with a new token (always a new capture) |
| `stop()`                | nothing                                            |
| `setAudio(on)`          | the wanted request with `audio: on`                |
| `toggleAudio()`         | `setAudio(!wanted.audio)`                          |
| `setQuality(q)`         | the wanted request with `quality: q`               |
| `captureEnded(capture)` | nothing, if `capture` is the live one (see below)  |

`setAudio`, `toggleAudio` and `setQuality` do nothing while nothing is
wanted (there is no audio or quality preference outside a share).

A request is `{ source, sourceKey, quality, audio, preferNative }`.
`sourceKey` identifies the picked source across requests (web: the desktop
source id) and is null when the system picker chooses.

## Serialization

One driver applies the wanted share, **one step at a time**. A command that
arrives while a step is in flight only changes what is wanted; when the
step lands the driver compares the wanted share with the live one and takes
the next step. So restarts never overlap, and any number of commands during
a step collapse into the latest (rapid audio toggles cause at most one more
restart, with the last value).

The next step, checked in this order:

1. The live capture ended by itself (`captureEnded`): if the wanted share
   is still that capture's (same token; only its audio or quality may have
   changed), nothing is wanted any more, with reason `source-ended`. A newer
   `start` queued meanwhile stays wanted and replaces the dead capture
   (step 4).
2. Nothing wanted and a share is live: **end** it.
3. Something wanted and nothing live: **start** it.
4. The wanted token is not the live one: **replace** it (below).
5. Wanted `audio` differs from the live share's: **change audio**.
6. Wanted `quality` differs: **change quality**.
7. Otherwise the driver is idle (`live` or `off`).

Transitions. Rows are the phase, columns what happens; "after" means the
command only changes what is wanted and the driver acts on it when the step
in flight lands.

| from \ event | `start(r)`                                     | `stop()`   | `setAudio` / `setQuality`                                                                  | step lands | step fails                                |
| ------------ | ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------- |
| `off`        | `starting`                                     | -          | -                                                                                          | -          | -                                         |
| `starting`   | after: `restarting` once the first one is live | `stopping` | after                                                                                      | `live`     | `off` (`ended`, `failed`)                 |
| `live`       | `restarting` (native quality-only: in place)   | `stopping` | browser: in place; native audio: `restarting`; native quality: in place, else `restarting` | -          | -                                         |
| `restarting` | after                                          | `stopping` | after                                                                                      | `live`     | `live` (swap kept the old share) or `off` |
| `stopping`   | after: `starting` once the end is done         | -          | -                                                                                          | `off`      | `off`                                     |

`captureEnded` of the live capture acts as `stop()` with reason
`source-ended`, when the driver next looks, unless a newer `start` is
wanted by then (that start runs instead). A restart in flight decides on
its own: it replaces the capture, or finds it dead and ends the share.

### Start

1. If the request prefers native and the native source is eligible: start
   the native pipeline.
   - It throws: stop the pipeline (idempotent). If a browser fallback is
     allowed (web: WGC capture is allowed, not the hook-exclusive policy)
     and the share is still wanted, capture through the browser path;
     otherwise the start **fails**.
   - It resolves but the pipeline is not active: stop the pipeline anyway
     (idempotent; web: this clears the options the transport would start
     again after a voice reconnect), release the capture, and the start
     **fails**, with no fallback (the pipeline answered and then went
     away).
2. Otherwise capture through the browser path; a throw (including the user
   cancelling the picker) **fails** the start.
3. If the capture is no longer the wanted one when it lands (its token is
   not the wanted token):
   - Browser: it is released and never published, whether the share was
     stopped or a newer `start` replaced it. The driver goes on with what
     is wanted now (a newer start runs as its own capture; nothing is
     announced for this one).
   - Native, replaced by a newer `start`: the pipeline is stopped (it
     withdraws what it pushed), the capture released, and the newer start
     runs.
   - Native, stopped: it is on the wire already, so it is recorded and
     ended like a live share (`ended`, not announced).
4. Publish:
   - Native: the reconciler **adopts** a fresh `{ kind: "native" }` on the
     `screen` slot (nothing is sent: the pipeline published it).
   - Browser: the reconciler's `screen` intent becomes a fresh
     `{ kind: "tracks", video, audio }` with `enabled` = whether the capture
     has audio, and the module awaits `reconcile()`. If the slot does not
     hold it afterwards (the retry budget ran out), the start **fails**.
     Then the platform applies the quality to the capture and its sender.
5. The share is live. Its audio is what it carries: native, the requested
   flag; browser, whether the capture has an audio track. If the user did
   not change audio meanwhile, the wanted audio becomes that too (so a
   capture without audio never reports `self_stream_audio`). `started` is
   emitted (`restarted` when a share was live before).

### Replace (a new `start` while sharing)

- **Native, same source, only quality differs**: the pipeline switches
  quality in place. If it cannot, a full restart.
- Otherwise a full restart on the new request: like **Start**, with the old
  share as "previous":
  - If the new request takes the native path (it prefers native and the
    source is eligible) and the old share is a **browser** share, the old
    share is **withdrawn first** (the `screen` intent becomes nothing and
    the module awaits `reconcile()`: web, `stopTracks` with both names, the
    video parked on its keepalive, see "Keepalive park and reuse"), then
    its capture is released, and only then does the pipeline start. The
    pipeline publishes the same track names itself, so one publisher holds
    them at a time; a browser publication left beside it would be
    announced again on the next voice reconnect over the native one. If
    the pipeline then fails and the browser fallback runs, the fallback
    capture is published on the slot afresh (web: on the kept-alive
    video); any other failure ends the share.
  - Otherwise, if the platform says the new capture cannot run beside the
    old one (web: any picked desktop source, since WGC and the native hook
    capture a source once), the old capture is **released first** (native:
    the pipeline is stopped). Nothing is withdrawn: viewers keep the
    share's SFU track.
  - Otherwise (web: `getDisplayMedia`) the old capture is kept until the
    new one is ready, then released, then the new tracks are published.
  - A **swap** restart whose capture fails while the old capture is still
    live keeps the old share: the wanted share goes back to it and
    `restart-failed` is emitted. Any other failure ends the share.

### Audio

- Browser: in place. The `screen` slot's `enabled` becomes the new value
  (web: `screen-audio-<id>`'s track `enabled`), and the share reports it.
  A capture without an audio track still reports what the user chose.
- Native: a restart on the same source and quality with `audio` flipped,
  because the loopback is fixed when the pipeline starts. This is the only
  way to actually turn native share audio on or off.

### Quality

- Browser: in place (web: `applyConstraints` on the capture and the
  sender's `maxBitrate`/`maxFramerate`).
- Native: in place if the pipeline can (`update_native_screen_quality`);
  otherwise a restart with the new quality.

### End

`stop()`, the capture ending by itself, or a failure:

1. A native pipeline is stopped (web: `stop_native_screen_share`, and the
   transport's own `StopTracks`, op 13, for the tracks it offered).
2. The `screen` intent becomes nothing and the module awaits `reconcile()`:
   the reconciler **unpublishes** the slot if this connection published or
   adopted it (web: `stopTracks([screen-video-<id>, screen-audio-<id>])`
   in one call: PartyTracks withdraws what it holds, and `StopTracks`,
   op 13, carries the names it does not hold).
3. The local capture is released (every local track stopped).
4. `ended` is emitted with the reason (`stopped`, `source-ended`, `failed`)
   and whether the share had been announced. The web client plays the stop
   sound only for an announced `stopped`.

A start that fails before anything was published withdraws nothing.

## Failure

Every failure resets to `off` with the capture's tracks stopped and the
slot withdrawn, except a swap restart that kept the old share. Covered:

| failure                                                                             | then                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| native start throws, fallback not allowed                                           | pipeline stopped; `off`; unpublish if it was live                                                                   |
| native start resolves inactive                                                      | pipeline stopped (its reconnect options cleared); no fallback; `off`; unpublish if it was live                      |
| native start throws, browser fallback throws                                        | `off`; unpublish if it was live                                                                                     |
| browser capture throws (cancelled, no source)                                       | first start: `off`; swap restart: old share kept; release-first restart (a picked desktop source): `off`, unpublish |
| browser publish runs out of retries                                                 | capture released; `off`; unpublish                                                                                  |
| a newer `start` arrived while a start failed                                        | the newer one runs; the failed one is dropped                                                                       |
| `stop()` and a newer `start` while a browser capture was in flight                  | the old capture is released, never published or announced; the newer one runs (cancelled: `off`)                    |
| a newer `start` while a native capture was in flight                                | the old pipeline is stopped and its capture released, never announced; the newer one runs                           |
| the live capture ended while a newer `start` was queued                             | the newer one runs and replaces the dead capture                                                                    |
| native restart over a browser share fails, no fallback                              | the browser share was withdrawn and released before the pipeline started; `off`                                     |
| a native share cannot reconnect after a voice reconnect                             | see "Reconnect": the platform falls back to the browser path or ends the share                                      |
| `stop()` arrived while a native start failed                                        | no fallback; `off`                                                                                                  |
| `stop()` or a newer `start` during the eligibility probe or a release-first release | nothing is captured for the old request                                                                             |
| the microphone or camera runs out of retries in the same reconcile run              | the `screen` slot still converges (STATE_MACHINE.md, "Retry and backoff")                                           |

## Keepalive park and reuse

Stopping a browser share withdraws its video publication but keeps the
same SFU track pushed, sending a keepalive (web: `video-keepalive.ts`,
`PartyTracksMediaManager.unpublishTrack`). Its audio is closed. Sharing
again publishes on the kept track (`publishStream` resumes it), so the next
share announces the **same** SFU track and viewers' pulls carry on without
renegotiating. If the keepalive stalled long enough that the SFU may have
dropped the track, the share is pushed afresh instead.

The reconciler converges with the keepalive: once this connection
unpublished the slot it is "none" even though the media session still
reports the kept sender (see STATE_MACHINE.md, "Plan"). A restart of a live
share is a swap of its sources on the same publications (`replace`), never
a withdraw, except a restart from a browser share onto the native path
(see "Replace"): that one withdraws the browser publication first, so its
video is parked like a stop. A parked sender is never announced while it
is parked (not on publish metadata, not on a reconnect's re-announce), so
the native pipeline's own SFU track is the only one under the names while
it runs. When the native share ends, its names are withdrawn as usual, and
the next browser share resumes the parked track: browser, native, browser
still announces the first browser share's SFU track again.

## Reconnect

When the voice socket is ready again with no publications, the reconciler's
connection reset republishes the `screen` slot with the microphone and
camera (browser path: the same tracks on fresh publications). A native
share reconnects through its own transport; the reconciler's `publish` of
the adopted native value does nothing, but records it, so stopping the
share later still withdraws both names.

A native reconnect (web: `NativeScreenShareTransport.reconnect`) starts the
pipeline again with the options it last started with:

- Nothing to bring back (the share was stopped, or never started): nothing
  happens.
- The share's owner stopped, restarted or reset the pipeline meanwhile, or
  the transport was disposed: the reconnect gives up quietly (that command
  owns the pipeline now).
- The pipeline could not come back on its own: it is stopped, its options
  are cleared (nothing retries it), and the client reports it like the
  native pipeline's own `connection-failed` end (web: the client's
  `native-screen-share-ended` event; the desktop backend emits nothing for
  a stop the renderer made). The platform acts on it only while the live
  share is a native one: if a browser fallback is allowed it restarts the
  same request through the browser path (`start` with `preferNative`
  false), otherwise it stops the share.

## Teardown

Leaving ends the share through the session teardown (STATE_MACHINE.md,
step 4): the module is disposed, which releases the live capture and any
capture still in flight when it lands, emits nothing and withdraws nothing.
The client's disconnect then disposes the media session (every
publication) and the native transport (which stops the pipeline). The UI
store reset clears the share state.

## Watching

A viewer pulls a remote share by these rules (`screenShareSubscription`; "on stage" is the share's tile or the participant's camera, so the share's own tile on stage is always audible):

| input                                 | `screen-video-<id>` | `screen-audio-<id>` | audible                      |
| ------------------------------------- | ------------------- | ------------------- | ---------------------------- |
| not watched, not on stage             | not pulled          | pulled              | no                           |
| watched (pressed Watch)               | pulled              | pulled              | if on stage or "always hear" |
| the share's tile on stage             | pulled              | pulled              | yes                          |
| the participant's camera on stage     | as watched          | pulled              | yes                          |
| "always hear" set for the participant | as watched          | pulled              | yes                          |

- Share audio is always pulled (a few kbps); toggling its transceiver
  inactive and back made it read silence, so audibility is only volume.
- **Once pulled, a share's video stays pulled until the share ends**, even
  after the viewer stops watching: the SFU cannot pull a closed slot again.
  Stopping watching only hides it. (Web: `PartyTracksMediaManager` keeps a
  share pull once it exists.)
- Watching is announced to others as a voice app event
  (`VoiceAppEvent`, op 106: `stream.watch.start` / `stream.watch.stop` with
  `streamer_user_id`), and the server's watcher snapshots drive the
  watcher list. On web the watch state (which shares the viewer watches,
  optimistic intents awaiting the next snapshot) stays in the hook: it is
  UI state with no media lifecycle, and only the pull rule above is shared.

## What this does not change

Nothing on the wire: the same `SelectProtocol`/`TracksReady`/`StopTracks`
messages for native shares, the same PartyTracks pushes for browser shares
(one `publishStream` call per share, the same `screen` prefix and track
names), the same `stopTracks` call with both names on stop, the same voice
state fields and the same watch app events. One sequence differs: a restart
from a browser share onto the native path sends the browser share's
`StopTracks` (one per name, from the `stopTracks` withdrawal) before the
pipeline's `SelectProtocol`, where it used to send nothing and leave the
browser publication up beside the native one.
