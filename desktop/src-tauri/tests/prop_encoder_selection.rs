//! Property-based test for vendor-neutral encoder selection.
//!
//! Feature: universal-game-capture-hook, Property 4: Encoder selection is total,
//! deterministic, and respects vendor preference order
//!
//! Validates: Requirements 6.1, 6.2, 6.3, 6.6
//!   - 6.1: a vendor hardware backend (NVENC / AMF / QuickSync) is selected when
//!     one is enumerated.
//!   - 6.2: a `GenericHwMft` is selected when no vendor backend is present but a
//!     generic hardware MFT is.
//!   - 6.3: the `Software` backend is selected as the last resort (and is the
//!     result for an empty candidate set) rather than failing to pick.
//!   - 6.6: selection is independent of any capture-side input — `select_encoder`
//!     takes only the enumerated candidate list, so a frame from any GPU vendor
//!     can be encoded by any available backend. (There is no capture argument to
//!     pass; this is enforced structurally by the function signature and noted
//!     here.)
//!
//! The functions under test are the pure, GPU-/OS-independent
//! `app_lib::wmf_encoder::{select_encoder, classify_mft}` over their public
//! types `EncoderBackend` / `EncoderCandidate`. They perform no Media
//! Foundation / D3D / OS calls, so proptest exercises them exhaustively in CI
//! without a GPU or any vendor SDK.
//!
//! `wmf_encoder` is declared `pub mod wmf_encoder` behind
//! `#[cfg(feature = "native-screen-share")]`, so this whole test crate is gated
//! to that feature and the layer is reachable as `app_lib::wmf_encoder`. Run with:
//!   cargo test --features native-screen-share --test prop_encoder_selection

#![cfg(feature = "native-screen-share")]

use app_lib::wmf_encoder::{classify_mft, select_encoder, EncoderBackend, EncoderCandidate};
use proptest::prelude::*;

/// Independent preference rank used by the test as an *oracle* — deliberately a
/// separate definition from the module's private `preference_rank`, so the
/// property checks the contract ("the chosen backend is the minimum-rank backend
/// present") rather than re-using the implementation it is meant to verify.
/// Lower is more preferred: vendor HW (Nvenc < Amf < QuickSync) < GenericHwMft <
/// Software (Req 6.1, 6.2, 6.3).
fn oracle_rank(b: EncoderBackend) -> u8 {
    match b {
        EncoderBackend::Nvenc => 0,
        EncoderBackend::Amf => 1,
        EncoderBackend::QuickSync => 2,
        EncoderBackend::GenericHwMft => 3,
        EncoderBackend::Software => 4,
    }
}

/// Independently re-derive the expected winner: the minimum-rank backend present
/// among the candidates, or `Software` for an empty set (Req 6.3). This never
/// calls the function under test.
fn expected_winner(candidates: &[EncoderCandidate]) -> EncoderBackend {
    candidates
        .iter()
        .map(|c| c.backend)
        .min_by_key(|b| oracle_rank(*b))
        .unwrap_or(EncoderBackend::Software)
}

/// Every `EncoderBackend` variant, used both to generate candidates and to
/// assert totality of the returned value.
const ALL_BACKENDS: [EncoderBackend; 5] = [
    EncoderBackend::Nvenc,
    EncoderBackend::Amf,
    EncoderBackend::QuickSync,
    EncoderBackend::GenericHwMft,
    EncoderBackend::Software,
];

/// Strategy producing any one of the five `EncoderBackend` variants uniformly.
fn backend_strategy() -> impl Strategy<Value = EncoderBackend> {
    prop_oneof![
        Just(EncoderBackend::Nvenc),
        Just(EncoderBackend::Amf),
        Just(EncoderBackend::QuickSync),
        Just(EncoderBackend::GenericHwMft),
        Just(EncoderBackend::Software),
    ]
}

/// Strategy producing an arbitrary `EncoderCandidate`. The `friendly_name` and
/// `is_hardware` fields are generated for realism even though `select_encoder`
/// keys only on `backend`; this guards against a regression that started letting
/// those fields influence selection.
fn candidate_strategy() -> impl Strategy<Value = EncoderCandidate> {
    (backend_strategy(), "[a-zA-Z0-9 ]{0,24}", any::<bool>()).prop_map(
        |(backend, friendly_name, is_hardware)| EncoderCandidate {
            backend,
            friendly_name,
            is_hardware,
        },
    )
}

