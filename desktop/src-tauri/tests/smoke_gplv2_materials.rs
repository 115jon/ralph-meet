//! Smoke test: the GPLv2 materials the `Owned_Capture_Component` must ship are
//! present at packaging — the license text, the OBS attribution with the pinned
//! upstream identifier, and the source-availability/written-offer material — and
//! they live in the SAME bundled resource directory as the `Forked_Hook_DLL`
//! payloads and the `Owned_Injector` binaries the desktop app ships.
//!
//! Validates: Requirements 11.1, 11.2, 11.3, 1.1, 1.2
//!   - 11.1 The packaged bundle includes the GPLv2 license text for the
//!          Forked_Hook_DLL / Owned_Injector binaries (`LICENSE-GPLv2.txt`).
//!   - 11.2 It includes the OBS Project attribution naming the component and the
//!          pinned upstream identifier (OBS Studio 32.1.2, tag `32.1.2`, commit
//!          `fb4d98b`) — `ATTRIBUTION.md`.
//!   - 11.3 It includes the GPLv2 §3 source-availability / written-offer
//!          material (`SOURCE-OFFER.md`).
//!   - 1.1  The capture payload is the project's own Forked_Hook_DLL built from
//!          OBS `win-capture` sources — the materials describe exactly that
//!          owned, built-from-source component (not an unmodified prebuilt OBS
//!          binary), and ship next to it.
//!   - 1.2  Exactly one 64-bit and one 32-bit Forked_Hook_DLL artifact ship in
//!          the same directory the GPLv2 materials do (the materials sit
//!          "alongside the binary and DLLs").
//!
//! # Why a smoke test (and what it proves)
//!
//! The three GPLv2 documents are **committed** to the repo (the `.dll` / `.exe`
//! binaries they cover are git-ignored and built on demand — see
//! `resources/obs-capture/README.md`). So a fresh checkout / CI always has the
//! license/attribution/source-offer text but may not have the binaries. This
//! test therefore proves the **packaging contract** at levels that are all
//! runnable under a plain `cargo test` on any platform, no feature gate:
//!
//!   * The three GPLv2 documents exist on disk and carry the required content
//!     (the GPLv2 header + version, the OBS attribution + pinned identifier, and
//!     the written-offer / corresponding-source text).
//!   * Those documents and the binary/DLL artifacts are declared as a single
//!     `Owned_Capture_Component` required-materials set (the shared
//!     `packaging_guard::REQUIRED_MATERIALS` the build's packaging guard
//!     enforces), so they ship together — the materials sit "alongside the
//!     binary and DLLs".
//!   * The resource directory holding all of them is exactly the directory
//!     `tauri.conf.json` bundles into the package (`resources/obs-capture/*`),
//!     so they are shipped, next to the desktop binary, by the same bundle glob.
//!   * WHEN the (git-ignored) DLL binaries are present, each named DLL really is
//!     a non-empty file in that same directory; when absent the test degrades
//!     gracefully (the binaries are built on demand and not required for this
//!     packaging-materials check).
//!
//! Run with (from `desktop/src-tauri`):
//!   cargo test --test smoke_gplv2_materials

use std::path::PathBuf;

// Include the SAME pure packaging-guard module the build script uses, so the
// "ships alongside the binary and DLLs" assertion checks the real required-
// materials contract rather than a string grep. The module is std-only and
// carries `#![allow(dead_code)]`, so including it here is warning-clean.
#[path = "../build_support/packaging_guard.rs"]
mod packaging_guard;

use packaging_guard::REQUIRED_MATERIALS;

/// The pinned upstream identifier the attribution MUST carry (Req 11.2). Kept in
/// sync with `ATTRIBUTION.md`, `SOURCE-OFFER.md`, `README.md`, and
/// `desktop/THIRD_PARTY_LICENSES.md`.
const PINNED_VERSION: &str = "32.1.2";
const PINNED_COMMIT: &str = "fb4d98b";

