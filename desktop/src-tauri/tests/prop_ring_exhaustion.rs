//! Property-based test for ring-buffer exhaustion behavior.
//!
//! Feature: screen-share-zero-overhead, Property 2: Exhaustion drops the frame,
//! counts it, and leaves held entries untouched. For any ring buffer and for any
//! sequence of events that leaves every slot `InUse`, when a new frame arrives
//! the system drops that frame, increments `dropped_frames` by exactly one,
//! returns no slot (acquire yields `None`), and mutates no `InUse` slot.
//!
//! Validates: Requirements 2.7, 3.10
//!
//! This drives the pure, GPU-independent `RingBuffer<T>` from
//! `app_lib::ring_buffer` (created in task 1.2). The generic payload stands in
//! for the real GPU texture; here each slot carries a stable tag so we can prove
//! that a dropped (exhausted) acquire never disturbs a held slot's payload.
//!
//! NOTE: This is an integration-test crate, so the `ring_buffer` module must be
//! reachable as `app_lib::ring_buffer` (declared `pub mod ring_buffer` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_ring_exhaustion

#![cfg(feature = "native-screen-share")]

use app_lib::ring_buffer::{RingBuffer, SlotState, MAX_SLOTS, MIN_SLOTS};
use proptest::prelude::*;

/// Drive a ring to full occupancy, then issue `extra_arrivals` more frame
/// arrivals against the saturated ring and verify exhaustion semantics.
#[derive(Clone, Debug)]
struct Scenario {
    /// Number of slots in the ring (2 or 3).
    count: usize,
    /// How many frames arrive at a fully-`InUse` ring (>= 1).
    extra_arrivals: usize,
}

fn scenario() -> impl Strategy<Value = Scenario> {
    (MIN_SLOTS..=MAX_SLOTS, 1usize..50).prop_map(|(count, extra_arrivals)| Scenario {
        count,
        extra_arrivals,
    })
}

proptest! {
    // Property 2 requires a minimum of 100 iterations; run more for coverage.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: screen-share-zero-overhead, Property 2: Exhaustion drops the
    /// frame, counts it, and leaves held entries untouched.
    ///
    /// Validates: Requirements 2.7, 3.10
    #[test]
    fn exhaustion_drops_counts_and_leaves_held_entries_untouched(s in scenario()) {
        let Scenario { count, extra_arrivals } = s;

        // Stable, unique per-slot tags. The state machine never mutates
        // payloads, so any tag change under a held slot would mean a dropped
        // frame overwrote an in-use entry.
        let payloads: Vec<usize> = (0..count).map(|i| 7000 + i).collect();
        let expected_payloads = payloads.clone();
        let mut ring: RingBuffer<usize> =
            RingBuffer::new(payloads, 1280, 720).expect("2 or 3 slots is valid");

        // Saturate the ring: acquire every slot exactly once.
        let mut acquired = Vec::with_capacity(count);
        for _ in 0..count {
            let slot = ring.acquire().expect("free slot available before saturation");
            acquired.push(slot);
        }
        // All slots distinct and InUse, nothing dropped yet.
        acquired.sort_unstable();
        acquired.dedup();
        prop_assert_eq!(acquired.len(), count, "saturation must acquire distinct slots");
        prop_assert_eq!(ring.in_use_count(), count);
        prop_assert_eq!(ring.free_count(), 0);
        prop_assert_eq!(ring.dropped(), 0);

        // Now every frame arrival hits a full ring and must be dropped.
        for n in 1..=extra_arrivals {
            // Capture in-use payloads before the arrival.
            for i in 0..count {
                prop_assert_eq!(ring.state(i), Some(SlotState::InUse));
            }

            let result = ring.acquire();

            // (1) Acquire yields no slot on exhaustion (Req 2.7).
            prop_assert_eq!(result, None, "acquire must return None when every slot is InUse");

            // (2) dropped_frames increments by exactly one per dropped arrival
            // (Req 2.7, 3.10) — after `n` exhausted arrivals the counter is `n`.
            prop_assert_eq!(
                ring.dropped(),
                n as u64,
                "dropped counter must increment by exactly one per dropped frame"
            );

            // (3) No InUse slot was touched: every slot is still InUse and still
            // holds its original payload; capacity and counts are unchanged.
            prop_assert_eq!(ring.in_use_count(), count);
            prop_assert_eq!(ring.free_count(), 0);
            prop_assert_eq!(ring.capacity(), count);
            for i in 0..count {
                prop_assert_eq!(
                    ring.state(i),
                    Some(SlotState::InUse),
                    "a held slot changed state on exhaustion"
                );
                prop_assert_eq!(
                    ring.get(i),
                    Some(&expected_payloads[i]),
                    "a held slot's payload was mutated on a dropped frame"
                );
            }
        }

        // Sanity: total drops equals the number of arrivals against the full
        // ring, never more (no spurious increments) and never less (no missed
        // drops).
        prop_assert_eq!(ring.dropped(), extra_arrivals as u64);

        // After releasing one slot, the ring recovers: the next arrival is
        // served (not dropped) and the dropped counter stays put.
        ring.release(acquired[0]);
        let recovered = ring.acquire();
        prop_assert_eq!(recovered, Some(acquired[0]), "released slot must be re-acquirable");
        prop_assert_eq!(
            ring.dropped(),
            extra_arrivals as u64,
            "serving a frame after recovery must not change the dropped counter"
        );
    }
}
