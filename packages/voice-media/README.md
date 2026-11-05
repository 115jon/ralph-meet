# @ralph/voice-media

The media layer every PartyTracks-based Yap client runs: the web app
(`src/lib/sfu-client.ts`) and the Expo app (`apps/mobile`,
`features/voice/connection.ts`). The session lifecycle that drives it is
`@ralph/voice` (`packages/voice/STATE_MACHINE.md`).

| file                           | what                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partytracks-transport.ts`     | A PartyTracks session (peer connection; one per call on the web): pushes, pulls, simulcast send encodings and layer pulls, the SFU errors PartyTracks retries. |
| `partytracks-media-manager.ts` | Ralph's aliases over that session: publications, withdraw with keepalive and resume, republish, pulls with watchdog and backoff, parked and kept pulls.        |
| `partytracks-pull-errors.ts`   | Reads `not_found_track_error` out of PartyTracks' API log.                                                                                                     |
| `video-layers.ts`              | The camera's simulcast encodings and which layer a rendered size needs.                                                                                        |
| `video-render-demand.ts`       | Where pulled video is rendered and how large (each platform's video views report here).                                                                        |
| `video-keepalive.ts`           | The keepalive contract; platforms make the track.                                                                                                              |
| `publication-liveness.ts`      | The SFU's 30 s inactivity rule.                                                                                                                                |

## Platform

WebRTC comes from the platform: a browser, or react-native-webrtc after its
`registerGlobals()` (`apps/mobile/src/features/voice/webrtc-runtime.ts`, which
must run before this package is first imported). The package uses no
browser-only global (`src/__tests__/platform-free.test.ts`). What differs per
platform is injected:

| option                                               | web                                                   | Expo app                                                                                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| transport `resolveApiUrl`                            | `apiUrl` (`src/lib/platform.ts`)                      | `config.apiBaseUrl` + path                                                                                                                                                                                |
| transport `configurePeerConnection`                  | Opus ptime preference (`src/lib/voice/opus-ptime.ts`) | none                                                                                                                                                                                                      |
| manager `createVideoKeepalive`                       | canvas track (`src/lib/voice/video-keepalive.ts`)     | Android: native black frame source (`features/voice/keepalive.ts`); iOS: none yet (camera or share off closes the publication, and a Chrome viewer pulling the next one can hit the recycled-MID failure) |
| manager `cameraSendEncodings`                        | three simulcast layers (default)                      | `null`: one layer                                                                                                                                                                                         |
| manager `optInTrackPrefixes`                         | `screen-video-` (default)                             | `screen-video-`, `cam-video-`: pulled while the call screen watches; `releaseUnsubscribedPulls()` in the background                                                                                       |
| transport                                            | `PartyTracksTransport`: one session                   | `SplitVideoTransport` (`features/voice/split-transport.ts`): video pulls on a session of their own, dropped once they close                                                                               |
| `videoRenderDemand` (the registry the manager reads) | `VideoPlayer` reports                                 | `VideoView` reports (`features/voice/render-demand.ts`)                                                                                                                                                   |

Nothing here changes the wire: gateway messages are sent by the platform's
sockets, and PartyTracks request bodies are what `patches/partytracks@0.0.56.patch`
makes them.
