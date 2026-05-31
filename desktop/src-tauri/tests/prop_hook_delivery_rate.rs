//! Property-based test for steady-state Game_Capture_Hook delivery rate.
//!
//! Feature: universal-game-capture-hook, Property 7: Steady-state delivery
//! preserves the negotiated rate when capacity is sufficient.
//!
//! Validates: Requirements 7.3
//!
//! This drives the pure, GPU-/IPC-independent `HookRetentionModel` from
//! `app_lib::game_capture::hook_retention` — specifically its delivery facet:
//! `on_surface_arrival` performs a bounded `try_send` into the depth-4 encoder
//! frame channel (delivered when a slot is free, dropped when full), and
//! `on_read_completion` drains one slot when the encoder finishes a keyed-mutex
//! read. The model exposes the `arrivals()`, `delivered()`, `dropped()`,
//! `consumed()`, `queued()`, and `capacity()` counters this test asserts over.
//!
//! Requirement 7.3 says the hook must deliver captured frames to the encoder at
//! a rate within 5% of the negotiated capture rate over any rolling 5-second
//! window **when the encoder keeps pace**. This test models exactly that
//! "keeps pace" precondition: a consumer that drains a slot within a bounded lag
//! that never exceeds the channel capacity, so a free slot is always available.
//! Under that condition the property is in fact stronger than 5%: NO frame is
//! dropped, `delivered == arrivals`, and over *any* rolling window the delivered
//! count equals the arrived count exactly.
//!
//! A complementary property makes the "when capacity is sufficient" precondition
//! load-bearing: an under-draining consumer whose backlog exceeds the capacity is
//! the ONLY way a drop ever occurs. In both directions the per-arrival invariant
//! holds — a frame is dropped iff the channel was full at the instant it
//! arrived — which ties drops precisely to channel occupancy.
//!
//! NOTE: This is an integration-test crate, so the model must be reachable as
//! `app_lib::game_capture::hook_retention` (declared `pub mod hook_retention`
//! inside `pub mod game_capture`, behind `#[cfg(feature = "native-screen-share")]`
//! in `lib.rs`). The model carries no Windows dependency, so this runs in CI
//! without a GPU, a game, anti-cheat software, or the `game-capture-hook`
//! feature. Run with:
//!   cargo test --features native-screen-share --test prop_hook_delivery_rate

#![cfg(feature = "native-screen-share")]

use app_lib::game_capture::hook_retention::{
    HookArrivalOutcome, HookRetentionModel, HOOK_DELIVERY_CHANNEL_DEPTH,
};
use proptest::prelude::*;

/// What happened to one arrival: whether it was delivered, and how full the
/// bounded delivery channel was at the instant the arrival was processed.
#[derive(Clone, Copy, Debug)]
struct ArrivalRecord {
    delivered: bool,
    queued_before: usize,
}

/// Run a fixed-lag consumer scenario against the `HookRetentionModel`.
///
/// Each cycle the encoder first drains the slot it acquired `lag` arrivals ago
/// (an `on_read_completion`), then a new surface arrives. A `lag <= capacity`
/// models a consumer that "keeps pace" — the backlog never exceeds the channel
/// capacity, so a free slot is always available. A `lag > capacity` models an
/// under-draining consumer whose backlog overflows the channel.
///
/// `change_every` makes the published shared handle change periodically so the
/// scenario exercises arbitrary retention (open / reuse / re-open) and proves
/// that delivery rate is independent of which surface action a frame triggered.
fn run_fixed_lag(
    capacity: usize,
    lag: usize,
    total: usize,
    change_every: usize,
) -> (HookRetentionModel, Vec<ArrivalRecord>) {
    let mut model = HookRetentionModel::with_capacity(capacity);
    let mut records = Vec::with_capacity(total);

    for i in 0..total {
        // The encoder finished reading the frame it acquired `lag` arrivals ago,
        // freeing a delivery-channel slot before the next frame arrives.
        if i >= lag {
            model.on_read_completion();
        }

        // Occupancy at the instant this frame arrives decides delivered vs dropped.
        let queued_before = model.queued();
        // Vary the handle so retention churns (open/reuse/re-open) independently
        // of delivery; `+ 1` keeps it non-zero for readability.
        let handle = (i / change_every) as u64 + 1;

        let delivered = match model.on_surface_arrival(handle) {
            HookArrivalOutcome::Processed { delivery, .. } => delivery.was_delivered(),
            // The model is never stopped during these scenarios.
            HookArrivalOutcome::Stopped => false,
        };

        records.push(ArrivalRecord {
            delivered,
            queued_before,
        });
    }

    (model, records)
}

