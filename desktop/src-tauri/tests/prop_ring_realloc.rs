//! Property-based test for the ring-buffer reallocation decision.
//!
//! Feature: screen-share-zero-overhead, Property 6: Ring reallocation happens
//! exactly when no slot fits the new resolution; after the decision every slot
//! is large enough. For any current ring resolution and for any new capture
//! resolution, the ring is reallocated if and only if no existing slot is large
//! enough for the new resolution; after the decision, every slot is large enough
//! for the new resolution.
//!
//! Validates: Requirements 2.5, 2.6
//!
//! This drives the pure, GPU-independent `RingBuffer<T>` from
//! `app_lib::ring_buffer` (created in task 1.2). `needs_realloc(w, h)` is the
//! exact negation of `fits(w, h)`; the test models the real pipeline decision:
//! reallocate iff `needs_realloc`, otherwise reuse the existing slots — and then
//! checks the post-decision "every slot covers the new resolution" guarantee
//! (Req 2.5 reallocate path, Req 2.6 reuse path).
//!
//! NOTE: This is an integration-test crate, so the `ring_buffer` module must be
//! reachable as `app_lib::ring_buffer` (declared `pub mod ring_buffer` behind
//! `#[cfg(feature = "native-screen-share")]` in `lib.rs`). Run with:
//!   cargo test --features native-screen-share --test prop_ring_realloc

#![cfg(feature = "native-screen-share")]

use app_lib::ring_buffer::{RingBuffer, MAX_SLOTS, MIN_SLOTS};
use proptest::prelude::*;

/// A current ring resolution + slot count, and a new target resolution.
#[derive(Clone, Debug)]
struct Scenario {
    count: usize,
    cur_w: u32,
    cur_h: u32,
    new_w: u32,
    new_h: u32,
}

/// Dimensions are kept in a modest range that straddles common capture sizes
/// (e.g. 720p/1080p/1440p/4K widths) so the generator frequently produces both
/// "fits" and "needs realloc" cases, including exact-equality boundaries.
fn dim() -> impl Strategy<Value = u32> {
    prop_oneof![
        // Bias toward the exact common resolutions to hit equality boundaries.
        Just(1u32),
        Just(720u32),
        Just(1080u32),
        Just(1280u32),
        Just(1440u32),
        Just(1920u32),
        Just(2160u32),
        Just(3840u32),
        1u32..=4096,
    ]
}

fn scenario() -> impl Strategy<Value = Scenario> {
    (MIN_SLOTS..=MAX_SLOTS, dim(), dim(), dim(), dim()).prop_map(
        |(count, cur_w, cur_h, new_w, new_h)| Scenario {
            count,
            cur_w,
            cur_h,
            new_w,
            new_h,
        },
    )
}

proptest! {
    // Property 6 requires a minimum of 100 iterations; run more for coverage.
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// Feature: screen-share-zero-overhead, Property 6: Ring reallocation happens
    /// exactly when no slot fits the new resolution; after the decision every
    /// slot is large enough.
    ///
    /// Validates: Requirements 2.5, 2.6
    #[test]
    fn reallocation_happens_iff_no_slot_fits_then_every_slot_is_large_enough(
        s in scenario()
    ) {
        let Scenario { count, cur_w, cur_h, new_w, new_h } = s;

        let payloads: Vec<usize> = (0..count).collect();
        let mut ring: RingBuffer<usize> =
            RingBuffer::new(payloads, cur_w, cur_h).expect("2 or 3 slots is valid");

        // (1) needs_realloc is the exact negation of fits (Req 2.5 vs 2.6 are
        // complementary): the ring must be reallocated iff no existing slot is
        // large enough for the new resolution.
        let fits = ring.fits(new_w, new_h);
        let needs = ring.needs_realloc(new_w, new_h);
        prop_assert_eq!(
            needs,
            !fits,
            "needs_realloc must be the exact negation of fits"
        );
        // And both agree with the underlying coverage definition.
        let covered_by_current = cur_w >= new_w && cur_h >= new_h;
        prop_assert_eq!(fits, covered_by_current);
        prop_assert_eq!(needs, !covered_by_current);

        // Drive the ring to a mixed state so we can confirm reallocation resets
        // slots regardless of prior occupancy.
        let _ = ring.acquire();

        // (2) Apply the real pipeline decision: reallocate iff needs_realloc,
        // otherwise reuse the existing slots untouched.
        if needs {
            // Reallocation path (Req 2.5): new payloads sized for the new res.
            let fresh: Vec<usize> = (0..count).map(|i| 100 + i).collect();
            ring.reallocate(fresh, new_w, new_h)
                .expect("reallocate with 2 or 3 slots is valid");

            // Reallocation resets every slot to Free.
            prop_assert_eq!(ring.free_count(), count);
            prop_assert_eq!(ring.in_use_count(), 0);
            prop_assert_eq!(ring.resolution(), (new_w, new_h));
        } else {
            // Reuse path (Req 2.6): the existing slots are kept as-is. The
            // acquired slot stays InUse, proving no reallocation occurred.
            prop_assert_eq!(ring.resolution(), (cur_w, cur_h));
            prop_assert_eq!(ring.in_use_count(), 1);
        }

        // (3) Post-decision guarantee: after the decision every slot is large
        // enough for the new resolution, and no further realloc is required —
        // whether we reallocated (Req 2.5) or reused (Req 2.6).
        prop_assert!(
            ring.fits(new_w, new_h),
            "after the decision every slot must cover the new resolution"
        );
        prop_assert!(
            !ring.needs_realloc(new_w, new_h),
            "after the decision no further reallocation may be required"
        );
        // Capacity is preserved across either branch (still 2 or 3 slots).
        prop_assert_eq!(ring.capacity(), count);
    }
}
