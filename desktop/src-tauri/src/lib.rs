// ── Ralph Meet Desktop — Tauri application entry point ──────────────────
//
// Module layout:
//   screen_capture  — xcap-based window/monitor enumeration + thumbnails
//   window          — Win32 DWM dark title bar + tray transparency hack
//   tray            — System tray icon, menu, and event handlers
//   permissions     — WebView2 media permission auto-granting (non-CEF only)

// `pub` so the pure, GPU-independent `CompletionOrderModel` (and its
// SlotId/OpId/ReadOutcome types) are reachable from the integration test crate
// in `tests/` (e.g. tests/prop_completion_ordering.rs).
#[cfg(feature = "native-screen-share")]
pub mod d3d_device;
// `pub` so the pure, GPU-independent `RingBuffer<T>` slot state machine is
// reachable from the integration test crate in `tests/` (e.g.
// tests/prop_ring_no_overwrite.rs, prop_ring_exhaustion.rs, prop_ring_realloc.rs).
#[cfg(feature = "native-screen-share")]
pub mod ring_buffer;
// `pub` so the pure, GPU-independent `WgcRetentionTracker` (and its
// FrameToken/RetainOutcome types) are reachable from the integration test crate
// in `tests/` (e.g. tests/prop_wgc_retention.rs, Property 3).
#[cfg(feature = "native-screen-share")]
pub mod wgc_capture;
#[cfg(feature = "native-screen-share")]
mod wmf_encoder;
// `pub` so the `NativeShareStats` / `NativeShareStatsSnapshot` mapping (and the
// `set_capture_mode` / `record_*` helpers) are reachable from the integration
// test crate in `tests/` (e.g. tests/prop_stats_snapshot.rs, Property 8).
#[cfg(feature = "native-screen-share")]
pub mod native_share;
#[cfg(feature = "native-screen-share")]
pub mod game_capture;
mod audio_devices;
mod hardware_encoder;
mod permissions;
mod screen_capture;
mod tray;
mod window;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// Shared desktop preferences that the frontend can modify.
/// These are checked by the Rust event handlers (e.g. close interceptor).
pub struct DesktopSettings {
    pub close_to_tray: AtomicBool,
    pub start_minimized: AtomicBool,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct DesktopRuntimeSettings {
    #[serde(default = "default_hardware_acceleration")]
    hardware_acceleration: bool,
}

fn default_hardware_acceleration() -> bool {
    true
}

impl Default for DesktopRuntimeSettings {
    fn default() -> Self {
        Self {
            hardware_acceleration: true,
        }
    }
}

fn runtime_settings_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA").map(|base| {
            std::path::PathBuf::from(base)
                .join("dev.jontitor.ralph-meet")
                .join("runtime-settings.json")
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(|base| {
            std::path::PathBuf::from(base)
                .join(".config")
                .join("dev.jontitor.ralph-meet")
                .join("runtime-settings.json")
        })
    }
}

