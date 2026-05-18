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
        (max_width, (h as f64 * ratio) as u32)
    } else {
        (w, h)
    };

    let thumb = image::imageops::resize(img, tw, th, FilterType::Triangle);
    let dynamic = image::DynamicImage::ImageRgba8(thumb);

    let mut buf = Cursor::new(Vec::new());
    dynamic
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .unwrap_or_default();

    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    format!("data:image/jpeg;base64,{}", b64)
}

/// Fast: returns source metadata WITHOUT thumbnails.
/// The frontend calls `get_source_thumbnail` per-source to lazy-load images.
#[tauri::command]
pub async fn get_screen_sources() -> Vec<ScreenSource> {
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

            sources.push(ScreenSource {
                id: format!("window-{}", win_id),
                capture_id: format!("window:{}:0", win_id),
                name: title,
                kind: "window".to_string(),
                thumbnail: String::new(), // loaded async
                app_name,
            });
        }
    }

    sources
}

/// Capture a single source's thumbnail on demand.
/// Called per-source from the frontend after the list is displayed.
#[tauri::command]
pub async fn get_source_thumbnail(source_id: String) -> String {
    if source_id.starts_with("monitor-") {
        let idx: usize = source_id
            .strip_prefix("monitor-")
            .and_then(|s| s.parse().ok())
            .unwrap_or(usize::MAX);

        if let Ok(monitors) = xcap::Monitor::all() {
            if let Some(monitor) = monitors.get(idx) {
                if let Ok(img) = monitor.capture_image() {
                    return image_to_base64_thumbnail(&img, 320);
                }
            }
        }
    } else if source_id.starts_with("window-") {
        let target_id: u32 = source_id
            .strip_prefix("window-")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        if let Ok(windows) = xcap::Window::all() {
            for window in windows {
                if window.id().unwrap_or(0) == target_id {
                    if let Ok(img) = window.capture_image() {
                        return image_to_base64_thumbnail(&img, 320);
                    }
                    break;
                }
            }
        }
    }

    String::new()
}