/// A pure, seed-driven Fisher–Yates shuffle (xorshift64 RNG) so a permutation of
/// the candidate list is a deterministic function of the proptest-generated
/// `seed`. This keeps the order-independence check fully reproducible (no hidden
/// test-internal randomness) while still covering many distinct orderings.
fn shuffled<T: Clone>(items: &[T], seed: u64) -> Vec<T> {
    let mut out = items.to_vec();
    // Avoid a zero state (xorshift is stuck at 0); mix the seed with a constant.
    let mut state = seed ^ 0x9E37_79B9_7F4A_7C15;
    if state == 0 {
        state = 0xD1B5_4A32_D192_ED03;
    }
    for i in (1..out.len()).rev() {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let j = (state % (i as u64 + 1)) as usize;
        out.swap(i, j);
    }
    out
}

proptest! {
    // Property 4 requires a minimum of 100 iterations; 256 keeps us comfortably
    // above the floor while exploring the (multiset × ordering) space.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: universal-game-capture-hook, Property 4: Encoder selection is
    /// total, deterministic, and respects vendor preference order
    ///
    /// Validates: Requirements 6.1, 6.2, 6.3, 6.6
    ///
    /// For an arbitrary candidate list (including empty) and an arbitrary
    /// permutation seed, all three facets hold simultaneously:
    ///   - TOTAL: the result is exactly one `EncoderBackend`, and an empty list
    ///     yields `Software` (Req 6.3).
    ///   - DETERMINISTIC: calling twice on the same slice agrees, and shuffling
    ///     the same multiset into any order yields the identical choice.
    ///   - PREFERENCE ORDER: the result equals the independently re-derived
    ///     minimum-rank backend present (Req 6.1, 6.2, 6.3).
    #[test]
    fn encoder_selection_is_total_deterministic_and_respects_preference(
        candidates in prop::collection::vec(candidate_strategy(), 0..12),
        seed in any::<u64>(),
    ) {
        let chosen = select_encoder(&candidates);

        // ── TOTAL ────────────────────────────────────────────────────────────
        // The returned value is always exactly one of the five known backends
        // (the function cannot panic or invent a backend for any input).
        prop_assert!(
            ALL_BACKENDS.contains(&chosen),
            "select_encoder returned an out-of-contract backend: {:?}",
            chosen
        );

        // ── PREFERENCE ORDER ──────────────────────────────────────────────────
        // The chosen backend equals the minimum-rank backend PRESENT among the
        // candidates, re-derived by the independent oracle (empty → Software).
        let expected = expected_winner(&candidates);
        prop_assert_eq!(
            chosen,
            expected,
            "select_encoder must pick the minimum-rank backend present \
             (candidates={:?})",
            candidates
        );

        // The winner is no worse than every present candidate, and is itself
        // present whenever the list is non-empty (stated directly against the
        // oracle rank so the ordering contract is explicit, not just implied by
        // the equality above).
        let present_backends: Vec<EncoderBackend> =
            candidates.iter().map(|c| c.backend).collect();
        for b in &present_backends {
            prop_assert!(
                oracle_rank(chosen) <= oracle_rank(*b),
                "chosen {:?} (rank {}) must be at least as preferred as present \
                 candidate {:?} (rank {})",
                chosen, oracle_rank(chosen), b, oracle_rank(*b)
            );
        }
        if !candidates.is_empty() {
            prop_assert!(
                present_backends.contains(&chosen),
                "for a non-empty list the winner must itself be a present candidate"
            );
        } else {
            // Empty slice → Software (Req 6.3: never fail to pick).
            prop_assert_eq!(
                chosen,
                EncoderBackend::Software,
                "an empty candidate list must select Software"
            );
        }

        // ── DETERMINISTIC ─────────────────────────────────────────────────────
        // Calling again on the identical slice yields the identical result.
        prop_assert_eq!(
            select_encoder(&candidates),
            chosen,
            "select_encoder must be deterministic across repeated calls"
        );

        // Re-ordering the SAME multiset of candidates must not change the choice:
        // selection depends only on which backends are present, not their order.
        let permuted = shuffled(&candidates, seed);
        prop_assert_eq!(
            select_encoder(&permuted),
            chosen,
            "select_encoder must be order-independent for the same multiset \
             (seed={})",
            seed
        );
    }

    /// Supporting check (Req 6.1, 6.2, 6.3): `classify_mft` maps vendor ids and
    /// friendly-name markers to backends deterministically, and is total. This
    /// underpins the candidate `backend` field that `select_encoder` consumes.
    ///
    /// Validates: Requirements 6.1, 6.2, 6.3, 6.6
    #[test]
    fn classify_mft_is_deterministic_and_total(
        friendly_name in "[a-zA-Z0-9 ]{0,24}",
        vendor_id in proptest::option::of(any::<u32>()),
        is_hardware in any::<bool>(),
    ) {
        let a = classify_mft(&friendly_name, vendor_id, is_hardware);
        let b = classify_mft(&friendly_name, vendor_id, is_hardware);

        // Deterministic: identical inputs → identical classification.
        prop_assert_eq!(a, b, "classify_mft must be deterministic for equal inputs");

        // Total: the result is always one of the five known backends.
        prop_assert!(
            ALL_BACKENDS.contains(&a),
            "classify_mft returned an out-of-contract backend: {:?}",
            a
        );

        // A non-hardware MFT is always Software, irrespective of vendor/name
        // (Req 6.3).
        if !is_hardware {
            prop_assert_eq!(
                a,
                EncoderBackend::Software,
                "a non-hardware MFT must classify as Software"
            );
        }

        // Authoritative PCI vendor ids on a hardware MFT map to the vendor
        // backend (Req 6.1), independent of the friendly name.
        if is_hardware {
            match vendor_id {
                Some(0x10DE) => prop_assert_eq!(a, EncoderBackend::Nvenc),
                Some(0x1002) => prop_assert_eq!(a, EncoderBackend::Amf),
                Some(0x8086) => prop_assert_eq!(a, EncoderBackend::QuickSync),
                _ => {}
            }
        }
    }
}

