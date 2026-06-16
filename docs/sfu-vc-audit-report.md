# SFU / Voice Channel Audit Report

Date: 2026-06-13

## Executive Summary

The voice-channel failures are most consistent with pull-side SFU negotiation desynchronization, not a simple microphone/device failure. The strongest evidence is a production log sequence where a client repeatedly re-pulls a remote screen track, receives `empty_track_error`, then attempts another pull and crashes the pull `RTCPeerConnection` with:

`Failed to set remote offer sdp: The order of m-lines in subsequent offer doesn't match order from previous offer/answer.`

After this error, the client resets the pull session, but the original pull waiters are left alive until timeout. During that window the local state, server pull session, and browser `RTCPeerConnection` can disagree about which remote tracks are active. That is a credible path to the reported symptoms: users appear to remain in VC, but some participants stop hearing them or stop being heard until a full leave/rejoin reloads the entire signaling and PeerConnection state.

The implementation is broadly aligned with Cloudflare Realtime SFU's HTTPS signaling model, but several local protocol details violate the reliability requirements of that model: uncorrelated `NegotiationDone` messages, non-atomic mutation of pulled-track state before SDP success, partial retry of failed remote tracks, and stale waiters surviving reset.

## Cloudflare Documentation Baseline

Relevant current Cloudflare Realtime/SFU documentation reviewed:

- Realtime SFU overview: Cloudflare Realtime is the SFU/media layer running on Cloudflare's global network.
- Sessions and Tracks: a Cloudflare Realtime Session maps directly to a WebRTC `RTCPeerConnection`; tracks map to `MediaStreamTrack` and are globally retrievable within an app.
- Connection API: signaling flow is `POST /apps/{appId}/sessions/new`, `POST /apps/{appId}/sessions/{sessionId}/tracks/new`, then `PUT /apps/{appId}/sessions/{sessionId}/renegotiate` for answers.
- Limits/timeouts: operations on a session require the PeerConnection to be connected; Realtime may block up to 5 seconds waiting for connected state; tracks are garbage-collected after 30 seconds with no media packets.
- Example architecture: the app backend owns participant/room state and relays client SDP to the Realtime API.

Key doc implications for this app:

- A Realtime Session and browser PeerConnection must remain in lockstep.
- Adding remote tracks to an existing pull session is a WebRTC renegotiation, not a stateless fetch.
- The app layer must provide strict signaling ordering/correlation because Cloudflare delegates room/presence state to the application.
- Track availability is time-sensitive; retrying before publisher ICE/RTP is flowing can legitimately return transient track errors.

## Current Architecture Observed

Client side:

- `src/lib/sfu-client.ts` owns call orchestration, room gateway, voice gateway, pending pull tracks, reconnect recovery, and reset behavior.
- `src/lib/voice/track-negotiator.ts` owns browser `RTCPeerConnection` objects and local SDP application.
- `src/lib/voice/webrtc-session-manager.ts` owns reset/circuit-breaker helpers.
- `src/lib/voice/gateways/voice-gateway.ts` dispatches voice signaling opcodes from the worker.

Server side:

- `worker/voice-room.ts` is the Durable Object/signaling room.
- It stores participants, push sessions, pull sessions, pending tracks, and reconnect grace state.
- It calls Cloudflare Realtime runtime endpoints under `https://rtc.live.cloudflare.com/v1/apps/{CALLS_APP_ID}`.
- It marks published tracks as pending until the publisher sends `TracksReady`, then broadcasts `Video` track offers.

The design uses separate push PeerConnections for cam and screen, plus one shared pull PeerConnection for all remote tracks. That can work, but the shared pull PC makes strict m-line ordering and serialized negotiation mandatory.

## Log Findings

### Log `tauri.localhost-1781323080695.log`

High-value sequence:

- `22:47:41`: Voice WebSocket disconnects with code `1006`, reconnects quickly, and the client logs that both push and pull PeerConnections survived. This supports the idea that brief WS loss itself is not the primary failure.
- `22:53` through `22:56`: repeated native screen-share starts, fallbacks, and remote screen track pulls occur.
- `22:57:31`: the client requests `screen-video-7908d49d-7054-4c01-b473-6cb50c9d9d11` again even though earlier negotiation for that same track had completed.
- `22:57:39` and `22:57:48`: the SFU returns `empty_track_error` for that screen video and the client retries.
- `22:57:48`: the client then requests `screen-audio-7908d49d-7054-4c01-b473-6cb50c9d9d11` separately.
- `22:57:48.943`: `setRemoteDescription` fails with m-line order mismatch.
- `22:57:58`: old pull waiters time out: `Pull Negotiation Done timed out` and `Pull SDP Offer timed out`.
- `22:57:59`: the client recovers by issuing new pulls, but this recovery depends on state that may already have been mutated by the failed SDP attempt.

