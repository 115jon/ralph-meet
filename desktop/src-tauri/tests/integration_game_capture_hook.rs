//! Hardware-gated, MANUAL integration tests for the universal Game_Capture_Hook
//! (task 11.4).
//!
//! Validates (manually, on a developer machine): Requirements 1.2, 1.3, 1.4,
//! 1.5, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 9.1, 9.2, 9.3, 9.5.
//!
//! # ⚠ Every test here is `#[ignore]` — they NEVER run in CI or a normal `cargo test`
//!
//! These tests drive the **real** end-to-end hook path: launching the reused OBS
//! `inject-helper` as a separate process, injecting the OBS `graphics-hook`
//! payload into a live target game, intercepting its `IDXGISwapChain::Present`,
//! reading the published `hook_info` over the OBS IPC channel, and opening the
//! DXGI shared handle on the `Shared_D3D_Device` with **no CPU readback**. None
//! of that is possible on a headless CI runner, and it cannot be faithfully
//! mocked without becoming a different test. So every test is annotated
//! `#[ignore = "manual hardware-gated: …"]` and is only ever run by a developer
//! who has deliberately set up the hardware + target + artifacts and invokes
//! them with `-- --ignored`.
//!
//! The key automated deliverable of this file is therefore that it **compiles**
//! under the `game-capture-hook` feature against the real public APIs
//! (`game_capture::inject`, `game_capture::obs_ipc`, `game_capture::dx11`,
//! `wmf_encoder`, `native_share`) — i.e. the host-side wiring is type-correct
//! and the tests are well-structured for the manual run.
//!
//! # Required setup for a manual run
//!
//! 1. **A real GPU** with a D3D11 hardware device (these tests use
//!    `D3dDevice::new`, the single `Shared_D3D_Device`).
//! 2. **The real OBS_Capture_Component artifacts** present next to the test
//!    executable / in `resources/obs-capture/`: `graphics-hook64.dll`,
//!    `graphics-hook32.dll`, `inject-helper64.exe`, `inject-helper32.exe`
//!    (GPLv2, not committed — see `resources/obs-capture/README.md`). Without
//!    them `plan_injection` returns `MissingArtifact` and the tests skip.
//! 3. **A running, windowed DX11 target game** (the spec's reference target is
//!    *Deadlock*, captured as a **window**, not exclusive fullscreen). Anything
//!    that is NOT an anti-cheat-protected title (see `blocklist.rs`) — never run
//!    injection against EAC/BattlEye/Vanguard titles.
//! 4. **The target selected via an environment variable** (documented below).
//!
//! ## Target selection environment variables
//!
//! - `RALPH_HOOK_TEST_PID` — the Target_Process **process id** (decimal or
//!   `0x`-hex). This is what injection needs directly.
//! - `RALPH_HOOK_TEST_WINDOW` — alternatively, the target **window handle**
//!   (decimal or `0x`-hex); the test resolves it to its owning process id with
//!   `GetWindowThreadProcessId`.
//!
//! If neither is set, every test **skips gracefully** (prints an explanatory
//! message and returns green) so a developer can run `-- --ignored` to confirm
//! the harness without a game attached.
//!
//! ## Example (Windows PowerShell, from `desktop/src-tauri`, CEF env vars set per tech.md)
//!
//! ```powershell
//! # 1. Launch the windowed DX11 target and note its PID (Task Manager → Details).
//! $env:RALPH_HOOK_TEST_PID = "12345"
//! # 2. Run the ignored hardware tests with output:
//! cargo test --features game-capture-hook --test integration_game_capture_hook -- --ignored --nocapture
//! ```
//!
//! Per-test manual verification expectations are documented on each test.
//!
//! # Per-backend gating (Requirement 3)
//!
//! DX11 is the only backend whose enablement gate is on
//! (`BackendGate::dx11_only`), so only the DX11 interception tests are
//! meaningfully runnable today. DX12 / Vulkan / OpenGL each have an `#[ignore]`
//! **stub** documenting the interception the reused OBS payload provides (Req
//! 3.5, 3.6, 3.7, 4.2); those stubs assert the backend is currently gated off
//! and are to be fleshed out and enabled as each gate flips on.

#![cfg(all(feature = "game-capture-hook", windows))]

use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use app_lib::d3d_device::D3dDevice;
use app_lib::game_capture::dx11::{open_shared_surface, GameCaptureHook, SharedSurface};
use app_lib::game_capture::inject::{
    detect_bitness, plan_injection, run_inject_helper, Bitness, InjectStrategy, ObsArtifacts,
};
use app_lib::game_capture::obs_ipc::{FrameMetadata, ObsIpcChannel};
use app_lib::game_capture::{
    BackendGate, CaptureMode, GraphicsApiBackend, InjectionOutcome, SourceKind,
};
use app_lib::native_share::NativeShareStats;
use app_lib::wmf_encoder::{MftEncoderWorker, VideoCodec};

use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::Graphics::Direct3D11::{ID3D11Texture2D, D3D11_TEXTURE2D_DESC};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_UNKNOWN;
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

// ── Target selection env vars (documented in the module header) ─────────────

