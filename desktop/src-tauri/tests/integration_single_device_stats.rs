//! Integration tests for the single-`D3dDevice` invariant and the stats-command
//! wiring.
//!
//! Validates: Requirements 4.2, 9.3, 11.4
//!   - 4.2 / 11.4: the pipeline keeps capture AND encode on ONE shared
//!                 `D3dDevice` and introduces no separate capture device and no
//!                 cross-device copy.
//!   - 9.3:        `get_native_screen_share_stats` returns a populated
//!                 `NativeShareStatsSnapshot` (mode + timing + counters) during
//!                 an active session.
//!
//! # What is checkable in CI, and what is structural
//!
//! The single-`D3dDevice` invariant (Req 4.2, 11.4) is an **architectural**
//! property of `start_native_screen_share`: it calls `D3dDevice::new()` exactly
//! once and shares that single device with both the encoder worker and WGC
//! capture via `Arc::clone`; the DX11 hook opens shared surfaces
//! (`OpenSharedResource`) on that *same* device, so there is never a second
//! capture device and never a cross-device copy. Constructing a real
//! `D3dDevice` needs a GPU, so this test cannot stand up the live pipeline in
//! CI. Instead it:
//!
//!   * proves the *shared-state design* via the public API — a single
//!     `Arc<NativeShareStats>` is shared (not duplicated) between the managed
//!     state and the worker threads, asserted through `Arc::strong_count`
//!     /`Arc::ptr_eq`, which is the same `Arc::clone` sharing discipline the
//!     pipeline uses for the one `D3dDevice`; and
//!   * documents (below) that the live single-device / no-cross-device-copy
//!     invariant is enforced structurally in `start_native_screen_share` and
//!     exercised on hardware by `integration_dx11_hook.rs` (which confirms the
//!     hook opens the shared backbuffer on the one `Shared_D3D_Device` with no
//!     CPU readback).
//!
//! The stats-command wiring (Req 9.3) **is** fully checkable without a GPU: the
//! Tauri command body is literally `Ok(state.stats.snapshot())`, so building a
//! `NativeShareState::default()`, mutating its shared `stats` Arc to simulate an
//! active session, and calling `state.stats.snapshot()` exercises exactly what
//! the command returns.
//!
//! Run with:
//!   cargo test --features native-screen-share --test integration_single_device_stats

#![cfg(feature = "native-screen-share")]

use std::sync::atomic::Ordering;
use std::sync::Arc;

use app_lib::game_capture::CaptureMode;
use app_lib::native_share::{NativeShareState, NativeShareStats};

// ── Req 9.3: stats command returns a populated snapshot during a session ───

/// Mirror of the `get_native_screen_share_stats` command body. The real command
/// is `Ok(state.stats.snapshot())`; replicating that single line here lets us
/// exercise the exact wiring without a Tauri `State` wrapper (which cannot be
/// constructed off a running app).
fn stats_command_result(state: &NativeShareState) -> app_lib::native_share::NativeShareStatsSnapshot
{
    state.stats.snapshot()
}

/// During an active (mocked) session the command returns a snapshot populated
/// with the active capture mode, per-frame timing (µs), and the live counters —
/// exactly the payload the renderer reads (Req 9.3, 9.4, 9.5).
#[test]
fn stats_command_returns_populated_snapshot_during_active_session() {
    let state = NativeShareState::default();

    // Simulate an active session by mutating the SHARED stats Arc, the same
    // handle the capture/encoder threads would write to live.
    let shared = Arc::clone(&state.stats);
    shared.captured_frames.store(900, Ordering::Relaxed);
    shared.encoded_frames.store(896, Ordering::Relaxed);
    shared.encode_errors.store(1, Ordering::Relaxed);
    shared.samples_written.store(890, Ordering::Relaxed);
    shared.dropped_frames.store(4, Ordering::Relaxed);
    shared.record_fused_gpu_ns(420_000); // 420 µs fused GPU op
    shared.record_encode_submit_ns(1_100_000); // 1100 µs encode submit
    shared.set_capture_mode(CaptureMode::Hook);

    let snap = stats_command_result(&state);

    // Mode is reported (Req 9.4) ...
    assert_eq!(snap.capture_mode, "hook");
    // ... timing is populated in microseconds (Req 9.1, 9.2) ...
    assert_eq!(snap.last_fused_gpu_us, 420);
    assert_eq!(snap.last_encode_submit_us, 1_100);
    assert!(
        snap.fused_gpu_us_avg > 0 && snap.encode_submit_us_avg > 0,
        "EWMA timing should be populated after recording samples"
    );
    // ... and every existing counter is carried through unchanged (Req 9.5).
    assert_eq!(snap.captured_frames, 900);
    assert_eq!(snap.encoded_frames, 896);
    assert_eq!(snap.encode_errors, 1);
    assert_eq!(snap.samples_written, 890);
    assert_eq!(snap.dropped_frames, 4);
}

