// ── Ralph Meet Desktop — Tauri application entry point ──────────────────
//
// Module layout:
//   screen_capture  — xcap-based window/monitor enumeration + thumbnails
//   window          — Win32 DWM dark title bar + tray transparency hack
//   tray            — System tray icon, menu, and event handlers
//   permissions     — WebView2 media permission auto-granting (non-CEF only)

mod permissions;
mod screen_capture;
mod tray;
mod window;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;

/// Shared desktop preferences that the frontend can modify.
/// These are checked by the Rust event handlers (e.g. close interceptor).
pub struct DesktopSettings {
    pub close_to_tray: AtomicBool,
    pub start_minimized: AtomicBool,
}

// ── Runtime type: CEF (Chromium) or Wry (native webview) ────────────────
// When the `cef` feature is enabled, the app uses a full Chromium engine.
// This gives us native getDisplayMedia, consistent WebRTC, and full DevTools.
#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

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
        .manage(DesktopSettings {
            close_to_tray: AtomicBool::new(true),
            start_minimized: AtomicBool::new(false),
        })
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            tray::setup_tray(app)?;

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
            permissions::setup_media_permissions(app);

            // ── Dark title bar on startup ────────────────────────────────
            // Default to dark title bar since the app defaults to dark theme.
            // The frontend will sync the actual theme via set_title_bar_dark_mode
            // once next-themes resolves the user's preference.
            #[cfg(target_os = "windows")]
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(hwnd) = win.hwnd() {
                    let hw = windows::Win32::Foundation::HWND(hwnd.0 as _);
                    window::set_dark_title_bar(hw, true);
                }
            }

            Ok(())
        })
        // ── Minimize to tray on close ────────────────────────────────────
        // CEF runtime limitations: hide() kills msg loop, minimize() crashes GPU
        // at 0x80000003, and set_skip_taskbar() is unimplemented.
        // See window::make_window_invisible() for the full explanation.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Only intercept close on the main window — let DevTools and
                // other secondary windows close normally.
                if window.label() != "main" {
                    return;
                }

                // Check if user wants close-to-tray behavior
                let close_to_tray = window
                    .state::<DesktopSettings>()
                    .close_to_tray
                    .load(Ordering::Relaxed);

                if !close_to_tray {
                    // User disabled minimize-to-tray — actually quit the app
                    return;
                }

                api.prevent_close();
                #[cfg(target_os = "windows")]
                if let Ok(hwnd) = window.hwnd() {
                    let hw = windows::Win32::Foundation::HWND(hwnd.0 as _);
                    window::make_window_invisible(hw);
                }
                log::info!("[Window] Close intercepted → became transparent (tray hack)");
            }
        })
        .invoke_handler(tauri::generate_handler![
            screen_capture::get_screen_sources,
            screen_capture::get_source_thumbnail,
            set_close_to_tray,
            set_start_minimized,
            window::set_title_bar_dark_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Desktop settings commands ───────────────────────────────────────────

/// Syncs the "close to tray" preference from the frontend into Rust state.
/// When disabled, the close button actually quits the app instead of hiding.
#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, DesktopSettings>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
    log::info!("[Settings] close_to_tray = {}", enabled);
}

/// Syncs the "start minimized" preference from the frontend into Rust state.
/// Currently read-only on the Rust side — the frontend handles the actual
/// minimization by calling make_window_invisible after startup.
#[tauri::command]
fn set_start_minimized(
    state: tauri::State<'_, DesktopSettings>,
    enabled: bool,
) {
    state.start_minimized.store(enabled, Ordering::Relaxed);
    log::info!("[Settings] start_minimized = {}", enabled);
}