/// The two `Forked_Hook_DLL` payloads that MUST ship next to the GPLv2 materials
/// (Req 1.2 — exactly one 64-bit and one 32-bit).
const FORKED_HOOK_DLLS: &[&str] = &["graphics-hook64.dll", "graphics-hook32.dll"];

/// The `Owned_Injector` binaries that round out the component shipped alongside
/// the GPLv2 materials (Req 1.1).
const OWNED_INJECTOR_BINARIES: &[&str] = &[
    "inject-helper64.exe",
    "inject-helper32.exe",
    "get-graphics-offsets64.exe",
    "get-graphics-offsets32.exe",
];

/// The three committed GPLv2 documents and the content each MUST contain.
const LICENSE_DOC: &str = "LICENSE-GPLv2.txt";
const ATTRIBUTION_DOC: &str = "ATTRIBUTION.md";
const SOURCE_OFFER_DOC: &str = "SOURCE-OFFER.md";

/// The resource directory holding the Owned_Capture_Component, relative to the
/// crate manifest dir — mirrors `OBS_CAPTURE_RESOURCE_DIR` in `build.rs` and the
/// `resources/obs-capture/*` glob in `tauri.conf.json`.
const RESOURCE_DIR_REL: &str = "resources/obs-capture";

/// Absolute path to this crate's manifest directory (`desktop/src-tauri`).
fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The resource directory where the GPLv2 materials and the binaries/DLLs ship.
fn resource_dir() -> PathBuf {
    manifest_dir().join(RESOURCE_DIR_REL)
}

/// Read a committed material from the resource dir, normalizing CRLF → LF so the
/// content assertions are line-ending agnostic on Windows.
fn read_material(name: &str) -> String {
    let path = resource_dir().join(name);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "required GPLv2 material {name} must be committed at {} (Req 11.1–11.3): {e}",
            path.display()
        )
    });
    raw.replace("\r\n", "\n")
}

/// Read a repo file relative to [`manifest_dir`], CRLF-normalized.
fn read_manifest_relative(rel: &str) -> String {
    let path = manifest_dir().join(rel);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    raw.replace("\r\n", "\n")
}

// ── Req 11.1 — the GPLv2 license text is present with the GPLv2 content ──────

/// `LICENSE-GPLv2.txt` exists in the bundled resource dir and contains the GPLv2
/// license text (the canonical title and version line), so the package ships the
/// license for the Forked_Hook_DLL / Owned_Injector binaries (Req 11.1).
#[test]
fn license_gplv2_text_is_present_and_is_the_gplv2() {
    let license = read_material(LICENSE_DOC).to_uppercase();

    assert!(
        license.contains("GNU GENERAL PUBLIC LICENSE"),
        "{LICENSE_DOC} must contain the GPLv2 title \"GNU GENERAL PUBLIC LICENSE\" (Req 11.1)"
    );
    assert!(
        license.contains("VERSION 2"),
        "{LICENSE_DOC} must identify itself as GPL Version 2 (Req 11.1)"
    );
    // A real license file, not a stub: the GPLv2 verbatim text is long.
    assert!(
        license.len() > 1000,
        "{LICENSE_DOC} looks too short to be the full GPLv2 text (Req 11.1)"
    );
}

// ── Req 11.2 — attribution with the pinned upstream identifier ───────────────