/// Env var carrying the Target_Process **process id** (decimal or `0x`-hex).
const TARGET_PID_ENV: &str = "RALPH_HOOK_TEST_PID";
/// Env var carrying the target **window handle** (decimal or `0x`-hex); resolved
/// to its owning process id with `GetWindowThreadProcessId`.
const TARGET_WINDOW_ENV: &str = "RALPH_HOOK_TEST_WINDOW";

/// How long a test polls for the first published frame before giving up. Long
/// enough to catch a frame at any normal present rate; bounded so a misconfigured
/// run fails fast rather than hanging.
const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(10);

/// Per-frame IPC wait bound for the channel (ms). Short so the capture loop stays
/// responsive to stop/exit and the no-frame watchdog (Req 8.3).
const FRAME_WAIT_MS: u32 = 100;

// ── Parsing / target-resolution helpers ─────────────────────────────────────

/// Parse a `u32` from a string accepting decimal or `0x`/`0X`-prefixed hex.
fn parse_u32(raw: &str) -> Option<u32> {
    let trimmed = raw.trim();
    let parsed = if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        u32::from_str_radix(hex, 16)
    } else {
        trimmed.parse::<u32>()
    };
    parsed.ok().filter(|v| *v != 0)
}

/// Parse an `isize` window handle from a string accepting decimal or hex.
fn parse_isize(raw: &str) -> Option<isize> {
    let trimmed = raw.trim();
    let parsed = if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        isize::from_str_radix(hex, 16)
    } else {
        trimmed.parse::<isize>()
    };
    parsed.ok().filter(|v| *v != 0)
}

/// Resolve the owning process id of a window handle via `GetWindowThreadProcessId`.
fn pid_from_window(hwnd: isize) -> Option<u32> {
    let mut pid: u32 = 0;
    let tid = unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut core::ffi::c_void), Some(&mut pid)) };
    // A zero thread id means the window handle was invalid.
    if tid != 0 && pid != 0 {
        Some(pid)
    } else {
        None
    }
}

/// Resolve the Target_Process pid from the environment: prefer
/// `RALPH_HOOK_TEST_PID`, else resolve `RALPH_HOOK_TEST_WINDOW` to its owning
/// pid. Returns `None` when neither is set (the test then skips gracefully).
fn resolve_target_pid() -> Option<u32> {
    if let Some(pid) = std::env::var(TARGET_PID_ENV).ok().and_then(|v| parse_u32(&v)) {
        return Some(pid);
    }
    let hwnd = std::env::var(TARGET_WINDOW_ENV).ok().and_then(|v| parse_isize(&v))?;
    pid_from_window(hwnd)
}

/// The host process bitness, derived from the compiled pointer width. The host
/// is whatever this test binary was built as (x64 in the normal toolchain).
fn host_bitness() -> Bitness {
    if std::mem::size_of::<usize>() == 8 {
        Bitness::X64
    } else {
        Bitness::X86
    }
}

/// Try to create the shared D3D11 hardware device. Returns `None` (rather than
/// panicking) when no GPU/D3D11 is available so a manual run on a headless box
/// skips gracefully — mirroring `integration_dx11_hook::try_create_device`.
fn try_create_device() -> Option<Arc<D3dDevice>> {
    match D3dDevice::new() {
        Ok(d3d) => Some(d3d),
        Err(e) => {
            eprintln!("[integration_game_capture_hook] D3dDevice::new() unavailable: {e}");
            None
        }
    }
}

/// Read a texture's `(width, height, format)` from its D3D11 descriptor.
fn texture_desc(texture: &ID3D11Texture2D) -> (u32, u32, u32) {
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    (desc.Width, desc.Height, desc.Format.0 as u32)
}

