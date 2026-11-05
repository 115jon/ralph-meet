# @ralph/voice-media

The media layer every PartyTracks-based Yap client runs: the web app
(`src/lib/sfu-client.ts`) and the Expo app (`apps/mobile`,
`features/voice/connection.ts`). The session lifecycle that drives it is
`@ralph/voice` (`packages/voice/STATE_MACHINE.md`).

| file                           | what                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partytracks-transport.ts`     | A PartyTracks session (peer connection): pushes, pulls, simulcast send encodings and layer pulls, the SFU errors PartyTracks retries.                   |
| `split-video-transport.ts`     | Video pulls on sessions of their own beside the main one; a fresh pull gets a connection with no closed m-line (no recycled MID).                       |
| `partytracks-media-manager.ts` | Ralph's aliases over that session: publications, withdraw with keepalive and resume, republish, pulls with watchdog and backoff, parked and kept pulls. |
| `partytracks-pull-errors.ts`   | Reads `not_found_track_error` out of PartyTracks' API log.                                                                                              |
| `video-layers.ts`              | The camera's simulcast encodings and which layer a rendered size needs.                                                                                 |
| `video-render-demand.ts`       | Where pulled video is rendered and how large (each platform's video views report here).                                                                 |
| `video-keepalive.ts`           | The keepalive contract; platforms make the track.                                                                                                       |
| `publication-liveness.ts`      | The SFU's 30 s inactivity rule.                                                                                                                         |
| `video-flow.ts`                | Whether a remote camera decodes frames (stalled or waiting), and what its tile shows: video, the loading state, or "Video unavailable".                 |
| `remote-video-health.ts`       | Measures the remote cameras on screen and pulls a stalled one again on a fresh path, once per stall.                                                    |

## Platform

WebRTC comes from the platform: a browser, or react-native-webrtc after its
`registerGlobals()` (`apps/mobile/src/features/voice/webrtc-runtime.ts`, which
must run before this package is first imported). The package uses no
browser-only global (`src/__tests__/platform-free.test.ts`). What differs per
platform is injected:

| option                                               | web                                                                                                      | Expo app                                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| transport `resolveApiUrl`                            | `apiUrl` (`src/lib/platform.ts`)                                                                         | `config.apiBaseUrl` + path                                                                                                                                                           |
| transport `configurePeerConnection`                  | Opus ptime preference (`src/lib/voice/opus-ptime.ts`)                                                    | none                                                                                                                                                                                 |
| manager `createVideoKeepalive`                       | canvas track (`src/lib/voice/video-keepalive.ts`)                                                        | Android: native black frame source (`features/voice/keepalive.ts`); iOS: none yet (camera or share off closes the publication; viewers pull the next one on a fresh path, see below) |
| manager `cameraSendEncodings`                        | three simulcast layers (default)                                                                         | `null`: one layer                                                                                                                                                                    |
| manager `optInTrackPrefixes`                         | `screen-video-` (default)                                                                                | `screen-video-`, `cam-video-`: pulled while the call screen watches; `releaseUnsubscribedPulls()` in the background                                                                  |
| transport                                            | `SplitVideoTransport`, `"fresh"`: one session, plus one per camera pulled again after a close or a stall | `SplitVideoTransport`, `"all"`: video pulls on a session of their own, dropped once they close                                                                                       |
| manager `readVideoFrames`                            | the StatsHub's last snapshot (main session; the receiver's until the hub has one); the receiver's stats  | the receiver's stats                                                                                                                                                                 |
| `videoRenderDemand` (the registry the manager reads) | `VideoPlayer` reports                                                                                    | `VideoView` reports (`features/voice/render-demand.ts`)                                                                                                                              |

## A camera that shows nothing

A video alias pulled again after its pull closed (its publication is a new
SFU track, such as an iPhone turning its camera back on; its pull was
dropped by the watchdog, unsubscribed or recovered) is pulled with `fresh`:
on a new video session, as the SFU recycles a closed m-line under its old
MID with other RTP header extension IDs, which libwebrtc rejects. The
manager remembers the alias until a fresh pull brings it back, so every
later pull of it is fresh too (one lost to a withdrawal, or cut short by a
new offer). A camera on screen that decodes no first frame in 6 s, or no new
frame for 5 s, is pulled again that way once (`RemoteVideoHealth`), and its
re-pull gets 10 s for a first frame, as its new connection must connect
first; still stalled, its tile shows the avatar and "Video unavailable"
until frames come back. Screen shares are not measured (a
still screen legitimately sends nothing).

Nothing here changes the wire: gateway messages are sent by the platform's
sockets, and PartyTracks request bodies are what `patches/partytracks@0.0.56.patch`
makes them.
