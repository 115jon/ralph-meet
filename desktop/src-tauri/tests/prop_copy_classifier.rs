//! Property-based test for the locked-DLL copy classifier.
//!
//! Feature: owned-game-capture-hook, Property 4: The locked-DLL copy classifier
//! maps every case to the right resolution
//!
//! Validates: Requirements 7.1, 7.2, 7.4
//!
//! The logic under test is the pure, filesystem-free
//! `classify_copy(copy_err_os_code, dest_exists, dest_len) -> CopyResolution`
//! that drives `build.rs`'s resilient copy of the `Forked_Hook_DLL` /
//! `Owned_Injector` artifacts. Build scripts cannot be imported from `tests/`,
//! so this test `#[path]`-includes the *same* shared source file that `build.rs`
//! includes (`build_support/copy_classifier.rs`), exercising the exact code the
//! build uses rather than a copy.
//!
//! For any copy-error code (none, the Windows sharing-violation code 32, or any
//! other code), destination-exists flag, and destination length, `classify_copy`
//! must return:
//!   - `Copied`               when there is no error;
//!   - `KeptLockedExisting`   iff the error is the sharing violation (32) AND a
//!                            usable artifact is present (dest exists & non-empty);
//!   - `FailedLockedMissing`  iff the error is the sharing violation (32) AND no
//!                            usable artifact is present;
//!   - `FailedAbsent`         for any other (non-`None`, non-32) error.
//!
//! In particular a sharing violation NEVER yields a build failure while a usable
//! same-bitness artifact is present at the destination (Req 7.1).
//!
//! `classify_copy` is pure and total, so the property runs in CI without a
//! build, a game, or a locked file. The expected outcome is re-derived
//! independently below (mirroring the contract, not the implementation) so the
//! property pins behavior rather than restating it.

// The pure classifier lives in a file shared with `build.rs`; include it the
// same way the build script does (build scripts cannot be imported from
// `tests/`). See the module doc comment in `copy_classifier.rs`.
#[path = "../build_support/copy_classifier.rs"]
mod copy_classifier;

use copy_classifier::{classify_copy, CopyResolution, ERROR_SHARING_VIOLATION};
use proptest::prelude::*;

/// Strategy over the complete copy-error-code input space: no error (`None`),
/// the Windows sharing-violation code (`Some(32)`), and arbitrary "other" error
/// codes (`Some(_)` where the code is not 32). The sharing-violation and `None`
/// cases are weighted up so the lock paths are exercised heavily, while
/// arbitrary other codes still cover the `FailedAbsent` branch broadly.
fn copy_err_strategy() -> impl Strategy<Value = Option<i32>> {
    prop_oneof![
        // No error -> Copied.
        4 => Just(None),
        // The single specially-handled code: sharing violation (os error 32).
        4 => Just(Some(ERROR_SHARING_VIOLATION)),
        // Any other error code (explicitly excluding 32 so the "other" branch
        // is unambiguous). Covers negatives, zero, and large codes.
        4 => any::<i32>()
            .prop_filter("non-sharing-violation code", |c| *c != ERROR_SHARING_VIOLATION)
            .prop_map(Some),
    ]
}

/// Full-range `u64` destination length with the boundary `0` (empty / not
/// usable) and `1` (smallest usable) over-sampled, plus `u64::MAX`, so the
/// usable/not-usable boundary is exercised at its edges rather than only
/// mid-range.
fn dest_len_strategy() -> impl Strategy<Value = u64> {
    prop_oneof![
        2 => Just(0u64),
        2 => Just(1u64),
        1 => Just(u64::MAX),
        5 => any::<u64>(),
    ]
}

/// Independent re-derivation of the documented mapping, written by hand (not by
/// calling `classify_copy`) so the property checks the implementation against a
/// second source of truth. A "usable" artifact is one that exists and is
/// non-empty.
fn expected_resolution(
    copy_err_os_code: Option<i32>,
    dest_exists: bool,
    dest_len: u64,
) -> CopyResolution {
    let usable = dest_exists && dest_len > 0;
    match copy_err_os_code {
        None => CopyResolution::Copied,
        Some(code) if code == ERROR_SHARING_VIOLATION => {
            if usable {
                CopyResolution::KeptLockedExisting { dest: std::path::PathBuf::new() }
            } else {
                CopyResolution::FailedLockedMissing { dest: std::path::PathBuf::new() }
            }
        }
        Some(_) => CopyResolution::FailedAbsent { dest: std::path::PathBuf::new() },
    }
}