/// Concrete, named edge cases that complement the property with documented
/// examples (Req 6.1, 6.2, 6.3). These pin the exact preference outcomes the
/// status contract depends on.
#[test]
fn documented_selection_examples() {
    // Helper to build a hardware candidate of a given backend.
    let hw = |backend: EncoderBackend, name: &str| EncoderCandidate {
        backend,
        friendly_name: name.to_string(),
        is_hardware: true,
    };

    // Empty → Software (Req 6.3).
    assert_eq!(select_encoder(&[]), EncoderBackend::Software);

    // Only software present → Software.
    assert_eq!(
        select_encoder(&[EncoderCandidate {
            backend: EncoderBackend::Software,
            friendly_name: "Software H264".to_string(),
            is_hardware: false,
        }]),
        EncoderBackend::Software
    );

    // Generic HW beats software (Req 6.2 over 6.3).
    assert_eq!(
        select_encoder(&[
            EncoderCandidate {
                backend: EncoderBackend::Software,
                friendly_name: "sw".to_string(),
                is_hardware: false,
            },
            hw(EncoderBackend::GenericHwMft, "Some HW MFT"),
        ]),
        EncoderBackend::GenericHwMft
    );

    // Any vendor HW beats generic HW (Req 6.1 over 6.2).
    assert_eq!(
        select_encoder(&[
            hw(EncoderBackend::GenericHwMft, "Some HW MFT"),
            hw(EncoderBackend::QuickSync, "Intel QuickSync"),
        ]),
        EncoderBackend::QuickSync
    );

    // Vendor tiebreak is the fixed documented priority NVENC > AMF > QuickSync,
    // regardless of listing order.
    assert_eq!(
        select_encoder(&[
            hw(EncoderBackend::QuickSync, "Intel"),
            hw(EncoderBackend::Amf, "AMD"),
            hw(EncoderBackend::Nvenc, "NVIDIA"),
        ]),
        EncoderBackend::Nvenc
    );
    assert_eq!(
        select_encoder(&[
            hw(EncoderBackend::QuickSync, "Intel"),
            hw(EncoderBackend::Amf, "AMD"),
        ]),
        EncoderBackend::Amf
    );

    // classify_mft documented mappings.
    assert_eq!(
        classify_mft("anything", Some(0x10DE), true),
        EncoderBackend::Nvenc
    );
    assert_eq!(
        classify_mft("anything", Some(0x1002), true),
        EncoderBackend::Amf
    );
    assert_eq!(
        classify_mft("anything", Some(0x8086), true),
        EncoderBackend::QuickSync
    );
    assert_eq!(
        classify_mft("AMD Radeon Encoder", None, true),
        EncoderBackend::Amf
    );
    assert_eq!(
        classify_mft("Mystery HW Encoder", None, true),
        EncoderBackend::GenericHwMft
    );
    assert_eq!(
        classify_mft("NVIDIA NVENC", Some(0x10DE), false),
        EncoderBackend::Software
    );
}