This is the clearest reproduction signature.

### Log `tauri.localhost-1781331471927.log`

Notable sequence:

- Initial join resets the pull PC immediately because it sees `iceConnectionState=new` as dead.
- The call then appears stable until explicit disconnect much later.
- On disconnect, `VoiceGW` queues a speaking update because it is no longer identified. That is noisy but not likely the cause of the silent-audio bug.

### Non-VC Noise

The logs also contain repeated `401` read-state requests and `404` TikTok preview requests. These are real app issues, but they are not causal for SFU audio dropouts based on the available evidence.

## Findings and Fixes

### P0: Pull SDP failure leaves stale waiters alive

Evidence:

- `src/lib/sfu-client.ts` handles pull `session-description` errors by logging and calling `resetPullAndRepull(...)`.
- The same code path does not reject/clear `pullResolver`, `pullRejector`, `pullNegotiationResolve`, or `pullNegotiationRejector` before resetting.
- The log confirms this: after the m-line error at `22:57:48.943`, stale `Pull SDP Offer` and `Pull Negotiation Done` waiters time out at `22:57:58`.

Impact:

- The old pull operation remains active while a new pull session is being created.
- Late `SessionDescription` or `NegotiationDone` messages can resolve the wrong operation.
- Client state can say tracks are pulled while the browser PC rejected the SDP.

Fix:

- On any pull SDP application failure, reject and clear all current pull waiters before calling `resetPullAndRepull`.
- Reset `pullQueue` to a clean resolved promise during a full pull-session reset.
- Add a pull generation/epoch to every pull request and ignore late signaling from older epochs.

### P0: `NegotiationDone` is not correlated to a session or operation

Evidence:
- `src/lib/voice/gateways/voice-gateway.ts` expects `negotiation-done` to contain `session_id`.
- `worker/voice-room.ts` sends `Op.NegotiationDone` with `{}`.
- `src/lib/sfu-client.ts` resolves whichever waiter appears most plausible instead of matching a specific session/operation.

Impact:

- Concurrent or adjacent cam push, screen push, and pull negotiations can complete the wrong waiter.
- This can make the client proceed while the actual pull renegotiation is incomplete, or wait until timeout even though a different operation completed.

Fix:

- Include `session_id` and `operation` or `direction` in every `NegotiationDone` payload.
- Resolve only the waiter matching the session ID and operation kind.
- Prefer an explicit client-generated `request_id` on every `SelectProtocol` and `Answer`, echoed by the worker in `SessionDescription`, `Error`, and `NegotiationDone`.

### P0: Pulled-track state is mutated before SDP is successfully applied

Evidence:

- In `src/lib/voice/track-negotiator.ts`, pull `handleSessionDescription(...)` mutates `pulledTracks` and `mid` mappings before `pullPC.setRemoteDescription(...)` succeeds.
- If `setRemoteDescription` throws, the mutation has already happened.

Impact:

- A failed offer can delete or remap local track metadata even though the browser rejected the SDP.
- `resetPullAndRepull([...this.negotiator.pulledTracks])` then restores from corrupted state.
- This directly matches the user-visible symptom: a remote audio track may no longer be represented correctly locally, and no new `remote-track` event fires until a full rejoin rebuilds everything.

Fix:

- Treat SDP application as atomic.
- Stage incoming `sd.tracks` to a temporary map.
- Only update `pulledTracks`, `mid`, and emitted-mid bookkeeping after `setRemoteDescription`, `createAnswer`, `setLocalDescription`, and `Answer` send all succeed.
- On failure, restore the exact pre-negotiation snapshot.

### P0: Partial retries can reorder the pull session's m-lines

Evidence:

- The failing log pulls `screen-video` repeatedly, then later pulls `screen-audio` separately.
- The browser rejects the resulting remote offer because subsequent offer m-line order differs from the previous offer/answer.
- A single shared pull PeerConnection is used for all remote tracks.

Impact:

- On a shared pull PC, the order of media sections must be stable across renegotiations.
- Retrying only one failed track, then adding its sibling later, can cause the SFU-generated offer to differ from the browser's current transceiver order.

Fix:

- Coalesce pull requests for a short window, for example 50-100 ms, so related audio/video tracks from the same publisher/session are requested together.
- Maintain a stable pull order: existing tracks in current m-line order first, new tracks appended in deterministic order.
- If an m-line error occurs, do not attempt incremental retry on that PC. Fully reset the pull PC and server pull session, then pull the complete desired remote-track set in one request.

### P1: Initial join treats a new pull PC as dead

Evidence:

- Both logs show immediate `Pull PC is dead (state=new)` after voice ready.
- The track-offered path later treats `new` and `checking` as usable, but the voice-ready path treats only `connected` and `completed` as active.

Impact:

