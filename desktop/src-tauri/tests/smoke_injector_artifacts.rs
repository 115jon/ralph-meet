//! Smoke test: the Injector resolves the reused OBS `graphics-hook` /
//! `inject-helper` artifacts and **never** references the legacy, nonexistent
//! `ralph_dx11_hook.dll` payload.
//!
//! Validates: Requirements 1.1, 11.1
//!   - 1.1  The Native_Share_Pipeline integrates the reused OBS Hook_Payload
//!          (`graphics-hook64.dll` / `graphics-hook32.dll`) as the in-process
//!          module the Injector loads — not a new in-process hook, and not the
//!          missing `ralph_dx11_hook.dll` that the prior scaffolding loaded.
//!   - 11.1 The pipeline reuses OBS Studio's `graphics-hook` payload DLLs and
//!          the OBS `inject-helper`, run as separate-process artifacts.
//!
//! # Why a smoke test (and what it proves about the pivot)
//!
//! The prior `screen-share-zero-overhead` scaffolding shipped a custom injector
//! whose `hook_payload_path()` looked for a DLL named `ralph_dx11_hook.dll`
//! **that does not exist anywhere in the repository**, so injection had nothing
//! to inject. This spec pivots the injector to reuse the OBS artifacts. A test
//! cannot grep the production source at runtime, so it proves the pivot at the
//! injector's public surface instead:
//!
//!   (a) Build an [`ObsArtifacts`] both by **discovering** the four OBS files in
//!       a temp dir and via the artifact-name **constants**, and assert
//!       `payload`/`helper` resolve to the OBS `graphics-hook*` / `inject-helper*`
//!       filenames for each [`Bitness`].
//!   (b) Assert the public artifact-name constants equal the expected OBS names
//!       and that **none** of them is — or even contains — the legacy
//!       `ralph_dx11_hook.dll`, and that every resolved payload file name starts
//!       with `graphics-hook`.
//!
//! Together these prove the injector uses the OBS artifacts (Req 1.1, 11.1) and
//! has dropped the missing legacy DLL.
//!
//! Run with (from `desktop/src-tauri`, CEF env vars set):
//!   cargo test --features game-capture-hook --test smoke_injector_artifacts

#![cfg(feature = "game-capture-hook")]

use std::path::{Path, PathBuf};

use app_lib::game_capture::inject::{
    Bitness, ObsArtifacts, GRAPHICS_HOOK32, GRAPHICS_HOOK64, INJECT_HELPER32, INJECT_HELPER64,
};

/// The legacy payload DLL name the prior scaffolding tried (and failed) to load.
/// The pivoted injector must never reference it again (Req 1.1).
const LEGACY_PAYLOAD_DLL: &str = "ralph_dx11_hook.dll";

/// Create a unique temp directory for this test, mirroring the convention used
/// by the `inject.rs` unit tests (no external temp-dir crate).
fn unique_temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "ralph_smoke_obs_artifacts_{tag}_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

// ── (a) Discovery resolves the OBS artifacts, by name, for each bitness ─────