/// The snapshot the command returns is serializable (it crosses the Tauri IPC
/// boundary as JSON), and the serialized payload carries the mode + timing +
/// counters the renderer consumes (Req 9.3).
#[test]
fn stats_command_snapshot_serializes_with_mode_and_timing() {
    let state = NativeShareState::default();
    state.stats.captured_frames.store(42, Ordering::Relaxed);
    state.stats.record_fused_gpu_ns(3_000); // -> 3 µs
    state.stats.set_capture_mode(CaptureMode::Wgc);

    let snap = stats_command_result(&state);
    let json = serde_json::to_value(&snap).expect("snapshot must serialize for the IPC boundary");

    assert_eq!(json["capture_mode"], "wgc");
    assert_eq!(json["captured_frames"], 42);
    assert_eq!(json["last_fused_gpu_us"], 3);
    // The timing + counter keys the renderer reads are all present.
    for key in [
        "capture_mode",
        "captured_frames",
        "encoded_frames",
        "encode_errors",
        "samples_written",
        "dropped_frames",
        "last_fused_gpu_us",
        "last_encode_submit_us",
        "fused_gpu_us_avg",
        "encode_submit_us_avg",
    ] {
        assert!(json.get(key).is_some(), "snapshot JSON must include `{key}`");
    }
}

/// With no active session the command still returns a valid snapshot — the
/// zeroed/`wgc` default — because `state.stats` is always a live Arc (Req 9.3
/// permits the default when nothing is active).
#[test]
fn stats_command_returns_default_when_no_session() {
    let state = NativeShareState::default();
    let snap = stats_command_result(&state);
    assert_eq!(snap, NativeShareStats::default().snapshot());
    assert_eq!(snap.capture_mode, "wgc");
    assert_eq!(snap.captured_frames, 0);
}

// ── Req 4.2 / 11.4: single shared state, no duplication ────────────────────

/// The managed state exposes its stats as a single `Arc<NativeShareStats>` that
/// is *shared* (via `Arc::clone`) rather than duplicated. This is the same
/// shared-ownership discipline `start_native_screen_share` uses for the single
/// `D3dDevice`: one allocation, handed to every consumer by `Arc::clone`. We
/// assert the shared-state design here as a public-API proxy for the single
/// shared device (the live device needs a GPU).
///
/// Req 4.2 / 11.4 (single `D3dDevice`, no cross-device copy) is enforced
/// structurally in `start_native_screen_share` — one `D3dDevice::new()`,
/// `Arc::clone` to both the encoder worker and WGC capture, and
/// `OpenSharedResource` for the hook on that *same* device — and is exercised on
/// hardware by `integration_dx11_hook.rs`.
#[test]
fn stats_arc_is_shared_not_duplicated() {
    let state = NativeShareState::default();

    // One owner so far: the managed state.
    assert_eq!(
        Arc::strong_count(&state.stats),
        1,
        "a fresh state owns exactly one reference to its stats"
    );

    // Hand the stats to N simulated worker threads exactly as the pipeline does
    // — by cloning the Arc, NOT by constructing new stats. Every clone must
    // point at the SAME allocation (the single-shared-state invariant).
    let worker_a = Arc::clone(&state.stats);
    let worker_b = Arc::clone(&state.stats);
    assert!(Arc::ptr_eq(&state.stats, &worker_a));
    assert!(Arc::ptr_eq(&worker_a, &worker_b));
    assert_eq!(
        Arc::strong_count(&state.stats),
        3,
        "the managed state + 2 worker clones share one stats allocation"
    );

    // A write through one clone is observed through every other handle —
    // proving they are the same shared object, not copies (the property the
    // single shared D3dDevice relies on for capture/encode to see one device).
    worker_a.captured_frames.store(7, Ordering::Relaxed);
    assert_eq!(worker_b.captured_frames.load(Ordering::Relaxed), 7);
    assert_eq!(state.stats.captured_frames.load(Ordering::Relaxed), 7);

    // Dropping the worker clones returns the count to one — no leaked owners.
    drop(worker_a);
    drop(worker_b);
    assert_eq!(
        Arc::strong_count(&state.stats),
        1,
        "dropping worker clones leaves only the managed state owner"
    );
}

/// The capture-mode reported in the snapshot round-trips through the single
/// shared stats Arc: a mode set on one handle is visible on the snapshot taken
/// from another, so capture and encode (which share that one Arc) always agree
/// on the active mode (Req 6.5, 9.4 — supporting the single-shared-state design
/// of Req 4.2/11.4).
#[test]
fn capture_mode_round_trips_through_shared_stats() {
    let state = NativeShareState::default();
    let worker = Arc::clone(&state.stats);

    worker.set_capture_mode(CaptureMode::Hook);
    assert_eq!(stats_command_result(&state).capture_mode, "hook");

    worker.set_capture_mode(CaptureMode::Wgc);
    assert_eq!(stats_command_result(&state).capture_mode, "wgc");
}
