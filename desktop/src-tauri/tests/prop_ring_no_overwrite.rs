//! Property-based test for the ring-buffer no-overwrite invariant.
//!
//! Feature: screen-share-zero-overhead, Property 1: Ring buffer never overwrites
//! a held entry. For any ring buffer (BGRA `Texture_Ring_Buffer` or
//! `NV12_Ring_Buffer`) of size 2 or 3, and for any sequence of acquire, release,
//! and frame-arrival events, a slot that is currently `InUse` (held downstream
//! and not yet released) is never written to or re-acquired until its release
//! flag is set.
//!
//! Validates: Requirements 2.2, 2.4, 3.9
//!
//! This drives the pure, GPU-independent `RingBuffer<T>` from
//! `app_lib::ring_buffer` (created in task 1.2). The generic payload stands in
//! for the real GPU texture; here we tag each slot with a stable payload value
//! so an "overwrite" of a held slot would be observable as either a re-acquire
//! of an `InUse` slot or a mutation of a held slot's payload.
//!
//! NOTE: This is an integration-test crate, so the `ring_buffer` module must be
//! reachable as `app_lib::ring_buffer` (declared `pub mod ring_buffer` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_ring_no_overwrite

#![cfg(feature = "native-screen-share")]

use app_lib::ring_buffer::{RingBuffer, SlotState, MAX_SLOTS, MIN_SLOTS};
use proptest::prelude::*;

/// One step in a randomly generated interleaving of frame arrivals and
/// downstream releases against a ring buffer.
#[derive(Clone, Debug)]
enum Action {
    /// A frame arrives: acquire the next free slot (or drop on exhaustion).
    Acquire,
    /// Downstream finished with a slot: release it (chosen by an index into the
    /// slot pool, taken modulo capacity). Releasing a `Free`/out-of-range slot
    /// is a documented no-op.
    Release(usize),
}

/// Strategy: pick a valid ring size (2 or 3), then a sequence of acquire/release
/// actions whose release targets stay within the slot pool so releases land on
/// real slots often.
fn scenario() -> impl Strategy<Value = (usize, Vec<Action>)> {
    (MIN_SLOTS..=MAX_SLOTS).prop_flat_map(|count| {
        let action = prop_oneof![
            3 => Just(Action::Acquire),
            2 => (0..count).prop_map(Action::Release),
        ];
        proptest::collection::vec(action, 1..200).prop_map(move |actions| (count, actions))
    })
}

proptest! {
    // Property 1 requires a minimum of 100 iterations; run more for coverage.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: screen-share-zero-overhead, Property 1: Ring buffer never
    /// overwrites a held entry.
    ///
    /// Validates: Requirements 2.2, 2.4, 3.9
    #[test]
    fn ring_buffer_never_overwrites_a_held_entry((count, actions) in scenario()) {
        // Payloads are stable, unique tags (1000 + index). The state machine
        // never mutates payloads, so a tag changing under a held slot would be
        // a direct "overwrite" violation.
        let payloads: Vec<usize> = (0..count).map(|i| 1000 + i).collect();
        let expected_payloads = payloads.clone();
        let mut ring: RingBuffer<usize> =
            RingBuffer::new(payloads, 1920, 1080).expect("2 or 3 slots is valid");

        // Independent reference model of which slots we believe are held.
        let mut held: Vec<bool> = vec![false; count];

        for action in actions {
            // Snapshot the set of currently-held slots BEFORE the action so we
            // can prove none of them are disturbed by it.
            let held_before: Vec<usize> =
                (0..count).filter(|&i| held[i]).collect();

            match action {
                Action::Acquire => {
                    let result = ring.acquire();
                    // The implementation returns the lowest-index Free slot.
                    let first_free = held.iter().position(|h| !*h);

                    match (result, first_free) {
                        (Some(i), Some(f)) => {
                            // (1) Acquire must never hand back a slot that is
                            // already held — that would overwrite a held entry
                            // (Req 2.2, 2.4, 3.9).
                            prop_assert!(
                                !held[i],
                                "acquire() returned slot {} which was already InUse",
                                i
                            );
                            // It returns the next free slot deterministically.
                            prop_assert_eq!(i, f);
                            // The ring now reports that slot as InUse.
                            prop_assert_eq!(ring.state(i), Some(SlotState::InUse));
                            held[i] = true;
                        }
                        (None, None) => {
                            // Exhaustion is allowed (covered by Property 2); the
                            // no-overwrite invariant still holds because nothing
                            // was acquired.
                        }
                        (got, expected) => {
                            prop_assert!(
                                false,
                                "acquire() disagreed with the reference model: \
                                 got {:?}, expected free slot {:?}",
                                got, expected
                            );
                        }
                    }
                }
                Action::Release(slot) => {
                    ring.release(slot);
                    if slot < count {
                        held[slot] = false;
                    }
                }
            }

            // (2) Every slot that was held BEFORE this action and is not the one
            // just released remains InUse and retains its original payload — it
            // was neither overwritten nor re-acquired.
            for &i in &held_before {
                if held[i] {
                    prop_assert_eq!(
                        ring.state(i),
                        Some(SlotState::InUse),
                        "a held slot was silently overwritten/released"
                    );
                    prop_assert_eq!(
                        ring.get(i),
                        Some(&expected_payloads[i]),
                        "a held slot's payload was mutated (overwritten)"
                    );
                }
            }

            // (3) Cross-check the reference model against the ring at all times:
            // the set of InUse slots matches exactly, so no held slot can be
            // re-acquired behind our back.
            for i in 0..count {
                prop_assert_eq!(
                    ring.is_in_use(i),
                    held[i],
                    "slot {} InUse state diverged from the reference model",
                    i
                );
            }
            // In-use count never exceeds capacity and matches the held set.
            prop_assert_eq!(ring.in_use_count(), held.iter().filter(|h| **h).count());
        }
    }
}
