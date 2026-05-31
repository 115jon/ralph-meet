//! Pure, filesystem-free predicate for the `Owned_Capture_Component` packaging
//! guard (`owned-game-capture-hook` design — *`build.rs` packaging guard* /
//! Property 5).
//!
//! This module is shared by two compilation units:
//!
//! - `build.rs` includes it (via `#[path = "build_support/packaging_guard.rs"]
//!   mod packaging_guard;`) to decide whether the `game-capture-hook` build may
//!   proceed: it probes the filesystem for each required material, then asks
//!   this pure predicate which (if any) are missing.
//! - The Property 5 test (task 6.4) includes the same file so it can exercise
//!   [`evaluate_packaging_guard`] across every present/absent subset without
//!   touching the filesystem.
//!
//! [`evaluate_packaging_guard`] is deliberately **pure and total**: it takes the
//! required-material list and a parallel "is this one present?" flag slice and
//! returns a [`PackagingGuardOutcome`] naming every missing material. It performs
//! no I/O, so the "guard fails whenever any required material is missing"
//! property runs in CI without a real `resources/obs-capture/` directory. The
//! caller (`build.rs`) is the only side that touches disk; it builds the
//! presence flags by `is_file()`-checking each material under the resource dir
//! and renders the Requirement 7.5 / 11.4 / 12.3 / 12.6 failure text.
//!
//! Validates: Requirements 7.5, 11.4, 12.3, 12.4, 12.6.

#![allow(dead_code)]

/// One material the `Owned_Capture_Component` MUST ship when the
/// `game-capture-hook` feature is enabled, identified by its file name (under
/// `resources/obs-capture/`) and a human-readable role used in the failure text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RequiredMaterial {
    /// File name expected under `resources/obs-capture/`.
    pub name: &'static str,
    /// Human-readable role, named in the build-failure message when absent.
    pub role: &'static str,
}

/// The complete set of `Owned_Capture_Component` required materials (design —
/// *required materials*; Requirements 11.1–11.3, 12.3): the 64- and 32-bit
/// `Forked_Hook_DLL` payloads, the four `Owned_Injector` artifacts (forked
/// `inject-helper` + `get-graphics-offsets`, both bitnesses), the GPLv2 license
/// text, the OBS Project attribution, and the source-availability/written-offer
/// material.
///
/// The six artifact names mirror the `GRAPHICS_HOOK64` / `GRAPHICS_HOOK32` /
/// `INJECT_HELPER64` / `INJECT_HELPER32` / `GET_GRAPHICS_OFFSETS64` /
/// `GET_GRAPHICS_OFFSETS32` constants in `src/game_capture/inject.rs` and the
/// `resources/obs-capture/README.md` "Required materials" table; keep all three
/// in sync. The three GPLv2 documents satisfy Requirements 11.1 (license text),
/// 11.2 (attribution + pinned upstream identifier), and 11.3 (source offer).
pub const REQUIRED_MATERIALS: &[RequiredMaterial] = &[
    RequiredMaterial {
        name: "graphics-hook64.dll",
        role: "64-bit Forked_Hook_DLL payload (GRAPHICS_HOOK64)",
    },
    RequiredMaterial {
        name: "graphics-hook32.dll",
        role: "32-bit Forked_Hook_DLL payload (GRAPHICS_HOOK32)",
    },
    RequiredMaterial {
        name: "inject-helper64.exe",
        role: "64-bit Owned_Injector — inject-helper (INJECT_HELPER64)",
    },
    RequiredMaterial {
        name: "inject-helper32.exe",
        role: "32-bit Owned_Injector — inject-helper (INJECT_HELPER32)",
    },
    RequiredMaterial {
        name: "get-graphics-offsets64.exe",
        role: "64-bit Owned_Injector — get-graphics-offsets (GET_GRAPHICS_OFFSETS64)",
    },
    RequiredMaterial {
        name: "get-graphics-offsets32.exe",
        role: "32-bit Owned_Injector — get-graphics-offsets (GET_GRAPHICS_OFFSETS32)",
    },
    RequiredMaterial {
        name: "LICENSE-GPLv2.txt",
        role: "GPLv2 license text for the Forked_Hook_DLL/Owned_Injector (Req 11.1)",
    },
    RequiredMaterial {
        name: "ATTRIBUTION.md",
        role: "OBS Project attribution + pinned win-capture identifier (Req 11.2)",
    },
    RequiredMaterial {
        name: "SOURCE-OFFER.md",
        role: "GPLv2 source-availability / written offer material (Req 11.3)",
    },
];

/// The outcome of evaluating the packaging guard over a present/absent flag set.
///
/// `missing` lists — in `REQUIRED_MATERIALS` order — every required material
/// that was reported absent. The guard passes iff `missing` is empty.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackagingGuardOutcome {
    /// Every required material reported absent, in declaration order.
    pub missing: Vec<RequiredMaterial>,
}

impl PackagingGuardOutcome {
    /// The guard passes iff no required material is missing (Property 5).
    pub fn passed(&self) -> bool {
        self.missing.is_empty()
    }
}

/// Pure predicate: given the required-material list and a parallel slice of
/// presence flags (`present[i]` is whether `required[i]` exists), return the
/// [`PackagingGuardOutcome`] naming every missing material.
///
/// Totality: an index without a corresponding `present` entry is treated as
/// **absent** (`present.get(i)` → `None` → missing), so a short/empty flag slice
/// can never spuriously pass the guard. The guard therefore passes **iff** every
/// required material has a `present[i] == true` flag (Property 5).
///
/// Performs no I/O and is total over all inputs, so it is the target of
/// Property 5 (task 6.4) and runs in CI without a build or a populated resource
/// directory.
pub fn evaluate_packaging_guard(
    required: &[RequiredMaterial],
    present: &[bool],
) -> PackagingGuardOutcome {
    let missing = required
        .iter()
        .enumerate()
        .filter(|(index, _)| !present.get(*index).copied().unwrap_or(false))
        .map(|(_, material)| *material)
        .collect();
    PackagingGuardOutcome { missing }
}