proptest! {
    // Property 4 requires a minimum of 100 iterations; 1024 cases cover the
    // (error-code x dest_exists x dest_len) space — including the over-sampled
    // sharing-violation code and the 0/1 length boundary — well above the floor.
    #![proptest_config(ProptestConfig::with_cases(1024))]

    /// Feature: owned-game-capture-hook, Property 4: The locked-DLL copy
    /// classifier maps every case to the right resolution.
    ///
    /// Validates: Requirements 7.1, 7.2, 7.4
    #[test]
    fn classify_copy_maps_every_case_to_the_right_resolution(
        copy_err_os_code in copy_err_strategy(),
        dest_exists in any::<bool>(),
        dest_len in dest_len_strategy(),
    ) {
        let got = classify_copy(copy_err_os_code, dest_exists, dest_len);
        let usable = dest_exists && dest_len > 0;

        // (1) Totality + agreement with the independently re-derived contract.
        // `classify_copy` returns placeholder (empty) paths since it is pure, so
        // the expected value uses the same empty placeholder — equality here
        // pins both the variant and the (pure) payload.
        prop_assert_eq!(
            &got,
            &expected_resolution(copy_err_os_code, dest_exists, dest_len),
            "classify_copy disagreed with the documented mapping: \
             err={:?}, dest_exists={}, dest_len={}",
            copy_err_os_code,
            dest_exists,
            dest_len
        );

        // (2) Restated per-branch for stronger localization of any counterexample.
        match copy_err_os_code {
            // No error -> Copied, regardless of the destination state (Req: a
            // successful copy is never reclassified by what was there before).
            None => prop_assert_eq!(
                &got,
                &CopyResolution::Copied,
                "no copy error must yield Copied (dest_exists={}, dest_len={})",
                dest_exists,
                dest_len
            ),
            Some(code) if code == ERROR_SHARING_VIOLATION => {
                if usable {
                    // Sharing violation + usable artifact present -> keep it and
                    // continue; NEVER a build failure (Req 7.1, 7.2).
                    prop_assert!(
                        matches!(got, CopyResolution::KeptLockedExisting { .. }),
                        "sharing violation with a usable artifact must be \
                         KeptLockedExisting, got {:?} (dest_len={})",
                        got,
                        dest_len
                    );
                } else {
                    // Sharing violation + nothing usable -> fail (Req 7.4).
                    prop_assert!(
                        matches!(got, CopyResolution::FailedLockedMissing { .. }),
                        "sharing violation with no usable artifact must be \
                         FailedLockedMissing, got {:?} (dest_exists={}, dest_len={})",
                        got,
                        dest_exists,
                        dest_len
                    );
                }
            }
            // Any other (non-32) error -> FailedAbsent: there is no artifact to
            // place at all, distinct from a present-but-locked file (Req 7.5).
            Some(_) => prop_assert!(
                matches!(got, CopyResolution::FailedAbsent { .. }),
                "a non-sharing-violation error must be FailedAbsent, got {:?}",
                got
            ),
        }

        // (3) The core Requirement 7.1 invariant, asserted directly: a sharing
        // violation with a usable same-bitness artifact present is never any
        // failure variant.
        if copy_err_os_code == Some(ERROR_SHARING_VIOLATION) && usable {
            prop_assert!(
                !matches!(
                    got,
                    CopyResolution::FailedLockedMissing { .. }
                        | CopyResolution::FailedAbsent { .. }
                ),
                "a sharing violation with a usable artifact must never fail the \
                 build, got {:?}",
                got
            );
        }
    }
}

/// Focused, non-property checks pinning the boundary cases with concrete, named
/// values — complements the property with explicit edge cases an audit can read
/// at a glance.
#[test]
fn concrete_boundary_cases_map_as_documented() {
    // No error always succeeds, whatever is (or isn't) at the destination.
    assert_eq!(classify_copy(None, false, 0), CopyResolution::Copied);
    assert_eq!(classify_copy(None, true, 0), CopyResolution::Copied);
    assert_eq!(classify_copy(None, true, 4096), CopyResolution::Copied);

    // Sharing violation with a usable (existing, non-empty) artifact -> kept.
    assert!(matches!(
        classify_copy(Some(ERROR_SHARING_VIOLATION), true, 1),
        CopyResolution::KeptLockedExisting { .. }
    ));
    assert!(matches!(
        classify_copy(Some(ERROR_SHARING_VIOLATION), true, u64::MAX),
        CopyResolution::KeptLockedExisting { .. }
    ));

    // Sharing violation but the destination is missing or a 0-byte stub -> fail.
    assert!(matches!(
        classify_copy(Some(ERROR_SHARING_VIOLATION), false, 0),
        CopyResolution::FailedLockedMissing { .. }
    ));
    assert!(matches!(
        classify_copy(Some(ERROR_SHARING_VIOLATION), true, 0),
        CopyResolution::FailedLockedMissing { .. }
    ));

    // Any other error code -> FailedAbsent, regardless of destination state.
    for code in [1, 2, 5, -1, i32::MAX, i32::MIN] {
        assert!(matches!(
            classify_copy(Some(code), true, 4096),
            CopyResolution::FailedAbsent { .. }
        ));
        assert!(matches!(
            classify_copy(Some(code), false, 0),
            CopyResolution::FailedAbsent { .. }
        ));
    }
}
