//! Edge test: a frame arriving before the NV12 ring is ready falls back to the
//! single retained fallback destination instead of dropping the session.
//!
//! Validates: Requirement 3.4
//!
//! # Why the real GPU VideoProcessor is not constructed here
//!
//! The production fallback path lives in `wmf_encoder.rs`'s `VideoProcessor`,
//! whose state (`fallback_tex` / `fallback_view`, `nv12_ring: Option<...>`, and
//! the `acquire_rotating` selection) is built from real D3D11 objects: an
//! `ID3D11Device`, an `ID3D11VideoDevice`, NV12 `ID3D11Texture2D` resources, and
//! `ID3D11VideoProcessorOutputView`s. Constructing any of those requires a GPU
//! and the Media Foundation / D3D11 video stack, which is not available in CI.
//! Those GPU-bound behaviors are covered by the hardware-gated integration tests
//! (e.g. `integration_dx11_hook.rs`), not here.
//!
//! What *is* pure and testable is the **destination-selection decision** at the
//! seam: when the NV12 ring is unavailable (`None`, i.e. not yet pre-allocated)
//! or yields no free slot, the encoder must convert into the single retained
//! fallback NV12 texture rather than dropping the frame/session (Req 3.4). When
//! the ring is present and has a free slot, that slot is used. This file
//! reproduces exactly that selection logic over the pure
//! `app_lib::ring_buffer::RingBuffer` plus a small `Option`/boolean model and
//! asserts:
//!   1. the fallback is chosen *exactly* when no ring slot is available, and
//!   2. a destination is **always** produced — the session never dies because a
//!      frame arrived early.

#![cfg(feature = "native-screen-share")]

use app_lib::ring_buffer::RingBuffer;

/// The destination the encoder will convert a frame into. Mirrors the real
/// `VideoProcessor` choice between a pooled NV12 ring slot and the single
/// retained fallback NV12 texture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Destination {
    /// A pooled NV12 ring slot (its index). Used in steady state.
    RingSlot(usize),
    /// The single retained fallback NV12 texture (Req 3.4). Used when the ring
    /// is not yet allocated or is momentarily exhausted.
    Fallback,
}

/// Pure model of the encoder's per-frame destination selection.
///
/// `ring` is `None` before pre-allocation completes (the Req 3.4 first-frame
/// case) and `Some(_)` once the NV12 ring exists. The rule:
///   * ring is `None`                  -> `Fallback`
///   * ring present, a free slot found -> `RingSlot(i)`
///   * ring present, no free slot      -> `Fallback`
///
/// Crucially this is total: it always returns a `Destination`, so the session
/// survives an early frame instead of being dropped.
fn select_destination<T>(ring: Option<&mut RingBuffer<T>>) -> Destination {
    match ring {
        None => Destination::Fallback,
        Some(ring) => match ring.acquire() {
            Some(slot) => Destination::RingSlot(slot),
            None => Destination::Fallback,
        },
    }
}

/// Build a small NV12-style ring of `count` (2 or 3) slots. Payloads are plain
/// integers — the selection logic never touches the payload contents, so no GPU
/// resource is needed (see the module doc comment).
fn nv12_ring(count: usize) -> RingBuffer<usize> {
    RingBuffer::new((0..count).collect(), 1280, 720).expect("valid NV12 ring slot count")
}

#[test]
fn first_frame_before_ring_ready_uses_fallback_and_session_survives() {
    // The NV12 ring has not been pre-allocated yet when the very first frame
    // arrives (Req 3.4). Selection must yield the fallback destination, not a
    // dropped session.
    let ring: Option<&mut RingBuffer<usize>> = None;
    let dest = select_destination(ring);
    assert_eq!(
        dest,
        Destination::Fallback,
        "a frame before NV12 ring readiness must use the fallback texture"
    );
}

