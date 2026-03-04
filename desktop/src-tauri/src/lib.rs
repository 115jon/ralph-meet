use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;

// ── Runtime type: CEF (Chromium) or Wry (native webview) ────────────────
// When the `cef` feature is enabled, the app uses a full Chromium engine.
// This gives us native getDisplayMedia, consistent WebRTC, and full DevTools.
#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

/// Auto-grant microphone and camera permissions in WebView2.
///
/// WebView2 fires a `PermissionRequested` event when web content calls
/// `getUserMedia()`. Unlike a regular browser, if the host app does NOT
/// handle this event, the request is **silently denied** — no prompt, no
/// error, just a rejected promise.  Without a successful `getUserMedia`
/// call, `enumerateDevices()` returns no usable devices.
///
/// This handler intercepts those events and grants media permissions
/// automatically, which is the expected behavior for a native desktop app.
#[cfg(all(target_os = "windows", not(feature = "cef")))]
fn setup_media_permissions(app: &tauri::App<TauriRuntime>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs,
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(move |webview| {
            unsafe {
                let core = webview.controller().CoreWebView2().unwrap();

                // Create a handler that auto-allows microphone + camera
                let handler = PermissionRequestedEventHandler::create(Box::new(
                    move |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                        if let Some(args) = args {
                            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                            args.PermissionKind(&mut kind)?;
                            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                                || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                            {
                                log::info!(
                                    "[Permissions] Auto-granting media permission (kind={:?})",
                                    kind.0
                                );
                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                            }
                        }
                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                let _ = core.add_PermissionRequested(&handler, &mut token as *mut i64 as *mut _);
                log::info!("[Permissions] WebView2 PermissionRequested handler registered");
            }
        });
    }
}

// ── Screen source enumeration for custom screen picker ──────────────────

#[derive(serde::Serialize, Clone)]
struct ScreenSource {
    id: String,
    name: String,
    kind: String, // "window" or "monitor"
    thumbnail: String, // base64 JPEG (empty on initial list, filled by get_source_thumbnail)
    app_name: String,
}

/// System/helper processes we never want to show in the picker.
const BLOCKED_APP_NAMES: &[&str] = &[
    "Progman",                    // Program Manager (Desktop)
    "TextInputHost",              // Windows IME
    "ApplicationFrameHost",       // UWP frame
    "SystemSettings",             // Settings flyouts
    "ShellExperienceHost",        // Start menu / Action Centre
    "SearchHost",                 // Windows Search
    "LockApp",                    // Lock screen
    "WindowsTerminalService",     // Invisible helpers
    "splwow64",                   // Print spooler
    "dwm",                        // Desktop Window Manager
    "csrss",                      // Client/Server Runtime
    "svchost",                    // Service Host
    "conhost",                    // Console Host
    "taskhostw",                  // Task Host Window
    "RuntimeBroker",              // Runtime Broker
    "backgroundTaskHost",         // Background tasks
    "SearchUI",                   // Cortana
    "StartMenuExperienceHost",    // Start Menu
    "SecurityHealthSystray",      // Windows Security tray
    "Widgets",                    // Widgets panel
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
async fn get_screen_sources() -> Vec<ScreenSource> {
    let mut sources = Vec::new();

    // Enumerate monitors (always fast, no capture)
    if let Ok(monitors) = xcap::Monitor::all() {
        for (i, monitor) in monitors.iter().enumerate() {
            let name = monitor.name().unwrap_or_else(|_| format!("Screen {}", i + 1));
            let is_primary = monitor.is_primary().unwrap_or(false);
            sources.push(ScreenSource {
                id: format!("monitor-{}", i),
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
async fn get_source_thumbnail(source_id: String) -> String {
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

// ── Native screen capture via local WebSocket ───────────────────────────
//
// Bypasses getDisplayMedia() entirely: captures frames natively via xcap,
// encodes as JPEG, and streams them over a local WebSocket as binary messages.
// The frontend connects to ws://127.0.0.1:<port>, receives raw JPEG bytes,
// decodes with createImageBitmap(), draws on canvas → captureStream() for WebRTC.
//
// This is dramatically faster than the old base64-over-IPC approach because:
// 1. Binary WebSocket = no base64 encoding overhead (saves ~33%)
// 2. No JSON serialization of the payload
// 3. Direct ArrayBuffer in the browser — no string parsing

use std::sync::atomic::{AtomicBool, Ordering};

/// Global shutdown signal for the capture server.
static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);

/// Encode an RgbaImage as a raw JPEG byte vector (no base64, no data URL).
fn image_to_jpeg_bytes(img: &image::RgbaImage, max_width: u32) -> Vec<u8> {
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

    let mut buf = Cursor::new(Vec::with_capacity(128 * 1024)); // pre-alloc 128KB
    dynamic
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .unwrap_or_default();

    buf.into_inner()
}

/// Capture a single frame from the given source.
fn capture_frame(source_id: &str) -> Option<image::RgbaImage> {
    if source_id.starts_with("monitor-") {
        let idx = source_id
            .strip_prefix("monitor-")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        xcap::Monitor::all()
            .ok()
            .and_then(|monitors| monitors.get(idx).and_then(|m| m.capture_image().ok()))
    } else if source_id.starts_with("window-") {
        let target_id = source_id
            .strip_prefix("window-")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        xcap::Window::all()
            .ok()
            .and_then(|windows| {
                windows
                    .into_iter()
                    .find(|w| w.id().unwrap_or(0) == target_id)
                    .and_then(|w| w.capture_image().ok())
            })
    } else {
        None
    }
}

/// Start a local WebSocket server that streams screen capture frames as binary JPEG.
/// Returns the port the server is listening on.
#[tauri::command]
async fn start_capture_server(source_id: String, max_width: u32, fps: u32) -> Result<u16, String> {
    // Stop any existing capture
    CAPTURE_RUNNING.store(false, Ordering::SeqCst);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    CAPTURE_RUNNING.store(true, Ordering::SeqCst);

    // Bind to an OS-assigned port on localhost only
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind capture server: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get port: {}", e))?
        .port();

    log::info!(
        "[CaptureServer] Started on port {} for source={} @ {}fps (max_width={})",
        port,
        source_id,
        fps,
        max_width
    );

    // Spawn the server in a background task
    tokio::spawn(async move {
        // Wait for exactly one client to connect
        let stream = tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, addr)) => {
                        log::info!("[CaptureServer] Client connected from {}", addr);
                        stream
                    }
                    Err(e) => {
                        log::error!("[CaptureServer] Accept failed: {}", e);
                        return;
                    }
                }
            }
            _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => {
                log::warn!("[CaptureServer] No client connected within 10s, shutting down");
                CAPTURE_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        // Upgrade TCP to WebSocket
        let ws_stream = match tokio_tungstenite::accept_async(stream).await {
            Ok(ws) => ws,
            Err(e) => {
                log::error!("[CaptureServer] WS handshake failed: {}", e);
                return;
            }
        };

        use futures_util::SinkExt;
        use tokio_tungstenite::tungstenite::Message;

        let (mut ws_tx, _ws_rx) = futures_util::StreamExt::split(ws_stream);
        let interval = std::time::Duration::from_millis(1000 / fps.max(1) as u64);

        while CAPTURE_RUNNING.load(Ordering::SeqCst) {
            let start = tokio::time::Instant::now();

            // Capture on a blocking thread to not stall the tokio runtime
            let sid = source_id.clone();
            let mw = max_width;
            let frame_data = tokio::task::spawn_blocking(move || {
                capture_frame(&sid).map(|img| image_to_jpeg_bytes(&img, mw))
            })
            .await;

            if let Ok(Some(jpeg_bytes)) = frame_data {
                if ws_tx.send(Message::Binary(jpeg_bytes.into())).await.is_err() {
                    log::info!("[CaptureServer] Client disconnected, stopping capture");
                    break;
                }
            }

            let elapsed = start.elapsed();
            if elapsed < interval {
                tokio::time::sleep(interval - elapsed).await;
            }
        }

        log::info!("[CaptureServer] Capture loop ended");
        let _ = ws_tx.close().await;
        CAPTURE_RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(port)
}

/// Stop the capture server and all associated resources.
#[tauri::command]
async fn stop_capture_server() {
    log::info!("[CaptureServer] Stopping capture");
    CAPTURE_RUNNING.store(false, Ordering::SeqCst);
}

/// Clerk publishable key — loaded from .env.local via build.rs.
/// This is a *public* key (pk_...) safe to embed in client code.
const CLERK_PUBLISHABLE_KEY: &str = env!("CLERK_PUBLISHABLE_KEY");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg_attr(feature = "cef", tauri::cef_entry_point)]
pub fn run() {
    // Install the rustls ring crypto provider before anything touches TLS.
    // Without this, reqwest (used by tauri-plugin-clerk) panics with "No provider set".
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::<TauriRuntime>::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        // Clerk auth — requires http + store plugins to be registered first
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_clerk::ClerkPluginBuilder::new()
                .publishable_key(CLERK_PUBLISHABLE_KEY)
                .with_tauri_store() // persist session across restarts
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // When a second instance launches (e.g. from a deep link),
            // forward the URL to the existing instance's webview
            log::info!("Single instance callback, argv: {:?}", argv);
            for arg in &argv {
                if arg.starts_with("ralphmeet://") {
                    log::info!("Deep link from second instance: {}", arg);
                    let _ = app.emit("deep-link", arg.as_str());
                }
            }
            // Focus the main window
            if let Some(window) = app.get_webview_window("main") {
                let _ = tauri::WebviewWindow::set_focus(&window);
            }
        }))
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        // Suppress xcap's noisy errors from protected system processes
                        .filter(|metadata| !metadata.target().starts_with("xcap"))
                        .build(),
                )?;
            }

            // Initialize the updater plugin
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // Persist window size & position across restarts
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_window_state::Builder::default().build())?;

            // ── System tray ─────────────────────────────────────────────
            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let show_i = MenuItem::with_id(app, "show", "Show Ralph Meet", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Ralph Meet")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        // Left-click → show & focus the window
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                // Listen for badge updates from the frontend
                let tray_handle = app.tray_by_id("main").or_else(|| {
                    // TrayIconBuilder without an explicit id uses "main" by default
                    // but fallback to first tray
                    None
                });
                if let Some(tray) = tray_handle {
                    let tray_clone = tray.clone();
                    app.listen("update-tray-badge", move |event| {
                        if let Ok(count) = event.payload().trim_matches('"').parse::<u32>() {
                            let tooltip = if count > 0 {
                                format!("Ralph Meet — {} unread", count)
                            } else {
                                "Ralph Meet".to_string()
                            };
                            let _ = tray_clone.set_tooltip(Some(&tooltip));
                        }
                    });
                }
            }

            // Listen for deep link events (ralphmeet://auth?token=...)
            // and forward them to the webview as a custom event
            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                log::info!("Deep link received: {:?}", event.payload());
                // Forward to all webviews — the frontend handles token extraction
                let _ = handle.emit("deep-link", event.payload());
            });

            // Auto-grant microphone + camera permissions in WebView2
            // (CEF has its own built-in PermissionHandler that auto-approves these)
            #[cfg(all(target_os = "windows", not(feature = "cef")))]
            setup_media_permissions(app);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_screen_sources, get_source_thumbnail, start_capture_server, stop_capture_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
