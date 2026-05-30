//! Property-based test for WGC-frame retention bookkeeping.
//!
//! Feature: screen-share-zero-overhead, Property 3: At most one WGC frame is
//! retained at any time; each retained frame is released no later than when the
//! next is retained, so the WGC 2-buffer pool always has a free buffer.
//!
//! Validates: Requirements 3.5, 3.7
//!
//! This drives the pure, GPU-independent `WgcRetentionTracker` from
//! `app_lib::wgc_capture` (added in task 3.2). The tracker is the in-memory
//! model of the rule that the fused-blit pipeline keeps at most one WGC
//! `Direct3D11CaptureFramePool` buffer checked out at a time: the 2-buffer pool
//! must always have one free buffer, so the pipeline may retain at most one
//! frame, releasing the prior one no later than retaining the next.
//!
//! NOTE: This is an integration-test crate, so `wgc_capture` must be reachable
//! as `app_lib::wgc_capture` (it is declared `pub mod wgc_capture` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_wgc_retention

#![cfg(feature = "native-screen-share")]

use std::time::Duration;

use app_lib::wgc_capture::{
    stop_release_meets_deadline, FrameToken, RetainOutcome, WgcRetentionTracker,
    STOP_RELEASE_DEADLINE,
};
use proptest::prelude::*;

/// One step in a randomly generated sequence of WGC-frame arrivals, encoder
/// completions, and session teardown.
#[derive(Clone, Debug)]
enum Action {
    /// A new WGC frame arrived and the pipeline wants to retain it.
    Retain,
    /// The encoder finished reading a previously issued frame; release the
    /// token at index `idx` (taken modulo the number issued so far). Exercises
    /// releasing both the currently retained frame and stale frames.
    ReleaseIssued(usize),
    /// Release a token that was never handed out — must be a no-op.
    ReleaseUnknown(u64),
    /// The session became inactive; release any retained frame.
    Stop,
}

fn scenario() -> impl Strategy<Value = Vec<Action>> {
    let action = prop_oneof![
        4 => Just(Action::Retain),
        3 => (0usize..256).prop_map(Action::ReleaseIssued),
        1 => any::<u64>().prop_map(Action::ReleaseUnknown),
        1 => Just(Action::Stop),
    ];
    proptest::collection::vec(action, 1..200)
}

proptest! {
    // Property 3 requires a minimum of 100 iterations; run more for coverage.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: screen-share-zero-overhead, Property 3: At most one WGC frame is
    /// retained at any time; each retained frame is released no later than when
    /// the next is retained.
    ///
    /// Validates: Requirements 3.5, 3.7
    #[test]
    fn at_most_one_wgc_frame_retained(actions in scenario()) {
        let mut tracker = WgcRetentionTracker::new();

        // Independent reference model:
        //   active   — whether the session is still running
        //   retained — the single token currently held, if any
        //   issued   — every token handed out (monotonic, unique, from 0)
        let mut active = true;
        let mut retained: Option<FrameToken> = None;
        let mut issued: Vec<FrameToken> = Vec::new();

        // The tracker starts active, retaining nothing.
        prop_assert!(tracker.is_active());
        prop_assert_eq!(tracker.retained(), None);
        prop_assert_eq!(tracker.retained_count(), 0);

        for action in actions {
            match action {
                Action::Retain => {
                    // Snapshot what was retained *before* this call: if a frame
                    // was already held it must be reported released as part of
                    // retaining the new one (released no later than the next).
                    let prior = retained;
                    let outcome = tracker.retain();

                    if active {
                        match outcome {
                            RetainOutcome::Retained { token, released_prior } => {
                                // The prior frame is released as part of this
                                // retain — never held alongside the new one.
                                prop_assert_eq!(released_prior, prior);
                                // Tokens are unique and monotonically increasing.
                                prop_assert!(!issued.contains(&token));
                                if let Some(last) = issued.last() {
                                    prop_assert!(token > *last);
                                }
                                issued.push(token);
                                retained = Some(token);
                            }
                            RetainOutcome::Stopped => {
                                prop_assert!(false, "active tracker must retain, got Stopped");
                            }
                        }
                    } else {
                        // After stop, no further frame is ever retained (Req 3.8).
                        prop_assert_eq!(outcome, RetainOutcome::Stopped);
                        prop_assert_eq!(retained, None);
                    }
                }
                Action::ReleaseIssued(idx) => {
                    if issued.is_empty() {
                        // Nothing issued yet — release a fixed dummy token; no-op.
                        tracker.release(0);
                    } else {
                        let token = issued[idx % issued.len()];
                        tracker.release(token);
                        // Releasing the currently retained token frees the pool
                        // buffer; releasing a stale token is a harmless no-op.
                        if retained == Some(token) {
                            retained = None;
                        }
                    }
                }
                Action::ReleaseUnknown(raw) => {
                    // Tokens are issued sequentially from 0, so any value beyond
                    // the number issued is unknown. Releasing it must not touch
                    // the currently retained frame.
                    let unknown = (raw % 1_000).saturating_add(1_000_000);
                    prop_assert!(!issued.contains(&unknown));
                    tracker.release(unknown);
                    // retained is unchanged in the reference model.
                }
                Action::Stop => {
                    let released = tracker.stop();
                    // stop() returns whatever was still retained, then clears it.
                    prop_assert_eq!(released, retained);
                    retained = None;
                    active = false;
                }
            }

            // ── Invariants checked after every step ──────────────────────────
            // Core Property 3 invariant: never more than one retained frame.
            prop_assert!(
                tracker.retained_count() <= 1,
                "retained_count exceeded 1"
            );
            // The tracker and the reference model agree on the retained frame …
            prop_assert_eq!(tracker.retained(), retained);
            // … and retained_count mirrors whether a frame is held.
            prop_assert_eq!(tracker.retained_count(), retained.is_some() as usize);
            // Active flag stays in lockstep.
            prop_assert_eq!(tracker.is_active(), active);
            // Once stopped, the tracker is inactive and holds nothing.
            if !active {
                prop_assert!(!tracker.is_active());
                prop_assert_eq!(tracker.retained(), None);
                prop_assert_eq!(tracker.retained_count(), 0);
            }
        }
    }

    /// The 100 ms stop-release deadline (Req 3.8) is reported correctly for any
    /// elapsed duration: a release meets the deadline iff it took ≤ 100 ms.
    #[test]
    fn stop_release_deadline_is_exact(elapsed_ms in 0u64..1_000) {
        let elapsed = Duration::from_millis(elapsed_ms);
        prop_assert_eq!(
            stop_release_meets_deadline(elapsed),
            elapsed <= STOP_RELEASE_DEADLINE
        );
        prop_assert_eq!(STOP_RELEASE_DEADLINE, Duration::from_millis(100));
    }
}