/// Discovering a directory that holds the four OBS files resolves every
/// `payload`/`helper` to the matching OBS `graphics-hook*` / `inject-helper*`
/// file — proving the injector consumes the reused OBS artifacts (Req 1.1, 11.1).
#[test]
fn discover_resolves_obs_graphics_hook_and_inject_helper_artifacts() {
    let dir = unique_temp_dir("discover");

    // Lay down the four reused OBS_Capture_Component artifacts (stub contents:
    // discovery only checks for a regular file by name).
    for name in [
        GRAPHICS_HOOK64,
        GRAPHICS_HOOK32,
        INJECT_HELPER64,
        INJECT_HELPER32,
    ] {
        std::fs::write(dir.join(name), b"stub").expect("write OBS artifact");
    }

    let artifacts = ObsArtifacts::discover(&dir);

    // The 64-bit payload/helper resolve to the OBS `graphics-hook64.dll` /
    // `inject-helper64.exe` sitting in the directory.
    assert_eq!(
        artifacts.payload(Bitness::X64),
        Some(dir.join(GRAPHICS_HOOK64).as_path()),
        "X64 payload must resolve to the OBS graphics-hook64.dll (Req 1.1, 11.1)"
    );
    assert_eq!(
        artifacts.payload(Bitness::X86),
        Some(dir.join(GRAPHICS_HOOK32).as_path()),
        "X86 payload must resolve to the OBS graphics-hook32.dll (Req 1.1, 11.1)"
    );
    assert_eq!(
        artifacts.helper(Bitness::X64),
        Some(dir.join(INJECT_HELPER64).as_path()),
        "X64 helper must resolve to the OBS inject-helper64.exe (Req 11.1)"
    );
    assert_eq!(
        artifacts.helper(Bitness::X86),
        Some(dir.join(INJECT_HELPER32).as_path()),
        "X86 helper must resolve to the OBS inject-helper32.exe (Req 11.1)"
    );

    // Every resolved payload file name is an OBS `graphics-hook*` DLL — and is
    // never the legacy `ralph_dx11_hook.dll` (Req 1.1).
    for bitness in [Bitness::X64, Bitness::X86] {
        let payload = artifacts
            .payload(bitness)
            .expect("payload present after discovery");
        let file_name = payload
            .file_name()
            .and_then(|n| n.to_str())
            .expect("payload file name");
        assert!(
            file_name.starts_with("graphics-hook"),
            "resolved {bitness:?} payload {file_name:?} must be an OBS graphics-hook* DLL"
        );
        assert_ne!(
            file_name, LEGACY_PAYLOAD_DLL,
            "the injector must never resolve the legacy {LEGACY_PAYLOAD_DLL} (Req 1.1)"
        );
        assert!(
            !file_name.contains("ralph_dx11_hook"),
            "resolved payload {file_name:?} must not reference the legacy DLL (Req 1.1)"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
}

/// An [`ObsArtifacts`] built directly from the artifact-name constants resolves
/// each payload/helper to the corresponding OBS file name — the same result as
/// discovery, but without touching the filesystem.
#[test]
fn constructed_artifacts_resolve_to_obs_names() {
    let artifacts = ObsArtifacts::new(
        Some(PathBuf::from(GRAPHICS_HOOK64)),
        Some(PathBuf::from(GRAPHICS_HOOK32)),
        Some(PathBuf::from(INJECT_HELPER64)),
        Some(PathBuf::from(INJECT_HELPER32)),
    );

    assert_eq!(artifacts.payload(Bitness::X64), Some(Path::new(GRAPHICS_HOOK64)));
    assert_eq!(artifacts.payload(Bitness::X86), Some(Path::new(GRAPHICS_HOOK32)));
    assert_eq!(artifacts.helper(Bitness::X64), Some(Path::new(INJECT_HELPER64)));
    assert_eq!(artifacts.helper(Bitness::X86), Some(Path::new(INJECT_HELPER32)));
}

// ── (b) The artifact-name constants are the OBS names, not the legacy DLL ───

/// The public artifact-name constants equal the expected OBS file names.
#[test]
fn artifact_name_constants_are_the_expected_obs_names() {
    assert_eq!(GRAPHICS_HOOK64, "graphics-hook64.dll");
    assert_eq!(GRAPHICS_HOOK32, "graphics-hook32.dll");
    assert_eq!(INJECT_HELPER64, "inject-helper64.exe");
    assert_eq!(INJECT_HELPER32, "inject-helper32.exe");
}

/// None of the public artifact-name constants is — or even contains — the
/// legacy `ralph_dx11_hook.dll`; the payload constants are OBS `graphics-hook*`
/// DLLs and the helper constants are OBS `inject-helper*` executables (Req 1.1,
/// 11.1).
#[test]
fn no_artifact_constant_references_the_legacy_dll() {
    for name in [
        GRAPHICS_HOOK64,
        GRAPHICS_HOOK32,
        INJECT_HELPER64,
        INJECT_HELPER32,
    ] {
        assert_ne!(
            name, LEGACY_PAYLOAD_DLL,
            "artifact constant {name:?} must not be the legacy {LEGACY_PAYLOAD_DLL} (Req 1.1)"
        );
        assert!(
            !name.contains("ralph_dx11_hook"),
            "artifact constant {name:?} must not reference the legacy DLL (Req 1.1)"
        );
    }

    // The payload artifacts are the OBS graphics-hook DLLs.
    for payload in [GRAPHICS_HOOK64, GRAPHICS_HOOK32] {
        assert!(
            payload.starts_with("graphics-hook") && payload.ends_with(".dll"),
            "payload constant {payload:?} must be an OBS graphics-hook* DLL (Req 1.1, 11.1)"
        );
    }
    // The helper artifacts are the OBS inject-helper executables.
    for helper in [INJECT_HELPER64, INJECT_HELPER32] {
        assert!(
            helper.starts_with("inject-helper"),
            "helper constant {helper:?} must be an OBS inject-helper* executable (Req 11.1)"
        );
    }
}
