//! Smoke tests: the `game-capture-hook` Cargo feature gate and the GPLv2
//! no-OBS-source-linkage boundary.
//!
//! Validates: Requirements 11.2, 12.2, 12.5, 12.6
//!   - 11.2 The proprietary desktop binary SHALL NOT statically or dynamically
//!          link GPLv2 OBS source code; it interacts with the reused OBS
//!          artifacts only across a process boundary. → the crate dependency
//!          graph contains **no** OBS source crate.
//!   - 12.2 All Game_Capture_Hook functionality stays behind a Cargo feature
//!          gate (`game-capture-hook`, built on top of `native-screen-share`).
//!   - 12.5 With the feature gate disabled, the pipeline builds and runs with
//!          WGC_Capture only — the hook-only modules (`inject`, `obs_ipc`,
//!          `blocklist`) are excluded.
//!   - 12.6 If any required OBS_Capture_Component artifact is absent, packaging
//!          fails rather than producing a package without it.
//!
//! # Heavy (manual / `#[ignore]`) vs lightweight (always-on) tests
//!
//! This file mixes two kinds of test, and is honest about which is which:
//!
//! * **Lightweight, always-on** tests parse `Cargo.toml`, `Cargo.lock`, the
//!   `game_capture/mod.rs` source, and the `resources/obs-capture/` directory
//!   at `env!("CARGO_MANIFEST_DIR")`. They do no I/O beyond reading repo files,
//!   run in milliseconds, and provide a fast guard for Req 11.2 / 12.2 / 12.6.
//!   These run under a normal `cargo test`.
//!
//! * **Heavy, `#[ignore]`** tests shell out to `cargo` (`cargo check`,
//!   `cargo metadata`) with different feature sets to prove the feature-off and
//!   feature-on builds behave per spec. They are slow (a full type-check of the
//!   CEF Tauri app) and environment-dependent, so they are annotated `#[ignore]`
//!   and are **not** run by a normal CI `cargo test`. Run them deliberately on a
//!   developer machine with the CEF/Rust build environment configured per
//!   `tech.md` ("CEF build environment"): `CEF_PATH`, the Rust toolchain on
//!   `PATH`, and `RUSTUP_HOME`/`CARGO_HOME`. Without that environment a real
//!   feature-off `cargo check` may fail to *link* CEF even though the gate logic
//!   is correct.
//!
//! The file itself compiles with no feature gate (it only uses `std`), so the
//! lightweight assertions run under any feature set. Verify with (from
//! `desktop/src-tauri`, CEF env vars set):
//!   cargo test --features native-screen-share --test smoke_feature_gate
//! which runs the lightweight tests and lists the `#[ignore]` heavy ones.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Absolute path to this crate's manifest directory (`desktop/src-tauri`).
fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Read a repo file relative to [`manifest_dir`], normalizing CRLF → LF so the
/// source/text assertions are line-ending agnostic on Windows.
fn read_manifest_relative(rel: &str) -> String {
    let path = manifest_dir().join(rel);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    raw.replace("\r\n", "\n")
}

// ── Shared OBS-source detector (Req 11.2) ────────────────────────────────────

/// Whether a crate/package name denotes OBS source that, if present in the
/// dependency graph, would mean GPLv2 OBS code is linked into the proprietary
/// binary (a Req 11.2 violation).
///
/// This is deliberately precise so it does **not** false-positive on unrelated
/// crates whose name merely contains the substring "obs" — most notably
/// `jobserver` (j-**obs**-erver), which is a legitimate transitive build
/// dependency. It matches the OBS project names a real linkage would introduce:
/// `obs`, `obs-*`/`obs_*`, `libobs*`, `obs-studio*`, and the `graphics-hook`
/// payload source.
fn is_obs_source_crate(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "obs"
        || n.starts_with("obs-")
        || n.starts_with("obs_")
        || n.contains("libobs")
        || n.contains("obs-studio")
        || n.contains("obsstudio")
        || n.contains("graphics-hook")
        || n.contains("graphics_hook")
}

