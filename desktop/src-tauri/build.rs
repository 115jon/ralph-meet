// The pure locked-DLL copy classifier (Requirements 7.1, 7.2, 7.4). Lives in a
// shared file so both this build script and the Property 4 test exercise the
// exact same logic; build scripts cannot be imported from `tests/`, so the file
// is `#[path]`-included here.
#[path = "build_support/copy_classifier.rs"]
mod copy_classifier;

// The pure Owned_Capture_Component packaging-guard predicate (Requirements 7.5,
// 11.4, 12.3, 12.4, 12.6). Shared with the Property 5 test the same way as the
// copy classifier: build scripts cannot be imported from `tests/`, so the file
// is `#[path]`-included on both sides.
#[path = "build_support/packaging_guard.rs"]
mod packaging_guard;

use copy_classifier::{classify_copy, CopyResolution};
use packaging_guard::{evaluate_packaging_guard, REQUIRED_MATERIALS};

fn main() {
    println!("cargo:rerun-if-changed=../../.env.local");
    enforce_obs_capture_component_packaging();
    place_owned_capture_artifacts_next_to_binary();
    sync_cef_runtime_from_env();
    tauri_build::build()
}

// ── Owned_Capture_Component packaging guard (Req 7.5, 11.4, 12.3, 12.4, 12.6) ─
//
// When the `game-capture-hook` feature is enabled, the project-built
// Owned_Capture_Component — the `Forked_Hook_DLL` 64/32 payloads, the
// `Owned_Injector` artifacts (forked `inject-helper` + `get-graphics-offsets`,
// both bitnesses), the GPLv2 license text, the OBS Project attribution, and the
// source-availability/written-offer material — MUST ship alongside the desktop
// binary. This guard fails the build naming the missing material(s) when any is
// absent, so packaging can never silently produce a `game-capture-hook` package
// without the complete Owned_Capture_Component and its GPLv2 materials
// (Req 7.5, 11.4, 12.3, 12.4, 12.6).
//
// The guard is **only** active when the `game-capture-hook` feature is enabled.
// Cargo exports `CARGO_FEATURE_<NAME>` for every enabled feature (the feature
// `game-capture-hook` becomes `CARGO_FEATURE_GAME_CAPTURE_HOOK`), so the default
// feature-off build skips the guard entirely and continues to build/run with
// WGC capture only (Requirement 12.5).
//
// The present/absent → pass/fail decision is the pure
// [`packaging_guard::evaluate_packaging_guard`]; this function is the thin
// OS-bound shell that probes the filesystem for each required material and
// renders the failure text. Keeping the decision pure lets task 6.4's Property 5
// exercise "fails whenever any required material is missing" without a populated
// resource directory.

/// Directory (relative to `CARGO_MANIFEST_DIR`) holding the
/// Owned_Capture_Component materials.
const OBS_CAPTURE_RESOURCE_DIR: &str = "resources/obs-capture";

