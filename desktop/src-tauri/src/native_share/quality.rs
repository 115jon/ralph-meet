//! Quality presets, aspect-preserving output sizing, and the resize debounce
//! that drives encoder reconfiguration when the captured source changes shape.
//! Everything here is pure so it is unit-tested without a GPU.

use std::time::{Duration, Instant};

/// Round down to an even dimension (H.264/NV12 need even sizes), minimum 2.
pub fn even_dimension(value: u32) -> u32 {
    value.saturating_sub(value % 2).max(2)
}

/// Resolved encode parameters for a quality preset and a source size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QualityParams {
    /// Encode width: the source aspect ratio fitted inside the preset box.
    pub width: u32,
    /// Encode height: the source aspect ratio fitted inside the preset box.
    pub height: u32,
    /// The preset's bounding box width (e.g. 1920 for `1080p30`).
    pub max_width: u32,
    /// The preset's bounding box height (e.g. 1080 for `1080p30`).
    pub max_height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

/// The preset box, fps and bitrate for a quality string such as `"1080p30"`.
/// Unknown strings fall back to 1080p30.
pub fn quality_preset(quality: &str) -> (u32, u32, u32, u32) {
    let fps: u32 = if quality.ends_with("60") { 60 } else { 30 };
    let (w, h, bitrate) = match quality {
        "480p30" | "480p60" => (854, 480, 2_000_000),
        "720p30" => (1280, 720, 4_000_000),
        "720p60" => (1280, 720, 6_000_000),
        "1080p30" => (1920, 1080, 8_000_000),
        "1080p60" => (1920, 1080, 12_000_000),
        "1440p30" => (2560, 1440, 16_000_000),
        "1440p60" => (2560, 1440, 24_000_000),
        "4k30" => (3840, 2160, 28_000_000),
        "4k60" => (3840, 2160, 45_000_000),
        _ => (1920, 1080, 8_000_000),
    };
    (w, h, fps, bitrate)
}

/// Fit `src` inside the `max` box, preserving the source aspect ratio, never
/// upscaling beyond the source, and rounding both sides down to even values.
///
/// Scaling uses the tighter of the two axes (so the result touches the box on
/// at least one side unless the source is already smaller), which is what
/// keeps a 21:9 or portrait source from being squashed into a 16:9 frame (B5).
pub fn fit_within(src: (u32, u32), max: (u32, u32)) -> (u32, u32) {
    let (sw, sh) = (src.0.max(1) as u64, src.1.max(1) as u64);
    let (mw, mh) = (max.0.max(2) as u64, max.1.max(2) as u64);
    let (w, h) = if sw <= mw && sh <= mh {
        (sw, sh)
    } else if sw * mh >= sh * mw {
        // Width-limited: the source is relatively wider than the box.
        (mw, sh * mw / sw)
    } else {
        // Height-limited: the source is relatively taller than the box.
        (sw * mh / sh, mh)
    };
    (even_dimension(w as u32), even_dimension(h as u32))
}

/// Map a quality preset string to encode parameters for a source of
/// `src_width × src_height`. Single source of truth for session start, the live
/// quality switch, and source-resize reconfiguration.
pub fn parse_quality_params(quality: &str, src_width: u32, src_height: u32) -> QualityParams {
    let (max_width, max_height, fps, bitrate) = quality_preset(quality);
    let (width, height) = fit_within((src_width, src_height), (max_width, max_height));
    QualityParams {
        width,
        height,
        max_width,
        max_height,
        fps,
        bitrate,
    }
}

/// Debounces source-size changes so a drag-resize does not rebuild the encoder
/// on every frame.
///
/// * The first change after a quiet period applies immediately (leading edge),
///   so a one-off change (maximize, hook surface replacing the WGC pre-roll)
///   costs no extra latency.
/// * Further changes inside the quiet window are coalesced and applied once
///   the size has been stable for `quiet`, or after `max_wait` of continuous
///   resizing, whichever comes first (trailing edge).
/// * A size that bounces back to the applied one cancels the pending change.
#[derive(Debug, Clone)]
pub struct ResizeDebouncer {
    applied: (u32, u32),
    applied_at: Option<Instant>,
    pending: Option<PendingResize>,
    quiet: Duration,
    max_wait: Duration,
}