/// `ATTRIBUTION.md` exists, attributes the component to the OBS Project, and
/// carries the pinned upstream identifier (OBS Studio 32.1.2, commit `fb4d98b`)
/// so the package credits the upstream basis at the exact pin (Req 11.2). The
/// pinned identifier also evidences the owned, built-from-source posture of
/// Req 1.1 (a specific `win-capture` source pin, not an opaque prebuilt binary).
#[test]
fn attribution_is_present_with_obs_credit_and_pinned_identifier() {
    let attribution = read_material(ATTRIBUTION_DOC);

    assert!(
        attribution.contains("OBS"),
        "{ATTRIBUTION_DOC} must attribute the component to OBS Studio / the OBS Project (Req 11.2)"
    );
    assert!(
        attribution.contains("win-capture"),
        "{ATTRIBUTION_DOC} must name the OBS `win-capture` upstream basis (Req 11.2, 1.1)"
    );
    assert!(
        attribution.contains(PINNED_VERSION),
        "{ATTRIBUTION_DOC} must carry the pinned upstream version {PINNED_VERSION} (Req 11.2)"
    );
    assert!(
        attribution.contains(PINNED_COMMIT),
        "{ATTRIBUTION_DOC} must carry the pinned upstream commit {PINNED_COMMIT} (Req 11.2)"
    );
    // The attribution covers the GPLv2-licensed component.
    assert!(
        attribution.contains("GPLv2") || attribution.contains("General Public License"),
        "{ATTRIBUTION_DOC} must state the GPLv2 license of the attributed component (Req 11.2)"
    );
}

// ── Req 11.3 — source-availability / written-offer material ──────────────────

/// `SOURCE-OFFER.md` exists and contains the GPLv2 §3 source-availability /
/// written-offer text — a written offer, the at-least-three-years validity, and
/// the corresponding-source language — so the package satisfies the GPLv2
/// source obligation for the binaries it ships (Req 11.3).
#[test]
fn source_offer_material_is_present_with_written_offer_text() {
    let offer = read_material(SOURCE_OFFER_DOC);
    let lower = offer.to_lowercase();

    assert!(
        lower.contains("written offer"),
        "{SOURCE_OFFER_DOC} must contain the GPLv2 \"written offer\" (Req 11.3)"
    );
    assert!(
        lower.contains("three") && lower.contains("year"),
        "{SOURCE_OFFER_DOC} must state the offer is valid for at least three years (Req 11.3)"
    );
    assert!(
        lower.contains("corresponding source"),
        "{SOURCE_OFFER_DOC} must reference the complete corresponding source (Req 11.3)"
    );
    // The source offer must point at the same pinned upstream the attribution
    // does, so the "corresponding source" is unambiguous (Req 11.3, 11.2).
    assert!(
        offer.contains(PINNED_VERSION) && offer.contains(PINNED_COMMIT),
        "{SOURCE_OFFER_DOC} must identify the corresponding source by the pinned upstream \
         {PINNED_VERSION} / {PINNED_COMMIT} (Req 11.3)"
    );
}

// ── Req 1.1, 1.2, 11.x — materials ship ALONGSIDE the binary and DLLs ────────

/// The three GPLv2 documents and the binary/DLL artifacts are declared as one
/// `Owned_Capture_Component` required-materials set — the same
/// `packaging_guard::REQUIRED_MATERIALS` the build's packaging guard enforces —
/// so they ship together. This is the "alongside the binary and DLLs" contract:
/// the GPLv2 materials (Req 11.1–11.3) and the two `Forked_Hook_DLL` payloads
/// (Req 1.2) plus the `Owned_Injector` binaries (Req 1.1) are required as a unit.
#[test]
fn gplv2_materials_and_binaries_are_one_required_component() {
    let required: Vec<&str> = REQUIRED_MATERIALS.iter().map(|m| m.name).collect();

    // The three GPLv2 documents are required materials (Req 11.1–11.3).
    for doc in [LICENSE_DOC, ATTRIBUTION_DOC, SOURCE_OFFER_DOC] {
        assert!(
            required.contains(&doc),
            "the packaging guard's required materials must include the GPLv2 doc {doc} so it \
             ships with the component (Req 11.1–11.3); REQUIRED_MATERIALS = {required:?}"
        );
    }

    // Exactly one 64-bit and one 32-bit Forked_Hook_DLL are required alongside
    // them (Req 1.2).
    for dll in FORKED_HOOK_DLLS {
        assert!(
            required.contains(dll),
            "the required materials must include the {dll} payload so it ships next to the GPLv2 \
             materials (Req 1.2); REQUIRED_MATERIALS = {required:?}"
        );
    }
    // The Owned_Injector binaries round out the owned, built-from-source
    // component the materials describe (Req 1.1).
    for bin in OWNED_INJECTOR_BINARIES {
        assert!(
            required.contains(bin),
            "the required materials must include the Owned_Injector binary {bin} (Req 1.1); \
             REQUIRED_MATERIALS = {required:?}"
        );
    }
}