fn enforce_obs_capture_component_packaging() {
    // Re-run the guard whenever the feature is toggled or the bundled materials
    // change, so adding/removing a material re-evaluates the check.
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_GAME_CAPTURE_HOOK");
    println!("cargo:rerun-if-changed={OBS_CAPTURE_RESOURCE_DIR}");

    // No-op unless the `game-capture-hook` feature is enabled (Requirement 12.5).
    if std::env::var_os("CARGO_FEATURE_GAME_CAPTURE_HOOK").is_none() {
        return;
    }

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .expect("CARGO_MANIFEST_DIR is always set by Cargo for build scripts");
    let resource_dir = std::path::Path::new(&manifest_dir).join(OBS_CAPTURE_RESOURCE_DIR);

    // Probe the filesystem once per required material; the pass/fail decision is
    // the pure predicate over these presence flags.
    let present: Vec<bool> = REQUIRED_MATERIALS
        .iter()
        .map(|material| resource_dir.join(material.name).is_file())
        .collect();

    let outcome = evaluate_packaging_guard(REQUIRED_MATERIALS, &present);

    if !outcome.passed() {
        let mut message = String::from(
            "\n\
            ============================================================\n\
            Owned_Capture_Component packaging guard FAILED (Req 7.5, 11.4, 12.3, 12.6)\n\
            ============================================================\n\
            The `game-capture-hook` feature is enabled, so the project-built\n\
            Owned_Capture_Component — the Forked_Hook_DLL (64/32), the\n\
            Owned_Injector artifacts, the GPLv2 license text, the OBS attribution,\n\
            and the source-availability/written-offer material — MUST ship\n\
            alongside the desktop binary.\n\n\
            Missing required material(s) under\n  ",
        );
        message.push_str(&resource_dir.display().to_string());
        message.push_str(":\n");
        for material in &outcome.missing {
            message.push_str(&format!("  - {}  ({})\n", material.name, material.role));
        }
        message.push_str(
            "\nThe GPLv2 binaries are NOT committed to the repository (the GPLv2\n\
            license, attribution, and source offer ARE). A maintainer must build\n\
            the Forked_Hook_DLL/Owned_Injector into that directory (see its\n\
            README.md — `build-capture-fork.ps1`) before building/packaging with\n\
            `game-capture-hook`. Failing the build here is intentional\n\
            (Req 7.5, 11.4, 12.3, 12.6) — it prevents shipping a game-capture-hook\n\
            package without the complete Owned_Capture_Component.\n\
            ============================================================\n",
        );
        panic!("{message}");
    }

    println!(
        "cargo:warning=Owned_Capture_Component present: all {} required artifacts/license/attribution/source-offer materials found under {}",
        REQUIRED_MATERIALS.len(),
        OBS_CAPTURE_RESOURCE_DIR
    );
}

// ── Locked-DLL-resilient artifact copy (Requirements 7.1, 7.2, 7.3, 7.4) ─────
//
// The Owned_Capture_Component artifacts (the `Forked_Hook_DLL` 64/32 payloads,
// the `Owned_Injector` inject-helper + get-graphics-offsets executables) must be
// placed next to the built binary so the running app can discover and inject
// them. During an active capture session a game has the `Forked_Hook_DLL`
// injected and holds it open, so overwriting it fails with Windows os error 32
// (sharing violation). Requirement 7 makes that lock non-fatal **when a usable
// same-bitness artifact is already in place**: the build warns (naming the
// locked artifact and the steps to release the lock) and continues using the
// already-present DLL, rather than hard-failing an in-progress developer
// rebuild. With no usable artifact present, the lock is fatal and the error
// names the path + release steps (Req 7.4).
//
// The lock/usable decision is the pure [`classify_copy`]; this function is the
// thin OS-bound shell that performs the copy, reads the destination's
// existence/length, and renders the Requirement 7.2/7.3/7.4 warning/error text.
//
// Gated on the `game-capture-hook` feature (via `CARGO_FEATURE_GAME_CAPTURE_HOOK`,
// the env var Cargo sets for the feature) so the default feature-off build never
// touches these artifacts.

/// The Owned_Capture_Component artifacts copied next to the binary, by role.
///
/// The file names mirror the `GRAPHICS_HOOK64` / `GRAPHICS_HOOK32` /
/// `INJECT_HELPER64` / `INJECT_HELPER32` / `GET_GRAPHICS_OFFSETS64` /
/// `GET_GRAPHICS_OFFSETS32` constants in `src/game_capture/inject.rs` and the
/// packaging-guard list above; keep all three in sync. The two
/// `Forked_Hook_DLL` payloads are the artifacts a running game can lock on disk
/// (Req 7.1); the `Owned_Injector` executables round out the set the app needs
/// next to the binary.
const OWNED_CAPTURE_COPY_ARTIFACTS: &[(&str, &str)] = &[
    ("graphics-hook64.dll", "64-bit Forked_Hook_DLL payload"),
    ("graphics-hook32.dll", "32-bit Forked_Hook_DLL payload"),
    ("inject-helper64.exe", "64-bit Owned_Injector (inject-helper)"),
    ("inject-helper32.exe", "32-bit Owned_Injector (inject-helper)"),
    ("get-graphics-offsets64.exe", "64-bit Owned_Injector (get-graphics-offsets)"),
    ("get-graphics-offsets32.exe", "32-bit Owned_Injector (get-graphics-offsets)"),
];

