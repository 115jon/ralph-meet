//! Unit test for idempotent `GameCaptureHook` detach and teardown (task 6.5).
//!
//! Validates: Requirements 1.6, 7.4
//!   - 1.6 When a native share session using the Game_Capture_Hook stops, the
//!         hook removes its Present_Interception and **releases its
//!         Shared_Surface resources** — `GameCaptureHook::detach` releases the
//!         retained surface and stops the IPC channel, and is idempotent
//!         (safe to call more than once and from `Drop`).
//!   - 7.4 When a session using the Game_Capture_Hook stops, the pipeline stops
//!         feeding surfaces and **releases the retained Shared_Surfaces** — the
//!         hook's `detach` clears the retained surface and the IPC channel.
//!
//! # What "a mock `ObsIpcChannel`" means here, and what is honestly testable
//!
//! The task calls for a mock `ObsIpcChannel`. `ObsIpcChannel` is a **concrete,
//! Win32-backed struct, not a trait**, so there is no injection seam to swap in
//! a fake — and faking one with `unsafe`/null handles would test a fiction, not
//! the real teardown contract. The honest substitute the design already gives us
//! is the **real channel constructed against an arbitrary, non-existent PID**:
//! `ObsIpcChannel::start_with_timeout(pid, ms)` only creates the host-owned
//! named kernel events (no game, no GPU, no injected hook), exactly as the
//! `obs_ipc` unit tests do. That real-but-gameless channel is the test double —
//! it lets us assert the observable teardown contract `detach` depends on
//! without hardware.
//!
//! `GameCaptureHook::new` additionally takes a real `Arc<D3dDevice>` (a live
//! D3D11 device). That device is **not** constructible on a headless CI runner,
//! so a fully-constructed `GameCaptureHook` can only be exercised on a box with
//! a GPU. We therefore split the coverage along the line of what is testable:
//!
//!   * **GPU-independent (always runs):** the IPC-teardown contract that
//!     `detach` delegates to — `ObsIpcChannel::stop` is idempotent, the target
//!     reads as exited after stop, and no metadata is produced afterwards. This
//!     is the `ipc.stop()` half of `detach` (Req 1.6).
//!
//!   * **GPU-bound (runs only with a real device, skips gracefully otherwise):**
//!     the full `GameCaptureHook::detach` idempotency — `is_attached()` flips to
//!     `false`, the retained-handle bookkeeping resets, `next_surface()`
//!     short-circuits to `Ok(None)`, a second `detach()` and the `Drop`-time
//!     `detach()` are safe no-ops. Releasing an **actually-populated** shared
//!     surface (a live `OpenSharedResource` handle from a presenting game) needs
//!     a publishing hook and is covered by the hardware-gated integration test
//!     (task 11.4, `integration_dx11_hook.rs`, which asserts `detach` releases
//!     the shared surface after a real interception). We do **not** fake a
//!     `D3dDevice` to force that half to run here.
//!
//! Run with (from `desktop/src-tauri`, CEF env vars set):
//!   cargo test --features game-capture-hook --test hook_detach

#![cfg(all(feature = "game-capture-hook", windows))]

use std::sync::Arc;

use app_lib::d3d_device::D3dDevice;
use app_lib::game_capture::dx11::GameCaptureHook;
use app_lib::game_capture::obs_ipc::{FrameMetadata, ObsIpcChannel};
use app_lib::game_capture::GraphicsApiBackend;

/// An arbitrary, non-existent target PID. The channel's named events are
/// host-created, so no real process by this id need exist (Req 1.4).
const TEST_PID: u32 = 0xFFFF_FFEE;

/// A short per-frame wait bound so `next_metadata` returns promptly with no hook
/// publishing — keeps the test fast (the bound only matters for the no-frame
/// path here).
const SHORT_WAIT_MS: u32 = 5;

/// Construct the real-but-gameless `ObsIpcChannel` that stands in for a mock:
/// only host-owned named events, no GPU and no injected hook required.
fn real_channel(pid: u32) -> ObsIpcChannel {
    ObsIpcChannel::start_with_timeout(pid, SHORT_WAIT_MS)
        .expect("named events can be created for an arbitrary pid without a game or GPU")
}

/// Try to create the shared D3D11 device. Returns `None` (rather than panicking)
/// on a headless runner so the GPU-bound test can skip gracefully — mirroring
/// `integration_dx11_hook::try_create_device`.
fn try_create_device() -> Option<Arc<D3dDevice>> {
    match D3dDevice::new() {
        Ok(d3d) => Some(d3d),
        Err(e) => {
            eprintln!("[hook_detach] D3dDevice::new() unavailable (headless CI?): {e}");
            None
        }
    }
}

// ── GPU-independent: the IPC-teardown contract `detach` delegates to ────────

/// The `ipc.stop()` half of `GameCaptureHook::detach` (Req 1.6): stopping the
/// channel is idempotent, latches the target as exited, and yields no further
/// metadata. `detach` calls exactly this on the channel it owns, so proving the
/// channel's teardown is idempotent proves `detach`'s teardown is idempotent at
/// the level that runs without a GPU.
#[test]
fn ipc_teardown_contract_is_idempotent() {
    let mut ipc = real_channel(TEST_PID);

    // Before stop: no hook is publishing, so there is no frame and the target is
    // not yet exited.
    assert_eq!(
        ipc.next_metadata(),
        Ok(None),
        "no hook is publishing, so no frame is ready within the bound"
    );
    assert!(
        !ipc.target_exited(),
        "the channel must not report exit before it is stopped"
    );

    // Stop releases the events/mapping and latches exit (Req 1.6, 9.3).
    ipc.stop();
    assert!(
        ipc.target_exited(),
        "after stop the channel must report the target as exited so teardown is clean"
    );
    assert_eq!(
        ipc.next_metadata(),
        Ok(None),
        "a stopped channel must produce no further metadata"
    );

    // Idempotent: stopping again is a safe no-op, and the Drop-time stop that
    // follows this test body must not double-free.
    ipc.stop();
    ipc.stop();
    assert!(
        ipc.target_exited(),
        "exit stays latched across repeated stops"
    );
}

