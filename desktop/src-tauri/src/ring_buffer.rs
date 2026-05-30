//! GPU-independent ring-buffer slot state machine.
//!
//! This module implements the pure, hardware-free core of the
//! `Texture_Ring_Buffer` (BGRA capture textures) and `NV12_Ring_Buffer`
//! (encoder destination textures) described in the screen-share-zero-overhead
//! design. A single generic `RingBuffer<T>` backs both pools so the slot
//! state machine — acquire / release / drop-on-exhaustion and the
//! resolution-fit / reallocation decision — can be property-tested in CI
//! without a GPU.
//!
//! The generic payload `T` stands in for the real GPU resource
//! (`ID3D11Texture2D` plus its views/release token) in production, or a plain
//! value (e.g. a counter) in tests. The state machine itself never touches the
//! payload's contents, so it is fully deterministic and side-effect free.
//!
//! Each slot is a two-state machine:
//!
//! ```text
//! Free  --acquire()-->  InUse        (handed downstream; must not be overwritten)
//! InUse --release(i)-->  Free         (downstream finished reading it)
//! InUse --(no Free slot on acquire)--> DROP (dropped += 1; InUse slots untouched)
//! ```
//!
//! Slots are always allocated uniformly (every slot covers the same
//! resolution), so a ring-level `(width, height)` describes every slot. This
//! mirrors the real pipeline, where all textures in a ring are created together
//! at the same size.
//!
//! Relevant requirements: 2.2, 2.4, 2.5, 2.6, 2.7, 3.9, 3.10.

/// Number of slots a ring may hold. Requirements 2.1 / 3.3 mandate "exactly 2
/// or 3" reusable textures.
pub const MIN_SLOTS: usize = 2;
pub const MAX_SLOTS: usize = 3;

/// Errors returned when constructing or reallocating a ring buffer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RingBufferError {
    /// The supplied number of slots was outside the allowed `2..=3` range.
    InvalidSlotCount(usize),
}

impl std::fmt::Display for RingBufferError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RingBufferError::InvalidSlotCount(count) => write!(
                f,
                "ring buffer must have {MIN_SLOTS} or {MAX_SLOTS} slots, got {count}"
            ),
        }
    }
}

impl std::error::Error for RingBufferError {}

/// State of a single ring slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotState {
    /// Available to receive a frame / be acquired.
    Free,
    /// Handed downstream (held by the encoder); must not be overwritten or
    /// re-acquired until released.
    InUse,
}

struct Slot<T> {
    payload: T,
    state: SlotState,
}

/// A fixed-size (2 or 3) pool of reusable payloads with release tracking and
/// drop-on-exhaustion semantics.
///
/// The buffer is GPU-independent: it tracks which slots are `Free`/`InUse`, the
/// resolution every slot currently covers, and a `dropped` counter that is
/// incremented whenever a frame arrives while every slot is `InUse`.
pub struct RingBuffer<T> {
    slots: Vec<Slot<T>>,
    /// Resolution every slot currently covers. Slots are uniform, so this
    /// applies to all of them.
    width: u32,
    height: u32,
    /// Number of frames dropped because no `Free` slot was available.
    dropped: u64,
}

impl<T> RingBuffer<T> {
    /// Create a ring from pre-built payloads sized to cover `(width, height)`.
    ///
    /// The caller is responsible for building the payloads (e.g. allocating the
    /// GPU textures) and for surfacing any allocation failure *before* calling
    /// this constructor (Requirement 2.8). `payloads.len()` must be 2 or 3.
    pub fn new(payloads: Vec<T>, width: u32, height: u32) -> Result<Self, RingBufferError> {
        let count = payloads.len();
        if !(MIN_SLOTS..=MAX_SLOTS).contains(&count) {
            return Err(RingBufferError::InvalidSlotCount(count));
        }
        Ok(Self {
            slots: payloads
                .into_iter()
                .map(|payload| Slot {
                    payload,
                    state: SlotState::Free,
                })
                .collect(),
            width,
            height,
            dropped: 0,
        })
    }

