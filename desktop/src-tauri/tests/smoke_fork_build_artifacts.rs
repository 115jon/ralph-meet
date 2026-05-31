//! Integration / smoke test: the fork build produces both bitnesses of the
//! `Forked_Hook_DLL` and the `Owned_Injector` artifacts at their destination
//! paths.
//!
//! Validates: Requirements 12.1, 12.2, 12.4, 12.5
//!   - 12.1 A successful `cargo tauri build` (CEF toolchain) produces the
//!          desktop binary plus the 64-bit and 32-bit `Forked_Hook_DLL`.
//!   - 12.2 The `game-capture-hook` feature compiles the hook functionality;
//!          the fork build wiring emits exactly one 64-bit and one 32-bit of
//!          each artifact (the bitness is encoded in the file name + PE machine).
//!   - 12.4 With `game-capture-hook` OFF the build works with WGC only and has
//!          no build-time dependency on the fork artifacts — so this test must
//!          NOT require the artifacts unconditionally.
//!   - 12.5 The hook builds/runs without any dev-server process — the artifacts
//!          are produced by an on-demand `build-capture-fork.ps1` run, not a
//!          running server.
//!
//! # Why a smoke test that degrades gracefully (not a real build)
//!
//! The actual fork build (`fork/CMakeLists.txt` driven by
//! `desktop/scripts/build-capture-fork.ps1`) needs CMake + MSVC + Microsoft
//! Detours, which are not present in a generic CI runner, and the produced
//! GPLv2 binaries are **git-ignored** (`desktop/src-tauri/resources/obs-capture/
//! *.dll` / `*.exe`) — only the license/attribution/source-offer text is
//! committed. So a fresh checkout (and CI) has the *source + build wiring* but
//! not the *binaries*. Running the full toolchain here would be slow and
//! environment-dependent, and unconditionally requiring the binaries would
//! violate Req 12.4/12.5 (the WGC-only build must not depend on them).
//!
//! This file therefore proves the **artifact contract** at two complementary
//! levels, both runnable under a plain `cargo test` on any platform:
//!
//!   * **Build wiring (always asserted).** The driver + CMake project are wired
//!     to emit all six artifacts — both bitnesses of `graphics-hook`,
//!     `inject-helper`, and `get-graphics-offsets` — into the destination
//!     resource directory under the exact names the host injector + packaging
//!     guard expect. This is meaningful in CI without the binaries.
//!   * **Artifact validation (when built).** WHEN the artifacts are present at
//!     their destination paths (a maintainer ran the fork build, or they were
//!     dropped in), each is non-empty and a valid PE whose machine type matches
//!     its name's bitness (`*64` → `0x8664` AMD64, `*32` → `0x014C` i386). When
//!     absent, the test skips that check gracefully (Req 12.4/12.5).
//!
//! The file compiles with no feature gate (it uses only `std`), so it runs under
//! any feature set. Verify with (from `desktop/src-tauri`):
//!   cargo test --test smoke_fork_build_artifacts

use std::path::{Path, PathBuf};

// ── Artifact contract (kept in sync with src/game_capture/inject.rs) ─────────
//
// These mirror the `GRAPHICS_HOOK64` / `GRAPHICS_HOOK32` / `INJECT_HELPER64` /
// `INJECT_HELPER32` / `GET_GRAPHICS_OFFSETS64` / `GET_GRAPHICS_OFFSETS32`
// constants in `src/game_capture/inject.rs`, the `OWNED_CAPTURE_COPY_ARTIFACTS`
// list in `build.rs`, and the `$artifactsByArch` table in
// `desktop/scripts/build-capture-fork.ps1`. If a name changes in one place it
// must change in all of them. The test cross-checks the build wiring against
// these names below.

/// `IMAGE_FILE_MACHINE_AMD64` — the machine type the 64-bit (`*64`) artifacts
/// must carry (the fork build's `x64` platform).
const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
/// `IMAGE_FILE_MACHINE_I386` — the machine type the 32-bit (`*32`) artifacts
/// must carry (the fork build's `Win32` platform).
const IMAGE_FILE_MACHINE_I386: u16 = 0x014C;

/// One Owned_Capture_Component artifact the fork build must place at its
/// destination: its file name and the PE machine type its bitness implies.
struct ForkArtifact {
    name: &'static str,
    /// Expected `IMAGE_FILE_HEADER.Machine` for this artifact's bitness.
    expected_machine: u16,
    /// Human-readable role for assertion messages.
    role: &'static str,
}

