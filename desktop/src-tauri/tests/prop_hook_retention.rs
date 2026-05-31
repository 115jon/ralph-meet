//! Property-based test for hook surface retention.
//!
//! Feature: universal-game-capture-hook, Property 6: At most one shared surface
//! is retained, and a changed handle releases the prior before opening the new
//!
//! Validates: Requirements 7.5, 9.2
//!
//! The subject under test is the pure, GPU-/IPC-independent
//! `app_lib::game_capture::hook_retention::HookRetentionModel`. It processes the
//! same three event kinds the real `GameCaptureHook::next_surface` path
//! performs — surface **arrival** (carrying the OBS-published shared handle),
//! encoder **read-completion**, and **release** — plus session **stop**, so
//! proptest can drive arbitrary event sequences and assert the retain-at-most-one
//! and re-open-on-handle-change invariants without a GPU, a game, or anti-cheat
//! software.
//!
//! The expected retained handle/token is folded **independently** in the test
//! (a local `next_expected_token` counter that mirrors the model's monotonic
//! token assignment, and an `expected_handle`) rather than by reading the
//! model's own inspectors first, so the property pins the model against a
//! second, hand-written source of truth.
//!
//! NOTE: This is an integration-test crate, so `hook_retention` must be reachable
//! as `app_lib::game_capture::hook_retention` (it is declared `pub mod` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_hook_retention

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::hook_retention::{
    HookArrivalOutcome, HookRetentionModel, SurfaceAction, SurfaceToken,
};
use proptest::prelude::*;

/// One event fed to the retention model. Arrivals draw their shared handle from
/// a tiny pool so that both re-opens (a changed handle) and reuses (an unchanged
/// handle) occur frequently within a single sequence.
#[derive(Debug, Clone)]
enum Event {
    /// A presented frame arrived carrying this shared handle.
    Arrival(u64),
    /// The encoder consumed one queued frame (does not affect retention).
    ReadCompletion,
    /// Release whatever surface is currently retained (exercises the
    /// "nothing retained ⇒ Opened" branch mid-sequence).
    ReleaseCurrent,
    /// Release an arbitrary (often stale/unknown) token — a no-op unless it
    /// happens to match the retained token.
    ReleaseToken(SurfaceToken),
    /// Stop the session.
    Stop,
}

/// Small pool of shared handles so the same handle recurs (reuse) and differs
/// (re-open) many times across a sequence.
fn handle_strategy() -> impl Strategy<Value = u64> {
    prop_oneof![
        Just(0xA1A1_0000_u64),
        Just(0xB2B2_0000_u64),
        Just(0xC3C3_0000_u64),
    ]
}

fn event_strategy() -> impl Strategy<Value = Event> {
    prop_oneof![
        // Arrivals dominate so retention churns through open/reopen/reuse.
        6 => handle_strategy().prop_map(Event::Arrival),
        3 => Just(Event::ReadCompletion),
        2 => Just(Event::ReleaseCurrent),
        // Small token pool so a release frequently matches an early token and
        // sometimes is a stale no-op.
        2 => (0u64..8).prop_map(Event::ReleaseToken),
        // Stop is rare; once it fires the rest of the sequence checks the
        // post-stop invariants (count == 0, further arrivals are Stopped).
        1 => Just(Event::Stop),
    ]
}

fn events_strategy() -> impl Strategy<Value = Vec<Event>> {
    prop::collection::vec(event_strategy(), 1..200)
}

