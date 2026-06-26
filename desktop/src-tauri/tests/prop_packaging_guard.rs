//! Property-based test for the `Owned_Capture_Component` packaging guard.
//!
//! Feature: owned-game-capture-hook, Property 5: The packaging guard fails
//! whenever any required material is missing
//!
//! Validates: Requirements 7.5, 11.4, 12.3
//!
//! The logic under test is the pure, filesystem-free
//! `evaluate_packaging_guard(required, present) -> PackagingGuardOutcome` that
//! drives `build.rs`'s `game-capture-hook` packaging guard. Build scripts cannot
//! be imported from `tests/`, so this test `#[path]`-includes the *same* shared
//! source file that `build.rs` includes (`build_support/packaging_guard.rs`),
//! exercising the exact code the build uses rather than a copy (same pattern as
//! task 6.2's `prop_copy_classifier.rs`).
//!
//! For any subset of required materials marked present/absent, the guard must
//! pass **iff ALL** required materials are present; if any is absent the guard
//! fails and `outcome.missing` lists exactly the materials whose flag was false,
//! in `REQUIRED_MATERIALS` declaration order. The test also covers the totality
//! edge: a short/empty presence slice treats the missing indices as absent and
//! therefore never spuriously passes.
//!
//! `evaluate_packaging_guard` is pure and total, so the property runs in CI
//! without a build or a populated `resources/obs-capture/` directory. The
//! expected outcome is re-derived independently below (mirroring the contract,
//! not the implementation) so the property pins behavior rather than restating
//! it.

// The pure predicate lives in a file shared with `build.rs`; include it the same
// way the build script does (build scripts cannot be imported from `tests/`).
// See the module doc comment in `packaging_guard.rs`.
#[path = "../build_support/packaging_guard.rs"]
mod packaging_guard;

use packaging_guard::{evaluate_packaging_guard, RequiredMaterial, REQUIRED_MATERIALS};
use proptest::prelude::*;

/// Strategy over presence-flag slices whose length is **exactly**
/// `REQUIRED_MATERIALS.len()` — the well-formed input `build.rs` always passes
/// (one `is_file()` probe per required material). Each flag is independently
/// arbitrary so every present/absent subset (all-present, all-absent, and every
/// mixture) is reachable.
fn full_presence_strategy() -> impl Strategy<Value = Vec<bool>> {
    prop::collection::vec(any::<bool>(), REQUIRED_MATERIALS.len())
}

/// Strategy over presence-flag slices of an **arbitrary** length in
/// `0..=REQUIRED_MATERIALS.len() + 4`, covering the totality edge: a short or
/// empty slice (fewer flags than materials) and an over-long slice (extra
/// trailing flags that must be ignored). Used to prove a missing/extra flag
/// never changes the pass/fail decision spuriously.
fn ragged_presence_strategy() -> impl Strategy<Value = Vec<bool>> {
    prop::collection::vec(any::<bool>(), 0..=REQUIRED_MATERIALS.len() + 4)
}

/// Independent re-derivation of the documented contract, written by hand (not by
/// calling `evaluate_packaging_guard`) so the property checks the implementation
/// against a second source of truth. A material at index `i` is present iff
/// `present.get(i) == Some(true)`; any index without a flag (short slice) is
/// treated as absent. Returns the missing materials in declaration order.
fn expected_missing(required: &[RequiredMaterial], present: &[bool]) -> Vec<RequiredMaterial> {
    required
        .iter()
        .enumerate()
        .filter(|(i, _)| present.get(*i).copied() != Some(true))
        .map(|(_, m)| *m)
        .collect()
}