#[derive(Debug, Clone, Copy)]
struct PendingResize {
    dims: (u32, u32),
    first_seen: Instant,
    last_change: Instant,
}

impl ResizeDebouncer {
    pub const DEFAULT_QUIET: Duration = Duration::from_millis(200);
    pub const DEFAULT_MAX_WAIT: Duration = Duration::from_millis(1000);

    pub fn new(applied: (u32, u32)) -> Self {
        Self::with_timing(applied, Self::DEFAULT_QUIET, Self::DEFAULT_MAX_WAIT)
    }

    pub fn with_timing(applied: (u32, u32), quiet: Duration, max_wait: Duration) -> Self {
        Self {
            applied,
            applied_at: None,
            pending: None,
            quiet,
            max_wait,
        }
    }

    /// The size the encoder is currently configured for.
    pub fn applied(&self) -> (u32, u32) {
        self.applied
    }

    /// Whether a change is waiting for the trailing edge.
    pub fn is_pending(&self) -> bool {
        self.pending.is_some()
    }

    /// Record the size of a newly arrived frame. Returns the size to apply now,
    /// if any.
    pub fn observe(&mut self, dims: (u32, u32), now: Instant) -> Option<(u32, u32)> {
        if dims == self.applied {
            self.pending = None;
            return None;
        }
        let quiet_since_last_apply = self
            .applied_at
            .map_or(true, |at| now.saturating_duration_since(at) >= self.quiet);
        if self.pending.is_none() && quiet_since_last_apply {
            return Some(self.apply(dims, now));
        }
        match self.pending.as_mut() {
            Some(pending) if pending.dims == dims => {}
            Some(pending) => {
                pending.dims = dims;
                pending.last_change = now;
            }
            None => {
                self.pending = Some(PendingResize {
                    dims,
                    first_seen: now,
                    last_change: now,
                });
            }
        }
        self.poll(now)
    }

    /// Check whether a pending change has reached its trailing edge.
    pub fn poll(&mut self, now: Instant) -> Option<(u32, u32)> {
        let pending = self.pending?;
        let stable = now.saturating_duration_since(pending.last_change) >= self.quiet;
        let overdue = now.saturating_duration_since(pending.first_seen) >= self.max_wait;
        if stable || overdue {
            Some(self.apply(pending.dims, now))
        } else {
            None
        }
    }

