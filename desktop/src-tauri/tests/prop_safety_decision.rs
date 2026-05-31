//! Property-based test for the anti-cheat safety decision.
//!
//! Feature: universal-game-capture-hook, Property 10: Safety decision denies
//! blocklisted targets and enforces a configured allowlist
//!
//! Validates: Requirements 10.1, 10.2, 10.3
//!   - 10.1/10.2: a target matching the `Process_Blocklist` is never permitted —
//!     `safety_decision` returns `Deny(Blocklisted)`, and the blocklist takes
//!     precedence over the allowlist (so a blocklisted target is denied even if
//!     it also appears on the allowlist).
//!   - 10.3: a configured (non-empty) `Process_Allowlist` restricts injection to
//!     its members — a non-matching target returns `Deny(NotAllowlisted)`, while
//!     an empty allowlist means "not configured" and permits any non-blocklisted
//!     target.
//!
//! The function under test is the pure, GPU-/OS-independent
//! `app_lib::game_capture::blocklist::safety_decision`. It is total over all
//! inputs, so proptest exercises it across many randomized blocklist/allowlist
//! sets and target names — including names drawn from the same small pool the
//! lists are built from, so matches (and the precedence/allowlist rules) are
//! frequently triggered rather than vanishingly rare.
//!
//! NOTE: `game_capture::blocklist` is declared behind `#[cfg(feature =
//! "game-capture-hook")]` (on top of `native-screen-share`), so this whole test
//! crate is gated to that feature and the module is reachable as
//! `app_lib::game_capture::blocklist`. Run with:
//!   cargo test --features game-capture-hook --test prop_safety_decision

#![cfg(feature = "game-capture-hook")]

use std::collections::HashSet;

use app_lib::game_capture::blocklist::{safety_decision, ProcessIdentity};
use app_lib::game_capture::{FallbackReason, SafetyDecision};
use proptest::prelude::*;

/// A small, fixed pool of *canonical* (already-normalized: lowercase, no path
/// separators, no surrounding whitespace) executable names. Blocklist entries,
/// allowlist entries, and the target are all drawn from this shared pool so that
/// matches occur often. A couple of real anti-cheat names are included for
/// realism; the property does not depend on their special meaning.
const POOL: &[&str] = &[
    "easyanticheat.exe",
    "beservice.exe",
    "vgc.exe",
    "valorant.exe",
    "mygame.exe",
    "notepad.exe",
    "browser.exe",
    "tool.exe",
];

/// Path prefixes used to decorate a canonical name. Each non-empty prefix ends
/// in a separator and contains no trailing path component, so the final path
/// component of `prefix + name` is always exactly `name` — which is what the
/// case-insensitive, final-path-component matching contract keys on. Spaces in
/// some prefixes ensure the trim/normalize logic is not fooled by them.
fn prefix_strategy() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just(""),
        Just("C:\\Games\\"),
        Just("C:\\Program Files\\Game Studio\\"),
        Just("/usr/local/bin/"),
        Just("D:\\a b\\sub dir\\"),
        Just("..\\relative\\"),
    ]
}

/// Decorate a canonical base name into a "wild" form that must still match the
/// canonical name under the documented contract (case-insensitive on the final
/// path component): apply per-character upper-casing, prepend a path prefix, and
/// optionally pad with surrounding whitespace. Crucially, `normalize(decorated)
/// == base` by construction, so the test's independent oracle can compare
/// canonical bases directly without reimplementing the module's normalizer.
fn decorate(base: &str, upper_flags: &[bool], prefix: &str, lead_ws: bool, trail_ws: bool) -> String {
    let cased: String = base
        .chars()
        .enumerate()
        .map(|(i, c)| {
            if upper_flags.get(i).copied().unwrap_or(false) {
                c.to_ascii_uppercase()
            } else {
                c
            }
        })
        .collect();

    let mut s = String::new();
    if lead_ws {
        s.push_str("  ");
    }
    s.push_str(prefix);
    s.push_str(&cased);
    if trail_ws {
        s.push_str("   ");
    }
    s
}

/// Strategy yielding `(canonical_base, decorated_name)`. The canonical base is
/// the ground truth the test uses to decide matches; the decorated name is what
/// is actually fed to `safety_decision`, exercising case-insensitivity and
/// path-component robustness.
fn decorated_strategy() -> impl Strategy<Value = (String, String)> {
    (
        0usize..POOL.len(),
        prop::collection::vec(any::<bool>(), 0..12),
        prefix_strategy(),
        any::<bool>(),
        any::<bool>(),
    )
        .prop_map(|(idx, upper_flags, prefix, lead_ws, trail_ws)| {
            let base = POOL[idx].to_string();
            let decorated = decorate(&base, &upper_flags, prefix, lead_ws, trail_ws);
            (base, decorated)
        })
}