/// Sanity-check the detector itself: it flags OBS source names but not the
/// `jobserver` false-positive (or other "obs"-substring innocents).
#[test]
fn obs_source_detector_flags_obs_but_not_jobserver() {
    // Real OBS source names a linkage would introduce.
    for obs in ["obs", "obs-sys", "libobs", "libobs-sys", "obs-studio", "graphics-hook"] {
        assert!(is_obs_source_crate(obs), "{obs:?} should be detected as OBS source");
    }
    // Innocent names that merely contain the substring "obs".
    for innocent in ["jobserver", "globset", "robots", "observer-utils"] {
        assert!(
            !is_obs_source_crate(innocent),
            "{innocent:?} must NOT be flagged as OBS source"
        );
    }
}

// ── Lightweight: Cargo.toml feature gate + no OBS dependency (Req 11.2/12.2) ──

/// Extract the right-hand value list of the `game-capture-hook` feature from a
/// `Cargo.toml`'s `[features]` table, e.g. for
/// `game-capture-hook = ["native-screen-share"]` returns
/// `"\"native-screen-share\""`.
fn game_capture_hook_feature_value(cargo_toml: &str) -> Option<String> {
    let mut in_features = false;
    for line in cargo_toml.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_features = trimmed == "[features]";
            continue;
        }
        if !in_features {
            continue;
        }
        // Match the `game-capture-hook = [ ... ]` key. Allow comments/blank lines.
        if let Some((key, value)) = trimmed.split_once('=') {
            if key.trim() == "game-capture-hook" {
                return Some(value.trim().to_string());
            }
        }
    }
    None
}

/// Req 12.2 — `game-capture-hook` exists as a Cargo feature and is built **on
/// top of** `native-screen-share` (so the hook is additive over the guaranteed
/// WGC substrate).
#[test]
fn cargo_toml_game_capture_hook_feature_depends_on_native_screen_share() {
    let cargo_toml = read_manifest_relative("Cargo.toml");

    let value = game_capture_hook_feature_value(&cargo_toml).expect(
        "Cargo.toml [features] must declare a `game-capture-hook` feature (Req 12.2)",
    );

    assert!(
        value.contains("\"native-screen-share\""),
        "the `game-capture-hook` feature must depend on `native-screen-share` \
         (built on top of the WGC pipeline); got: {value} (Req 12.2)"
    );
}

/// Collect the dependency names declared in `Cargo.toml`, tracking the current
/// table so feature names/values in `[features]` are not mistaken for deps.
///
/// Handles the table shapes this manifest uses:
///   - `[dependencies]` / `[dev-dependencies]` / `[build-dependencies]` and
///     `[target.*.dependencies]` → keys are dependency names;
///   - `[dependencies.<name>]` (and the dev/build variants) → `<name>` is the
///     dependency;
///   - `[patch.*]` → keys are crate names being patched.
fn declared_dependency_names(cargo_toml: &str) -> Vec<String> {
    let mut names = Vec::new();
    // Kinds of the current section: key-style dep table, or none.
    let mut in_key_dep_table = false;

    for line in cargo_toml.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let header = &trimmed[1..trimmed.len() - 1];
            let segments: Vec<&str> = header.split('.').collect();
            let last = *segments.last().unwrap_or(&"");

            if last == "dependencies"
                || last == "dev-dependencies"
                || last == "build-dependencies"
                || header == "patch.crates-io"
                || header.starts_with("patch.")
            {
                // Keys within this table are dependency names.
                in_key_dep_table = true;
            } else if segments.contains(&"dependencies")
                || segments.contains(&"dev-dependencies")
                || segments.contains(&"build-dependencies")
            {
                // `[dependencies.<name>]` style — the trailing segment is the dep.
                in_key_dep_table = false;
                names.push(last.trim_matches(|c| c == '"' || c == '\'').to_string());
            } else {
                in_key_dep_table = false;
            }
            continue;
        }

        if in_key_dep_table {
            if let Some((key, _)) = trimmed.split_once('=') {
                names.push(key.trim().trim_matches('"').to_string());
            }
        }
    }

    names
}