/// `delivered` equals `arrived` within 5% — the tolerance Requirement 7.3 allows
/// over a rolling window.
fn within_five_percent(arrived: u64, delivered: u64) -> bool {
    let diff = arrived.abs_diff(delivered) as f64;
    let tolerance = arrived as f64 * 0.05;
    diff <= tolerance
}

/// A steady-state scenario: a delivery channel of `capacity` slots fed by `total`
/// arrivals at `fps`, with a consumer keeping pace at a bounded `lag <= capacity`.
#[derive(Clone, Debug)]
struct SteadyState {
    capacity: usize,
    lag: usize,
    fps: u32,
    total: usize,
    change_every: usize,
}

fn steady_state() -> impl Strategy<Value = SteadyState> {
    // Common negotiated rates; 30 fps is the design's target encode rate.
    let fps = prop_oneof![Just(15u32), Just(24u32), Just(30u32), Just(60u32)];
    // Capacities around the design's depth-4 channel, plus narrower/wider ones.
    (1usize..=8, fps, 1usize..=8).prop_flat_map(|(capacity, fps, seconds)| {
        // A multi-second stream so a rolling 5-second window is meaningful.
        let total = (fps as usize) * seconds;
        // "Keeps pace": the consumer drains within a bounded lag that never
        // exceeds the channel capacity (1..=capacity).
        let lag = 1usize..=capacity;
        let change_every = 1usize..=8;
        (Just(capacity), lag, Just(fps), Just(total), change_every).prop_map(
            |(capacity, lag, fps, total, change_every)| SteadyState {
                capacity,
                lag,
                fps,
                total,
                change_every,
            },
        )
    })
}

/// An under-draining scenario: the consumer lags by strictly more than the
/// channel capacity, so the backlog overflows and frames are dropped.
#[derive(Clone, Debug)]
struct UnderDraining {
    capacity: usize,
    lag: usize,
    total: usize,
    change_every: usize,
}

fn under_draining() -> impl Strategy<Value = UnderDraining> {
    (1usize..=8, 1usize..=12, 1usize..=40, 1usize..=8).prop_map(
        |(capacity, over, tail, change_every)| {
            // Lag strictly greater than capacity ⇒ the backlog exceeds the
            // channel before the consumer catches up.
            let lag = capacity + over;
            // Run past the catch-up point so both the dropping regime (before
            // the consumer starts draining) and the recovered regime are covered.
            let total = lag + tail;
            UnderDraining {
                capacity,
                lag,
                total,
                change_every,
            }
        },
    )
}

