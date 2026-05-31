// ── Screen source enumeration for custom screen picker ──────────────────
//
// Enumerates windows and monitors via the `xcap` crate and returns metadata
// (title, app name, id) plus on-demand JPEG thumbnails for the frontend
// screen-share picker modal.

#[derive(serde::Serialize, Clone)]
pub struct ScreenSource {
    pub id: String,
    pub capture_id: String,
    pub name: String,
    pub kind: String,      // "window" or "monitor"
    pub thumbnail: String, // base64 JPEG (empty on initial list, filled by get_source_thumbnail)
    pub app_name: String,
    /// base64 PNG data URL of the window's application icon (empty for monitors
    /// or when the window exposes no icon). Populated during enumeration via a
    /// message-free class-icon read so the picker shows real app icons.
    pub icon: String,
}

/// System/helper processes we never want to show in the picker.
const BLOCKED_APP_NAMES: &[&str] = &[
    "Progman",                 // Program Manager (Desktop)
    "TextInputHost",           // Windows IME
    "ApplicationFrameHost",    // UWP frame
    "SystemSettings",          // Settings flyouts
    "ShellExperienceHost",     // Start menu / Action Centre
    "SearchHost",              // Windows Search
    "LockApp",                 // Lock screen
    "WindowsTerminalService",  // Invisible helpers
    "splwow64",                // Print spooler
    "dwm",                     // Desktop Window Manager
    "csrss",                   // Client/Server Runtime
    "svchost",                 // Service Host
    "conhost",                 // Console Host
    "taskhostw",               // Task Host Window
    "RuntimeBroker",           // Runtime Broker
    "backgroundTaskHost",      // Background tasks
    "SearchUI",                // Cortana
    "StartMenuExperienceHost", // Start Menu
    "SecurityHealthSystray",   // Windows Security tray
    "Widgets",                 // Widgets panel
];

/// Window titles that indicate system/invisible windows.
const BLOCKED_TITLES: &[&str] = &[
    "Program Manager",
    "Windows Input Experience",
    "MSCTFIME UI",
    "Default IME",
    "Setup",
];

/// Minimum visible area (width × height) to be considered a real window.
const MIN_AREA: u32 = 200 * 100;

fn is_blocked_window(title: &str, app_name: &str) -> bool {
    // 1. Blocked app name (case-insensitive substring match)
    let app_lower = app_name.to_lowercase();
    for blocked in BLOCKED_APP_NAMES {
        if app_lower.contains(&blocked.to_lowercase()) {
            return true;
        }
    }
    // 2. Blocked title
    for blocked_title in BLOCKED_TITLES {
        if title == *blocked_title {
            return true;
        }
    }
    // 3. Skip our own Tauri window
    if title.contains("Ralph Meet") || app_lower.contains("ralph-meet") {
        return true;
    }
    false
}

/// Capture a thumbnail as a base64-encoded JPEG, resized to fit within max_width.
fn image_to_base64_thumbnail(img: &image::RgbaImage, max_width: u32) -> String {
    use base64::Engine;
    use image::imageops::FilterType;
    use std::io::Cursor;

    let (w, h) = (img.width(), img.height());
    let (tw, th) = if w > max_width {
        let ratio = max_width as f64 / w as f64;
        (max_width, (h as f64 * ratio).round().max(1.0) as u32)
    } else {
        (w, h)
    };

    // Lanczos3 gives noticeably crisper downscaled thumbnails than Triangle for
    // the same source — the user explicitly wants high-quality thumbnails, and
    // the cost difference is negligible at thumbnail sizes.
    let thumb = if (tw, th) != (w, h) {
        image::imageops::resize(img, tw, th, FilterType::Lanczos3)
    } else {
        img.clone()
    };
    let dynamic = image::DynamicImage::ImageRgba8(thumb);

    let mut buf = Cursor::new(Vec::new());
    // Quality-90 JPEG keeps thumbnails sharp without bloating the base64 payload.
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90);
    if dynamic.write_with_encoder(encoder).is_err() {
        return String::new();
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    format!("data:image/jpeg;base64,{}", b64)
}

/// Max thumbnail width in px. Higher than the previous 320 for crisper previews
/// (the user wants high-quality thumbnails); still small enough that the JPEG
/// payload stays modest.
const THUMBNAIL_MAX_WIDTH: u32 = 480;

/// How long a captured thumbnail stays fresh in the cache. The picker re-renders
/// and polls source metadata every few seconds; serving a recent thumbnail from
/// cache instead of re-capturing avoids repeatedly capturing other apps' windows
/// (notably a running game), which is what causes the in-game FPS dip when the
/// picker is open. 4s comfortably covers a picker session's churn while staying
/// fresh enough that window contents are not visibly stale.
const THUMBNAIL_TTL: std::time::Duration = std::time::Duration::from_secs(4);