/// The full inject → IPC handshake the DX11 tests share.
///
/// Resolves the target pid, detects its bitness, discovers the OBS artifacts,
/// plans + runs injection through the OBS `inject-helper`, and on `Success`
/// starts an `ObsIpcChannel`. Returns:
///   - `Ok(Some((pid, channel)))` when injection succeeded and IPC is live,
///   - `Ok(None)` when the test should **skip** (no target set, no artifacts, or
///     a valid non-`Success` injection outcome such as an anti-cheat block),
///   - never panics on a skip path — only genuine assertion failures panic in
///     the callers.
fn inject_and_start_channel(test_name: &str) -> Option<(u32, ObsIpcChannel)> {
    let Some(target_pid) = resolve_target_pid() else {
        eprintln!(
            "[integration_game_capture_hook] SKIP {test_name}: set {TARGET_PID_ENV} (or \
             {TARGET_WINDOW_ENV}) to a running, windowed, non-anti-cheat DX11 target to run \
             the hardware path. See the module doc-comment."
        );
        return None;
    };

    // Target bitness via IsWow64Process2 (Req 2). A failure here means we cannot
    // even open the target for query — treat as a skip, not a failure.
    let target_bitness = match detect_bitness(target_pid) {
        Ok(b) => b,
        Err(e) => {
            eprintln!(
                "[integration_game_capture_hook] SKIP {test_name}: detect_bitness({target_pid}) \
                 failed ({e}); is the pid valid and queryable?"
            );
            return None;
        }
    };

    // Discover the real OBS artifacts shipped next to the binary (Req 2.5, 12.x).
    let artifacts = ObsArtifacts::discover_next_to_binary();
    let strategy = match plan_injection(host_bitness(), target_bitness, &artifacts) {
        Ok(s) => s,
        Err(reason) => {
            eprintln!(
                "[integration_game_capture_hook] SKIP {test_name}: plan_injection returned \
                 {reason:?} (host={:?}, target={target_bitness:?}). The real OBS artifacts must \
                 be present in resources/obs-capture/ for the matching bitness.",
                host_bitness()
            );
            return None;
        }
    };
    document_strategy(strategy, target_bitness);

    // Launch the OBS inject-helper as a SEPARATE process (no GPL linkage) and map
    // the outcome (Req 1.1, 7.4, 10.4, 11.x).
    match run_inject_helper(strategy, &artifacts, target_pid) {
        InjectionOutcome::Success => {}
        InjectionOutcome::Blocked => {
            // A *correct* fallback path: anti-cheat / OpenProcess denied. The
            // session would fall back to WGC (Req 10.4); nothing to capture here.
            eprintln!(
                "[integration_game_capture_hook] SKIP {test_name}: injection into pid \
                 {target_pid} was Blocked (anti-cheat / ACCESS_DENIED). This is a valid WGC \
                 fallback path; not a test failure."
            );
            return None;
        }
        outcome @ (InjectionOutcome::Failed | InjectionOutcome::NotAttempted) => {
            eprintln!(
                "[integration_game_capture_hook] SKIP {test_name}: injection into pid \
                 {target_pid} did not succeed ({outcome:?}). Verify the target is a windowed \
                 DX11 app and the matching-bitness artifacts are present."
            );
            return None;
        }
    }

    // Injection succeeded — open the OBS IPC channel and signal the hook to start
    // (Req 1.4).
    match ObsIpcChannel::start_with_timeout(target_pid, FRAME_WAIT_MS) {
        Ok(channel) => Some((target_pid, channel)),
        Err(e) => {
            eprintln!(
                "[integration_game_capture_hook] SKIP {test_name}: ObsIpcChannel::start failed \
                 for pid {target_pid} ({e})."
            );
            None
        }
    }
}

