//! Property-based test for steady-state delivery rate.
//!
//! Feature: screen-share-zero-overhead, Property 5: Steady-state delivery
//! preserves the negotiated rate. For any stream of frame arrivals at the
//! negotiated capture rate where slots are released promptly (adequate ring
//! capacity), the number of frames delivered to the encoder over any rolling
//! window equals the number that arrived within 5%, i.e. no frame is dropped
//! when capacity is sufficient.
//!
//! Validates: Requirements 1.3
//!
//! This drives the pure, GPU-independent `RingBuffer<T>` from
//! `app_lib::ring_buffer` (the slot Free/InUse state machine with
//! acquire/release and a `dropped()` counter). It models the steady-state WGC
//! delivery path: frames arrive at the negotiated rate, and each acquired slot
//! is released within `release_latency` arrivals — a latency strictly below the
//! ring capacity, which is exactly what "released promptly (adequate ring
//! capacity)" means. Under that condition a `Free` slot is always available, so
//! every arrival is delivered, nothing is dropped, and over *any* rolling
//! window `delivered == arrived` (trivially within the 5% tolerance the
//! requirement allows).
//!
//! NOTE: This is an integration-test crate, so the `ring_buffer` module must be
//! reachable as `app_lib::ring_buffer` (declared `pub mod ring_buffer` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_delivery_rate

#![cfg(feature = "native-screen-share")]

use std::collections::VecDeque;

use app_lib::ring_buffer::{RingBuffer, MAX_SLOTS, MIN_SLOTS};
use proptest::prelude::*;

/// A steady-state delivery scenario: a ring of `count` slots fed by `total`
/// arrivals at `fps`, where each slot is released `release_latency` arrivals
/// after it was acquired.
#[derive(Clone, Debug)]
struct Scenario {
    /// Number of slots in the ring (2 or 3).
    count: usize,
    /// Negotiated capture rate (frames per second).
    fps: u32,
    /// Total number of frame arrivals in the stream.
    total: usize,
    /// How many arrivals after acquiring a slot before it is released.
    /// Kept `<= count - 1` so a `Free` slot is always available — the
    /// "released promptly (adequate ring capacity)" precondition.
    release_latency: usize,
}

fn scenario() -> impl Strategy<Value = Scenario> {
    // Common negotiated rates; 720p30 is the design's target encode rate.
    let fps = prop_oneof![Just(15u32), Just(24u32), Just(30u32), Just(60u32)];
    (MIN_SLOTS..=MAX_SLOTS, fps, 1usize..=8).prop_flat_map(|(count, fps, seconds)| {
        // A multi-second stream so a rolling 5-second window is meaningful.
        let total = (fps as usize) * seconds;
        // Prompt release: latency strictly below capacity guarantees a free
        // slot at every acquire (1..=count-1).
        (1usize..count).prop_map(move |release_latency| Scenario {
            count,
            fps,
            total,
            release_latency,
        })
    })
}

/// `delivered` equals `arrived` within 5% (the tolerance Requirement 1.3
/// allows over a rolling window).
fn within_five_percent(arrived: u64, delivered: u64) -> bool {
    let diff = arrived.abs_diff(delivered) as f64;
    let tolerance = arrived as f64 * 0.05;
    diff <= tolerance
}

proptest! {
    // Property 5 requires a minimum of 100 iterations; run more for coverage.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: screen-share-zero-overhead, Property 5: Steady-state delivery
    /// preserves the negotiated rate.
    ///
    /// Validates: Requirements 1.3
    #[test]
    fn steady_state_delivery_preserves_the_negotiated_rate(s in scenario()) {
        let Scenario { count, fps, total, release_latency } = s;

        // Sanity: the generator only ever produces the "adequate capacity"
        // precondition (prompt release strictly below capacity).
        prop_assert!(release_latency < count);

        let payloads: Vec<usize> = (0..count).collect();
        let mut ring: RingBuffer<usize> =
            RingBuffer::new(payloads, 1280, 720).expect("2 or 3 slots is valid");

        // Slots acquired but not yet released, in arrival order, so we can
        // release the oldest once it reaches `release_latency` age.
        let mut held_order: VecDeque<usize> = VecDeque::with_capacity(count);
        // Per-arrival delivery flag (true = a slot was acquired for it).
        let mut delivered: Vec<bool> = Vec::with_capacity(total);

        for i in 0..total {
            // Prompt release: the slot acquired `release_latency` arrivals ago
            // is now released (the encoder finished reading it), keeping a free
            // slot available for this arrival.
            if i >= release_latency {
                if let Some(slot) = held_order.pop_front() {
                    ring.release(slot);
                }
            }

            match ring.acquire() {
                Some(slot) => {
                    held_order.push_back(slot);
                    delivered.push(true);
                }
                None => {
                    // Under the adequate-capacity precondition this must never
                    // happen — there is always a free slot.
                    delivered.push(false);
                }
            }

            // Invariant during steady state: never more than `count` slots are
            // ever in use, and with prompt release we stay strictly below
            // capacity after acquiring (a free slot remains).
            prop_assert!(ring.in_use_count() <= count);
        }

        // (1) No frame is dropped when capacity is sufficient (Req 1.3): the
        // ring's drop counter stayed at zero and every arrival was delivered.
        prop_assert_eq!(
            ring.dropped(),
            0,
            "no frame may be dropped while ring capacity is sufficient"
        );
        let delivered_total = delivered.iter().filter(|d| **d).count();
        prop_assert_eq!(
            delivered_total,
            total,
            "every arrival must be delivered when slots are released promptly"
        );

        // (2) Over ANY rolling window the delivered count equals the arrived
        // count within 5%. We slide several window sizes — including the
        // requirement's 5-second window — across the whole stream.
        let five_second_window = (fps as usize * 5).clamp(1, total);
        let window_sizes = [
            1usize,
            (fps as usize).clamp(1, total),  // 1-second window
            five_second_window,              // the Req-1.3 rolling 5s window
            total,                           // the entire stream
        ];

        for &w in &window_sizes {
            if w == 0 || w > total {
                continue;
            }
            for start in 0..=(total - w) {
                let arrived = w as u64;
                let delivered_in_window =
                    delivered[start..start + w].iter().filter(|d| **d).count() as u64;

                // Delivered equals arrived within 5% (here, exactly equal).
                prop_assert!(
                    within_five_percent(arrived, delivered_in_window),
                    "rolling window [{}, {}) delivered {} of {} arrivals — outside 5%",
                    start,
                    start + w,
                    delivered_in_window,
                    arrived
                );
                // Stronger than the requirement: with prompt release no frame is
                // dropped, so the counts match exactly.
                prop_assert_eq!(
                    delivered_in_window,
                    arrived,
                    "rolling window must deliver exactly the arrived count under adequate capacity"
                );
            }
        }
    }
}
