//! Unit test for the hook-surface frame adapter
//! (`CapturedFrame::from_hook_surface`) — task 7.2.
//!
//! Validates: Requirements 7.1
//!   - 7.1: while the active Capture_Mode is `hook`, the pipeline feeds the
//!          Shared_Surfaces published by the Hook_Payload into the encoder frame
//!          channel **in place of** WGC frames. The adapter is the seam that
//!          makes that possible: it turns a `SharedSurface` + the OBS
//!          `FrameMetadata` that described it into exactly the `CapturedFrame`
//!          the WGC `FrameArrived` callback produces, so the single encoder path
//!          serves both origins unchanged.
//!
//! # What this asserts
//!
//! For a `SharedSurface` + `FrameMetadata`, `from_hook_surface` must produce a
//! `CapturedFrame` whose:
//!   1. dimensions are the surface dimensions **capped to the encode size** —
//!      `min(surface.*, encode_*)` — tested in both the uncapped (surface
//!      smaller than encode) and capped (surface larger than encode) cases;
//!   2. `pts_hns` is the converted OBS timestamp. The conversion
//!      (`wgc_capture::hook_pts_hns`) is currently a documented **pass-through**
//!      (QPC ticks are forwarded unchanged until the units are reconciled
//!      against the pinned OBS source — see the `TODO(verify-units)` there), so
//!      the adapter must forward `meta.timestamp_qpc` verbatim;
//!   3. retention token is **hook-origin** (`FrameOrigin::Hook`), asserted via
//!      the minimal `CapturedFrame::is_hook_origin()` accessor added to
//!      `wgc_capture.rs` (the `origin` field itself is private, so the external
//!      test crate cannot pattern-match it directly);
//!   4. `release` token starts `false` and is shared with the retained
//!      `HookSurfaceGuard`, so dropping the frame sets it `true` (the signal the
//!      hook capture thread watches to release the keyed mutex and free the
//!      surface — retain-at-most-one, Req 7.5).
//!
//! # Why a WARP device, and graceful skip
//!
//! `SharedSurface` holds a real `ID3D11Texture2D` COM interface, which needs a
//! D3D11 device to create. A headless CI runner has no physical GPU, so this
//! test creates the device with the **WARP** software rasterizer
//! (`D3D_DRIVER_TYPE_WARP`), which yields a real `ID3D11Texture2D` without any
//! GPU and works in most headless Windows environments. It first tries a
//! hardware device and falls back to WARP. If **both** fail (no D3D11 at all),
//! the GPU-bound assertions are skipped with an explanatory message rather than
//! failing — but WARP is attempted first and normally succeeds.
//!
//! The adapter itself performs **no** `OpenSharedResource` (that is `dx11.rs`'s
//! job); it only retains the `SharedSurface`'s texture (a COM-ref clone) and
//! reads the struct's `width`/`height`. So a plain WARP-created BGRA texture —
//! created with the `SHARED` misc flag to mirror how a real shared surface looks
//! — is a faithful stand-in for the opened surface.
//!
//! Gated `#![cfg(all(feature = "game-capture-hook", windows))]`: the adapter,
//! `FrameOrigin::Hook`, `is_hook_origin`, and `FrameMetadata` only exist under
//! the hook feature, and the WARP device is Windows-only.
//!
//! Run (from `desktop/src-tauri`, CEF env vars set per tech.md):
//!   cargo test --features game-capture-hook --test frame_adapter

#![cfg(all(feature = "game-capture-hook", windows))]

use std::sync::atomic::Ordering;
use std::sync::Arc;

use app_lib::game_capture::dx11::SharedSurface;
use app_lib::game_capture::obs_ipc::FrameMetadata;
use app_lib::wgc_capture::CapturedFrame;

use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP, D3D_FEATURE_LEVEL_11_0,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_RESOURCE_MISC_SHARED,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};