/// Req 11.2 — no OBS source crate is declared as a dependency of the proprietary
/// crate. The reused OBS `graphics-hook`/`inject-helper` artifacts are
/// separate-process GPLv2 components shipped alongside (not linked into) the
/// binary, so none of them — and no OBS source crate — may appear in any
/// dependency table.
#[test]
fn cargo_toml_declares_no_obs_dependency() {
    let cargo_toml = read_manifest_relative("Cargo.toml");
    let deps = declared_dependency_names(&cargo_toml);

    // Sanity: we actually parsed some dependencies (guards against the parser
    // silently finding nothing and the test passing vacuously).
    assert!(
        deps.iter().any(|d| d == "serde" || d == "tauri" || d == "windows"),
        "dependency parse looks empty/wrong; parsed: {deps:?}"
    );

    let offenders: Vec<&String> = deps.iter().filter(|d| is_obs_source_crate(d)).collect();
    assert!(
        offenders.is_empty(),
        "no OBS source crate may be a dependency (Req 11.2); found: {offenders:?}"
    );
}

// ── Lightweight: Cargo.lock dependency graph has no OBS source (Req 11.2) ─────

/// Parse every `[[package]] name = "..."` from a `Cargo.lock`.
fn cargo_lock_package_names(cargo_lock: &str) -> Vec<String> {
    cargo_lock
        .lines()
        .filter_map(|line| {
            let t = line.trim();
            t.strip_prefix("name = \"")
                .and_then(|rest| rest.strip_suffix('"'))
                .map(|name| name.to_string())
        })
        .collect()
}

/// Req 11.2 (fast guard) — the **resolved** dependency graph in `Cargo.lock`
/// contains no OBS source package. This is the lightweight, always-on counterpart
/// to the heavy `cargo metadata` smoke test below: it reads the committed lockfile
/// instead of resolving the graph, so it runs in CI without invoking cargo.
#[test]
fn cargo_lock_dependency_graph_contains_no_obs_source() {
    let cargo_lock = read_manifest_relative("Cargo.lock");
    let packages = cargo_lock_package_names(&cargo_lock);

    assert!(
        packages.len() > 10,
        "Cargo.lock parse looks wrong; only parsed {} packages",
        packages.len()
    );

    let offenders: Vec<&String> = packages.iter().filter(|p| is_obs_source_crate(p)).collect();
    assert!(
        offenders.is_empty(),
        "the resolved dependency graph must contain no OBS source (Req 11.2); found: {offenders:?}"
    );
}

// ── Lightweight: feature-off build excludes the hook modules (Req 12.5) ──────

/// Req 12.5 — the hook-only `game_capture` submodules are each gated behind
/// `#[cfg(feature = "game-capture-hook")]`, so a feature-off build (the default
/// `native-screen-share` build) compiles WGC only and never pulls in the OBS
/// injection/IPC/blocklist code.
///
/// Module gating is a **compile-time** decision, so a runtime test cannot
/// observe an "excluded" module directly. The honest, durable check is to assert
/// the gating at the source level: each of `inject` / `obs_ipc` / `blocklist` is
/// declared `pub mod` immediately under the `game-capture-hook` cfg attribute in
/// `game_capture/mod.rs`. (The orthogonal proof that the gate actually changes
/// the build is the heavy `cargo check` smoke test below.)
#[test]
fn feature_off_build_excludes_hook_modules() {
    let mod_rs = read_manifest_relative("src/game_capture/mod.rs");

    for module in ["inject", "obs_ipc", "blocklist"] {
        let gated = format!("#[cfg(feature = \"game-capture-hook\")]\npub mod {module};");
        assert!(
            mod_rs.contains(&gated),
            "hook module `{module}` must be gated behind `game-capture-hook` so the \
             feature-off build excludes it (Req 12.5); expected source sequence:\n{gated}"
        );
    }

    // And the dx11 hook surface source / selection core remain available under
    // plain `native-screen-share` (the WGC-only build still compiles the
    // selection core), i.e. `dx11` is NOT behind the hook feature.
    assert!(
        mod_rs.contains("pub mod dx11;"),
        "the dx11 module hosting the shared-surface opener must compile under \
         `native-screen-share` (WGC-only build), i.e. not behind the hook feature"
    );
}

// ── Lightweight: packaging guard logic fails when an artifact is absent (12.6) ─

/// The required OBS_Capture_Component file names, kept in sync with
/// `OBS_CAPTURE_REQUIRED_FILES` in `build.rs`. The guard fails the build if any
/// of these is absent from `resources/obs-capture/` when `game-capture-hook` is
/// enabled (Req 12.6).
const OBS_CAPTURE_REQUIRED_FILES: &[&str] = &[
    "graphics-hook64.dll",
    "graphics-hook32.dll",
    "inject-helper64.exe",
    "inject-helper32.exe",
    "LICENSE-GPLv2.txt",
    "ATTRIBUTION.md",
];