/// The complete set of fork build outputs (Req 12.1, 12.2): exactly one 64-bit
/// and one 32-bit of the `Forked_Hook_DLL` payload, the `inject-helper`
/// Owned_Injector, and the `get-graphics-offsets` helper.
const FORK_ARTIFACTS: &[ForkArtifact] = &[
    ForkArtifact {
        name: "graphics-hook64.dll",
        expected_machine: IMAGE_FILE_MACHINE_AMD64,
        role: "64-bit Forked_Hook_DLL payload",
    },
    ForkArtifact {
        name: "graphics-hook32.dll",
        expected_machine: IMAGE_FILE_MACHINE_I386,
        role: "32-bit Forked_Hook_DLL payload",
    },
    ForkArtifact {
        name: "inject-helper64.exe",
        expected_machine: IMAGE_FILE_MACHINE_AMD64,
        role: "64-bit Owned_Injector (inject-helper)",
    },
    ForkArtifact {
        name: "inject-helper32.exe",
        expected_machine: IMAGE_FILE_MACHINE_I386,
        role: "32-bit Owned_Injector (inject-helper)",
    },
    ForkArtifact {
        name: "get-graphics-offsets64.exe",
        expected_machine: IMAGE_FILE_MACHINE_AMD64,
        role: "64-bit Owned_Injector (get-graphics-offsets)",
    },
    ForkArtifact {
        name: "get-graphics-offsets32.exe",
        expected_machine: IMAGE_FILE_MACHINE_I386,
        role: "32-bit Owned_Injector (get-graphics-offsets)",
    },
];

/// The destination directory the fork build copies its artifacts into, relative
/// to the crate manifest dir — mirrors `$destDir` in `build-capture-fork.ps1`
/// and `OBS_CAPTURE_RESOURCE_DIR` in `build.rs`.
const DESTINATION_DIR_REL: &str = "resources/obs-capture";

/// Absolute path to this crate's manifest directory (`desktop/src-tauri`).
fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The destination directory where the fork build places the six artifacts.
fn destination_dir() -> PathBuf {
    manifest_dir().join(DESTINATION_DIR_REL)
}

/// Read a repo file relative to [`manifest_dir`], normalizing CRLF → LF so the
/// source/text assertions are line-ending agnostic on Windows.
fn read_manifest_relative(rel: &str) -> String {
    let path = manifest_dir().join(rel);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    raw.replace("\r\n", "\n")
}

/// Parse a PE file's `IMAGE_FILE_HEADER.Machine` from its bytes, returning
/// `None` if the bytes are not a well-formed PE (too short, no `MZ`, bad
/// `e_lfanew`, or no `PE\0\0` signature). Pure byte arithmetic, so it validates
/// a Windows artifact on any host platform.
fn pe_machine(bytes: &[u8]) -> Option<u16> {
    // DOS header: "MZ" magic, then the PE header offset at 0x3C (e_lfanew).
    if bytes.len() < 0x40 || &bytes[0..2] != b"MZ" {
        return None;
    }
    let e_lfanew = u32::from_le_bytes([bytes[0x3C], bytes[0x3D], bytes[0x3E], bytes[0x3F]]) as usize;
    // Need PE signature (4 bytes) + at least the Machine field (2 bytes) of the
    // COFF file header that immediately follows it.
    if e_lfanew + 6 > bytes.len() {
        return None;
    }
    if &bytes[e_lfanew..e_lfanew + 4] != b"PE\0\0" {
        return None;
    }
    let machine_off = e_lfanew + 4;
    Some(u16::from_le_bytes([bytes[machine_off], bytes[machine_off + 1]]))
}

/// Sanity-check the PE parser against the bytes it expects to see, so a parser
/// bug can't make the artifact checks pass vacuously.
#[test]
fn pe_machine_parser_reads_the_machine_field() {
    // Minimal synthetic PE: "MZ" + e_lfanew=0x40, then "PE\0\0" + machine LE.
    let mut buf = vec![0u8; 0x48];
    buf[0] = b'M';
    buf[1] = b'Z';
    buf[0x3C..0x40].copy_from_slice(&0x40u32.to_le_bytes());
    buf[0x40..0x44].copy_from_slice(b"PE\0\0");
    buf[0x44..0x46].copy_from_slice(&IMAGE_FILE_MACHINE_AMD64.to_le_bytes());
    assert_eq!(pe_machine(&buf), Some(IMAGE_FILE_MACHINE_AMD64));

    // Non-PE inputs return None rather than a bogus machine value.
    assert_eq!(pe_machine(b""), None);
    assert_eq!(pe_machine(b"not a pe file"), None);
    let mut no_sig = buf.clone();
    no_sig[0x40..0x44].copy_from_slice(b"junk");
    assert_eq!(pe_machine(&no_sig), None);
}

// ── Build wiring (always asserted; meaningful in CI without the binaries) ────