    /// Acquire the next `Free` slot, mark it `InUse`, and return its index.
    ///
    /// Returns `None` on exhaustion (every slot already `InUse`). On exhaustion
    /// the `dropped` counter is incremented by exactly one and no `InUse` slot
    /// is mutated (Requirements 2.7, 3.10).
    pub fn acquire(&mut self) -> Option<usize> {
        for (index, slot) in self.slots.iter_mut().enumerate() {
            if slot.state == SlotState::Free {
                slot.state = SlotState::InUse;
                return Some(index);
            }
        }
        // Exhaustion: leave every InUse slot untouched, just count the drop.
        self.dropped += 1;
        None
    }

    /// Release a slot back to `Free` so it can be acquired again.
    ///
    /// Out-of-range indices are ignored, and releasing an already-`Free` slot is
    /// a no-op, so this is safe to call from the encoder side without coordinating
    /// with the producer.
    pub fn release(&mut self, slot: usize) {
        if let Some(slot) = self.slots.get_mut(slot) {
            slot.state = SlotState::Free;
        }
    }

    /// The state of a slot, or `None` if the index is out of range.
    pub fn state(&self, slot: usize) -> Option<SlotState> {
        self.slots.get(slot).map(|slot| slot.state)
    }

    /// True if the given slot is currently `InUse`.
    pub fn is_in_use(&self, slot: usize) -> bool {
        matches!(self.state(slot), Some(SlotState::InUse))
    }

    /// Borrow a slot's payload (e.g. to issue GPU work against the texture).
    pub fn get(&self, slot: usize) -> Option<&T> {
        self.slots.get(slot).map(|slot| &slot.payload)
    }

    /// Mutably borrow a slot's payload.
    pub fn get_mut(&mut self, slot: usize) -> Option<&mut T> {
        self.slots.get_mut(slot).map(|slot| &mut slot.payload)
    }

    /// Total number of slots (2 or 3).
    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// Number of slots currently `Free`.
    pub fn free_count(&self) -> usize {
        self.slots
            .iter()
            .filter(|slot| slot.state == SlotState::Free)
            .count()
    }

    /// Number of slots currently `InUse`.
    pub fn in_use_count(&self) -> usize {
        self.slots
            .iter()
            .filter(|slot| slot.state == SlotState::InUse)
            .count()
    }

    /// Number of frames dropped so far due to exhaustion.
    pub fn dropped(&self) -> u64 {
        self.dropped
    }