proptest! {
    // Property 6 requires a minimum of 100 iterations. 512 cases over sequences
    // of up to ~200 events keeps the run fast while exercising every retention
    // transition (open / reopen / reuse / release / stop) many times over.
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// Feature: universal-game-capture-hook, Property 6: At most one shared
    /// surface is retained, and a changed handle releases the prior before
    /// opening the new
    ///
    /// Validates: Requirements 7.5, 9.2
    #[test]
    fn retain_at_most_one_and_reopen_on_handle_change(events in events_strategy()) {
        let mut model = HookRetentionModel::new();

        // Independent fold of the expected retained state.
        let mut expected_token: Option<SurfaceToken> = None;
        let mut expected_handle: Option<u64> = None;
        // Mirrors the model's monotonic token counter: the next token handed out
        // on an open or a re-open (never on a reuse).
        let mut next_expected_token: SurfaceToken = 0;
        let mut stopped = false;

        for event in events {
            match event {
                Event::Arrival(handle) => {
                    let outcome = model.on_surface_arrival(handle);

                    if stopped {
                        // After stop(), every arrival is ignored (Req 7.4 teardown):
                        // nothing retained, nothing delivered.
                        prop_assert_eq!(
                            outcome,
                            HookArrivalOutcome::Stopped,
                            "arrival after stop must be Stopped"
                        );
                        prop_assert_eq!(model.retained_count(), 0);
                    } else {
                        let surface = match outcome {
                            HookArrivalOutcome::Processed { surface, .. } => surface,
                            HookArrivalOutcome::Stopped => {
                                return Err(TestCaseError::fail(
                                    "active model must process arrivals, got Stopped",
                                ));
                            }
                        };

                        match expected_handle {
                            // Same handle still retained ⇒ Reused, token unchanged.
                            Some(h) if h == handle => {
                                let prior = expected_token.expect("handle set ⇒ token set");
                                prop_assert_eq!(
                                    surface,
                                    SurfaceAction::Reused { token: prior },
                                    "unchanged handle must Reuse the open surface with the same token"
                                );
                                // Retention is unchanged on a reuse.
                            }
                            // A different handle retained ⇒ Reopened: the prior is
                            // released *before* the new is opened (Req 7.5, 9.2),
                            // the new token differs from the released one.
                            Some(_) => {
                                let prior = expected_token.expect("handle set ⇒ token set");
                                match surface {
                                    SurfaceAction::Reopened { token, released_prior } => {
                                        prop_assert_eq!(
                                            released_prior, prior,
                                            "Reopened must release the previously-retained token"
                                        );
                                        prop_assert_ne!(
                                            token, released_prior,
                                            "the re-opened token must differ from the released one"
                                        );
                                        prop_assert_eq!(
                                            token, next_expected_token,
                                            "re-open must hand out the next monotonic token"
                                        );
                                        expected_token = Some(token);
                                        expected_handle = Some(handle);
                                        next_expected_token += 1;
                                    }
                                    other => {
                                        return Err(TestCaseError::fail(format!(
                                            "changed handle must Reopen, got {other:?}"
                                        )));
                                    }
                                }
                            }
                            // Nothing retained ⇒ Opened (Req 7.5 fresh open).
                            None => {
                                match surface {
                                    SurfaceAction::Opened { token } => {
                                        prop_assert_eq!(
                                            token, next_expected_token,
                                            "open must hand out the next monotonic token"
                                        );
                                        expected_token = Some(token);
                                        expected_handle = Some(handle);
                                        next_expected_token += 1;
                                    }
                                    other => {
                                        return Err(TestCaseError::fail(format!(
                                            "arrival with nothing retained must Open, got {other:?}"
                                        )));
                                    }
                                }
                            }
                        }
                    }
                }
                Event::ReadCompletion => {
                    // A read-completion frees a delivery slot but must never
                    // change which surface is retained.
                    let _ = model.on_read_completion();
                }
                Event::ReleaseCurrent => {
                    if let Some(token) = expected_token {
                        model.release(token);
                        expected_token = None;
                        expected_handle = None;
                    }
                }
                Event::ReleaseToken(token) => {
                    model.release(token);
                    // Releasing the retained token frees it; any other token is
                    // a harmless no-op.
                    if expected_token == Some(token) {
                        expected_token = None;
                        expected_handle = None;
                    }
                }
                Event::Stop => {
                    model.stop();
                    stopped = true;
                    expected_token = None;
                    expected_handle = None;
                    prop_assert!(!model.is_active(), "stop must mark the model inactive");
                    prop_assert_eq!(
                        model.retained_count(), 0,
                        "stop must release any retained surface"
                    );
                }
            }

            // ── Invariants checked after EVERY event ──────────────────────
            // Headline: retain-at-most-one at all times (Req 7.5).
            prop_assert!(
                model.retained_count() <= 1,
                "retained_count must never exceed one (got {})",
                model.retained_count()
            );
            // The model's retained token/handle/count agree with the
            // independently-folded expectation.
            prop_assert_eq!(
                model.retained(), expected_token,
                "retained token diverged from the independent fold"
            );
            prop_assert_eq!(
                model.retained_handle(), expected_handle,
                "retained handle diverged from the independent fold"
            );
            prop_assert_eq!(
                model.retained_count(),
                expected_token.is_some() as usize,
                "retained_count must equal whether a surface is held"
            );
        }
    }
}
