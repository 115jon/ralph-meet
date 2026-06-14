//! Pure, GPU-/IPC-independent model of the Game_Capture_Hook surface retention
//! and steady-state delivery rules (Requirements 7.3, 7.5, 9.2).
//!
//! This is the hook-surface analogue of [`WgcRetentionTracker`] in
//! `wgc_capture.rs`: where that struct models "retain at most one WGC pool frame
//! at a time", this models the two invariants the hook path must hold when it
//! feeds the encoder from OBS shared surfaces instead of WGC frames:
//!
//! 1. **Retain at most one Shared_Surface at a time** (Req 7.5). The host opens
//!    the DXGI shared handle the injected OBS `graphics-hook` published and reads
//!    it directly in the fused blit (no per-frame copy), so it keeps that surface
//!    checked out until the encoder has read it. To avoid stalling the hook's
//!    surface supply it holds **at most one** surface at any instant. When the
//!    hook republishes a **changed** handle — the swapchain resize/recreate case
//!    (Req 9.2) — the prior surface is released **before** the new handle is
//!    opened, so the retained count transitions 1 → 0 → 1 and never reaches two.
//!
//! 2. **Preserve the negotiated rate in steady state** (Req 7.3). Frames are
//!    handed to the encoder over a bounded channel (the design's depth-4 frame
//!    channel). While the encoder keeps pace — exactly one surface retained and
//!    released each cycle — the channel never fills, so no frame is dropped and
//!    the delivered count equals the arrival count.
//!
//! # Why a pure model
//!
//! The real path lives in [`GameCaptureHook::next_surface`](crate::game_capture::dx11)
//! and touches D3D11/COM and the OBS IPC channel, none of which run in CI. This
//! struct is the GPU-/OS-independent **model** of the exact bookkeeping that path
//! performs: it processes the same three event kinds — **surface arrival** (with
//! the published shared handle), **encoder read-completion**, and **release** —
//! and exposes inspectors so the property tests can drive arbitrary event
//! sequences and assert the invariants without a GPU, a game, or anti-cheat
//! software. It is the target of:
//!
//! - **Property 6** (`tests/prop_hook_retention.rs`, task 6.3): at most one
//!   surface is retained, and a changed handle releases the prior before opening
//!   the new (Req 7.5, 9.2).
//! - **Property 7** (`tests/prop_hook_delivery_rate.rs`, task 6.4): steady-state
//!   delivery preserves the negotiated rate when capacity is sufficient (Req 7.3).
//!
//! It is `pub` and declared under `native-screen-share` (the whole
//! `game_capture` module is) — it carries no Windows dependency, so Properties 6
//! and 7 run without the `game-capture-hook` feature, exactly as the WGC
//! retention model runs without it.
//!
//! [`WgcRetentionTracker`]: crate::wgc_capture::WgcRetentionTracker

use std::collections::VecDeque;

/// Depth of the encoder frame channel the hook feeds, from the design's frame
/// flow ("`try_send` frame channel depth 4"). The bounded delivery queue models
/// that channel so the steady-state rate property (Property 7 / Req 7.3) can be
/// asserted against a concrete capacity.
pub const HOOK_DELIVERY_CHANNEL_DEPTH: usize = 4;

/// Monotonic identifier for one retained shared surface. A fresh token is handed
/// out by [`HookRetentionModel::on_surface_arrival`] each time a surface is
/// **opened** or **re-opened** (never on a reuse of the already-open handle), so
/// a token correlates an open with its matching release.
pub type SurfaceToken = u64;

/// What happened to the single retained surface when a frame arrived.
///
/// The variants encode the three real branches of
/// [`GameCaptureHook::next_surface`](crate::game_capture::dx11): the first open,
/// a re-open on a changed handle (swapchain resize/recreate, Req 9.2), and a
/// reuse when the handle is unchanged. The retained count is `1` after every
/// variant; it only ever transitions through `0` *inside* a [`Reopened`].
///
/// [`Reopened`]: SurfaceAction::Reopened
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurfaceAction {
    /// No surface was retained before, so a new one is opened. Nothing released.
    Opened { token: SurfaceToken },
    /// The published handle **differs** from the currently retained one, so the
    /// prior surface is released **before** the new handle is opened
    /// (retain-at-most-one across a swapchain resize/recreate — Req 7.5, 9.2).
    Reopened {
        token: SurfaceToken,
        released_prior: SurfaceToken,
    },
    /// The published handle is **unchanged**, so the already-open surface is
    /// reused — no new surface is opened and nothing is released.
    Reused { token: SurfaceToken },
}