/// Directory holding the OBS_Capture_Component, relative to the manifest dir
/// (mirrors `OBS_CAPTURE_RESOURCE_DIR` in `build.rs`).
const OBS_CAPTURE_RESOURCE_DIR: &str = "resources/obs-capture";

/// Replicate the `build.rs` guard's core decision: the set of required files
/// that are absent from `dir`. The guard fails the build iff this is non-empty.
fn missing_required_files(dir: &Path, required: &[&str]) -> Vec<String> {
    required
        .iter()
        .filter(|name| !dir.join(name).is_file())
        .map(|name| name.to_string())
        .collect()
}

fn unique_temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "ralph_smoke_feature_gate_{tag}_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

/// Req 12.6 (guard logic) — when every required artifact is present the guard
/// passes (no missing files); when any single required artifact is absent the
/// guard reports it missing (and so would fail the build). This exercises the
/// guard's decision deterministically against synthetic directories, without
/// shelling out to a real feature-on build.
#[test]
fn packaging_guard_fails_when_a_required_artifact_is_absent() {
    // (a) All required files present → guard passes (empty missing set).
    let full = unique_temp_dir("full");
    for name in OBS_CAPTURE_REQUIRED_FILES {
        std::fs::write(full.join(name), b"stub").expect("write stub artifact");
    }
    assert!(
        missing_required_files(&full, OBS_CAPTURE_REQUIRED_FILES).is_empty(),
        "with all artifacts present the packaging guard must pass (Req 12.6)"
    );

    // (b) Drop each required artifact in turn → the guard must report exactly
    //     that file missing (so packaging fails rather than shipping without it).
    for absent in OBS_CAPTURE_REQUIRED_FILES {
        let dir = unique_temp_dir("absent");
        for name in OBS_CAPTURE_REQUIRED_FILES {
            if name != absent {
                std::fs::write(dir.join(name), b"stub").expect("write stub artifact");
            }
        }
        let missing = missing_required_files(&dir, OBS_CAPTURE_REQUIRED_FILES);
        assert_eq!(
            missing,
            vec![absent.to_string()],
            "guard must fail when the required artifact {absent:?} is absent (Req 12.6)"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    let _ = std::fs::remove_dir_all(&full);
}

/// Documents the current repo state for Req 12.6: the GPLv2 binary artifacts are
/// intentionally **not** committed, so a real `game-capture-hook` build fails the
/// packaging guard until a maintainer drops them in. The committed license +
/// attribution text files are present. This pins the "fails by design" state so
/// it is visible and intentional (and re-evaluates automatically once a
/// maintainer adds the real OBS binaries).
#[test]
fn obs_capture_binary_artifacts_are_absent_by_design_but_license_present() {
    let dir = manifest_dir().join(OBS_CAPTURE_RESOURCE_DIR);
    assert!(
        dir.is_dir(),
        "the OBS_Capture_Component resource dir must exist at {}",
        dir.display()
    );

    // GPLv2 binaries are not committed → guard would fail a feature-on build.
    let missing = missing_required_files(&dir, OBS_CAPTURE_REQUIRED_FILES);
    let binaries = ["graphics-hook64.dll", "graphics-hook32.dll", "inject-helper64.exe", "inject-helper32.exe"];
    for bin in binaries {
        assert!(
            missing.iter().any(|m| m == bin),
            "GPLv2 binary {bin:?} should be absent by design (Req 12.6 fails-build state); \
             if a maintainer added the real OBS artifacts this assertion intentionally flips"
        );
    }

    // License + attribution text are committed and present.
    for committed in ["LICENSE-GPLv2.txt", "ATTRIBUTION.md"] {
        assert!(
            dir.join(committed).is_file(),
            "the committed {committed} must ship with the OBS_Capture_Component (Req 11.3/12.3)"
        );
    }
}

// ── Heavy (`#[ignore]`): real cargo builds / dependency-graph resolution ─────
//
// These shell out to `cargo` and are slow + environment-dependent. They require
// the CEF/Rust build environment from tech.md ("CEF build environment"):
// `CEF_PATH`, the Rust toolchain on `PATH`, and `RUSTUP_HOME`/`CARGO_HOME`. They
// are `#[ignore]`d so a normal `cargo test` skips them; run them deliberately:
//   cargo test --features native-screen-share --test smoke_feature_gate -- --ignored

/// Run a `cargo` subcommand in the manifest dir and capture its result.
fn run_cargo(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO"))
        .args(args)
        .current_dir(manifest_dir())
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn `cargo {}`: {e}", args.join(" ")))
}

/// Req 12.5 (heavy) — the **feature-off** build type-checks successfully: with
/// `game-capture-hook` disabled the crate builds with WGC capture only. Requires
/// the CEF build environment (see module docs); without it the CEF link step,
/// not the gate logic, may fail.
#[test]
#[ignore = "heavy: shells out to `cargo check`; requires the CEF/Rust build env (tech.md)"]
fn smoke_cargo_check_feature_off_succeeds() {
    let output = run_cargo(&[
        "check",
        "--no-default-features",
        "--features",
        "cef,native-screen-share",
    ]);
    assert!(
        output.status.success(),
        "feature-off `cargo check` must succeed (Req 12.5).\nstderr:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Req 12.6 (heavy) — with the GPLv2 OBS artifacts **absent** (the committed repo
/// state), a **feature-on** build fails the `build.rs` packaging guard. This is
/// the intended Req 12.6 behavior: packaging fails rather than producing a
/// `game-capture-hook` package without the OBS_Capture_Component.
///
/// NOTE: when a maintainer adds the real OBS artifacts under
/// `resources/obs-capture/`, the guard passes and a feature-on `cargo check`
/// instead **succeeds** — so this test documents/asserts the absent-artifact
/// path explicitly and is skipped (`#[ignore]`) by default.
#[test]
#[ignore = "heavy: shells out to `cargo check`; asserts the Req 12.6 guard-failure path when OBS artifacts are absent"]
fn smoke_cargo_check_feature_on_guard_fails_without_artifacts() {
    let dir = manifest_dir().join(OBS_CAPTURE_RESOURCE_DIR);
    let artifacts_present =
        missing_required_files(&dir, OBS_CAPTURE_REQUIRED_FILES).is_empty();

    let output = run_cargo(&[
        "check",
        "--no-default-features",
        "--features",
        "cef,game-capture-hook",
    ]);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if artifacts_present {
        // A maintainer has dropped in the real OBS artifacts: the guard passes
        // and the feature-on build is expected to succeed instead (Req 12.6
        // satisfied). Document this branch rather than failing spuriously.
        assert!(
            output.status.success(),
            "OBS artifacts are present, so the feature-on build should succeed.\nstderr:\n{stderr}"
        );
    } else {
        // The committed state: artifacts absent → packaging guard fails the build.
        assert!(
            !output.status.success(),
            "feature-on `cargo check` must FAIL when OBS artifacts are absent (Req 12.6)"
        );
        assert!(
            stderr.contains("OBS_Capture_Component packaging guard FAILED")
                || stderr.contains("packaging guard FAILED")
                || stderr.contains("OBS_Capture_Component"),
            "the build failure must come from the packaging guard (Req 12.6).\nstderr:\n{stderr}"
        );
    }
}

/// Req 11.2 (heavy) — the fully-resolved dependency graph reported by
/// `cargo metadata` contains no OBS source package, proving no GPLv2 OBS source
/// is linked into the proprietary binary. This is the authoritative counterpart
/// to the lightweight `Cargo.lock` scan above.
#[test]
#[ignore = "heavy: shells out to `cargo metadata` to resolve the full dependency graph"]
fn smoke_cargo_metadata_dependency_graph_contains_no_obs_source() {
    let output = run_cargo(&["metadata", "--format-version", "1"]);
    assert!(
        output.status.success(),
        "`cargo metadata` must succeed.\nstderr:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Extract every package name from the JSON without a JSON dependency: scan
    // for the `"name":"..."` occurrences cargo emits per package.
    let mut offenders = Vec::new();
    for fragment in stdout.split("\"name\":\"").skip(1) {
        if let Some(end) = fragment.find('"') {
            let name = &fragment[..end];
            if is_obs_source_crate(name) {
                offenders.push(name.to_string());
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "the resolved dependency graph must contain no OBS source (Req 11.2); found: {offenders:?}"
    );
}