/// Optional Owned_Capture_Component artifacts placed next to the binary on a
/// best-effort basis. Unlike [`OWNED_CAPTURE_COPY_ARTIFACTS`], absence here is
/// normal and never fails the build: the Vulkan implicit-layer manifests exist
/// only when the fork was built with the Vulkan hook. They must sit next to the
/// `graphics-hook<bits>.dll` they reference so `game_capture::vulkan_layer` can
/// register them with the Vulkan loader.
const OWNED_CAPTURE_OPTIONAL_ARTIFACTS: &[&str] = &["obs-vulkan64.json", "obs-vulkan32.json"];

/// Copy each Owned_Capture_Component artifact from the source resource dir to
/// the build's output (next to the binary), tolerating a locked
/// `Forked_Hook_DLL` per Requirement 7.
fn place_owned_capture_artifacts_next_to_binary() {
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_GAME_CAPTURE_HOOK");

    // No-op unless the `game-capture-hook` feature is enabled (Req 12.5).
    if std::env::var_os("CARGO_FEATURE_GAME_CAPTURE_HOOK").is_none() {
        return;
    }

    let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") else {
        return;
    };
    let source_dir = std::path::Path::new(&manifest_dir).join(OBS_CAPTURE_RESOURCE_DIR);

    // Derive the build's per-profile output dir (where the binary lands) from
    // OUT_DIR, the same way the CEF runtime sync does, then place the artifacts
    // under an `obs-capture/` subdir so the app discovers them next to the binary.
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };
    let Some(profile_dir) = std::path::PathBuf::from(&out_dir)
        .ancestors()
        .nth(3)
        .map(std::path::PathBuf::from)
    else {
        return;
    };
    let dest_dir = profile_dir.join("obs-capture");
    let _ = std::fs::create_dir_all(&dest_dir);

    for (name, role) in OWNED_CAPTURE_COPY_ARTIFACTS {
        let src = source_dir.join(name);
        let dest = dest_dir.join(name);
        println!("cargo:rerun-if-changed={}", src.display());
        place_one_artifact(&src, &dest, name, role);
    }

    // Optional Vulkan implicit-layer manifests. These are present only when the
    // fork was built with the Vulkan hook; their absence is normal (DX/GL
    // capture is unaffected), so copy best-effort without the lockable-artifact
    // classification or the packaging guard. They must sit next to the
    // graphics-hook DLLs they reference so vulkan_layer.rs can register them.
    for name in OWNED_CAPTURE_OPTIONAL_ARTIFACTS {
        let src = source_dir.join(name);
        let dest = dest_dir.join(name);
        println!("cargo:rerun-if-changed={}", src.display());
        if src.is_file() {
            if let Err(err) = std::fs::copy(&src, &dest) {
                println!(
                    "cargo:warning=Could not place optional capture artifact {name} at {}: {err} \
                     (Vulkan capture activation may be unavailable; DX/GL capture is unaffected).",
                    dest.display()
                );
            }
        }
    }
}