fn read_runtime_settings() -> DesktopRuntimeSettings {
    let Some(path) = runtime_settings_path() else {
        return DesktopRuntimeSettings::default();
    };

    let Ok(raw) = std::fs::read_to_string(path) else {
        return DesktopRuntimeSettings::default();
    };

    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_runtime_settings(settings: &DesktopRuntimeSettings) -> Result<(), String> {
    let path = runtime_settings_path().ok_or_else(|| "runtime settings path unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    std::fs::write(path, raw).map_err(|err| err.to_string())
}

// ── Runtime type: CEF (Chromium) or Wry (native webview) ────────────────
// When the `cef` feature is enabled, the app uses a full Chromium engine.
// This gives us native getDisplayMedia, consistent WebRTC, and full DevTools.
#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg_attr(feature = "cef", tauri::cef_entry_point)]
pub fn run() {
    // Install the rustls ring crypto provider before anything touches TLS.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let mut builder = tauri::Builder::<TauriRuntime>::default()
        .manage(DesktopSettings {
            close_to_tray: AtomicBool::new(true),
            start_minimized: AtomicBool::new(false),
        })
        .plugin(
            tauri_plugin_log::Builder::default()
                .clear_targets()
                .targets([
                    #[cfg(debug_assertions)]
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("desktop".into()),
                    }),
                ])
                .rotation_strategy(RotationStrategy::KeepSome(5))
                .level(log::LevelFilter::Info)
                // Suppress xcap's noisy errors from protected system processes.
                .filter(|metadata| !metadata.target().starts_with("xcap"))
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(feature = "native-screen-share")]
    {
        builder = builder.manage(native_share::NativeShareState::default());
    }

    // Apply CEF specific Chromium launch arguments
    // Must be done via Builder::command_line_args because additionalBrowserArgs in tauri.conf is for WebView2!
    #[cfg(feature = "cef")]
    {
        let runtime_settings = read_runtime_settings();
        let mut chromium_args = vec![
            ("--disable-gpu-sandbox".to_string(), None::<String>),
            ("--disable-background-networking".to_string(), None::<String>),
            ("--disable-component-update".to_string(), None::<String>),
            ("--disable-default-apps".to_string(), None::<String>),
            ("--no-pings".to_string(), None::<String>),
            ("--enable-webrtc-hw-h264-encoding".to_string(), None::<String>),
            ("--enable-webrtc-hw-vp8-encoding".to_string(), None::<String>),
            ("--enable-mf-h264-encoding".to_string(), None::<String>),
            (
                "--enable-features".to_string(),
                Some(
                    [
                        "WebRtcAllowInputVolumeAdjustment",
                        "AllowWgcScreenCapturer",
                        "AllowWgcScreenZeroHz",
                        "AllowWgcWindowCapturer",
                        "AllowWgcWindowZeroHz",
                    ]
                    .join(","),
                ),
            ),
        ];
        if !runtime_settings.hardware_acceleration {
            // Discord's hardware-acceleration toggle leaves its native
            // capture-device encode path enabled. CEF's browser compositor is
            // separate: preserving it on this runtime crashes the GPU process
            // before capture starts, so keep the UI path stable while the native
            // capture-device encoder helper owns the performant streaming path.
            chromium_args.push(("--disable-gpu-compositing".to_string(), None::<String>));
        }
        #[cfg(debug_assertions)]
        {
            if let Ok(port) = std::env::var("RALPH_CEF_DEVTOOLS_PORT") {
                chromium_args.push(("--remote-debugging-port".to_string(), Some(port)));
            }
        }
        println!("[CEF] Chromium args: {:?}", chromium_args);
        builder = builder.command_line_args(chromium_args);
    }
    // CEF spawns child processes (renderer, gpu, devtools) using the same executable.
    // If the single instance plugin runs in a child process, it thinks it's a second
    // launch of the app, signals the main process, and terminates itself!
    // This causes DevTools to instantly close.
    let is_cef_child = std::env::args().any(|arg| arg.starts_with("--type="));
    if !is_cef_child {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
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
        }));
    }

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            if let Ok(log_dir) = app.path().app_log_dir() {
                log::info!(
                    "[Logging] Writing desktop logs to {}",
                    log_dir.join("desktop.log").display()
                );
            }
            log::info!(
                "[DesktopRuntime] hardware_acceleration={}",
                read_runtime_settings().hardware_acceleration
            );

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
            audio_devices::get_native_audio_devices,
            screen_capture::get_screen_sources,
            screen_capture::get_source_thumbnail,
            hardware_encoder::probe_hardware_video_encoders,
            #[cfg(feature = "native-screen-share")]
            native_share::start_native_screen_share,
            #[cfg(feature = "native-screen-share")]
            native_share::handle_sdp_answer,
            #[cfg(feature = "native-screen-share")]
            native_share::wait_native_screen_share_connected,
            #[cfg(feature = "native-screen-share")]
            native_share::stop_native_screen_share,
            #[cfg(feature = "native-screen-share")]
            native_share::get_native_screen_share_stats,
            get_hardware_acceleration,
            set_hardware_acceleration,
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
fn set_start_minimized(state: tauri::State<'_, DesktopSettings>, enabled: bool) {
    state.start_minimized.store(enabled, Ordering::Relaxed);
    log::info!("[Settings] start_minimized = {}", enabled);
}

#[tauri::command]
fn get_hardware_acceleration() -> bool {
    read_runtime_settings().hardware_acceleration
}

#[tauri::command]
fn set_hardware_acceleration(enabled: bool) -> Result<(), String> {
    let mut settings = read_runtime_settings();
    settings.hardware_acceleration = enabled;
    write_runtime_settings(&settings)?;
    log::info!("[Settings] hardware_acceleration = {} (pending restart)", enabled);
    Ok(())
}

