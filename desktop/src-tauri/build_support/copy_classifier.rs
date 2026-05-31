//! Pure, filesystem-free classifier for the locked-DLL artifact copy
//! (`owned-game-capture-hook` design — *`classify_copy` / `CopyResolution`*).
//!
//! This module is shared by two compilation units:
//!
//! - `build.rs` includes it (via `#[path = "build_support/copy_classifier.rs"]
//!   mod copy_classifier;`) to drive the resilient copy of the
//!   `Forked_Hook_DLL` / `Owned_Injector` artifacts next to the binary.
//! - The Property 4 test (task 6.2) includes the same file so it can exercise
//!   [`classify_copy`] across every input without touching the filesystem.
//!
//! [`classify_copy`] is deliberately **pure and total**: it takes only the
//! Windows copy-error code (if any), whether a file already exists at the
//! destination, and that file's length, and returns a [`CopyResolution`]. It
//! performs no I/O, so it is exhaustively testable in CI without a build, a
//! game, or a locked file. The caller (`build.rs`) is the only side that
//! touches disk; it attaches the real destination path with
//! [`CopyResolution::with_dest`] and emits the warning/error text required by
//! Requirements 7.2, 7.3, and 7.4.
//!
//! Validates: Requirements 7.1, 7.2, 7.4.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// Windows `ERROR_SHARING_VIOLATION` — surfaced by `std::io::Error::raw_os_error`
/// as **os error 32** when a copy/overwrite fails because the destination file
/// is locked on disk (e.g. a running game has the `Forked_Hook_DLL` injected and
/// holds it open). This is the single error code the resilience path treats
/// specially (Requirement 7.1).
pub const ERROR_SHARING_VIOLATION: i32 = 32;

/// The outcome of attempting to place one `Forked_Hook_DLL` / `Owned_Injector`
/// artifact at its destination during the build (Requirements 7.1–7.5).
///
/// The non-`Copied` variants carry the destination path so the caller can name
/// the locked/absent artifact by its path in the warning or error it emits
/// (Req 7.2, 7.3, 7.4). [`classify_copy`] fills the path with an empty
/// placeholder (it is pure and never sees a path); the caller attaches the real
/// destination with [`with_dest`](Self::with_dest).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CopyResolution {
    /// The copy succeeded; the destination now holds the fresh artifact.
    Copied,
    /// os error 32 (sharing violation) **and** a usable (existing, non-empty)
    /// artifact is already present at the destination → warn + continue using
    /// the already-present artifact, never failing the build (Req 7.1–7.3).
    KeptLockedExisting { dest: PathBuf },
    /// os error 32 (sharing violation) **and** no usable artifact is present at
    /// the destination → fail the build, naming the path and the release steps
    /// (Req 7.4).
    FailedLockedMissing { dest: PathBuf },
    /// A non-lock copy failure with no usable artifact to fall back on — there
    /// is no artifact to place at all (e.g. the source vanished), distinct from
    /// a present-but-locked file → fail the build (Req 7.5).
    FailedAbsent { dest: PathBuf },
}

impl CopyResolution {
    /// Attach the real destination path to a non-`Copied` resolution.
    ///
    /// [`classify_copy`] is pure and produces placeholder paths; `build.rs`
    /// calls this with the actual destination so the warning/error text can name
    /// the locked or absent artifact by its path (Req 7.2, 7.3, 7.4).
    pub fn with_dest(self, dest: &Path) -> Self {
        match self {
            CopyResolution::Copied => CopyResolution::Copied,
            CopyResolution::KeptLockedExisting { .. } => {
                CopyResolution::KeptLockedExisting { dest: dest.to_path_buf() }
            }
            CopyResolution::FailedLockedMissing { .. } => {
                CopyResolution::FailedLockedMissing { dest: dest.to_path_buf() }
            }
            CopyResolution::FailedAbsent { .. } => {
                CopyResolution::FailedAbsent { dest: dest.to_path_buf() }
            }
        }
    }
}

/// Pure classifier: given the copy error (if any), whether a file already exists
/// at the destination, and that file's length, decide the [`CopyResolution`].
///
/// A **usable** artifact is one that already exists at the destination and is
/// non-empty (`dest_exists && dest_len > 0`) — an empty (0-byte) file is *not*
/// usable, so a sharing violation over a 0-byte stub fails rather than silently
/// shipping a broken DLL.
///
/// Mapping (Requirements 7.1, 7.2, 7.4):
/// - no error                                   → [`CopyResolution::Copied`]
/// - sharing violation (32) **and** usable      → [`CopyResolution::KeptLockedExisting`]
/// - sharing violation (32) **and** not usable  → [`CopyResolution::FailedLockedMissing`]
/// - any other error                            → [`CopyResolution::FailedAbsent`]
///
/// In particular a sharing violation never yields a build failure while a usable
/// artifact is present at the destination (Req 7.1).
///
/// Performs no I/O and is total over all inputs, so it is the target of
/// Property 4 and runs in CI without hardware.
pub fn classify_copy(
    copy_err_os_code: Option<i32>,
    dest_exists: bool,
    dest_len: u64,
) -> CopyResolution {
    let usable = dest_exists && dest_len > 0;
    match copy_err_os_code {
        // The copy succeeded — nothing was locked or missing.
        None => CopyResolution::Copied,
        // Destination locked on disk (a running game holds the injected DLL).
        Some(code) if code == ERROR_SHARING_VIOLATION => {
            if usable {
                // A usable same-bitness artifact is already in place: keep it
                // and continue (Req 7.1, 7.2) — never fail on account of the lock.
                CopyResolution::KeptLockedExisting { dest: PathBuf::new() }
            } else {
                // Locked but nothing usable to fall back on: fail (Req 7.4).
                CopyResolution::FailedLockedMissing { dest: PathBuf::new() }
            }
        }
        // Any other copy error means there is no artifact to place at all
        // (e.g. the source is gone): this is not a recoverable lock (Req 7.5).
        Some(_) => CopyResolution::FailedAbsent { dest: PathBuf::new() },
    }
}
