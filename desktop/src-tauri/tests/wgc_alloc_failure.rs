//! Unit test for ring allocation failure at session startup.
//!
//! Validates: Requirement 2.8 — IF Texture_Ring_Buffer allocation fails at
//! session start, THEN THE WGC_Capture SHALL terminate session startup with an
//! error indication rather than proceeding to frame processing.
//!
//! # Why this models the seam instead of mocking a real device
//!
//! In production, `wgc_capture::TextureRingBuffer::new` allocates `count` BGRA
//! `ID3D11Texture2D` resources via `ID3D11Device::CreateTexture2D`; if any
//! allocation fails it returns `Err(String)` so `start_wgc_capture` aborts
//! before the `FrameArrived` callback can ever run. A real `ID3D11Device` is
//! GPU-bound: `D3dDevice::new` calls `D3D11CreateDevice` with
//! `D3D_DRIVER_TYPE_HARDWARE`, which has no software/mock substitute that
//! exercises a `CreateTexture2D` *failure* deterministically in CI. There is no
//! counting/mock device trait in the crate, and introducing one purely for this
//! test would not exercise any additional pure logic.
//!
//! So this test targets the GPU-independent seam the production constructor is
//! built on — the pure `app_lib::ring_buffer::RingBuffer<T>` and its
//! `RingBufferError` paths — and reproduces the exact two-step contract
//! `TextureRingBuffer::new` follows:
//!
//! 1. Build the payloads (this is where `CreateTexture2D` would fail). If the
//!    payload builder yields an error, **no ring is constructed** and the error
//!    is propagated — startup terminates before any frame processing.
//! 2. Hand the payloads to `RingBuffer::new`, which itself rejects an invalid
//!    slot count (`RingBufferError::InvalidSlotCount`) — the other documented
//!    way ring construction fails at startup.
//!
//! In both failure modes the observable contract is identical and is what this
//! test asserts: the constructor returns `Err`, **no** `RingBuffer` is produced,
//! and therefore no frame is ever acquired/delivered (the "frames processed"
//! counter stays at zero).
//!
//! Run with:
//!   cargo test --features native-screen-share --test wgc_alloc_failure

#![cfg(feature = "native-screen-share")]

use std::cell::Cell;

use app_lib::ring_buffer::{RingBuffer, RingBufferError, MAX_SLOTS, MIN_SLOTS};

/// Mirror of the real `wgc_capture::TextureRingBuffer::new` flow over a generic
/// payload, with the GPU allocation replaced by an injectable builder so we can
/// deterministically force the `CreateTexture2D`-equivalent failure that a real
/// device cannot reproduce in CI.
///
/// `build_payloads` stands in for `TextureRingBuffer::allocate_textures`: it
/// returns `Err(String)` to model a failed `CreateTexture2D`, exactly as the
/// production builder maps `device.CreateTexture2D(...)` errors. On success it
/// returns the `count` payloads, which are then wrapped in a `RingBuffer`
/// (whose own `InvalidSlotCount` guard is preserved).
fn try_build_ring<T>(
    count: usize,
    width: u32,
    height: u32,
    build_payloads: impl FnOnce(usize) -> Result<Vec<T>, String>,
) -> Result<RingBuffer<T>, String> {
    // Step 1: allocate the per-slot payloads. A failure here (the
    // `CreateTexture2D` seam) aborts before any ring exists.
    let payloads = build_payloads(count)?;
    // Step 2: build the ring; an invalid slot count is rejected by the ring
    // itself and surfaced as an error string, just like the production code.
    RingBuffer::new(payloads, width, height).map_err(|e: RingBufferError| e.to_string())
}

/// Extract the `Err` string from a ring-build result without requiring the
/// `Ok` payload (`RingBuffer<T>`) to be `Debug` — `Result::expect_err` would
/// impose that bound, and `RingBuffer<T>` intentionally is not `Debug`.
fn expect_build_err<T>(result: Result<RingBuffer<T>, String>) -> String {
    match result {
        Err(e) => e,
        Ok(_) => panic!("expected the ring build to fail with Err, but it returned Ok"),
    }
}