/// Process-lifetime thumbnail cache keyed by `source_id`. Each entry stores the
/// base64 JPEG and the instant it was captured; entries older than
/// [`THUMBNAIL_TTL`] are recaptured on demand. Capturing a window via xcap is a
/// GDI `PrintWindow`/`BitBlt` that contends with the target app's rendering, so
/// coalescing repeat requests here is the main lever for keeping the picker from
/// dropping a game's FPS.
fn thumbnail_cache(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, (String, std::time::Instant)>> {
    static CACHE: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, (String, std::time::Instant)>>,
    > = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Look up a still-fresh cached thumbnail for `source_id`, if any.
fn cached_thumbnail(source_id: &str) -> Option<String> {
    let cache = thumbnail_cache().lock().ok()?;
    let (thumb, at) = cache.get(source_id)?;
    if at.elapsed() < THUMBNAIL_TTL {
        Some(thumb.clone())
    } else {
        None
    }
}

/// Store a freshly captured thumbnail for `source_id`.
fn store_thumbnail(source_id: &str, thumb: &str) {
    if let Ok(mut cache) = thumbnail_cache().lock() {
        cache.insert(source_id.to_string(), (thumb.to_string(), std::time::Instant::now()));
    }
}

/// Fast: returns source metadata WITHOUT thumbnails.
/// The frontend calls `get_source_thumbnail` per-source to lazy-load images.
///
/// xcap enumeration (`Monitor::all`/`Window::all` + per-window title/app/size
/// queries) is synchronous and can take a few ms to tens of ms, so it runs on a
/// blocking thread to keep the async runtime free for WebRTC signaling and the
/// stats command.
#[tauri::command]
pub async fn get_screen_sources() -> Vec<ScreenSource> {
    tokio::task::spawn_blocking(enumerate_screen_sources)
        .await
        .unwrap_or_default()
}

fn enumerate_screen_sources() -> Vec<ScreenSource> {
    let started_at = std::time::Instant::now();
    let mut sources = Vec::new();

    // Enumerate monitors (always fast, no capture)
    if let Ok(monitors) = xcap::Monitor::all() {
        for (i, monitor) in monitors.iter().enumerate() {
            let name = monitor
                .name()
                .unwrap_or_else(|_| format!("Screen {}", i + 1));
            let is_primary = monitor.is_primary().unwrap_or(false);
            sources.push(ScreenSource {
                id: format!("monitor-{}", i),
                capture_id: format!("screen:{}:0", i),
                name: if is_primary {
                    format!("{} (Primary)", name)
                } else {
                    name
                },
                kind: "monitor".to_string(),
                thumbnail: String::new(), // loaded async
                app_name: String::new(),
                icon: String::new(), // monitors have no app icon
            });
        }
    }

    // Enumerate windows with aggressive filtering
    if let Ok(windows) = xcap::Window::all() {
        for window in windows {
            let title = window.title().unwrap_or_default();
            if title.is_empty() {
                continue;
            }

            let is_minimized = window.is_minimized().unwrap_or(false);
            if is_minimized {
                continue;
            }

            let w = window.width().unwrap_or(0);
            let h = window.height().unwrap_or(0);
            if w * h < MIN_AREA {
                continue;
            }

            // app_name() can fail on protected system processes (GetModuleBaseNameW
            // returns ACCESS_DENIED). That's fine — use empty string and let the
            // title-based filtering catch system windows instead.
            let app_name = window.app_name().unwrap_or_default();

            if is_blocked_window(&title, &app_name) {
                continue;
            }

            let win_id = window.id().unwrap_or(0);

            // Extract the real application icon (message-free class-icon read;
            // empty string when the window exposes none). xcap's window id is
            // the HWND value, which is what the icon resolver needs.
            let icon = crate::window_icon::window_icon_data_url(win_id as isize)
                .unwrap_or_default();

            sources.push(ScreenSource {
                id: format!("window-{}", win_id),
                capture_id: format!("window:{}:0", win_id),
                name: title,
                kind: "window".to_string(),
                thumbnail: String::new(), // loaded async
                app_name,
                icon,
            });
        }
    }

    let monitor_count = sources.iter().filter(|s| s.kind == "monitor").count();
    let window_count = sources.iter().filter(|s| s.kind == "window").count();
    log::info!(
        "[ScreenPicker] Enumerated {} monitors + {} windows in {:?}",
        monitor_count,
        window_count,
        started_at.elapsed()
    );

    sources
}

/// Capture a single source's thumbnail on demand.
///
/// Called per-source from the frontend after the list is displayed. A
/// still-fresh cached thumbnail is returned immediately; otherwise the capture
/// runs on a blocking thread (xcap's window capture is a synchronous GDI
/// `PrintWindow`/`BitBlt`) so it never blocks the shared async runtime that also
/// drives WebRTC signaling and the stats command, and the result is cached for
/// [`THUMBNAIL_TTL`] so repeated requests for the same source (re-open, metadata
/// poll, list re-render) do not re-capture — which is what kept dropping the
/// game's FPS while the picker was open.
#[tauri::command]
pub async fn get_source_thumbnail(source_id: String) -> String {
    // Serve a fresh cached thumbnail without touching the GPU/GDI at all.
    if let Some(cached) = cached_thumbnail(&source_id) {
        return cached;
    }

    // Capture off the async runtime: xcap's capture_image is blocking and
    // GDI-bound, so running it inline would stall other Tauri commands.
    let captured = tokio::task::spawn_blocking(move || capture_thumbnail_blocking(&source_id))
        .await
        .unwrap_or_default();
    captured.unwrap_or_default()
}

/// The blocking capture body for [`get_source_thumbnail`]. Returns `Some(thumb)`
/// on success (and populates the cache) or `None` on failure.
///
/// Prefers **Windows Graphics Capture** (DWM-composited, message-free) so
/// snapshotting a busy game window does not stall its render thread. Falls back
/// to the legacy `xcap` GDI capture only if WGC is unavailable for the source
/// (e.g. a window that refuses WGC), so behavior never regresses.
fn capture_thumbnail_blocking(source_id: &str) -> Option<String> {
    let started_at = std::time::Instant::now();

    // 1. Preferred path: one-shot WGC snapshot (no PrintWindow message pump).
    #[cfg(feature = "native-screen-share")]
    if let Some(thumb) = capture_thumbnail_wgc(source_id) {
        store_thumbnail(source_id, &thumb);
        log::info!(
            "[ScreenPicker] Captured thumbnail (WGC) for {} in {:?}",
            source_id,
            started_at.elapsed()
        );
        return Some(thumb);
    }

    // 2. Fallback: legacy xcap GDI capture (kept so nothing regresses if WGC
    //    refuses a particular source).
    if let Some(thumb) = capture_thumbnail_xcap(source_id) {
        store_thumbnail(source_id, &thumb);
        log::info!(
            "[ScreenPicker] Captured thumbnail (xcap fallback) for {} in {:?}",
            source_id,
            started_at.elapsed()
        );
        return Some(thumb);
    }

    log::warn!(
        "[ScreenPicker] Failed to capture thumbnail for {} in {:?}",
        source_id,
        started_at.elapsed()
    );
    None
}

/// Capture a thumbnail via a one-shot WGC snapshot. Returns `None` if a capture
/// item cannot be created or no frame arrives within the budget.
#[cfg(feature = "native-screen-share")]
fn capture_thumbnail_wgc(source_id: &str) -> Option<String> {
    // Build the WGC capture item for the source.
    let item = if let Some(idx) =
        source_id.strip_prefix("monitor-").and_then(|s| s.parse::<usize>().ok())
    {
        crate::wgc_capture::capture_item_for_monitor_idx(idx).ok()?
    } else if let Some(hwnd) =
        source_id.strip_prefix("window-").and_then(|s| s.parse::<isize>().ok())
    {
        crate::wgc_capture::capture_item_for_hwnd(hwnd).ok()?
    } else {
        return None;
    };

    // 600 ms is generous for a single composited frame while still bounding a
    // source that never produces one (e.g. a fully occluded/minimized window).
    let snap = crate::wgc_capture::capture_wgc_snapshot(
        &item,
        std::time::Duration::from_millis(600),
    )
    .ok()?;

    // WGC gives tightly-packed BGRA; the thumbnail encoder wants an RgbaImage.
    let mut rgba = Vec::with_capacity(snap.bgra.len());
    for px in snap.bgra.chunks_exact(4) {
        rgba.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
    }
    let img: image::RgbaImage = image::ImageBuffer::from_raw(snap.width, snap.height, rgba)?;
    let thumb = image_to_base64_thumbnail(&img, THUMBNAIL_MAX_WIDTH);
    if thumb.is_empty() {
        None
    } else {
        Some(thumb)
    }
}

/// Legacy xcap GDI capture fallback.
fn capture_thumbnail_xcap(source_id: &str) -> Option<String> {
    if let Some(idx) = source_id.strip_prefix("monitor-").and_then(|s| s.parse::<usize>().ok()) {
        if let Ok(monitors) = xcap::Monitor::all() {
            if let Some(monitor) = monitors.get(idx) {
                if let Ok(img) = monitor.capture_image() {
                    return Some(image_to_base64_thumbnail(&img, THUMBNAIL_MAX_WIDTH));
                }
            }
        }
    } else if let Some(target_id) =
        source_id.strip_prefix("window-").and_then(|s| s.parse::<u32>().ok())
    {
        if let Ok(windows) = xcap::Window::all() {
            for window in windows {
                if window.id().unwrap_or(0) == target_id {
                    if let Ok(img) = window.capture_image() {
                        return Some(image_to_base64_thumbnail(&img, THUMBNAIL_MAX_WIDTH));
                    }
                    break;
                }
            }
        }
    }
    None
}