proptest! {
    // Property 10 requires a minimum of 100 iterations; 512 keeps us well above
    // the floor while thoroughly exploring the (lists × decorations × target)
    // space.
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// Feature: universal-game-capture-hook, Property 10: Safety decision denies
    /// blocklisted targets and enforces a configured allowlist
    ///
    /// Validates: Requirements 10.1, 10.2, 10.3
    ///
    /// Over arbitrary blocklist/allowlist sets and an arbitrary (decorated)
    /// target, the decision must equal the independently re-derived expectation:
    ///   (a) target matches blocklist            -> Deny(Blocklisted)  [regardless of allowlist]
    ///   (b) else allowlist non-empty & no match -> Deny(NotAllowlisted)
    ///   (c) else                                -> Allow
    #[test]
    fn safety_decision_matches_independent_derivation(
        blocklist_spec in prop::collection::vec(decorated_strategy(), 0..6),
        allowlist_spec in prop::collection::vec(decorated_strategy(), 0..6),
        target_spec in decorated_strategy(),
    ) {
        // Build the real inputs from the decorated names.
        let blocklist: Vec<ProcessIdentity> = blocklist_spec
            .iter()
            .map(|(_, s)| ProcessIdentity::new(s.clone()))
            .collect();
        let allowlist: Vec<ProcessIdentity> = allowlist_spec
            .iter()
            .map(|(_, s)| ProcessIdentity::new(s.clone()))
            .collect();
        let (target_base, target_str) = &target_spec;

        // Independent oracle: match purely on the canonical bases we generated,
        // never via the module's own normalizer. `normalize(decorated) == base`
        // holds by construction, so canonical-base set membership is exactly the
        // module's matching relation.
        let block_bases: HashSet<&str> =
            blocklist_spec.iter().map(|(b, _)| b.as_str()).collect();
        let allow_bases: HashSet<&str> =
            allowlist_spec.iter().map(|(b, _)| b.as_str()).collect();

        let in_block = block_bases.contains(target_base.as_str());
        let in_allow = allow_bases.contains(target_base.as_str());
        let allowlist_configured = !allowlist.is_empty();

        let expected = if in_block {
            // (a) Blocklist wins, and wins regardless of the allowlist (Req 10.2).
            SafetyDecision::Deny(FallbackReason::Blocklisted)
        } else if allowlist_configured && !in_allow {
            // (b) Configured allowlist with no match (Req 10.3).
            SafetyDecision::Deny(FallbackReason::NotAllowlisted)
        } else {
            // (c) Not blocklisted, and allowlist unconfigured or matched.
            SafetyDecision::Allow
        };

        let actual = safety_decision(target_str, &blocklist, &allowlist);

        prop_assert_eq!(
            actual,
            expected,
            "safety_decision disagreed with the independent oracle \
             (target={:?}, in_block={}, allowlist_configured={}, in_allow={})",
            target_str,
            in_block,
            allowlist_configured,
            in_allow
        );

        // (a) Blocklist precedence, stated as a standalone invariant: a
        // blocklisted target is denied as Blocklisted no matter what the
        // allowlist contains (Req 10.1, 10.2).
        if in_block {
            prop_assert_eq!(
                actual,
                SafetyDecision::Deny(FallbackReason::Blocklisted),
                "a blocklisted target must be Deny(Blocklisted) regardless of the allowlist"
            );
        }

        // (b) A configured allowlist excludes non-members (Req 10.3).
        if !in_block && allowlist_configured && !in_allow {
            prop_assert_eq!(
                actual,
                SafetyDecision::Deny(FallbackReason::NotAllowlisted),
                "a non-blocklisted target absent from a configured allowlist must be \
                 Deny(NotAllowlisted)"
            );
        }

        // (c) Allow exactly when not blocklisted and (allowlist empty or matched).
        if !in_block && (!allowlist_configured || in_allow) {
            prop_assert_eq!(
                actual,
                SafetyDecision::Allow,
                "a non-blocklisted target with an unconfigured-or-matched allowlist must be Allow"
            );
        }

        // The decision is always exactly one of the three documented outcomes
        // (totality): proves the function never panics or yields an unexpected
        // reason for any input.
        prop_assert!(
            matches!(
                actual,
                SafetyDecision::Allow
                    | SafetyDecision::Deny(FallbackReason::Blocklisted)
                    | SafetyDecision::Deny(FallbackReason::NotAllowlisted)
            ),
            "safety_decision produced an out-of-contract value: {:?}",
            actual
        );
    }

    /// Matching is case-insensitive and robust to a full path being passed for
    /// the target (Req 10.2, 10.3 matching contract). A list entry stored in one
    /// form must match a target given in a wildly different case / with a path.
    #[test]
    fn matching_is_case_insensitive_and_path_component_robust(
        listed in decorated_strategy(),
        target in decorated_strategy(),
    ) {
        let (listed_base, listed_name) = &listed;
        let (target_base, target_name) = &target;
        let same_program = listed_base == target_base;

        // The list stores the canonical (plain, lowercase, no-path) form; the
        // target is the decorated (cased + path-prefixed + padded) form.
        let blocklist = vec![ProcessIdentity::new(listed_base.clone())];
        let decision = safety_decision(target_name, &blocklist, &[]);
        if same_program {
            prop_assert_eq!(
                decision,
                SafetyDecision::Deny(FallbackReason::Blocklisted),
                "plain blocklist entry {:?} must match decorated target {:?} \
                 (case-insensitive, final path component)",
                listed_base,
                target_name
            );
        } else {
            prop_assert_eq!(
                decision,
                SafetyDecision::Allow,
                "different program {:?} must not match blocklist entry {:?}",
                target_name,
                listed_base
            );
        }

        // Symmetrically: the allowlist stores the *decorated* form, and a plain
        // target of the same program is still admitted; a different program is
        // denied as NotAllowlisted.
        let allowlist = vec![ProcessIdentity::new(listed_name.clone())];
        let decision = safety_decision(target_base, &[], &allowlist);
        if same_program {
            prop_assert_eq!(
                decision,
                SafetyDecision::Allow,
                "decorated allowlist entry {:?} must admit plain target {:?}",
                listed_name,
                target_base
            );
        } else {
            prop_assert_eq!(
                decision,
                SafetyDecision::Deny(FallbackReason::NotAllowlisted),
                "different program {:?} must be denied under allowlist {:?}",
                target_base,
                listed_name
            );
        }
    }
}
