# Desktop native screen share

How the desktop app publishes a hardware-encoded H.264 screen share, and how it ends. The code lives in
[`desktop/src-tauri/src/native_share/`](../../desktop/src-tauri/src/native_share/) behind the `native-screen-share`
feature (on by default); the game-capture hook path also needs `game-capture-hook`.

## Modules

| module         | owns                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| `mod.rs`       | the Tauri commands, `NativeShareState` (lifecycle gate, current-session slot, stats)     |
| `session.rs`   | `ShareSession`: everything one go-live creates, its cancel token, and its one teardown   |
| `transport.rs` | peer connection, tracks, sample writer, RTCP, keyframe-on-connect; used by SFU + preview |
| `capture.rs`   | source resolution, capture-mode selection (WGC or hook), the hook thread                 |
| `audio.rs`     | WASAPI loopback, Opus encode, the ordered audio writer                                   |
| `quality.rs`   | presets, aspect-preserving fit, resize debounce (pure, unit-tested)                      |
| `stats.rs`     | pipeline counters and the `Capture_Status` snapshot the renderer polls                   |

## Session ownership

Each `start_native_screen_share` builds one `ShareSession` with a fresh id and its own `CancelToken`. The session
owns the SFU peer connection and its tasks, the capture source, the encoder worker, audio, watchdogs and the preview
loopback. Nothing about a share lives in `NativeShareState` except the slot that holds the current session.

- Start builds the session step by step. If any step fails, whatever was built is torn down through the same
  `ShareSession::shutdown` used by stop.
- Shutdown cancels the token first (every task and thread watches it), closes the peer connections (3 s bound), then
  joins the blocking parts on the blocking pool (5 s bound). A wedged driver cannot hold the lifecycle gate.
- Start, stop, quality updates and preview calls are serialized by `lifecycle_gate`. Lock order: gate, then slot.
- A session that ends itself (below) only removes itself if it is still the current one (`take_if_current`), so a
  late signal from an old session never stops a newer one.

## Ending on its own

The backend emits `native-screen-share-ended` with `{ reason, detail }`:

| reason              | when                                                                    | renderer action                          |
| ------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| `source-closed`     | the captured window closed or its process exited                        | stop the share, as an explicit stop does |
| `connection-failed` | after first connecting, the PC went `Failed`, or `Disconnected` for 5 s | restart the same source on CEF capture   |

The renderer side is [`src/lib/voice/native-share-ended.ts`](../../src/lib/voice/native-share-ended.ts). The CEF
fallback keeps the source, quality and audio settings and shows a toast. Under the hook-exclusive capture policy,
where WGC/CEF capture is not allowed, it stops instead. Events that arrive after the user already stopped are ignored.
Older builds sent a bare string (`"source-closed: target_exited"`); the parser still accepts it.

Failures before the first connect are not handled here; `wait_native_screen_share_connected` reports them to the
start path.

## Resolution and resize

A quality preset (`720p30`, `1080p60`, …) is a bounding box, fps and bitrate. `quality::fit_within` fits the source
inside the box keeping its aspect ratio, never upscales, and rounds both sides down to even values. A 21:9 or
portrait window keeps its shape instead of being squashed into 16:9.

When the captured source changes size mid-share, the encoder is reconfigured to the new fitted size. The resize
debounce applies a change once the size has been stable for 200 ms, and at most once a second during a continuous
drag. The same `parse_quality_params` drives start, live quality changes and resizes.

## Self-preview

The local preview is a second, localhost-only peer connection (`start_preview_loopback`) built from the same
`transport` code as the SFU publisher. It subscribes to a fan-out of the SFU writer's encoded frames instead of
running a second encoder. A lagging preview skips ahead and asks for a keyframe rather than slowing the SFU path. It
gathers host candidates only, so the separate ICE-candidate command was removed.