/// The resource directory holding the GPLv2 materials and the binaries/DLLs is
/// exactly the directory `tauri.conf.json` bundles into the package, so the same
/// bundle glob ships the GPLv2 materials next to the desktop binary
/// (Req 11.1–11.3 "at packaging", alongside the binary).
#[test]
fn bundled_resource_dir_ships_the_materials_next_to_the_binary() {
    let tauri_conf = read_manifest_relative("tauri.conf.json");

    // tauri.conf.json bundles the obs-capture resource dir (the glob that ships
    // the license/attribution/source-offer AND the binaries together).
    assert!(
        tauri_conf.contains("resources/obs-capture"),
        "tauri.conf.json must bundle the resources/obs-capture directory so the GPLv2 materials \
         (and the binaries/DLLs) ship with the desktop binary (Req 11.1–11.3)"
    );

    // The three GPLv2 documents physically live in that bundled directory.
    let dir = resource_dir();
    assert!(
        dir.is_dir(),
        "the bundled Owned_Capture_Component dir must exist at {} (Req 11.1–11.3)",
        dir.display()
    );
    for doc in [LICENSE_DOC, ATTRIBUTION_DOC, SOURCE_OFFER_DOC] {
        let path = dir.join(doc);
        assert!(
            path.is_file(),
            "GPLv2 material {doc} must be a committed file in the bundled dir {} (Req 11.1–11.3)",
            dir.display()
        );
    }
}

/// WHEN the (git-ignored, built-on-demand) Forked_Hook_DLL payloads are present,
/// each named DLL is a non-empty file in the SAME directory as the GPLv2
/// materials — concretely confirming the materials sit "alongside the binary and
/// DLLs" (Req 1.2). WHEN absent (fresh checkout / CI without a fork build), the
/// test degrades gracefully: the GPLv2 materials contract above still holds and
/// the binaries are not required for this packaging-materials check.
#[test]
fn present_forked_hook_dlls_sit_in_the_same_dir_as_the_gplv2_materials() {
    let dir = resource_dir();

    // Anchor: the GPLv2 license really is in this directory.
    assert!(
        dir.join(LICENSE_DOC).is_file(),
        "{LICENSE_DOC} must be in {} (Req 11.1)",
        dir.display()
    );

    let mut present = 0usize;
    let mut absent = Vec::new();
    for dll in FORKED_HOOK_DLLS {
        let path = dir.join(dll);
        match std::fs::metadata(&path) {
            Ok(meta) => {
                assert!(
                    meta.len() > 0,
                    "Forked_Hook_DLL {dll} is present next to the GPLv2 materials but EMPTY \
                     (Req 1.2): {}",
                    path.display()
                );
                present += 1;
            }
            Err(_) => absent.push(*dll),
        }
    }

    if present == 0 {
        eprintln!(
            "[skip] no Forked_Hook_DLL payload present under {} — the GPLv2 binaries are \
             git-ignored and built on demand (`desktop/scripts/build-capture-fork.ps1`). The \
             GPLv2 materials contract is asserted by the other tests; skipping the \
             binary-co-location check (Req 1.2).",
            dir.display()
        );
        return;
    }

    if !absent.is_empty() {
        eprintln!(
            "[note] {present} Forked_Hook_DLL payload(s) present alongside the GPLv2 materials; \
             not built (absent): {absent:?}. A full build yields both bitnesses (Req 1.2)."
        );
    }
}
