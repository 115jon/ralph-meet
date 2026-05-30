//! Property-based test for the GPU completion-ordering rule.
//!
//! Feature: screen-share-zero-overhead, Property 4: GPU completion ordering —
//! no read before the producing operation signals. For any interleaving of
//! fused-blit submissions (each followed by a completion query/fence insertion)
//! and encoder reads, the encoder never reads a destination slot before that
//! slot's producing blit has signaled completion, and the ordering is achieved
//! without a full per-frame command-buffer flush.
//!
//! Validates: Requirements 1.2, 1.5
//!
//! This drives the pure, GPU-independent `CompletionOrderModel` from
//! `app_lib::d3d_device` (created in task 2.1). The model mirrors the real
//! per-frame flow: record the fused blit into a destination slot (`submit`),
//! let the GPU reach the inserted `D3D11_QUERY_EVENT` / `ID3D11Fence`
//! (`signal`), then read the slot only once that signal has fired (`read`).
//! Re-submitting a slot makes it pending again until the new op signals.

#![cfg(feature = "native-screen-share")]

use std::collections::{HashMap, HashSet};

use app_lib::d3d_device::{CompletionOrderModel, OpId, ReadOutcome, SlotId};
use proptest::prelude::*;

/// One step in a randomly generated interleaving of submit / signal / read
/// activity across multiple destination slots.
#[derive(Clone, Debug)]
enum Action {
    /// Record a fused blit producing `slot` (returns a fresh op id).
    Submit(SlotId),
    /// Fire the completion signal for a previously submitted op, chosen by an
    /// index into the ops submitted so far (taken modulo the count). This lets
    /// the interleaving signal both the latest and stale ops.
    Signal(usize),
    /// Fire a signal for an op id that was never handed out — must be ignored.
    SignalUnknown(u64),
    /// Attempt to read `slot`.
    Read(SlotId),
}

/// Build a strategy that first picks a small slot pool size, then a sequence of
/// actions whose slot ids stay within that pool so collisions/re-submits on the
/// same slot are common.
fn scenario() -> impl Strategy<Value = (u64, Vec<Action>)> {
    (1u64..=4).prop_flat_map(|num_slots| {
        let action = prop_oneof![
            3 => (0..num_slots).prop_map(Action::Submit),
            3 => (0usize..256).prop_map(Action::Signal),
            1 => any::<u64>().prop_map(Action::SignalUnknown),
            3 => (0..num_slots).prop_map(Action::Read),
        ];
        proptest::collection::vec(action, 1..200).prop_map(move |actions| (num_slots, actions))
    })
}

proptest! {
    // Minimum 100 iterations required for the property; run more for coverage.
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// Feature: screen-share-zero-overhead, Property 4: GPU completion ordering
    /// — no read before the producing operation signals.
    ///
    /// Validates: Requirements 1.2, 1.5
    #[test]
    fn completion_ordering_no_read_before_signal((_num_slots, actions) in scenario()) {
        let mut model = CompletionOrderModel::new();

        // Independent reference model recomputing the expected outcome:
        //   producer[slot] = the most-recent op that produced `slot`
        //   signaled       = the set of ops whose completion signal has fired
        //   submitted       = every op id handed out, in submission order
        let mut producer: HashMap<SlotId, OpId> = HashMap::new();
        let mut signaled: HashSet<OpId> = HashSet::new();
        let mut submitted: Vec<OpId> = Vec::new();

        for action in actions {
            match action {
                Action::Submit(slot) => {
                    let op = model.submit(slot);
                    // The model hands out monotonically increasing, unique op ids.
                    prop_assert!(!submitted.contains(&op));
                    producer.insert(slot, op);
                    submitted.push(op);

                    // A freshly submitted (re-submitted) slot is pending again:
                    // its just-recorded blit has not signaled, so a read must be
                    // deferred even if a prior op for this slot had signaled.
                    prop_assert_eq!(model.read(slot), ReadOutcome::Deferred);
                    prop_assert!(!model.is_ready(slot));
                }
                Action::Signal(idx) => {
                    if !submitted.is_empty() {
                        let op = submitted[idx % submitted.len()];
                        model.signal(op);
                        signaled.insert(op);
                    }
                }
                Action::SignalUnknown(raw) => {
                    // Op ids are handed out sequentially from 0, so any value at
                    // or beyond the count submitted so far is unknown. Signaling
                    // an unknown op must be a no-op.
                    let unknown = raw.saturating_add(submitted.len() as u64);
                    if !submitted.contains(&unknown) {
                        model.signal(unknown);
                    }
                }
                Action::Read(slot) => {
                    let outcome = model.read(slot);

                    let expected = match producer.get(&slot) {
                        None => ReadOutcome::Unproduced,
                        Some(op) => {
                            if signaled.contains(op) {
                                ReadOutcome::Permitted
                            } else {
                                ReadOutcome::Deferred
                            }
                        }
                    };
                    prop_assert_eq!(outcome, expected);

                    // Core invariant: a read is Permitted only after the slot's
                    // most-recent producing op has signaled completion.
                    if outcome == ReadOutcome::Permitted {
                        let op = producer
                            .get(&slot)
                            .expect("Permitted read must have a producing op");
                        prop_assert!(
                            signaled.contains(op),
                            "read permitted before its producing op signaled"
                        );
                    }

                    // Never Permitted while the latest producer is still pending.
                    if let Some(op) = producer.get(&slot) {
                        if !signaled.contains(op) {
                            prop_assert_ne!(outcome, ReadOutcome::Permitted);
                        }
                    }

                    // read() / read_outcome() must agree and never mutate state.
                    prop_assert_eq!(model.is_ready(slot), outcome == ReadOutcome::Permitted);
                }
            }

            // Ordering is achieved with a scoped completion signal, never a full
            // per-frame command-buffer flush (Requirements 1.1, 1.2, 1.5).
            prop_assert_eq!(model.flush_count(), 0);
        }
    }
}