/// Try to create a D3D11 device, hardware first then a WARP software device.
///
/// Returns `None` only when **neither** a hardware nor a WARP device can be
/// created (no usable D3D11 at all), so the GPU-bound assertions can skip
/// gracefully instead of failing. WARP normally succeeds headless.
fn try_create_device() -> Option<(ID3D11Device, &'static str)> {
    for (driver, label) in [
        (D3D_DRIVER_TYPE_HARDWARE, "hardware"),
        (D3D_DRIVER_TYPE_WARP, "warp"),
    ] {
        if let Some(device) = create_device(driver) {
            return Some((device, label));
        }
    }
    None
}

/// Create a `D3D_FEATURE_LEVEL_11_0` device for the given driver type, or `None`
/// if creation fails (e.g. no hardware adapter for `D3D_DRIVER_TYPE_HARDWARE`).
fn create_device(driver: D3D_DRIVER_TYPE) -> Option<ID3D11Device> {
    let feature_levels = [D3D_FEATURE_LEVEL_11_0];
    let mut device: Option<ID3D11Device> = None;
    let hr = unsafe {
        D3D11CreateDevice(
            None,
            driver,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&feature_levels),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            None,
        )
    };
    hr.ok().and(device)
}

/// Create a BGRA `ID3D11Texture2D` with the `SHARED` misc flag, mirroring how an
/// opened shared surface looks, and wrap it in a [`SharedSurface`].
fn make_shared_surface(device: &ID3D11Device, width: u32, height: u32) -> SharedSurface {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
    };
    let mut tex: Option<ID3D11Texture2D> = None;
    unsafe {
        device
            .CreateTexture2D(&desc, None, Some(&mut tex))
            .expect("WARP/HW CreateTexture2D for the shared-surface stand-in must succeed");
    }
    SharedSurface {
        texture: tex.unwrap(),
        width,
        height,
    }
}

/// Build a `FrameMetadata` describing a surface, with an arbitrary QPC timestamp
/// and shared handle (the adapter does not re-open the handle).
fn make_meta(width: u32, height: u32, timestamp_qpc: i64) -> FrameMetadata {
    FrameMetadata {
        width,
        height,
        format: DXGI_FORMAT_B8G8R8A8_UNORM.0 as u32,
        timestamp_qpc,
        shared_handle: 0xDEAD_BEEF,
    }
}

/// Read a texture's actual `(width, height)` from its D3D11 descriptor.
fn texture_dims(texture: &ID3D11Texture2D) -> (u32, u32) {
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    (desc.Width, desc.Height)
}

/// Uncapped case: the surface is smaller than the encode size, so the adapter
/// preserves the surface dimensions verbatim, forwards the OBS timestamp as the
/// PTS (current documented pass-through), and stamps a hook-origin token whose
/// release flag starts unset.
#[test]
fn adapter_uncapped_preserves_dimensions_pts_and_hook_origin() {
    let Some((device, label)) = try_create_device() else {
        eprintln!(
            "[frame_adapter] SKIP adapter_uncapped_*: neither a hardware nor a WARP D3D11 \
             device could be created, so no ID3D11Texture2D is available. WARP normally \
             succeeds headless; this environment exposes no usable D3D11."
        );
        return;
    };

    // Surface (320x240) smaller than the encode size (1920x1080) -> no capping.
    let surface_w = 320;
    let surface_h = 240;
    let encode_w = 1920;
    let encode_h = 1080;
    let timestamp_qpc = 1_234_567_890_i64;

    let surface = make_shared_surface(&device, surface_w, surface_h);
    let meta = make_meta(surface_w, surface_h, timestamp_qpc);

    let frame = CapturedFrame::from_hook_surface(surface, &meta, encode_w, encode_h);

    // 1. Dimensions: min(surface, encode) == surface when the surface is smaller.
    assert_eq!(
        frame.width, surface_w,
        "[{label}] uncapped width must equal the surface width"
    );
    assert_eq!(
        frame.height, surface_h,
        "[{label}] uncapped height must equal the surface height"
    );

    // 2. PTS: the adapter forwards the OBS QPC timestamp unchanged (the current
    //    documented `hook_pts_hns` pass-through; see TODO(verify-units)).
    assert_eq!(
        frame.pts_hns, timestamp_qpc,
        "[{label}] pts must be the converted OBS timestamp (pass-through today)"
    );

    // 3. Hook-origin retention token (not a WGC pool frame).
    assert!(
        frame.is_hook_origin(),
        "[{label}] a hook-surface frame must carry a FrameOrigin::Hook token"
    );

    // 4. Release token starts unset (the encoder/guard sets it later/on drop).
    assert!(
        !frame.release.load(Ordering::Acquire),
        "[{label}] the release token must start false"
    );

    // The retained texture aliases the surface's full-resolution texture (a COM
    // ref clone, not a copy): its descriptor still reports the surface size.
    assert_eq!(
        texture_dims(&frame.texture),
        (surface_w, surface_h),
        "[{label}] the retained texture must alias the surface's full-res texture"
    );
}