- The client sends unnecessary `ResetPullSession` during normal startup.
- This adds avoidable session churn and increases the chance that an in-flight pre-created pull session is invalidated before first use.

Fix:

- In voice-ready recovery, distinguish `new`/never-used from dead.
- Only reset a pull PC as dead if it previously negotiated tracks or reached `failed`/closed/disconnected past the grace window.
- Align the voice-ready pull usability check with the track-offered path.

### P1: Server-side SFU error handling clears too much state

Evidence:

- In `worker/voice-room.ts`, generic SFU errors containing `session_error`, `410`, or `425` clear `pull_session_id`, `push_session_cam`, and `push_session_screen` for the participant.

Impact:

- A pull-side transient error can wipe push session IDs for the same participant while their publishing PeerConnection is still alive.
- Future publish/stop/reconnect operations may create replacement sessions while the old SFU session still exists.

Fix:

- Scope error recovery to the operation.
- Pull operation failures should clear only `pull_session_id`.
- Cam push failures should clear only `push_session_cam`.
- Screen push failures should clear only `push_session_screen`.

### P1: ResetPullSession only clears database state

Evidence:

- `worker/voice-room.ts` handles `ResetPullSession` by setting `pull_session_id = NULL`.
- It does not correlate or cancel in-flight `tracks/new` or `renegotiate` responses.

Impact:

- Late responses from the old pull session can still arrive at the client and be processed unless the client has its own generation guard.

Fix:

- Add pull generation/request ID correlation and ignore stale responses.
- Consider recording an incrementing `pull_generation` server-side and echoing it on every pull `SessionDescription`, `Error`, and `NegotiationDone`.

### P2: `empty_track_error` recovery is too eager and too local

Evidence:

- The worker correctly comments that `empty_track_error` can be transient while publisher ICE/RTP is still starting.
- The client retries after 1 second for the exact failed track names.

Impact:

- Repeated retries can thrash negotiation during publisher startup or screen-share transitions.
- Retrying the exact failed track without its sibling tracks contributes to partial pull ordering problems.

Fix:

- Back off transient pull retries with jitter: 1s, 2s, 4s, then require a fresh `TracksReady`/`Video` event or publisher state change.
- Retry a complete stable desired-track set, not just the failed track name.
- For screen share, treat `screen-video` and `screen-audio` from the same participant/session as a group.

## Recommended Implementation Plan

1. Add request/session correlation.

- Add `request_id` to `SelectProtocol` and `Answer` client payloads.
- Echo `request_id`, `session_id`, and `operation` in `SessionDescription`, `Error`, and `NegotiationDone`.
- Resolve/reject only matching waiters.

2. Make pull reset hard and atomic.

- Add `resetPullWaiters(reason)` and call it before every pull PC reset.
- Reset `pullQueue` on full pull reset.
- Increment a pull epoch and ignore stale messages.

3. Make pull SDP application atomic.

- Snapshot `pulledTracks` before applying an offer.
- Do not mutate mids or filter tracks until SDP succeeds.
- Restore snapshot on failure.

4. Coalesce and order pulls.

- Replace immediate per-event `pullTracks([track])` calls with a short debounced pull scheduler.
- Stable sort by existing mid order, then participant/session, then kind order.
- Prefer pulling all desired remote tracks after reset instead of incremental retries.

5. Scope server session cleanup.

- Split `handleSelectProtocol` catch recovery by active operation.
- Do not clear push sessions because a pull operation failed.

6. Improve recovery telemetry.

- Log `request_id`, `session_id`, `pull_epoch`, `track_names`, `signalingState`, `connectionState`, and `iceConnectionState` at every `SelectProtocol`, `SessionDescription`, `Answer`, `NegotiationDone`, reset, and retry.
- Add a user-visible reconnecting banner if pull audio is being rebuilt.

## Verification Checklist

After fixes, test these cases:

- Join a voice channel with two existing participants already speaking.
- Start and stop screen share with audio repeatedly while another participant joins.
- Force a VoiceGW WebSocket `1006` disconnect while media is flowing; verify no PC reset occurs if ICE stays connected.
- Force pull `empty_track_error` by delaying publisher `TracksReady`; verify retry does not create m-line mismatch.
- Force `setRemoteDescription` failure in a unit test; verify waiters are rejected, `pulledTracks` is restored, and the next pull uses a fresh PC.
- Run for over 30 minutes with idle and active periods; verify expired pull sessions rebuild without losing remote audio.

## Bottom Line

The app is using the right Cloudflare product and the general signaling flow is recognizable, but the custom signaling layer needs stricter transactionality. The highest-value fix is to make pull negotiation an explicitly correlated transaction: one request, one expected session/operation, atomic state mutation, and guaranteed cleanup on failure. That should directly address the intermittent "still in VC but cannot hear / cannot be heard" reports.