/// Place a single artifact at `dest`, classifying any copy failure with the pure
/// [`classify_copy`] and rendering the Requirement 7.2/7.3/7.4 messaging.
fn place_one_artifact(src: &std::path::Path, dest: &std::path::Path, name: &str, role: &str) {
    // Attempt the copy; on failure capture the raw OS error code so the pure
    // classifier can recognise the Windows sharing violation (os error 32).
    let copy_err_os_code = match std::fs::copy(src, dest) {
        Ok(_) => None,
        Err(err) => Some(err.raw_os_error().unwrap_or(0)),
    };

    // Read the destination's existence + length so a sharing violation over a
    // usable (existing, non-empty) artifact is kept rather than treated as fatal.
    let (dest_exists, dest_len) = match std::fs::metadata(dest) {
        Ok(meta) => (true, meta.len()),
        Err(_) => (false, 0),
    };

    match classify_copy(copy_err_os_code, dest_exists, dest_len).with_dest(dest) {
        CopyResolution::Copied => {}
        CopyResolution::KeptLockedExisting { dest } => {
            // Req 7.2 + 7.3: warn naming the locked artifact by its destination
            // path, and state that a running game has the Forked_Hook_DLL
            // injected and the steps to release the lock — then continue.
            println!(
                "cargo:warning=Owned_Capture_Component artifact locked on disk (os error 32, \
                 sharing violation): kept the existing {role} at {}. A running game has the \
                 Forked_Hook_DLL injected and is holding it open. To refresh it, release the \
                 lock by stopping the screen-share/capture session or closing the game, then \
                 rebuild. Continuing with the already-present artifact (Req 7.1-7.3).",
                dest.display()
            );
        }
        CopyResolution::FailedLockedMissing { dest } => {
            // Req 7.4: locked and no usable artifact to fall back on — fail,
            // naming the path and the release steps.
            panic!(
                "Owned_Capture_Component artifact locked on disk (os error 32, sharing \
                 violation) and no usable artifact present at {}: cannot place the {role}. A \
                 running game has the Forked_Hook_DLL injected and is holding it open. Release \
                 the lock by stopping the screen-share/capture session or closing the game, \
                 then rebuild (Req 7.4).",
                dest.display()
            );
        }
        CopyResolution::FailedAbsent { dest } => {
            // No source/dest artifact to place at all (distinct from locked).
            // The packaging guard (Req 7.5) is the authority on absent required
            // materials; here we surface the failed copy so it is diagnosable
            // without masking the guard.
            println!(
                "cargo:warning=Owned_Capture_Component artifact {name} ({role}) could not be \
                 placed at {} (source missing or unreadable: {}). The packaging guard will fail \
                 the build if this is a required material (Req 7.5).",
                dest.display(),
                src.display()
            );
        }
    }
}

#[cfg(all(windows, feature = "cef"))]
fn sync_cef_runtime_from_env() {
    use std::{env, fs, path::PathBuf};

    let Ok(cef_path) = env::var("CEF_PATH") else {
        return;
    };
    let Ok(out_dir) = env::var("OUT_DIR") else {
        return;
    };

    let source = PathBuf::from(cef_path);
    if !source.join("libcef.dll").is_file() {
        println!(
            "cargo:warning=CEF_PATH does not contain libcef.dll: {}",
            source.display()
        );
        return;
    }

    let Some(profile_dir) = PathBuf::from(out_dir)
        .ancestors()
        .nth(3)
        .map(PathBuf::from)
    else {
        return;
    };

    for entry in CEF_RUNTIME_FILES {
        let src = source.join(entry);
        let dest = profile_dir.join(entry);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if src.is_file() {
            if let Err(error) = fs::copy(&src, &dest) {
                println!(
                    "cargo:warning=Failed to copy CEF runtime file {} -> {}: {}",
                    src.display(),
                    dest.display(),
                    error
                );
            }
        }
    }

    let source_locales = source.join("locales");
    let dest_locales = profile_dir.join("locales");
    if source_locales.is_dir() {
        let _ = fs::create_dir_all(&dest_locales);
        if let Ok(entries) = fs::read_dir(source_locales) {
            for entry in entries.flatten() {
                let src = entry.path();
                if src.is_file() {
                    let dest = dest_locales.join(entry.file_name());
                    let _ = fs::copy(src, dest);
                }
            }
        }
    }

    println!("cargo:rerun-if-env-changed=CEF_PATH");
    println!("cargo:warning=Synced CEF runtime from {}", source.display());
}

#[cfg(not(all(windows, feature = "cef")))]
fn sync_cef_runtime_from_env() {}

#[cfg(all(windows, feature = "cef"))]
const CEF_RUNTIME_FILES: &[&str] = &[
    "bootstrap.exe",
    "bootstrapc.exe",
    "chrome_100_percent.pak",
    "chrome_200_percent.pak",
    "chrome_elf.dll",
    "d3dcompiler_47.dll",
    "dxcompiler.dll",
    "dxil.dll",
    "icudtl.dat",
    "libcef.dll",
    "libEGL.dll",
    "libGLESv2.dll",
    "resources.pak",
    "v8_context_snapshot.bin",
    "vk_swiftshader.dll",
    "vk_swiftshader_icd.json",
    "vulkan-1.dll",
];