/// Capped case: the surface is larger than the encode size, so the reported
/// frame dimensions are clamped to the encode bounds while the retained texture
/// still aliases the full-resolution surface (the encoder crops on read).
#[test]
fn adapter_caps_dimensions_to_encode_bounds() {
    let Some((device, label)) = try_create_device() else {
        eprintln!(
            "[frame_adapter] SKIP adapter_caps_*: no hardware or WARP D3D11 device available."
        );
        return;
    };

    // Surface (1920x1080) larger than the encode size (1280x720) -> capped.
    let surface_w = 1920;
    let surface_h = 1080;
    let encode_w = 1280;
    let encode_h = 720;

    let surface = make_shared_surface(&device, surface_w, surface_h);
    let meta = make_meta(surface_w, surface_h, 42);

    let frame = CapturedFrame::from_hook_surface(surface, &meta, encode_w, encode_h);

    assert_eq!(
        (frame.width, frame.height),
        (encode_w, encode_h),
        "[{label}] frame dimensions must be capped to the encode bounds"
    );
    // The underlying texture is retained at full resolution; only the reported
    // width/height are capped.
    assert_eq!(
        texture_dims(&frame.texture),
        (surface_w, surface_h),
        "[{label}] the retained texture keeps the surface's full resolution"
    );
    assert!(frame.is_hook_origin(), "[{label}] capped frame is still hook-origin");
}

/// The release token is shared between the `CapturedFrame` and its retained
/// `HookSurfaceGuard`: it starts `false`, and dropping the frame sets it `true`
/// (the signal the hook thread watches to release the keyed mutex / free the
/// surface — Req 7.5). The guard is private, so this is observed through a clone
/// of the shared `Arc` the public `release` field exposes.
#[test]
fn adapter_release_token_is_shared_and_set_on_drop() {
    let Some((device, label)) = try_create_device() else {
        eprintln!(
            "[frame_adapter] SKIP adapter_release_*: no hardware or WARP D3D11 device available."
        );
        return;
    };

    let surface = make_shared_surface(&device, 640, 360);
    let meta = make_meta(640, 360, 7);
    let frame = CapturedFrame::from_hook_surface(surface, &meta, 640, 360);

    // Clone the shared release Arc so we can observe it after the frame drops.
    let release: Arc<_> = Arc::clone(&frame.release);
    assert!(
        !release.load(Ordering::Acquire),
        "[{label}] the release token must start false before drop"
    );
    // The frame and the retained guard share this exact Arc.
    assert!(
        Arc::strong_count(&release) >= 2,
        "[{label}] the release token must be shared (frame + guard hold clones)"
    );

    drop(frame);

    assert!(
        release.load(Ordering::Acquire),
        "[{label}] dropping the frame must set the shared release token true"
    );
}