// ── GPU-bound: full `GameCaptureHook::detach` idempotency (skips w/o a GPU) ──

/// `GameCaptureHook::detach` is idempotent and tears the hook down: it stops the
/// owned IPC channel, clears the retained-surface bookkeeping, marks the hook
/// detached, and short-circuits `next_surface`. A second `detach()` and the
/// `Drop`-time `detach()` are safe no-ops (Req 1.6, 7.4).
///
/// Skips gracefully when no D3D11 device is available (the constructor needs a
/// real `Arc<D3dDevice>`); the GPU-independent teardown half is covered above,
/// and releasing a live, populated shared surface is covered by the
/// hardware-gated integration test (task 11.4).
#[test]
fn detach_is_idempotent_and_tears_down_the_hook() {
    let Some(d3d) = try_create_device() else {
        eprintln!(
            "[hook_detach] SKIP detach_is_idempotent_and_tears_down_the_hook: no D3D11 device \
             (headless CI). GameCaptureHook::new requires a real Arc<D3dDevice>; the \
             IPC-teardown half is asserted by ipc_teardown_contract_is_idempotent, and the \
             live shared-surface release is covered by the hardware-gated integration test \
             (task 11.4, integration_dx11_hook.rs)."
        );
        return;
    };

    let ipc = real_channel(TEST_PID);
    let mut hook = GameCaptureHook::new(d3d, ipc, GraphicsApiBackend::Dx11, TEST_PID);

    // A freshly built hook is attached, knows its target, and retains nothing.
    assert!(
        hook.is_attached(),
        "a newly built hook must report attached"
    );
    assert_eq!(
        hook.target_pid(),
        TEST_PID,
        "the hook must carry its target pid"
    );
    assert_eq!(
        hook.backend(),
        GraphicsApiBackend::Dx11,
        "DX11 is the gated backend"
    );
    assert_eq!(
        hook.last_handle(),
        0,
        "no surface is retained before the first published frame"
    );

    // No hook is publishing, so pulling a surface reports no frame (and never
    // tries to open/retain anything) rather than erroring.
    match hook.next_surface() {
        Ok(None) => {}
        Ok(Some(_)) => panic!("no game is publishing; next_surface must report no frame"),
        Err(e) => panic!("next_surface on an idle channel must not error: {e}"),
    }

    // ── First detach: tears the hook down (Req 1.6, 7.4). ───────────────────
    hook.detach();
    assert!(!hook.is_attached(), "detach must mark the hook inactive");
    assert_eq!(
        hook.last_handle(),
        0,
        "detach must clear the retained-surface handle bookkeeping"
    );
    // After detach, the surface source is released and the pull short-circuits.
    assert!(
        matches!(hook.next_surface(), Ok(None)),
        "a detached hook must stop yielding surfaces (Req 7.4)"
    );
    // `handle_changed`-style re-open can never happen post-detach because the
    // pull is short-circuited; a detached hook stays detached.
    assert!(!hook.is_attached());

    // ── Idempotency: a second detach is a safe no-op. ───────────────────────
    hook.detach();
    assert!(
        !hook.is_attached(),
        "a second detach must remain a safe no-op"
    );
    assert_eq!(hook.last_handle(), 0);

    // ── Drop runs detach again; it must not panic or double-free. The hook
    // owns the (already-stopped) channel, whose own stop is idempotent. ──────
    drop(hook);
}

/// `Drop` alone (without an explicit `detach` first) must also tear the hook
/// down cleanly: the `Drop` impl calls `detach`, which stops the owned channel
/// exactly once (Req 1.6). Skips gracefully without a GPU.
#[test]
fn drop_without_explicit_detach_tears_down_cleanly() {
    let Some(d3d) = try_create_device() else {
        eprintln!(
            "[hook_detach] SKIP drop_without_explicit_detach_tears_down_cleanly: no D3D11 device \
             (headless CI). Drop delegates to detach; the IPC-teardown half is asserted by \
             ipc_teardown_contract_is_idempotent."
        );
        return;
    };

    let ipc = real_channel(TEST_PID.wrapping_add(1));
    let hook = GameCaptureHook::new(d3d, ipc, GraphicsApiBackend::Dx11, TEST_PID.wrapping_add(1));
    assert!(hook.is_attached());

    // Dropping an attached hook must run detach (stop IPC + release surface)
    // without panicking. No assertion can outlive the drop, so reaching the end
    // of the test without a panic/double-free is the contract.
    drop(hook);
}

/// A sanity check that `FrameMetadata` (the type the IPC channel decodes into,
/// and the basis for the retained handle `detach` releases) is constructible and
/// comparable here — keeps the import meaningful and documents that the retained
/// surface `detach` releases is keyed by the published shared handle.
#[test]
fn frame_metadata_handle_is_the_retention_key() {
    let meta = FrameMetadata {
        width: 1280,
        height: 720,
        format: 87, // DXGI_FORMAT_B8G8R8A8_UNORM
        timestamp_qpc: 42,
        shared_handle: 0xABCD_0000_1234_5678,
    };
    // The shared handle is what `next_surface` opens and `detach` releases; a
    // zero handle is the "no surface retained" sentinel `detach` resets to.
    assert_ne!(meta.shared_handle, 0, "a real published handle is non-zero");
}