/// Log which injection strategy was chosen, asserting the bitness invariant the
/// planner guarantees (Req 2.4): the selected payload bitness equals the target.
fn document_strategy(strategy: InjectStrategy, target_bitness: Bitness) {
    assert_eq!(
        strategy.payload(),
        target_bitness,
        "the selected payload bitness must equal the Target_Bitness (Req 2.4)"
    );
    match strategy {
        InjectStrategy::Direct { payload } => eprintln!(
            "[integration_game_capture_hook] injecting DIRECT (matching bitness, payload={payload:?})"
        ),
        InjectStrategy::CrossBitness { payload, helper } => eprintln!(
            "[integration_game_capture_hook] injecting CROSS-BITNESS via inject-helper \
             (payload={payload:?}, helper={helper:?})"
        ),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Test 1 — DX11 inject + Present interception + zero-copy shared-handle open
//          (Req 1.2, 1.3, 1.4, 4.1)
// ════════════════════════════════════════════════════════════════════════════

/// **DX11 payload injects, intercepts `IDXGISwapChain::Present`, and the host
/// opens the published shared handle on the `Shared_D3D_Device` with NO CPU
/// readback (zero-copy).**
///
/// Flow:
/// 1. Inject the OBS `graphics-hook` payload into the DX11 target via the OBS
///    `inject-helper` (Req 1.2 — the payload installs the DX11 Present
///    interception; Req 3.4 — it intercepts `IDXGISwapChain::Present`).
/// 2. Pull `FrameMetadata` over the OBS IPC channel (Req 1.4 — the hook
///    publishes the shared-handle + dimensions/format/timestamp).
/// 3. Open the shared handle with `open_shared_surface` →
///    `ID3D11Device::OpenSharedResource` on the `Shared_D3D_Device` (Req 1.3,
///    4.1 — vendor-neutral D3D11 `SharedSurface`, no CPU-side readback).
/// 4. Assert the opened surface's dimensions/format are sane and agree with the
///    metadata the hook published.
///
/// Manual verification (Req 1.3 zero-copy): in a GPU capture (PIX / RenderDoc)
/// confirm a single same-device `OpenSharedResource` and **no** staging-texture
/// `Map`/readback, and confirm no measurable in-game FPS drop (RTSS).
#[test]
#[ignore = "manual hardware-gated: needs a real GPU, the OBS artifacts, and a running DX11 target (set RALPH_HOOK_TEST_PID)"]
fn dx11_injects_intercepts_present_and_opens_shared_handle_zero_copy() {
    let Some(d3d) = try_create_device() else {
        eprintln!("[integration_game_capture_hook] SKIP: no D3D11 hardware device available.");
        return;
    };

    let Some((target_pid, mut channel)) =
        inject_and_start_channel("dx11_injects_intercepts_present_and_opens_shared_handle_zero_copy")
    else {
        return;
    };

    // Poll the IPC channel for the first published frame metadata (Req 1.4).
    let meta = match poll_first_metadata(&mut channel) {
        Some(meta) => meta,
        None => {
            eprintln!(
                "[integration_game_capture_hook] SKIP: no frame published by the hook within \
                 {FIRST_FRAME_TIMEOUT:?} for pid {target_pid}. Is the target actively presenting \
                 (focused / not minimized)?"
            );
            return;
        }
    };

    // The published metadata must describe a real shared texture (Req 1.4).
    assert_ne!(
        meta.shared_handle, 0,
        "the hook must publish a non-zero DXGI shared handle for the shtex path"
    );
    assert!(
        meta.width > 0 && meta.height > 0,
        "the hook must publish sane backbuffer dimensions, got {}x{}",
        meta.width,
        meta.height
    );
    assert_ne!(
        meta.format,
        DXGI_FORMAT_UNKNOWN.0 as u32,
        "the hook must publish a concrete swapchain DXGI_FORMAT, not UNKNOWN"
    );

    // ── Req 1.3 / 4.1: open the shared handle zero-copy on the Shared_D3D_Device ──
    // `open_shared_surface` aliases the already-resident backbuffer copy via
    // `OpenSharedResource`; the very type it returns (an ID3D11Texture2D) proves
    // zero-copy — there is no Vec<u8>/staging readback on this path.
    let handle = HANDLE(meta.shared_handle as *mut core::ffi::c_void);
    let surface: SharedSurface = open_shared_surface(&d3d, handle)
        .expect("opening the published shared backbuffer handle on the Shared_D3D_Device must succeed");

    assert!(
        surface.width > 0 && surface.height > 0,
        "the opened shared surface must carry the backbuffer dimensions, got {}x{}",
        surface.width,
        surface.height
    );

    // The opened texture's descriptor must agree with the surface struct and the
    // published metadata (a vendor-neutral D3D11 surface — Req 4.1).
    let (tex_w, tex_h, tex_fmt) = texture_desc(&surface.texture);
    assert_eq!(
        (tex_w, tex_h),
        (surface.width, surface.height),
        "the opened texture descriptor must match the SharedSurface dimensions"
    );
    assert_eq!(
        (surface.width, surface.height),
        (meta.width, meta.height),
        "the opened surface dimensions must match the hook's published metadata"
    );
    assert_ne!(tex_fmt, DXGI_FORMAT_UNKNOWN.0 as u32, "opened texture format must be concrete");

    eprintln!(
        "[integration_game_capture_hook] OK: intercepted DX11 Present, opened zero-copy shared \
         surface {tex_w}x{tex_h} (fmt {tex_fmt}) from pid {target_pid}"
    );

    channel.stop();
}

// ════════════════════════════════════════════════════════════════════════════
// Test 2 — Feed-the-encoder smoke: hook frames flow into the encoder channel
//          (Req 1.5, 3.5)
// ════════════════════════════════════════════════════════════════════════════

/// **The intercepted frames flow, as zero-copy `CapturedFrame`s, into the real
/// encoder frame channel — and the original app keeps presenting (Req 1.5).**
///
/// This is the "feed the encoder" smoke test: it builds the real
/// `MftEncoderWorker` (vendor-neutral encoder selection, Req 3.5 / 6.x), then
/// pumps frames from the live `GameCaptureHook::next_captured_frame` into the
/// worker's `frame_tx` exactly as the session would (Req 1.5 / 7.1). Reaching
/// several encoded frames without the target stalling demonstrates the original
/// present function is still invoked (Req 1.5).
///
/// Manual verification: the WebRTC/encoded output is non-empty and the target
/// game continues to display frames normally throughout.
#[test]
#[ignore = "manual hardware-gated: needs a real GPU, the OBS artifacts, and a running DX11 target (set RALPH_HOOK_TEST_PID)"]
fn dx11_hook_frames_feed_the_encoder() {
    let Some(d3d) = try_create_device() else {
        eprintln!("[integration_game_capture_hook] SKIP: no D3D11 hardware device available.");
        return;
    };

    let Some((target_pid, channel)) = inject_and_start_channel("dx11_hook_frames_feed_the_encoder")
    else {
        return;
    };

    // Encode dimensions (downscale target). Capture frames are capped to these.
    let encode_w = 1280u32;
    let encode_h = 720u32;
    let fps = 60u32;
    let bitrate = 6_000_000u32;

    let stats = Arc::new(NativeShareStats::default());
    let (output_tx, output_rx) = mpsc::sync_channel::<Vec<u8>>(8);

    // Build the real encoder worker (selects a vendor-neutral encoder, Req 3.5).
    // src dims are reported as the encode dims here; the real session uses the
    // capture dims, but the smoke test only needs a live encoder to accept frames.
    let mut encoder = match MftEncoderWorker::new(
        VideoCodec::H264,
        encode_w,
        encode_h,
        encode_w,
        encode_h,
        fps,
        bitrate,
        Arc::clone(&d3d),
        output_tx,
        Arc::clone(&stats),
    ) {
        Ok(worker) => worker,
        Err(e) => {
            eprintln!(
                "[integration_game_capture_hook] SKIP: could not initialize the encoder \
                 ({e}); a hardware or software MFT must be available."
            );
            return;
        }
    };
    eprintln!(
        "[integration_game_capture_hook] encoder backend selected: {}",
        encoder.selected_backend().as_str()
    );

    // Pump hook frames into the encoder, retain-at-most-one (Req 7.5) enforced by
    // pulling the next frame only after the prior one's release token fires.
    let mut hook = GameCaptureHook::new(d3d, channel, GraphicsApiBackend::Dx11, target_pid);
    let mut fed = 0u32;
    let deadline = Instant::now() + FIRST_FRAME_TIMEOUT;
    while fed < 30 && Instant::now() < deadline {
        match hook.next_captured_frame(encode_w, encode_h) {
            Ok(Some(frame)) => {
                let release = Arc::clone(&frame.release);
                if encoder.try_send_frame(frame) {
                    fed += 1;
                    // Wait briefly for the encoder to consume + release the frame
                    // so at most one surface is in flight (Req 7.5).
                    let wait_release = Instant::now() + Duration::from_millis(50);
                    while !release.load(std::sync::atomic::Ordering::Acquire)
                        && Instant::now() < wait_release
                    {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
            Err(e) => panic!("pulling a hook frame for the encoder failed: {e}"),
        }
    }

    encoder.stop();

    assert!(
        fed > 0,
        "at least one hook frame must reach the encoder channel within {FIRST_FRAME_TIMEOUT:?} \
         (Req 1.5). Is the target actively presenting?"
    );

    // Drain any encoded output the worker produced; non-empty output confirms the
    // captured frames were actually encoded.
    let encoded = output_rx.try_iter().count();
    eprintln!(
        "[integration_game_capture_hook] OK: fed {fed} hook frames to the encoder, drained \
         {encoded} encoded buffers (encoder backend {})",
        encoder.selected_backend().as_str()
    );
}

// ════════════════════════════════════════════════════════════════════════════
// Test 3 — Fullscreen ↔ windowed transition survival (Req 9.1)
// ════════════════════════════════════════════════════════════════════════════

/// **Capture continues across a fullscreen↔windowed transition (Req 9.1).**
///
/// Captures a baseline frame, then prompts the operator to toggle the target
/// between windowed and fullscreen presentation (e.g. Alt+Enter) and confirms a
/// frame is still delivered afterward without the session terminating. A
/// fullscreen↔windowed switch typically recreates the swapchain, so this also
/// exercises the re-open-on-handle-change path (Req 9.2), but the contract under
/// test here is simply **continuity**.
///
/// Manual step: while the test waits, perform the fullscreen↔windowed toggle in
/// the target. The test polls for continued frame delivery across the change.
#[test]
#[ignore = "manual hardware-gated + interactive: requires toggling the target's fullscreen state during the run"]
fn dx11_capture_survives_fullscreen_windowed_transition() {
    let Some(d3d) = try_create_device() else {
        eprintln!("[integration_game_capture_hook] SKIP: no D3D11 hardware device available.");
        return;
    };

    let Some((target_pid, channel)) =
        inject_and_start_channel("dx11_capture_survives_fullscreen_windowed_transition")
    else {
        return;
    };

    let mut hook = GameCaptureHook::new(d3d, channel, GraphicsApiBackend::Dx11, target_pid);

    // Baseline: confirm capture is live before the transition.
    let before = poll_first_surface_dims(&mut hook);
    let Some(before) = before else {
        eprintln!(
            "[integration_game_capture_hook] SKIP: no baseline frame before the transition; is \
             the target presenting?"
        );
        return;
    };
    eprintln!(
        "[integration_game_capture_hook] baseline {}x{} — NOW toggle the target between \
         windowed and fullscreen (e.g. Alt+Enter) within the next {FIRST_FRAME_TIMEOUT:?}…",
        before.0, before.1
    );

    // After the operator toggles fullscreen/windowed, capture must continue
    // (Req 9.1). Poll for any subsequent frame — possibly at new dimensions.
    let after = poll_first_surface_dims(&mut hook);
    assert!(
        after.is_some(),
        "capture must continue across the fullscreen↔windowed transition without terminating \
         (Req 9.1); no frame was delivered after the transition window"
    );
    assert!(
        !hook.target_exited(),
        "the target must not be reported as exited merely due to a presentation-mode change"
    );

    let after = after.unwrap();
    eprintln!(
        "[integration_game_capture_hook] OK: capture continued across transition ({}x{} → \
         {}x{})",
        before.0, before.1, after.0, after.1
    );

    hook.detach();
}

// ════════════════════════════════════════════════════════════════════════════
// Test 4 — Swapchain resize → handle change → host re-opens (Req 9.2)
// ════════════════════════════════════════════════════════════════════════════

/// **A swapchain resize republishes a NEW shared handle, and the host releases
/// the prior surface and re-opens the new one (Req 9.2).**
///
/// Records the handle of the first opened surface, then prompts the operator to
/// resize the target window (which recreates/resizes the swapchain). The hook
/// republishes a different `shared_handle`; `ObsIpcChannel::handle_changed`
/// returns true and `GameCaptureHook` opens the new handle. The test asserts the
/// published handle actually changed and a fresh surface was opened at the new
/// dimensions — retain-at-most-one means the prior surface was released first.
///
/// Manual step: while the test waits, **resize the target window** to new
/// dimensions.
#[test]
#[ignore = "manual hardware-gated + interactive: requires resizing the target window during the run"]
fn dx11_swapchain_resize_changes_handle_and_reopens() {
    let Some(d3d) = try_create_device() else {
        eprintln!("[integration_game_capture_hook] SKIP: no D3D11 hardware device available.");
        return;
    };

    let Some((target_pid, mut channel)) =
        inject_and_start_channel("dx11_swapchain_resize_changes_handle_and_reopens")
    else {
        return;
    };

    // Read the first metadata directly from the channel so we can compare raw
    // published handles across the resize (the handle is the resize signal).
    let Some(first) = poll_first_metadata(&mut channel) else {
        eprintln!(
            "[integration_game_capture_hook] SKIP: no first frame before resize; is the target \
             presenting?"
        );
        return;
    };
    assert!(channel.handle_changed(&first), "the very first handle counts as a change");
    // Open it on the Shared_D3D_Device and record it as the currently-open handle.
    let handle = HANDLE(first.shared_handle as *mut core::ffi::c_void);
    let first_surface = open_shared_surface(&d3d, handle)
        .expect("opening the first shared handle must succeed");
    channel.mark_handle_opened(&first);
    eprintln!(
        "[integration_game_capture_hook] first surface {}x{} (handle {:#x}) — NOW RESIZE the \
         target window within the next {FIRST_FRAME_TIMEOUT:?}…",
        first_surface.width, first_surface.height, first.shared_handle
    );
    // Release the prior surface before opening the next (retain-at-most-one).
    drop(first_surface);

    // Poll until the hook publishes a CHANGED handle (the resize), then re-open.
    let deadline = Instant::now() + FIRST_FRAME_TIMEOUT;
    let mut changed: Option<FrameMetadata> = None;
    while Instant::now() < deadline {
        match channel.next_metadata() {
            Ok(Some(meta)) if meta.shared_handle != 0 && channel.handle_changed(&meta) => {
                changed = Some(meta);
                break;
            }
            Ok(_) => {}
            Err(e) => panic!("reading metadata across the resize failed: {e}"),
        }
    }

    let Some(changed) = changed else {
        eprintln!(
            "[integration_game_capture_hook] SKIP: no swapchain resize observed (the published \
             handle never changed). Did you resize the target window?"
        );
        channel.stop();
        return;
    };

    assert_ne!(
        changed.shared_handle, first.shared_handle,
        "a swapchain resize must republish a different shared handle (Req 9.2)"
    );

    // The host re-opens the new handle on the same device (Req 9.2).
    let new_handle = HANDLE(changed.shared_handle as *mut core::ffi::c_void);
    let new_surface = open_shared_surface(&d3d, new_handle)
        .expect("re-opening the resized swapchain's new shared handle must succeed");
    channel.mark_handle_opened(&changed);

    assert!(
        new_surface.width > 0 && new_surface.height > 0,
        "the re-opened surface must carry the new backbuffer dimensions"
    );
    eprintln!(
        "[integration_game_capture_hook] OK: resize re-open — handle {:#x} ({}x{}) → {:#x} \
         ({}x{}) for pid {target_pid}",
        first.shared_handle,
        first.width,
        first.height,
        changed.shared_handle,
        new_surface.width,
        new_surface.height
    );

    channel.stop();
}

// ════════════════════════════════════════════════════════════════════════════
// Test 5 — Target exit survival (Req 9.3 / 9.5)
// ════════════════════════════════════════════════════════════════════════════

/// **When the target exits, the hook detects it (`target_exited()` true) and the
/// session detaches/releases cleanly without crashing (Req 9.3 / 9.5).**
///
/// Confirms capture is live, then prompts the operator to **close the target
/// game**. The hook's `target_exited()` must flip to true (the OBS exit event /
/// keepalive going away), after which `detach()` releases the surface + IPC and
/// is idempotent — modeling the session's mid-session fall-back-to-WGC path
/// (Req 8.3) without a crash (Req 9.5).
///
/// Manual step: while the test waits, **close the target game**.
#[test]
#[ignore = "manual hardware-gated + interactive: requires closing the target game during the run"]
fn dx11_target_exit_is_detected_and_detaches_cleanly() {
    let Some(d3d) = try_create_device() else {
        eprintln!("[integration_game_capture_hook] SKIP: no D3D11 hardware device available.");
        return;
    };

    let Some((target_pid, channel)) =
        inject_and_start_channel("dx11_target_exit_is_detected_and_detaches_cleanly")
    else {
        return;
    };

    let mut hook = GameCaptureHook::new(d3d, channel, GraphicsApiBackend::Dx11, target_pid);

    // Confirm capture is live before asking for the exit.
    if poll_first_surface_dims(&mut hook).is_none() {
        eprintln!(
            "[integration_game_capture_hook] SKIP: no frame before requesting exit; is the \
             target presenting?"
        );
        return;
    }
    eprintln!(
        "[integration_game_capture_hook] capture live for pid {target_pid} — NOW CLOSE the \
         target game within the next {FIRST_FRAME_TIMEOUT:?}…"
    );

    // Poll until the hook reports the target exited (Req 9.3).
    let deadline = Instant::now() + FIRST_FRAME_TIMEOUT;
    let mut exited = false;
    while Instant::now() < deadline {
        // Keep pulling so the channel observes the exit event/keepalive loss.
        let _ = hook.next_captured_frame(1280, 720);
        if hook.target_exited() {
            exited = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    assert!(
        exited,
        "the hook must detect the target's exit via target_exited() within {FIRST_FRAME_TIMEOUT:?} \
         (Req 9.3). Did you close the target game?"
    );

    // Detach must release the surface + IPC cleanly and be idempotent (Req 9.5).
    hook.detach();
    assert!(!hook.is_attached(), "detach after target exit must mark the hook inactive");
    hook.detach(); // idempotent: a second detach is a safe no-op.
    assert!(!hook.is_attached());

    // A detached hook yields no further frames and never crashes (Req 9.5).
    assert!(
        matches!(hook.next_captured_frame(1280, 720), Ok(None)),
        "a detached hook must stop yielding frames after the target exits"
    );

    eprintln!(
        "[integration_game_capture_hook] OK: target exit detected and the hook detached cleanly \
         (pid {target_pid})"
    );
}

// ── Shared polling helpers ───────────────────────────────────────────────────

/// Poll the IPC channel for the first published `FrameMetadata` with a non-zero
/// shared handle, bounded by [`FIRST_FRAME_TIMEOUT`]. Returns `None` on timeout
/// or if the target exits first.
fn poll_first_metadata(channel: &mut ObsIpcChannel) -> Option<FrameMetadata> {
    let deadline = Instant::now() + FIRST_FRAME_TIMEOUT;
    while Instant::now() < deadline {
        if channel.target_exited() {
            return None;
        }
        match channel.next_metadata() {
            Ok(Some(meta)) if meta.shared_handle != 0 => return Some(meta),
            Ok(_) => {}
            Err(e) => panic!("reading the first frame metadata failed: {e}"),
        }
    }
    None
}

/// Poll the hook for the next opened surface's `(width, height)`, bounded by
/// [`FIRST_FRAME_TIMEOUT`]. Returns `None` on timeout. Reads through
/// `GameCaptureHook::next_captured_frame` so it exercises the same host wiring
/// the session uses; the returned frame is dropped immediately (releasing its
/// surface, retain-at-most-one).
fn poll_first_surface_dims(hook: &mut GameCaptureHook) -> Option<(u32, u32)> {
    let deadline = Instant::now() + FIRST_FRAME_TIMEOUT;
    while Instant::now() < deadline {
        if hook.target_exited() {
            return None;
        }
        match hook.next_captured_frame(u32::MAX, u32::MAX) {
            // cap_width/height = u32::MAX so the reported dims are the surface's
            // own (min with MAX is the surface value) — we want the real size.
            Ok(Some(frame)) => return Some((frame.width, frame.height)),
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
            Err(e) => panic!("pulling a surface from the hook failed: {e}"),
        }
    }
    None
}

// ════════════════════════════════════════════════════════════════════════════
// Per-backend interception gating — DX12 enabled; Vulkan / OpenGL stubs (Req
// 3.6, 3.7, 4.2). Enabled incrementally as each backend's gate flips on (Req
// 3.2).
// ════════════════════════════════════════════════════════════════════════════
//
// The reused OBS payload already intercepts DX12 (via the shared
// `IDXGISwapChain::Present` path), Vulkan (`vkQueuePresentKHR` +
// `vkCreateSwapchainKHR`), and OpenGL (`wglSwapBuffers`/`SwapBuffers`) and
// copies each backbuffer into a D3D11 `SharedSurface` via Cross_API_Interop
// (Req 4.2). The HOST side SELECTS a backend whose `BackendGate` is on: DX11 and
// DX12 share the DXGI present hook and are both enabled (`BackendGate::dxgi`,
// Req 3.1). Vulkan/OpenGL stubs document each backend's interception entry point
// and assert it is currently gated OFF; when a gate is flipped on, replace the
// gated-off assertion with the full inject→intercept→open flow.

/// DX12 presents through the same DXGI swapchain as DX11, so it is captured via
/// the shared present hook and is an active backend under the DXGI gate
/// (Req 3.1, 8.2). It is gated OFF only under the legacy DX11-only gate.
#[test]
fn dx12_present_interception_is_enabled_via_dxgi_gate() {
    // DX12 is active-capable (shares the DXGI present-hook path).
    assert!(
        GraphicsApiBackend::Dx12.is_active_capable(),
        "DX12 must be active-capable (shared DXGI present hook, Req 8.2)"
    );
    // Enabled under the production DXGI gate, off under the legacy DX11-only one.
    assert!(
        BackendGate::dxgi().enabled(GraphicsApiBackend::Dx12),
        "DX12 must be enabled under the DXGI gate (Req 3.1)"
    );
    assert!(
        !BackendGate::dx11_only().enabled(GraphicsApiBackend::Dx12),
        "DX12 stays off under the legacy DX11-only gate"
    );
}

/// Vulkan presents are intercepted by the implicit Vulkan layer
/// (`vkQueuePresentKHR`), activated by the loader once the manifest is
/// registered (see `vulkan_layer`) and coordinated with the injected capture
/// thread/IPC. Vulkan is active-capable and enabled under the production DXGI
/// gate; it is gated OFF only under the legacy DX11-only gate.
#[test]
fn vulkan_present_interception_is_enabled_via_dxgi_gate() {
    assert!(
        GraphicsApiBackend::Vulkan.is_active_capable(),
        "Vulkan must be active-capable (implicit-layer + IPC path)"
    );
    assert!(
        BackendGate::dxgi().enabled(GraphicsApiBackend::Vulkan),
        "Vulkan must be enabled under the production DXGI gate (Req 3.1)"
    );
    assert!(
        !BackendGate::dx11_only().enabled(GraphicsApiBackend::Vulkan),
        "Vulkan stays off under the legacy DX11-only gate"
    );
}

/// OpenGL interception is gated OFF today (Req 3.2/3.3); when enabled, the OBS
/// payload intercepts `wglSwapBuffers` and `SwapBuffers` (Req 3.7), copying the
/// backbuffer into a D3D11 `SharedSurface` via Cross_API_Interop (Req 4.2).
#[test]
#[ignore = "manual hardware-gated: OpenGL backend interception, gated OFF until the OpenGL gate is enabled (Req 3.2)"]
fn opengl_present_interception_is_gated_off_until_enabled() {
    assert!(
        !BackendGate::dx11_only().enabled(GraphicsApiBackend::OpenGl),
        "OpenGL must be gated OFF in the DX11-first default (Req 3.2/3.3)"
    );
    assert!(
        !GraphicsApiBackend::OpenGl.is_active_capable(),
        "OpenGL must not be active-capable until its gate is proven (Req 3.2)"
    );
    eprintln!(
        "[integration_game_capture_hook] OpenGL interception (wglSwapBuffers/SwapBuffers, \
         Req 3.7) is gated off; enable the OpenGL gate and replace this stub with the full \
         inject→intercept→open flow incl. Cross_API_Interop (Req 4.2)."
    );
}

// ── Compile-time / gate sanity (the one always-meaningful automated check) ──

/// A non-`#[ignore]` sanity check that the DX11-first backend gate and the
/// capture-mode contract the hardware tests rely on hold. This is the only test
/// in this file that runs in a normal `cargo test` (everything else is manual,
/// hardware-gated). It guards the structural assumptions baked into the gated
/// tests above so a regression in the gate is caught without hardware.
#[test]
fn dx11_first_gating_contract_holds() {
    let gate = BackendGate::dx11_only();
    assert!(gate.enabled(GraphicsApiBackend::Dx11), "DX11 is the first enabled backend (Req 3.1)");
    assert!(!gate.enabled(GraphicsApiBackend::Dx12));
    assert!(!gate.enabled(GraphicsApiBackend::Vulkan));
    assert!(!gate.enabled(GraphicsApiBackend::OpenGl));

    // The production DXGI gate enables DX11, DX12, and Vulkan; OpenGL stays off
    // (Req 3.1, 8.2).
    let dxgi = BackendGate::dxgi();
    assert!(dxgi.enabled(GraphicsApiBackend::Dx11));
    assert!(dxgi.enabled(GraphicsApiBackend::Dx12));
    assert!(dxgi.enabled(GraphicsApiBackend::Vulkan));
    assert!(!dxgi.enabled(GraphicsApiBackend::OpenGl));

    // DX11, DX12, and Vulkan may be the active hook backend; OpenGL may not yet
    // (Req 3.1/3.2, 8.2).
    assert!(GraphicsApiBackend::Dx11.is_active_capable());
    assert!(GraphicsApiBackend::Dx12.is_active_capable());
    assert!(GraphicsApiBackend::Vulkan.is_active_capable());
    assert!(!GraphicsApiBackend::OpenGl.is_active_capable());

    // Stable status strings the hardware tests print/inspect.
    assert_eq!(CaptureMode::Hook.as_str(), "hook");
    assert_eq!(CaptureMode::Wgc.as_str(), "wgc");
    assert_eq!(GraphicsApiBackend::Dx11.as_str(), "dx11");

    // Only a real, successful interception authorizes hook mode (Req 1.x/9.x);
    // every other outcome falls back. The hardware tests rely on this.
    assert!(InjectionOutcome::Success.is_success());
    assert!(!InjectionOutcome::Blocked.is_success());
    assert!(!InjectionOutcome::Failed.is_success());
    assert!(!InjectionOutcome::NotAttempted.is_success());

    // A window source is the only hook candidate; a monitor is always WGC.
    assert_eq!(SourceKind::Window, SourceKind::Window);
    assert_ne!(SourceKind::Window, SourceKind::Monitor);
}