/// Req 12.1, 12.2 — the fork build is wired to produce **all six** artifacts:
/// the standalone CMake project names the three output targets with the
/// bitness-suffixed names, and the PowerShell driver builds both bitnesses and
/// copies every one of the six artifacts into the destination resource dir under
/// the exact contract names. This proves "a successful build yields both
/// bitnesses of the Forked_Hook_DLL + the Owned_Injector" at the wiring level,
/// independent of whether the (git-ignored) binaries are currently built.
#[test]
fn fork_build_is_wired_to_produce_both_bitnesses_at_destination() {
    let cmake = read_manifest_relative("resources/obs-capture/fork/CMakeLists.txt");
    let driver = std::fs::read_to_string(
        manifest_dir()
            .join("..")
            .join("scripts")
            .join("build-capture-fork.ps1"),
    )
    .expect("the fork build driver build-capture-fork.ps1 must exist (task 1.2)")
    .replace("\r\n", "\n");

    // (a) CMake emits the three targets with a bitness-suffixed OUTPUT_NAME, so
    //     one configure per arch yields `…64` / `…32` of each (Req 1.2, 12.2).
    for target in ["graphics-hook", "inject-helper", "get-graphics-offsets"] {
        let output_name = format!("OUTPUT_NAME \"{target}${{FORK_BITS}}\"");
        assert!(
            cmake.contains(&output_name),
            "fork CMakeLists.txt must name the {target} output with the bitness suffix \
             so both 64- and 32-bit artifacts are produced (Req 1.2, 12.2); expected: {output_name}"
        );
    }

    // (b) The driver builds BOTH bitnesses (x64 + Win32) ...
    assert!(
        driver.contains("\"x64\"") && (driver.contains("\"x86\"") || driver.contains("Win32")),
        "the driver must build both the 64-bit (x64) and 32-bit (x86/Win32) artifacts (Req 12.1)"
    );

    // (c) ... copies every one of the six contract artifacts ...
    for artifact in FORK_ARTIFACTS {
        assert!(
            driver.contains(artifact.name),
            "the fork build driver must produce/copy the {} ({}) (Req 12.1, 12.2)",
            artifact.name,
            artifact.role
        );
    }

    // (d) ... into the destination resource dir the host injector + packaging
    //     guard read from (Req 12.1 — artifacts at their destination paths).
    assert!(
        driver.contains("resources\\obs-capture") || driver.contains("resources/obs-capture"),
        "the driver must copy artifacts into the {DESTINATION_DIR_REL} destination dir (Req 12.1)"
    );
}

// ── Artifact validation when built (degrades gracefully when absent) ─────────

/// Req 12.1, 12.2, 12.4, 12.5 — WHEN the fork build artifacts are present at
/// their destination paths, each is **non-empty** and a valid PE whose machine
/// type matches the bitness encoded in its name (`*64` → AMD64 `0x8664`, `*32` →
/// i386 `0x014C`). WHEN none are present (a fresh checkout / CI without the
/// toolchain, since the GPLv2 binaries are git-ignored and built on demand) the
/// test **skips gracefully** rather than failing — the WGC-only build must not
/// require these artifacts (Req 12.4, 12.5).
#[test]
fn present_fork_artifacts_are_nonempty_pe_with_matching_machine_type() {
    let dest = destination_dir();
    assert!(
        dest.is_dir(),
        "the Owned_Capture_Component destination dir must exist at {} (committed alongside the \
         license/attribution materials)",
        dest.display()
    );

    let mut validated = 0usize;
    let mut absent = Vec::new();

    for artifact in FORK_ARTIFACTS {
        let path = dest.join(artifact.name);
        let Ok(meta) = std::fs::metadata(&path) else {
            // Not built yet — git-ignored, produced on demand by the fork build.
            absent.push(artifact.name);
            continue;
        };

        // Present ⇒ must be non-empty (Req 12.1 — a *successful* build yields a
        // real, non-empty artifact, never a zero-byte placeholder).
        assert!(
            meta.len() > 0,
            "fork artifact {} ({}) is present at {} but EMPTY; a successful build yields a \
             non-empty artifact (Req 12.1, 12.2)",
            artifact.name,
            artifact.role,
            path.display()
        );

        // Present ⇒ must be a valid PE whose machine type matches its bitness.
        let bytes = std::fs::read(&path)
            .unwrap_or_else(|e| panic!("failed to read present artifact {}: {e}", path.display()));
        let machine = pe_machine(&bytes).unwrap_or_else(|| {
            panic!(
                "fork artifact {} ({}) at {} is not a valid PE file (no MZ/PE header)",
                artifact.name,
                artifact.role,
                path.display()
            )
        });
        assert_eq!(
            machine, artifact.expected_machine,
            "fork artifact {} ({}) has PE machine 0x{:04X}, expected 0x{:04X} for its bitness \
             (Req 12.1, 12.2)",
            artifact.name, artifact.role, machine, artifact.expected_machine
        );
        validated += 1;
    }

    if validated == 0 {
        // Graceful skip: the build hasn't run / the toolchain isn't present.
        // Req 12.4/12.5 — the artifacts are NOT required unconditionally.
        eprintln!(
            "[skip] no fork build artifacts present under {} — the GPLv2 binaries are \
             git-ignored and built on demand by `desktop/scripts/build-capture-fork.ps1`. \
             Run that script (CMake + MSVC + Detours) to validate the built artifacts. \
             Skipping the PE/non-empty checks (Req 12.4, 12.5).",
            dest.display()
        );
        return;
    }

    if !absent.is_empty() {
        // A partial set is legitimate: `build-capture-fork.ps1` skips the
        // graphics-hook DLLs when Microsoft Detours can't be resolved while the
        // helper EXEs still build. Surface which are missing for diagnosis, but
        // do not fail — every artifact that *is* present was validated above.
        eprintln!(
            "[note] validated {validated} present fork artifact(s); not built (absent): {absent:?}. \
             A full build (with Detours resolved) yields all {} (Req 12.1, 12.2).",
            FORK_ARTIFACTS.len()
        );
    }
}