impl SurfaceAction {
    /// The token of the surface that is retained after this action.
    pub fn token(self) -> SurfaceToken {
        match self {
            SurfaceAction::Opened { token }
            | SurfaceAction::Reopened { token, .. }
            | SurfaceAction::Reused { token } => token,
        }
    }

    /// Whether this action opened a new shared handle (an open or a re-open).
    /// A reuse returns `false`.
    pub fn opened_new_handle(self) -> bool {
        matches!(
            self,
            SurfaceAction::Opened { .. } | SurfaceAction::Reopened { .. }
        )
    }
}

/// What happened to the bounded encoder delivery channel when a frame arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryAction {
    /// The frame was enqueued for the encoder (a `try_send` that succeeded).
    /// `seq` is the monotonic arrival sequence number that was queued.
    Delivered { seq: u64 },
    /// The delivery channel was full, so the frame was dropped rather than
    /// blocking the hook (a `try_send` that failed). `seq` is the dropped frame.
    Dropped { seq: u64 },
}

impl DeliveryAction {
    /// Whether the frame was delivered (enqueued) rather than dropped.
    pub fn was_delivered(self) -> bool {
        matches!(self, DeliveryAction::Delivered { .. })
    }
}

/// Outcome of processing one surface-arrival event.
///
/// Mirrors the shape of [`RetainOutcome`](crate::wgc_capture::RetainOutcome): a
/// [`Stopped`] variant for an arrival that reached the model after the session
/// went inactive (ignored — no retention, no delivery), and a [`Processed`]
/// variant carrying both facets of an active arrival.
///
/// [`Stopped`]: HookArrivalOutcome::Stopped
/// [`Processed`]: HookArrivalOutcome::Processed
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookArrivalOutcome {
    /// The active model processed the arrival. `surface` describes what happened
    /// to the single retained surface (Property 6); `delivery` describes the
    /// bounded-channel hand-off to the encoder (Property 7).
    Processed {
        surface: SurfaceAction,
        delivery: DeliveryAction,
    },
    /// The session has [`stop`](HookRetentionModel::stop)ped; the arrival is
    /// ignored. Nothing is retained and nothing is delivered.
    Stopped,
}

/// Pure, GPU-/IPC-independent model of hook surface retention (Req 7.5, 9.2) and
/// steady-state delivery (Req 7.3).
///
/// See the module docs for the full rationale. In short, the model holds **at
/// most one** shared surface keyed by its published shared handle, and a bounded
/// FIFO of depth [`HOOK_DELIVERY_CHANNEL_DEPTH`] modelling the encoder frame
/// channel. It processes three event kinds:
///
/// * [`on_surface_arrival`](Self::on_surface_arrival) — a presented frame arrived
///   carrying a shared handle. Updates retention (open / re-open on a changed
///   handle / reuse on an unchanged handle) and attempts a bounded delivery.
/// * [`on_read_completion`](Self::on_read_completion) — the encoder consumed one
///   queued frame (the keyed-mutex read finished), freeing a channel slot. The
///   retained surface stays open because the OBS shared texture is reused across
///   presents on the same handle; the surface is released only on a re-open, an
///   explicit [`release`](Self::release), or [`stop`](Self::stop).
/// * [`release`](Self::release) / [`stop`](Self::stop) — release the retained
///   surface.
///
/// The struct is `pub` and Windows-free so the property test crate in `tests/`
/// (`prop_hook_retention.rs`, Property 6; `prop_hook_delivery_rate.rs`,
/// Property 7) can drive arbitrary event sequences and assert the invariants.
#[derive(Debug, Clone)]
pub struct HookRetentionModel {
    /// The single retained surface as `(token, shared_handle)`, or `None` when
    /// nothing is held. `Some(_)` ⇒ exactly one surface is checked out (Req 7.5).
    retained: Option<(SurfaceToken, u64)>,
    /// Next surface token to hand out; incremented on every open / re-open.
    next_token: SurfaceToken,
    /// Bounded FIFO modelling the depth-4 encoder frame channel. Holds the
    /// arrival sequence numbers of frames delivered but not yet consumed.
    delivery: VecDeque<u64>,
    /// Capacity of the delivery channel (`HOOK_DELIVERY_CHANNEL_DEPTH` by default).
    capacity: usize,
    /// `false` once [`stop`](Self::stop) has been called — no further surfaces
    /// are retained and no further frames are delivered.
    active: bool,
    /// Total surface-arrival events processed while active (also the next
    /// arrival sequence number).
    arrivals: u64,
    /// Total frames delivered (successfully enqueued) to the channel.
    delivered: u64,
    /// Total frames dropped because the channel was full.
    dropped: u64,
    /// Total frames consumed by the encoder (successful read-completions).
    consumed: u64,
}