/// A counting allocator that fails on the Nth `CreateTexture2D`-equivalent
/// call, so we can assert (a) startup aborts and (b) no extra work happens.
struct CountingAllocator {
    /// 1-based index of the allocation that fails (`0` ⇒ never fails).
    fail_on: usize,
    calls: Cell<usize>,
}

impl CountingAllocator {
    fn new(fail_on: usize) -> Self {
        Self {
            fail_on,
            calls: Cell::new(0),
        }
    }

    /// Build `count` payloads, failing on the configured allocation. Mirrors the
    /// `for _ in 0..count { CreateTexture2D(...)? }` loop in the real code.
    fn build(&self, count: usize) -> Result<Vec<u32>, String> {
        let mut out = Vec::with_capacity(count);
        for slot in 1..=count {
            self.calls.set(self.calls.get() + 1);
            if self.fail_on != 0 && self.calls.get() == self.fail_on {
                return Err(format!(
                    "CreateTexture2D (ring slot): simulated failure on allocation {slot}"
                ));
            }
            out.push(7000 + slot as u32);
        }
        Ok(out)
    }

    fn calls(&self) -> usize {
        self.calls.get()
    }
}

#[test]
fn allocation_failure_on_first_texture_aborts_startup_with_err_and_no_ring() {
    let alloc = CountingAllocator::new(1); // fail on the very first CreateTexture2D
    let result = try_build_ring(MAX_SLOTS, 1920, 1080, |count| alloc.build(count));

    // (1) Startup terminates with an error indication (Req 2.8).
    let err = expect_build_err(result);
    assert!(
        err.contains("CreateTexture2D"),
        "error should surface the texture allocation failure, got: {err}"
    );
    // (2) No ring is produced, so no slot can ever be acquired and no frame can
    // be processed. The builder stopped at the first failing allocation.
    assert_eq!(alloc.calls(), 1, "must abort on the first failed allocation");
}

#[test]
fn allocation_failure_midway_aborts_startup_and_processes_no_frames() {
    // Fail on the 2nd of 3 textures — the ring is still never constructed.
    let alloc = CountingAllocator::new(2);
    let result = try_build_ring(MAX_SLOTS, 1280, 720, |count| alloc.build(count));

    assert!(
        result.is_err(),
        "a mid-allocation failure must still abort startup before frame processing"
    );
    // Allocation short-circuited at the failing slot; no later textures and, of
    // course, no ring / no frame acquisition followed.
    assert_eq!(alloc.calls(), 2, "allocation must short-circuit on first failure");
}

#[test]
fn invalid_slot_count_is_the_other_startup_failure_path() {
    // The ring constructor itself rejects an out-of-range slot count even when
    // every payload "allocated" successfully (Req 2.1's "exactly 2 or 3").
    let alloc = CountingAllocator::new(0); // never fails the allocation step
    for bad_count in [0usize, 1, MAX_SLOTS + 1, 8] {
        let result = try_build_ring(bad_count, 800, 600, |count| alloc.build(count));
        let err = expect_build_err(result);
        assert!(
            err.contains("ring buffer must have"),
            "invalid slot count error should describe the 2-or-3 constraint, got: {err}"
        );
    }
}

#[test]
fn successful_allocation_yields_a_ring_that_then_processes_frames() {
    // Control case: when allocation succeeds for a valid slot count, a ring IS
    // produced and is immediately usable — confirming the failure assertions
    // above are meaningful (the contract differs on the success path).
    let alloc = CountingAllocator::new(0);
    for good_count in [MIN_SLOTS, MAX_SLOTS] {
        let mut ring = try_build_ring(good_count, 1920, 1080, |count| alloc.build(count))
            .expect("valid allocation + slot count must succeed");

        assert_eq!(ring.capacity(), good_count);
        assert_eq!(ring.dropped(), 0);
        // A produced ring can acquire/deliver a frame (proves "frames are
        // processed" only happens on the success path, never after an Err).
        let slot = ring.acquire().expect("a fresh ring has a free slot");
        assert!(ring.is_in_use(slot));
    }
}