    fn apply(&mut self, dims: (u32, u32), now: Instant) -> (u32, u32) {
        self.applied = dims;
        self.applied_at = Some(now);
        self.pending = None;
        dims
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ultrawide_at_1080p_keeps_its_aspect_ratio() {
        let p = parse_quality_params("1080p60", 3440, 1440);
        assert_eq!((p.width, p.height), (1920, 802));
        assert_eq!((p.max_width, p.max_height), (1920, 1080));
        assert_eq!(p.fps, 60);
    }

    #[test]
    fn portrait_source_is_height_limited() {
        assert_eq!(fit_within((1080, 1920), (1920, 1080)), (606, 1080));
        assert_eq!(fit_within((1440, 2560), (1280, 720)), (404, 720));
    }

    #[test]
    fn sources_smaller_than_the_preset_are_never_upscaled() {
        assert_eq!(fit_within((1280, 720), (1920, 1080)), (1280, 720));
        assert_eq!(fit_within((800, 1000), (1920, 1080)), (800, 1000));
    }

    #[test]
    fn odd_sizes_round_down_to_even() {
        assert_eq!(fit_within((1115, 628), (1920, 1080)), (1114, 628));
        assert_eq!(fit_within((1921, 1081), (1920, 1080)), (1918, 1080));
        assert_eq!(fit_within((3, 3), (1920, 1080)), (2, 2));
    }

    #[test]
    fn matching_aspect_fills_the_box_exactly() {
        assert_eq!(fit_within((3840, 2160), (1920, 1080)), (1920, 1080));
        assert_eq!(fit_within((2560, 1440), (854, 480)), (852, 480));
    }

    #[test]
    fn degenerate_inputs_stay_valid() {
        assert_eq!(fit_within((0, 0), (1920, 1080)), (2, 2));
        assert_eq!(fit_within((10_000, 1), (1920, 1080)), (1920, 2));
    }

    #[test]
    fn unknown_quality_falls_back_to_1080p30() {
        let p = parse_quality_params("bogus", 1920, 1080);
        assert_eq!(
            (p.width, p.height, p.fps, p.bitrate),
            (1920, 1080, 30, 8_000_000)
        );
    }

    fn ms(base: Instant, n: u64) -> Instant {
        base + Duration::from_millis(n)
    }

    #[test]
    fn first_change_applies_immediately() {
        let t0 = Instant::now();
        let mut d = ResizeDebouncer::new((1920, 1080));
        assert_eq!(d.observe((1920, 1080), t0), None);
        assert_eq!(d.observe((1280, 720), t0), Some((1280, 720)));
        assert_eq!(d.applied(), (1280, 720));
    }

    #[test]
    fn drag_resize_is_coalesced_until_stable() {
        let t0 = Instant::now();
        let mut d = ResizeDebouncer::new((1000, 800));
        assert_eq!(d.observe((1010, 800), t0), Some((1010, 800)));
        // A drag: a new size every 16 ms. None apply inside the quiet window.
        for i in 1..=6u64 {
            assert_eq!(d.observe((1010 + i as u32 * 10, 800), ms(t0, i * 16)), None);
        }
        assert!(d.is_pending());
        // Still moving recently: not yet.
        assert_eq!(d.poll(ms(t0, 96 + 100)), None);
        // Quiet for 200 ms after the last change: apply the final size once.
        assert_eq!(d.poll(ms(t0, 96 + 200)), Some((1070, 800)));
        assert!(!d.is_pending());
        assert_eq!(d.poll(ms(t0, 1000)), None);
    }

    #[test]
    fn continuous_resize_applies_at_most_every_max_wait() {
        let t0 = Instant::now();
        let mut d = ResizeDebouncer::new((1000, 800));
        assert_eq!(d.observe((1001, 800), t0), Some((1001, 800)));
        let mut applied = Vec::new();
        for i in 1..=125u64 {
            // 16 ms cadence for 2 s, never quiet.
            if let Some(dims) = d.observe((1001 + i as u32, 800), ms(t0, i * 16)) {
                applied.push((i * 16, dims));
            }
        }
        assert!(!applied.is_empty(), "max_wait must force progress");
        assert!(
            applied.len() <= 2,
            "at most one apply per max_wait: {applied:?}"
        );
    }

    #[test]
    fn bouncing_back_cancels_the_pending_change() {
        let t0 = Instant::now();
        let mut d = ResizeDebouncer::new((1000, 800));
        assert_eq!(d.observe((1200, 800), t0), Some((1200, 800)));
        assert_eq!(d.observe((1300, 800), ms(t0, 10)), None);
        assert_eq!(d.observe((1200, 800), ms(t0, 20)), None);
        assert!(!d.is_pending());
        assert_eq!(d.poll(ms(t0, 1000)), None);
    }

    #[test]
    fn a_change_after_a_quiet_period_is_leading_edge_again() {
        let t0 = Instant::now();
        let mut d = ResizeDebouncer::new((1000, 800));
        assert_eq!(d.observe((1200, 800), t0), Some((1200, 800)));
        assert_eq!(d.observe((1300, 900), ms(t0, 500)), Some((1300, 900)));
    }
}