impl Default for HookRetentionModel {
    fn default() -> Self {
        Self::new()
    }
}

impl HookRetentionModel {
    /// Create a model for an active session with the design's depth-4 delivery
    /// channel, retaining nothing yet.
    pub fn new() -> Self {
        Self::with_capacity(HOOK_DELIVERY_CHANNEL_DEPTH)
    }

    /// Create a model with an explicit delivery-channel capacity.
    ///
    /// A capacity of `0` is clamped to `1` so a single in-flight frame can
    /// always be delivered (a zero-depth channel could never deliver anything).
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            retained: None,
            next_token: 0,
            delivery: VecDeque::with_capacity(capacity.max(1)),
            capacity: capacity.max(1),
            active: true,
            arrivals: 0,
            delivered: 0,
            dropped: 0,
            consumed: 0,
        }
    }

    /// Process a surface-arrival event carrying the hook's published
    /// `shared_handle`.
    ///
    /// Retention (Req 7.5, 9.2):
    /// - nothing retained ⇒ [`SurfaceAction::Opened`];
    /// - a **different** handle retained ⇒ release the prior surface first, then
    ///   open the new handle ⇒ [`SurfaceAction::Reopened`] (the count goes
    ///   1 → 0 → 1, never 2);
    /// - the **same** handle retained ⇒ reuse it ⇒ [`SurfaceAction::Reused`].
    ///
    /// Delivery (Req 7.3): the arrival is enqueued into the bounded channel when
    /// a slot is free ([`DeliveryAction::Delivered`]) or dropped when it is full
    /// ([`DeliveryAction::Dropped`]) — never blocking the hook's surface supply.
    ///
    /// Returns [`HookArrivalOutcome::Stopped`] without recording anything if the
    /// session has already stopped.
    pub fn on_surface_arrival(&mut self, shared_handle: u64) -> HookArrivalOutcome {
        if !self.active {
            return HookArrivalOutcome::Stopped;
        }

        let seq = self.arrivals;
        self.arrivals += 1;

        // ── Retention facet (Property 6) ──────────────────────────────────
        let surface = match self.retained {
            // Same handle still open: reuse it. No new surface, nothing released.
            Some((token, handle)) if handle == shared_handle => SurfaceAction::Reused { token },
            // A different handle is open: this is a swapchain resize/recreate.
            // Release the prior surface *before* opening the new one so the
            // retained count transitions 1 → 0 → 1 and never reaches two.
            Some((prior_token, _)) => {
                self.retained = None; // release prior first (Req 7.5, 9.2)
                let token = self.next_token;
                self.next_token += 1;
                self.retained = Some((token, shared_handle));
                SurfaceAction::Reopened {
                    token,
                    released_prior: prior_token,
                }
            }
            // Nothing retained: first open (or first after a release/stop-reset).
            None => {
                let token = self.next_token;
                self.next_token += 1;
                self.retained = Some((token, shared_handle));
                SurfaceAction::Opened { token }
            }
        };

        // ── Delivery facet (Property 7) ───────────────────────────────────
        let delivery = if self.delivery.len() < self.capacity {
            self.delivery.push_back(seq);
            self.delivered += 1;
            DeliveryAction::Delivered { seq }
        } else {
            self.dropped += 1;
            DeliveryAction::Dropped { seq }
        };

        HookArrivalOutcome::Processed { surface, delivery }
    }

    /// Record that the encoder consumed one queued frame (the keyed-mutex read
    /// finished after the fused blit), freeing a delivery-channel slot.
    ///
    /// Returns the arrival sequence number consumed, or `None` if the channel
    /// was empty. This does **not** release the retained surface: the OBS shared
    /// texture is reused across presents on the same handle, so the surface stays
    /// open until a re-open ([`on_surface_arrival`](Self::on_surface_arrival)
    /// with a changed handle), an explicit [`release`](Self::release), or a
    /// [`stop`](Self::stop).
    pub fn on_read_completion(&mut self) -> Option<u64> {
        let seq = self.delivery.pop_front();
        if seq.is_some() {
            self.consumed += 1;
        }
        seq
    }

    /// Release the retained surface if it matches `token` (the encoder is done
    /// with that specific surface, or the session is tearing it down).
    ///
    /// Releasing a stale/unknown token is a harmless no-op so the encoder can
    /// release without coordinating with the capture thread — mirroring
    /// [`WgcRetentionTracker::release`](crate::wgc_capture::WgcRetentionTracker::release).
    pub fn release(&mut self, token: SurfaceToken) {
        if matches!(self.retained, Some((t, _)) if t == token) {
            self.retained = None;
        }
    }

    /// Mark the session inactive, release any retained surface, and drain the
    /// delivery channel (Req 1.6, 7.4). Returns the released surface token, if a
    /// surface was still retained. No further arrivals are retained or delivered.
    pub fn stop(&mut self) -> Option<SurfaceToken> {
        self.active = false;
        self.delivery.clear();
        self.retained.take().map(|(token, _)| token)
    }

    /// The token of the currently retained surface, if any.
    pub fn retained(&self) -> Option<SurfaceToken> {
        self.retained.map(|(token, _)| token)
    }

    /// The shared handle of the currently retained surface, if any.
    pub fn retained_handle(&self) -> Option<u64> {
        self.retained.map(|(_, handle)| handle)
    }

    /// Number of shared surfaces currently retained — always `0` or `1`
    /// (retain-at-most-one, Req 7.5).
    pub fn retained_count(&self) -> usize {
        self.retained.is_some() as usize
    }

    /// Number of frames currently queued in the delivery channel (`0..=capacity`).
    pub fn queued(&self) -> usize {
        self.delivery.len()
    }

    /// The delivery channel capacity (the modelled encoder-channel depth).
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Total surface-arrival events processed while active.
    pub fn arrivals(&self) -> u64 {
        self.arrivals
    }

    /// Total frames delivered (enqueued) to the encoder channel.
    pub fn delivered(&self) -> u64 {
        self.delivered
    }

    /// Total frames dropped because the channel was full.
    pub fn dropped(&self) -> u64 {
        self.dropped
    }

    /// Total frames consumed by the encoder (successful read-completions).
    pub fn consumed(&self) -> u64 {
        self.consumed
    }

    /// Whether the session is still active (has not been [`stop`](Self::stop)ped).
    pub fn is_active(&self) -> bool {
        self.active
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: assert an arrival was processed and return its (surface, delivery).
    fn processed(outcome: HookArrivalOutcome) -> (SurfaceAction, DeliveryAction) {
        match outcome {
            HookArrivalOutcome::Processed { surface, delivery } => (surface, delivery),
            HookArrivalOutcome::Stopped => panic!("active model must process arrivals"),
        }
    }

    #[test]
    fn new_model_retains_nothing_and_is_active() {
        let model = HookRetentionModel::new();
        assert!(model.is_active());
        assert_eq!(model.retained(), None);
        assert_eq!(model.retained_handle(), None);
        assert_eq!(model.retained_count(), 0);
        assert_eq!(model.queued(), 0);
        assert_eq!(model.capacity(), HOOK_DELIVERY_CHANNEL_DEPTH);
    }

    #[test]
    fn first_arrival_opens_a_surface_and_delivers() {
        let mut model = HookRetentionModel::new();
        let (surface, delivery) = processed(model.on_surface_arrival(0xAAAA));
        assert!(matches!(surface, SurfaceAction::Opened { .. }));
        assert!(delivery.was_delivered());
        assert_eq!(model.retained_count(), 1);
        assert_eq!(model.retained_handle(), Some(0xAAAA));
        assert_eq!(model.queued(), 1);
        assert_eq!(model.delivered(), 1);
        assert_eq!(model.dropped(), 0);
    }

    #[test]
    fn unchanged_handle_reuses_the_open_surface() {
        let mut model = HookRetentionModel::new();
        let token = processed(model.on_surface_arrival(0x1234)).0.token();
        // Same handle again: reuse, no new token, still exactly one surface.
        let (surface, _) = processed(model.on_surface_arrival(0x1234));
        assert_eq!(surface, SurfaceAction::Reused { token });
        assert_eq!(model.retained(), Some(token));
        assert_eq!(model.retained_count(), 1);
    }

    #[test]
    fn changed_handle_releases_prior_before_opening_new() {
        let mut model = HookRetentionModel::new();
        let first = processed(model.on_surface_arrival(0x1111)).0.token();
        // A changed handle (swapchain resize/recreate, Req 9.2) must release the
        // prior surface before opening the new — count goes 1 → 0 → 1, never 2.
        let (surface, _) = processed(model.on_surface_arrival(0x2222));
        match surface {
            SurfaceAction::Reopened {
                token,
                released_prior,
            } => {
                assert_eq!(released_prior, first);
                assert_ne!(token, first);
                assert_eq!(model.retained(), Some(token));
            }
            other => panic!("expected Reopened, got {other:?}"),
        }
        assert_eq!(model.retained_count(), 1);
        assert_eq!(model.retained_handle(), Some(0x2222));
    }

    #[test]
    fn retained_count_never_exceeds_one_across_alternating_handles() {
        let mut model = HookRetentionModel::new();
        for i in 0..50u64 {
            // Alternate handles so every other arrival is a re-open.
            model.on_surface_arrival(if i % 2 == 0 { 0xA } else { 0xB });
            assert!(model.retained_count() <= 1);
            // Drain so the bounded channel never masks the retention assertion.
            model.on_read_completion();
        }
        assert_eq!(model.retained_count(), 1);
    }

    #[test]
    fn read_completion_pops_one_queued_frame() {
        let mut model = HookRetentionModel::new();
        model.on_surface_arrival(0x1);
        model.on_surface_arrival(0x1);
        assert_eq!(model.queued(), 2);
        assert_eq!(model.on_read_completion(), Some(0)); // FIFO: first arrival
        assert_eq!(model.on_read_completion(), Some(1));
        assert_eq!(model.on_read_completion(), None); // empty
        assert_eq!(model.queued(), 0);
        assert_eq!(model.consumed(), 2);
    }

    #[test]
    fn delivery_channel_drops_when_full() {
        let mut model = HookRetentionModel::with_capacity(4);
        // Fill the depth-4 channel without consuming.
        for _ in 0..4 {
            assert!(processed(model.on_surface_arrival(0x9)).1.was_delivered());
        }
        assert_eq!(model.queued(), 4);
        // The 5th arrival has nowhere to go: dropped, not blocking the hook.
        let (_, delivery) = processed(model.on_surface_arrival(0x9));
        assert!(matches!(delivery, DeliveryAction::Dropped { .. }));
        assert_eq!(model.dropped(), 1);
        assert_eq!(model.delivered(), 4);
        // Retention is unaffected by a delivery drop (still exactly one surface).
        assert_eq!(model.retained_count(), 1);
    }

    #[test]
    fn steady_state_consumer_keeps_pace_drops_nothing() {
        // Property 7 in miniature: arrival + read-completion each cycle on a
        // stable handle keeps the channel from filling, so delivered == arrivals.
        let mut model = HookRetentionModel::new();
        for _ in 0..1000 {
            assert!(processed(model.on_surface_arrival(0x42)).1.was_delivered());
            model.on_read_completion();
        }
        assert_eq!(model.arrivals(), 1000);
        assert_eq!(model.delivered(), 1000);
        assert_eq!(model.dropped(), 0);
        assert_eq!(model.consumed(), 1000);
        assert_eq!(model.retained_count(), 1);
    }

    #[test]
    fn release_of_current_token_frees_the_surface() {
        let mut model = HookRetentionModel::new();
        let token = processed(model.on_surface_arrival(0x7)).0.token();
        model.release(token);
        assert_eq!(model.retained(), None);
        assert_eq!(model.retained_count(), 0);
    }

    #[test]
    fn release_of_stale_token_is_a_noop() {
        let mut model = HookRetentionModel::new();
        let first = processed(model.on_surface_arrival(0x1)).0.token();
        // Re-open to a new surface; releasing the now-stale first token must not
        // drop the currently retained surface.
        let second = match processed(model.on_surface_arrival(0x2)).0 {
            SurfaceAction::Reopened { token, .. } => token,
            other => panic!("expected Reopened, got {other:?}"),
        };
        model.release(first);
        assert_eq!(model.retained(), Some(second));
        assert_eq!(model.retained_count(), 1);
    }

    #[test]
    fn stop_releases_retained_surface_and_blocks_further_arrivals() {
        let mut model = HookRetentionModel::new();
        let token = processed(model.on_surface_arrival(0x5)).0.token();
        model.on_surface_arrival(0x5); // queue a second frame
        assert_eq!(model.stop(), Some(token));
        assert!(!model.is_active());
        assert_eq!(model.retained_count(), 0);
        assert_eq!(model.queued(), 0); // channel drained
                                       // No retention or delivery after stop.
        assert_eq!(model.on_surface_arrival(0x5), HookArrivalOutcome::Stopped);
        assert_eq!(model.retained_count(), 0);
        assert_eq!(model.queued(), 0);
    }

    #[test]
    fn stop_with_nothing_retained_returns_none() {
        let mut model = HookRetentionModel::new();
        assert_eq!(model.stop(), None);
        assert!(!model.is_active());
    }

    #[test]
    fn zero_capacity_is_clamped_to_one() {
        let mut model = HookRetentionModel::with_capacity(0);
        assert_eq!(model.capacity(), 1);
        assert!(processed(model.on_surface_arrival(0x1)).1.was_delivered());
        assert_eq!(model.queued(), 1);
    }
}