    /// Resolution every slot currently covers.
    pub fn resolution(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// True if the existing slots are large enough to hold a frame of
    /// `(w, h)` (Requirement 2.6). Slots are uniform, so this answers the
    /// question for every slot at once.
    pub fn fits(&self, w: u32, h: u32) -> bool {
        self.width >= w && self.height >= h
    }

    /// True iff no existing slot is large enough for the new resolution, i.e.
    /// the ring must be reallocated before it can hold `(new_w, new_h)`
    /// (Requirement 2.5). This is exactly the negation of [`fits`](Self::fits).
    pub fn needs_realloc(&self, new_w: u32, new_h: u32) -> bool {
        !self.fits(new_w, new_h)
    }

    /// Replace every slot with a freshly built payload sized to cover
    /// `(new_w, new_h)`, resetting all slots to `Free`.
    ///
    /// The caller builds the new payloads (handling any GPU allocation failure)
    /// and hands them over. After this call every slot is guaranteed to cover
    /// the new resolution (Requirement 2.5, Property 6). `payloads.len()` must
    /// be 2 or 3. The `dropped` counter is preserved across reallocation.
    pub fn reallocate(
        &mut self,
        payloads: Vec<T>,
        new_w: u32,
        new_h: u32,
    ) -> Result<(), RingBufferError> {
        let count = payloads.len();
        if !(MIN_SLOTS..=MAX_SLOTS).contains(&count) {
            return Err(RingBufferError::InvalidSlotCount(count));
        }
        self.slots = payloads
            .into_iter()
            .map(|payload| Slot {
                payload,
                state: SlotState::Free,
            })
            .collect();
        self.width = new_w;
        self.height = new_h;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring(count: usize) -> RingBuffer<usize> {
        RingBuffer::new((0..count).collect(), 1920, 1080).expect("valid slot count")
    }

    fn assert_invalid_count<T>(result: Result<RingBuffer<T>, RingBufferError>, expected: usize) {
        match result {
            Err(RingBufferError::InvalidSlotCount(count)) => assert_eq!(count, expected),
            Ok(_) => panic!("expected InvalidSlotCount({expected}), got Ok"),
        }
    }

    #[test]
    fn new_rejects_invalid_slot_counts() {
        assert_invalid_count(RingBuffer::<usize>::new(vec![], 100, 100), 0);
        assert_invalid_count(RingBuffer::new(vec![0], 100, 100), 1);
        assert_invalid_count(RingBuffer::new(vec![0, 1, 2, 3], 100, 100), 4);
        assert!(RingBuffer::new(vec![0, 1], 100, 100).is_ok());
        assert!(RingBuffer::new(vec![0, 1, 2], 100, 100).is_ok());
    }

    #[test]
    fn acquire_returns_distinct_free_slots_until_exhausted() {
        let mut r = ring(3);
        let a = r.acquire().unwrap();
        let b = r.acquire().unwrap();
        let c = r.acquire().unwrap();
        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_ne!(a, c);
        assert_eq!(r.in_use_count(), 3);
        assert_eq!(r.free_count(), 0);
    }

    #[test]
    fn exhaustion_drops_frame_counts_it_and_leaves_in_use_slots_untouched() {
        let mut r = ring(2);
        let a = r.acquire().unwrap();
        let b = r.acquire().unwrap();
        // Every slot now InUse — the next acquire must drop.
        assert_eq!(r.acquire(), None);
        assert_eq!(r.dropped(), 1);
        // The held slots are untouched.
        assert!(r.is_in_use(a));
        assert!(r.is_in_use(b));
        assert_eq!(r.in_use_count(), 2);
        // A second arrival on a full ring drops again.
        assert_eq!(r.acquire(), None);
        assert_eq!(r.dropped(), 2);
    }

    #[test]
    fn release_makes_a_slot_acquirable_again() {
        let mut r = ring(2);
        let a = r.acquire().unwrap();
        let _b = r.acquire().unwrap();
        assert_eq!(r.acquire(), None);
        r.release(a);
        assert_eq!(r.free_count(), 1);
        let reacquired = r.acquire().unwrap();
        assert_eq!(reacquired, a);
    }

    #[test]
    fn release_is_idempotent_and_ignores_out_of_range() {
        let mut r = ring(2);
        let a = r.acquire().unwrap();
        r.release(a);
        r.release(a); // no panic, stays Free
        r.release(999); // out of range, ignored
        assert_eq!(r.free_count(), 2);
    }

    #[test]
    fn fits_and_needs_realloc_are_exact_negations() {
        let r = ring(2); // 1920x1080
        assert!(r.fits(1280, 720));
        assert!(r.fits(1920, 1080));
        assert!(!r.fits(1921, 1080));
        assert!(!r.fits(1920, 1081));
        for (w, h) in [(1280, 720), (1920, 1080), (1921, 1080), (3840, 2160)] {
            assert_eq!(r.needs_realloc(w, h), !r.fits(w, h));
        }
    }

    #[test]
    fn reallocate_resets_slots_and_covers_new_resolution() {
        let mut r = ring(2);
        let _a = r.acquire().unwrap();
        let _b = r.acquire().unwrap();
        assert_eq!(r.acquire(), None);
        assert_eq!(r.dropped(), 1);

        // Larger resolution that no current slot covers.
        assert!(r.needs_realloc(3840, 2160));
        r.reallocate(vec![10, 11, 12], 3840, 2160).unwrap();

        // Every slot is Free again and covers the new resolution.
        assert_eq!(r.free_count(), 3);
        assert_eq!(r.capacity(), 3);
        assert!(r.fits(3840, 2160));
        assert!(!r.needs_realloc(3840, 2160));
        // Dropped counter is preserved across reallocation.
        assert_eq!(r.dropped(), 1);
    }

    #[test]
    fn reallocate_rejects_invalid_slot_counts() {
        let mut r = ring(2);
        match r.reallocate(vec![0], 100, 100) {
            Err(RingBufferError::InvalidSlotCount(count)) => assert_eq!(count, 1),
            other => panic!("expected InvalidSlotCount(1), got {other:?}"),
        }
        // Ring is unchanged on error.
        assert_eq!(r.capacity(), 2);
        assert_eq!(r.resolution(), (1920, 1080));
    }
}