proptest! {
    // Property 7 requires a minimum of 100 iterations; run more for coverage.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: universal-game-capture-hook, Property 7: Steady-state delivery
    /// preserves the negotiated rate when capacity is sufficient.
    ///
    /// Validates: Requirements 7.3
    ///
    /// When the encoder keeps pace (the consumer drains within a bounded lag
    /// that never exceeds the channel capacity), every arrival is delivered, no
    /// frame is dropped, and over any rolling window — including the
    /// requirement's 5-second window — the delivered count equals the arrived
    /// count (trivially within the allowed 5%).
    #[test]
    fn steady_state_delivery_preserves_the_negotiated_rate(s in steady_state()) {
        let SteadyState { capacity, lag, fps, total, change_every } = s;

        // Sanity: the generator only ever produces the "capacity is sufficient"
        // precondition (the consumer keeps pace within the channel depth).
        prop_assert!(lag <= capacity);

        let (model, records) = run_fixed_lag(capacity, lag, total, change_every);

        // (1) No frame is dropped and every arrival is delivered when capacity
        // is sufficient (Req 7.3 — stronger than the 5% tolerance here).
        prop_assert_eq!(model.arrivals(), total as u64);
        prop_assert_eq!(
            model.dropped(),
            0,
            "no frame may be dropped while the consumer keeps pace within capacity"
        );
        prop_assert_eq!(
            model.delivered(),
            total as u64,
            "every arrival must be delivered when slots are freed within capacity"
        );

        // Per-arrival invariant: a drop happens iff the channel was full at the
        // instant the frame arrived. Here the channel never fills, so no drops.
        for (idx, r) in records.iter().enumerate() {
            prop_assert!(
                r.queued_before < capacity,
                "arrival {} saw a full channel ({}/{}) — capacity was not sufficient",
                idx, r.queued_before, capacity
            );
            prop_assert!(
                r.delivered,
                "arrival {} was not delivered despite a free slot", idx
            );
        }

        // (2) Over ANY rolling window the delivered count equals the arrived
        // count within 5% (and in fact exactly). Slide several window sizes,
        // including the requirement's rolling 5-second window.
        let five_second_window = (fps as usize * 5).clamp(1, total);
        let window_sizes = [
            1usize,
            (fps as usize).clamp(1, total), // 1-second window
            five_second_window,             // the Req-7.3 rolling 5s window
            total,                          // the entire stream
        ];

        for &w in &window_sizes {
            if w == 0 || w > total {
                continue;
            }
            for start in 0..=(total - w) {
                let arrived = w as u64;
                let delivered_in_window =
                    records[start..start + w].iter().filter(|r| r.delivered).count() as u64;

                prop_assert!(
                    within_five_percent(arrived, delivered_in_window),
                    "rolling window [{}, {}) delivered {} of {} arrivals — outside 5%",
                    start, start + w, delivered_in_window, arrived
                );
                // Stronger than the requirement: under sufficient capacity the
                // delivered rate matches the arrival rate exactly.
                prop_assert_eq!(
                    delivered_in_window,
                    arrived,
                    "rolling window must deliver exactly the arrived count under sufficient capacity"
                );
            }
        }
    }

    /// Feature: universal-game-capture-hook, Property 7: Steady-state delivery
    /// preserves the negotiated rate when capacity is sufficient.
    ///
    /// Validates: Requirements 7.3
    ///
    /// Complement that makes the "when capacity is sufficient" precondition
    /// load-bearing: an under-draining consumer (a backlog that exceeds the
    /// channel capacity) is the ONLY way a drop occurs. A frame is dropped iff
    /// the channel was full at the instant it arrived, so drops appear exactly
    /// in the window where the lagging consumer let the backlog overflow, and
    /// vanish once it catches back up to within capacity.
    #[test]
    fn under_draining_backlog_is_the_only_source_of_drops(s in under_draining()) {
        let UnderDraining { capacity, lag, total, change_every } = s;

        // Sanity: this generator models the precondition failing (lag exceeds
        // capacity), the mirror image of the steady-state property.
        prop_assert!(lag > capacity);

        let (model, records) = run_fixed_lag(capacity, lag, total, change_every);

        prop_assert_eq!(model.arrivals(), total as u64);

        // Per-arrival invariant (holds in BOTH regimes): a frame is dropped iff
        // the channel was full at the instant it arrived — drops are caused by
        // channel occupancy and nothing else.
        for (idx, r) in records.iter().enumerate() {
            let was_full = r.queued_before == capacity;
            prop_assert_eq!(
                !r.delivered, was_full,
                "arrival {} dropped={} but channel occupancy was {}/{}",
                idx, !r.delivered, r.queued_before, capacity
            );
        }

        // With a fixed lag strictly greater than capacity, exactly the arrivals
        // that land while the channel is saturated and before the consumer
        // begins draining are dropped: that is `lag - capacity` frames.
        let expected_drops = (lag - capacity) as u64;
        prop_assert_eq!(
            model.dropped(),
            expected_drops,
            "an under-draining backlog must drop exactly the frames that overflow capacity"
        );

        // The precondition failing actually produces drops (the property is not
        // vacuously true), proving the steady-state guarantee genuinely depends
        // on sufficient capacity.
        prop_assert!(
            model.dropped() > 0,
            "an under-draining consumer must drop at least one frame"
        );

        // Delivered and dropped partition the arrivals exactly.
        prop_assert_eq!(model.delivered() + model.dropped(), total as u64);
        prop_assert_eq!(
            model.delivered(),
            total as u64 - expected_drops,
            "every non-overflowing arrival is still delivered"
        );
    }
}

#[test]
fn default_channel_depth_matches_design() {
    // The steady-state property is asserted against the design's depth-4 encoder
    // frame channel; a default-constructed model uses exactly that capacity.
    let model = HookRetentionModel::new();
    assert_eq!(model.capacity(), HOOK_DELIVERY_CHANNEL_DEPTH);
    assert_eq!(HOOK_DELIVERY_CHANNEL_DEPTH, 4);
}