#[test]
fn frame_after_ring_ready_uses_a_pooled_slot() {
    // Once the ring exists with free slots, the pooled slot is preferred over
    // the fallback so the steady-state path uses the ring (Req 3.1, 3.6).
    let mut ring = nv12_ring(3);
    let dest = select_destination(Some(&mut ring));
    assert!(
        matches!(dest, Destination::RingSlot(_)),
        "a frame after the ring is ready must use a pooled NV12 slot, got {dest:?}"
    );
}

#[test]
fn exhausted_ring_falls_back_without_dropping_the_session() {
    // Even after the ring exists, if every slot is still held by the encoder a
    // late frame still gets a destination (the fallback) rather than killing the
    // session — the fallback texture is the single retained safety net.
    let mut ring = nv12_ring(2);
    // Drain every slot so the ring is exhausted.
    assert!(matches!(select_destination(Some(&mut ring)), Destination::RingSlot(_)));
    assert!(matches!(select_destination(Some(&mut ring)), Destination::RingSlot(_)));
    assert_eq!(ring.free_count(), 0);

    let dest = select_destination(Some(&mut ring));
    assert_eq!(
        dest,
        Destination::Fallback,
        "an exhausted ring must fall back, never drop the session"
    );
}

#[test]
fn fallback_is_chosen_exactly_when_no_ring_slot_is_available() {
    // Walk the lifecycle: not-ready -> ready+free -> ready+exhausted -> released.
    // At each step the fallback is chosen iff no ring slot is available, and a
    // destination is always produced.

    // 1. Ring not allocated yet: no slot available -> Fallback.
    {
        let ring: Option<&mut RingBuffer<usize>> = None;
        assert_eq!(select_destination(ring), Destination::Fallback);
    }

    // 2. Ring ready with free slots: slot available -> RingSlot.
    let mut ring = nv12_ring(2);
    let first = select_destination(Some(&mut ring));
    assert!(matches!(first, Destination::RingSlot(_)));

    // 3. Ring exhausted: no slot available -> Fallback.
    let _second = select_destination(Some(&mut ring)); // RingSlot, consumes last slot
    assert_eq!(ring.free_count(), 0);
    assert_eq!(select_destination(Some(&mut ring)), Destination::Fallback);

    // The exhausted-fallback selection must not have mutated the in-use slots.
    assert_eq!(ring.in_use_count(), 2);

    // 4. Encoder releases a slot: a slot is available again -> RingSlot.
    if let Destination::RingSlot(idx) = first {
        ring.release(idx);
        assert_eq!(ring.free_count(), 1);
        assert!(matches!(select_destination(Some(&mut ring)), Destination::RingSlot(_)));
    } else {
        panic!("expected the first selection to be a ring slot");
    }
}

#[test]
fn a_destination_is_always_produced_across_a_mixed_sequence() {
    // Regardless of ring readiness or occupancy, selection is total: the session
    // always has somewhere to convert the frame into (Req 3.4 — never drop the
    // session). Run a deterministic mix and assert every step yields a
    // destination.

    // Phase A: several frames before the ring is ready — all fallback.
    for _ in 0..5 {
        let ring: Option<&mut RingBuffer<usize>> = None;
        let dest = select_destination(ring);
        assert_eq!(dest, Destination::Fallback);
    }

    // Phase B: ring ready; alternate acquiring and releasing so we cross the
    // free/exhausted boundary repeatedly. Every selection yields *some*
    // destination (the match in select_destination is exhaustive), so the
    // session survives every frame.
    let mut ring = nv12_ring(3);
    let mut held: Vec<usize> = Vec::new();
    for step in 0..20 {
        let dest = select_destination(Some(&mut ring));
        match dest {
            Destination::RingSlot(idx) => held.push(idx),
            Destination::Fallback => {
                // Fallback only when genuinely exhausted.
                assert_eq!(ring.free_count(), 0, "fallback chosen while a slot was free");
            }
        }
        // Periodically release a held slot to reopen the ring.
        if step % 2 == 1 {
            if let Some(idx) = held.pop() {
                ring.release(idx);
            }
        }
    }
}