proptest! {
    // Property 5 requires a minimum of 100 iterations; 512 cases cover the
    // present/absent subset space (2^len well-formed combinations plus the
    // ragged-length totality edge) well above the floor.
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// Feature: owned-game-capture-hook, Property 5: The packaging guard fails
    /// whenever any required material is missing — well-formed input (one flag
    /// per required material).
    ///
    /// Validates: Requirements 7.5, 11.4, 12.3
    #[test]
    fn guard_passes_iff_all_required_materials_present(present in full_presence_strategy()) {
        let outcome = evaluate_packaging_guard(REQUIRED_MATERIALS, &present);
        let all_present = present.iter().all(|&p| p);

        // (1) The headline property: pass IFF every required material is present.
        prop_assert_eq!(
            outcome.passed(),
            all_present,
            "guard.passed() must equal (all materials present); present={:?}, missing={:?}",
            present,
            outcome.missing
        );

        // (2) When any material is absent, `missing` names exactly the absent
        // ones, in declaration order (Req 7.5/11.4/12.3 failure text must name
        // the missing material(s)).
        let expected = expected_missing(REQUIRED_MATERIALS, &present);
        prop_assert_eq!(
            &outcome.missing,
            &expected,
            "missing list must be exactly the false-flag materials in declaration \
             order; present={:?}",
            present
        );

        // (3) Localize the inverse: every reported-missing material had a false
        // flag, and every false-flag material is reported missing.
        for (i, material) in REQUIRED_MATERIALS.iter().enumerate() {
            let flagged_present = present[i];
            let listed_missing = outcome.missing.contains(material);
            prop_assert_eq!(
                listed_missing,
                !flagged_present,
                "material {:?} (index {}) present-flag={} but listed_missing={}",
                material.name,
                i,
                flagged_present,
                listed_missing
            );
        }

        // (4) The missing list preserves REQUIRED_MATERIALS order (a strictly
        // increasing index sequence), so the failure text reads in a stable,
        // auditable order.
        let mut last_idx: Option<usize> = None;
        for material in &outcome.missing {
            let idx = REQUIRED_MATERIALS
                .iter()
                .position(|m| m == material)
                .expect("missing material must come from REQUIRED_MATERIALS");
            if let Some(prev) = last_idx {
                prop_assert!(
                    idx > prev,
                    "missing list out of declaration order: index {} after {}",
                    idx,
                    prev
                );
            }
            last_idx = Some(idx);
        }
    }

    /// Feature: owned-game-capture-hook, Property 5: The packaging guard fails
    /// whenever any required material is missing — totality edge: a
    /// short/empty/over-long presence slice treats missing indices as absent and
    /// never spuriously passes.
    ///
    /// Validates: Requirements 7.5, 11.4, 12.3
    #[test]
    fn guard_is_total_over_ragged_presence_slices(present in ragged_presence_strategy()) {
        let outcome = evaluate_packaging_guard(REQUIRED_MATERIALS, &present);

        // A material is satisfied only by an explicit `Some(true)` flag; a
        // missing index (short slice) counts as absent.
        let all_present = REQUIRED_MATERIALS
            .iter()
            .enumerate()
            .all(|(i, _)| present.get(i).copied() == Some(true));

        prop_assert_eq!(
            outcome.passed(),
            all_present,
            "guard must pass IFF every index has Some(true); len={}, present={:?}, missing={:?}",
            present.len(),
            present,
            outcome.missing
        );

        prop_assert_eq!(
            &outcome.missing,
            &expected_missing(REQUIRED_MATERIALS, &present),
            "ragged-slice missing list must match the re-derived contract; present={:?}",
            present
        );

        // Totality guarantee: a slice shorter than the material list can never
        // pass, because at least one material has no `Some(true)` flag.
        if present.len() < REQUIRED_MATERIALS.len() {
            prop_assert!(
                !outcome.passed(),
                "a presence slice shorter than REQUIRED_MATERIALS must never pass \
                 (len={} < {})",
                present.len(),
                REQUIRED_MATERIALS.len()
            );
        }
    }
}

/// Focused, non-property checks pinning the boundary cases with concrete, named
/// values — complements the property with explicit edge cases an audit can read
/// at a glance.
#[test]
fn concrete_packaging_guard_cases_map_as_documented() {
    let n = REQUIRED_MATERIALS.len();

    // All present -> the guard passes and nothing is missing.
    let all_present = vec![true; n];
    let outcome = evaluate_packaging_guard(REQUIRED_MATERIALS, &all_present);
    assert!(outcome.passed(), "all-present must pass");
    assert!(
        outcome.missing.is_empty(),
        "all-present must report no missing"
    );

    // All absent -> the guard fails and every material is named, in order.
    let all_absent = vec![false; n];
    let outcome = evaluate_packaging_guard(REQUIRED_MATERIALS, &all_absent);
    assert!(!outcome.passed(), "all-absent must fail");
    assert_eq!(
        outcome.missing.len(),
        n,
        "all-absent must name every required material"
    );
    assert_eq!(
        outcome.missing.as_slice(),
        REQUIRED_MATERIALS,
        "all-absent missing list must equal REQUIRED_MATERIALS in order"
    );

    // Exactly one material absent (each index in turn) -> fail naming only that
    // one. This exercises the per-material failure text contract.
    for absent_idx in 0..n {
        let mut present = vec![true; n];
        present[absent_idx] = false;
        let outcome = evaluate_packaging_guard(REQUIRED_MATERIALS, &present);
        assert!(
            !outcome.passed(),
            "missing index {} must fail the guard",
            absent_idx
        );
        assert_eq!(
            outcome.missing,
            vec![REQUIRED_MATERIALS[absent_idx]],
            "missing index {} must name exactly that material",
            absent_idx
        );
    }

    // Totality edge: an empty slice treats every material as absent -> fail
    // naming all, and a one-short slice fails naming (at least) the last.
    let outcome = evaluate_packaging_guard(REQUIRED_MATERIALS, &[]);
    assert!(!outcome.passed(), "empty presence slice must never pass");
    assert_eq!(
        outcome.missing.as_slice(),
        REQUIRED_MATERIALS,
        "empty presence slice must report all materials missing"
    );

    let one_short = vec![true; n - 1];
    let outcome = evaluate_packaging_guard(REQUIRED_MATERIALS, &one_short);
    assert!(
        !outcome.passed(),
        "one-short presence slice must never pass"
    );
    assert_eq!(
        outcome.missing,
        vec![REQUIRED_MATERIALS[n - 1]],
        "one-short slice must report exactly the trailing material missing"
    );
}