/// Req 12.1, 12.2 — completeness contract for a *successful full build*: once
/// the `Forked_Hook_DLL` payloads are present (i.e. a Detours-enabled build
/// ran), BOTH bitnesses of all three artifact types must be present and
/// non-empty at their destination paths — a successful build never produces only
/// one bitness. WHEN the payload DLLs are absent (no build / Detours-less
/// partial build / fresh checkout) the test skips gracefully (Req 12.4, 12.5).
#[test]
fn successful_full_fork_build_yields_all_six_artifacts() {
    let dest = destination_dir();

    let hook64_present = dest.join("graphics-hook64.dll").is_file();
    let hook32_present = dest.join("graphics-hook32.dll").is_file();

    if !hook64_present && !hook32_present {
        eprintln!(
            "[skip] neither Forked_Hook_DLL is present under {} — no Detours-enabled fork build \
             has run (the GPLv2 binaries are git-ignored / built on demand). Skipping the \
             full-build completeness check (Req 12.4, 12.5).",
            dest.display()
        );
        return;
    }

    // At least one DLL is present ⇒ a real fork build ran ⇒ a *successful* build
    // must have produced every one of the six artifacts, each non-empty.
    let mut incomplete = Vec::new();
    for artifact in FORK_ARTIFACTS {
        let path = dest.join(artifact.name);
        match std::fs::metadata(&path) {
            Ok(meta) if meta.len() > 0 => {}
            Ok(_) => incomplete.push(format!("{} (empty)", artifact.name)),
            Err(_) => incomplete.push(format!("{} (missing)", artifact.name)),
        }
    }

    assert!(
        incomplete.is_empty(),
        "a Forked_Hook_DLL is present (a fork build ran), so a successful build must yield BOTH \
         bitnesses of all six artifacts non-empty at {} (Req 12.1, 12.2); not satisfied: {incomplete:?}",
        dest.display()
    );

    // And the two payload DLLs specifically are both present (the headline
    // Req 12.1 guarantee: a successful build produces the 64-bit AND 32-bit
    // Forked_Hook_DLL).
    assert!(
        hook64_present && hook32_present,
        "a successful build produces BOTH the 64-bit and 32-bit Forked_Hook_DLL (Req 12.1); \
         got hook64={hook64_present}, hook32={hook32_present}"
    );
}

/// Helper: the destination resource dir is the path the host injector discovers
/// artifacts from and the path the packaging guard checks — assert the test's
/// destination matches the names the injector contract pins, so the artifact
/// names this test enforces can't silently drift from the rest of the build.
#[test]
fn artifact_names_match_the_injector_and_build_contract() {
    // The build.rs copy list and the inject.rs constants are the source of
    // truth; assert this test's names appear in build.rs's copy artifact list.
    let build_rs = read_manifest_relative("build.rs");
    for artifact in FORK_ARTIFACTS {
        assert!(
            build_rs.contains(artifact.name),
            "build.rs OWNED_CAPTURE_COPY_ARTIFACTS must include {} so the host can locate it \
             next to the binary (Req 12.1); keep this test in sync with build.rs",
            artifact.name
        );
    }

    // The packaging guard (README + build.rs) requires the two DLLs as required
    // materials, anchoring the "both bitnesses" destination-path contract.
    for dll in ["graphics-hook64.dll", "graphics-hook32.dll"] {
        assert!(
            Path::new(&destination_dir())
                .join("README.md")
                .is_file(),
            "the destination dir must document its required materials (README.md)"
        );
        assert!(
            build_rs.contains(dll),
            "build.rs must reference the required {dll} payload (Req 12.1)"
        );
    }
}
