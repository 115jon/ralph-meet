# Devices

How a Yap voice client picks, opens, keeps and saves its microphone, camera
and speaker. `src/devices.ts` is these rules as pure functions; this
document and that file must agree. The web client, the Expo app (once it
adopts this package) and the native Rust client implement the platform side
(listing devices, opening them, routing audio) and follow these decisions.
Where it says MUST, a client that does otherwise loses or overwrites the
user's choice.

The package only decides. Listing devices (web: `enumerateDevices()`),
opening them (`getUserMedia`), routing output (`setSinkId`), watching for
changes (`devicechange`) and building audio processors stay on the
platform. Device changes reach peers only through the
[publication reconciler](STATE_MACHINE.md#publication): a new capture hands
it a new track; nothing here publishes.

## Inputs

- **Saved choice**, per kind (microphone, camera, speaker): `deviceId`,
  `label`, `groupId` as the user picked it (`SavedDevice`). `deviceId` is
  `"default"` (or empty) for **System default**, which follows the OS.
- **Device list**, per kind (`ListedDevice[]`): what the platform lists now.
  It is in one of three states:
  - **readable**: entries have ids and labels;
  - **hidden**: there are entries but none has both an id and a label
    (`isHiddenDeviceList`). Browsers do this before the page has media
    permission. Desktop CEF grants capture per request and records nothing,
    so every desktop launch starts hidden until the first capture;
  - **unavailable** (`null`): the platform cannot list at all.
    An **empty** list is readable: there are no devices of that kind.
- **Selection counter**, per kind: moves on every pick in the device menu or
  settings, **including picking the device already saved** (which writes
  identical settings). Not persisted. Web: `deviceSelectionRevision` in
  `useVoiceSettingsStore`, bumped by `setDevice`.

## Matching a saved device

`matchSavedDevice(list, saved)`, in this order:

1. **System default** saved: no match (nothing to find).
2. **By id**: an entry with the saved id. Skipped for a desktop-native id
   (`native:…`): CEF never lists those, only their label or group can find
   the browser's endpoint.
3. **By label**: among physical entries (not `default` or `communications`,
   which alias a real endpoint), the label equal to the saved one after
   trimming and lower-casing. Two with the same label: the one with the
   saved `groupId`, else the first.
4. **By groupId**: among physical entries with the saved `groupId`, the only
   one; or, when several share it, the only one whose label overlaps the
   saved label (one contains the other: Windows decorates names, e.g.
   "Microphone (Shure MV7)" vs "Shure MV7").
5. Otherwise not listed.

Step 4 exists because one sound card's Microphone, Line In and Stereo Mix
share a `groupId` on Windows. A client MUST NOT pick between such siblings on
the group alone: with no label match among several group members, the
device is not listed.

`listedDeviceId(list, saved)` is the id of the match, or null.

## Which device to open

`resolveSavedDevice(saved, list)`:

| saved          | list                      | outcome      | open                      |
| -------------- | ------------------------- | ------------ | ------------------------- |
| System default | any                       | `default`    | the platform default      |
| a device       | hidden or unavailable     | `unverified` | the saved id, as it is    |
| a device       | readable, saved is listed | `listed`     | the listed (maybe new) id |
| a device       | readable, not listed      | `missing`    | the system default        |

A hidden list says nothing about whether the saved device exists, so the
saved id is tried blind instead of being swapped for the default.

`captureTarget(id)`: a concrete id is required **exactly** (web:
`deviceId: { exact }`); the default is left to the platform (no device
constraint).

### When opening fails

`captureErrorAction(error)`:

| error (web name)                        | action                                         |
| --------------------------------------- | ---------------------------------------------- |
| `OverconstrainedError`, `NotFoundError` | open the system default instead (**fallback**) |
| `NotAllowedError`                       | permission denied: surface it, no retry        |
| anything else                           | the capture fails                              |

**Reopen after unlock.** When an `unverified` open fell back to the default,
that fallback capture granted permission, so the list is readable now. The
client looks the saved device up again (only for the kinds that were
unverified; ids already verified are kept). If any kind then has a concrete
id (a verified id, `listed`, or still `unverified`), it opens once more with
those ids; a kind whose device is now `missing` is opened as the default in
that same capture. If that works, the fallback capture is stopped and the
reopened one is used. If no kind has a concrete id, or the reopen fails, the
fallback capture is kept.

## Keeping a capture

A capture sync first asks whether the live capture already is what the user
wants. If it is, nothing is opened.

`liveCaptureMatches` (device), per kind. The live capture is kept when any
of these holds:

1. System default is saved (any device answers it);
2. the track opened the saved id;
3. the track opened the id the saved device is listed under now (a
   refreshed id);
4. the track is a **fallback** opened for this same saved id and nothing
   moved since: its `CaptureRecord` (saved id, listed id and selection
   counter at the time it was opened) equals the current saved id, listed
   id and selection counter.

So an unrelated sync (camera quality, a background) never reopens a
fallback, and a fallback is reopened when the saved device is listed
differently (plugged back in, or the list unlocked) or the user picks a
device again. **Re-picking the device that is already open does nothing**
(rule 2 holds); re-picking while on a fallback retries the saved device.

The platform also requires: the track is live; for the microphone, its
applied capture processing equals [what is wanted](#capture-processing)
(`captureProcessingMatches`) and the published processor is the one the
settings ask for; for the camera, the same quality and background effect.
A standby's silence still published while unmuted is never kept.

`captureAnswersRequest` is the same decision for the platform's capture
cache (web: `local-media-manager`), which reuses its active stream for a
request when: the list is hidden and the stream was opened for this same
saved id (whatever device it got); or the saved device is `missing` and the
stream was opened for this saved id (its fallback); or the stream is on the
resolved device (any device for the default). A missing device's request
from a capture opened for another choice is never answered by it.

## When to capture again

A client runs a capture sync when any of these change (web: the dependency
list of the capture effect in `useVoiceChannel`):

| trigger                                                  | why                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| the session's client (a new session, a promoted standby) | the first capture of a session                                                                                                       |
| a kind's saved choice (id, label or groupId)             | the user picked another device, or a refreshed id was saved                                                                          |
| a kind's selection counter                               | the user picked a device again (retries a fallback)                                                                                  |
| a kind's `fallbackRetryId`                               | while a fallback is live, the id the saved device is listed under: it changes when the device is plugged back in or the list unlocks |
| camera on/off, camera quality, background effect         | the camera capture or its effect changes                                                                                             |
| audio processing settings or input profile               | [capture processing](#capture-processing) or the processor changes                                                                   |
| a microphone appears (none listed → some)                | a mic plugged in mid-call is opened                                                                                                  |
| unmute while a promoted standby's silence is published   | no live microphone was opened while muted; open one now                                                                              |

`fallbackRetryId(fellBack, listedId)` is `listedId` while the live capture
is a fallback and null otherwise, so ordinary list changes (the list
unlocking after a capture that already opened the saved device, another
device plugged in) do not restart anything. A sync that runs and finds
everything kept (above) does nothing.

Mute is **not** a trigger: muting never reopens the microphone (see
[Mute](STATE_MACHINE.md#mute)).

### Capture processing

`captureProcessingFor(settings)` is what the microphone is opened with:

| settings                   | noise suppression | echo cancellation | auto gain |
| -------------------------- | ----------------- | ----------------- | --------- |
| high fidelity (stereo)     | off               | off               | off       |
| RNNoise on (and supported) | off               | setting           | on        |
| otherwise                  | setting           | setting           | on        |

These are capture constraints: when a live capture's applied values differ,
the device is opened again. Processor-level settings (RNNoise, the
sensitivity gate, which the **Studio** input profile turns off, so the
microphone is published directly) do not reopen the device: the sync keeps
the capture and builds the processor they ask for, then hands its output to
the reconciler.

## What is saved

After a capture is committed, `captureOutcome(saved, opened)` (with
`opened` the track's actual device id, label and groupId):

- **persist**: `deviceToPersist` — an id to write back, with the opened
  label and groupId, or nothing. Only a **refreshed id for the same physical
  device** is saved: a concrete choice is saved, the opened id differs and is
  not `default`/`communications`, and either the labels are known (non-empty)
  and equal, or the
  groupIds are equal and (when both labels are known) the labels overlap.
- **fellBack**: a concrete choice is saved, the capture opened another id,
  and that is not a refreshed id.

Rules a client MUST keep:

- **Never overwrite the saved choice with a fallback.** An unplugged device,
  a hidden list, or the `default` alias of the same device leaves the saved
  choice as it is, so the device is used again once it is back.
- **System default stays default**, and keeps following the OS. Opening it
  never saves the concrete device it resolved to.
- A sibling endpoint (same groupId, non-overlapping label) is never saved.

Writing back a refreshed id moves the selection counter like any pick; the
next sync keeps the capture (rule 2 above).

## Speaker (output routing)

`resolveOutputDevice(saved, outputs)`: the saved speaker resolved by the
same [matching](#matching-a-saved-device) and [table](#which-device-to-open)
— a hidden or unavailable list tries the saved id as it is, a listed one
routes to its (maybe refreshed) id, a missing one routes to the system
default, and the default stays `"default"`. If the lookup itself fails, the
saved id is tried as it is.

A client routes again (while in a call) when the saved speaker or its
selection counter changes, and whenever the output list changes
(`deviceListKey`: an entry appears, goes or is relabelled; this includes
the list unlocking after the first capture). The speaker choice is never
written back: routing does not persist anything.

## Early microphone and standby

- **Early mic.** On a join click the client opens the saved microphone (same
  resolution) before the sockets finish connecting, and builds the audio
  processor from it in parallel. The session's first capture sync reuses
  that request: it waits for an early capture still in flight and takes it
  when it opened the saved id (or the default is saved) with the wanted
  processing; otherwise it opens again once that lands. An early capture
  that already landed is the capture cache's active stream, and the reuse
  rule above (`captureAnswersRequest`) decides. An early processor is taken
  only for the same capture track and settings.
- **Standby.** A standby never opens a device: it publishes silence. On
  promotion the early mic starts on the standby's capture owner, and the
  capture sync replaces the silence through the reconciler
  ([Adopt](STATE_MACHINE.md#adopt)). Muted at promotion, the silence stays
  published until unmute, which triggers a capture sync if no live
  microphone exists yet.

## Web adapter

- `src/lib/stored-device.ts`: reads `enumerateDevices()` for one kind and
  asks `resolveSavedDevice`; `resolveOutputSinkId` for the speaker.
- `src/lib/local-media-manager.ts`: `getUserMedia`, the per-owner capture
  cache and in-flight request sharing, fallback and reopen-after-unlock,
  using `captureTarget`, `captureErrorAction`, `captureAnswersRequest` and
  `captureProcessingMatches`.
- `src/hooks/useVoiceChannel.ts`: the capture sync (`liveCaptureMatches`,
  `captureOutcome`, `fallbackRetryId`) and output sync; audio processors,
  camera effects and the reconciler hand-off stay there.
- `src/lib/useMediaDevices.ts`: the device lists and `devicechange`.

## Wire

Nothing here is on the wire. Device choice, fallback and routing are
local; peers only see the published tracks (see
[What this package does not change](STATE_MACHINE.md#what-this-package-does-not-change)).
