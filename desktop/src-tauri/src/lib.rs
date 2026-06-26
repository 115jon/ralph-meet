// ── Ralph Meet Desktop — Tauri application entry point ──────────────────
//
// Module layout:
//   screen_capture  — xcap-based window/monitor enumeration + thumbnails
//   window          — Win32 DWM dark title bar + tray transparency hack
//   tray            — System tray icon, menu, and event handlers
//   permissions     — WebView2 media permission auto-granting (non-CEF only)
//
// Native-share feature layers (Req 12.2, 12.5):
//   `native-screen-share`  — the WGC native share pipeline (d3d_device,
//                            ring_buffer, wgc_capture, wmf_encoder,
//                            native_share, game_capture). This is the
//                            guaranteed capture substrate.
//   `game-capture-hook`    — additive, default-OFF zero-copy fast path built
//                            ON TOP of `native-screen-share`. The hook-only
//                            `game_capture` submodules (`inject`, `obs_ipc`,
//                            `blocklist`) and `dx11::GameCaptureHook` are gated
//                            behind it (declared in `game_capture/mod.rs`), so
//                            the feature-OFF build compiles WGC only and never
//                            pulls in the OBS injection/IPC code. The
//                            `get_native_screen_share_stats` command stays
//                            registered under `native-screen-share` either way,
//                            exposing the extended Capture_Status snapshot to
//                            the renderer (Req 14.5).

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
// `pub` so the pure, GPU-/OS-independent `Encoder_Selection` layer
// (`EncoderBackend`, `EncoderCandidate`, `classify_mft`, `select_encoder`) is
// reachable from the integration test crate in `tests/` (e.g.
// tests/prop_encoder_selection.rs, Property 4) without any hardware.
#[cfg(feature = "native-screen-share")]
pub mod wmf_encoder;
// `pub` so the `NativeShareStats` / `NativeShareStatsSnapshot` mapping (and the
// `set_capture_mode` / `record_*` helpers) are reachable from the integration
// test crate in `tests/` (e.g. tests/prop_stats_snapshot.rs, Property 8).
#[cfg(feature = "native-screen-share")]
pub mod native_share;
// `game_capture` itself is part of the `native-screen-share` pipeline (it hosts
// the pure, GPU-independent capture-mode selection core). Its hook-only
// submodules — `inject`, `obs_ipc`, `blocklist`, and `dx11::GameCaptureHook` —
// are further gated behind `game-capture-hook` inside the module, so the
// feature-OFF build excludes the OBS injection/IPC code and runs WGC only
// (Req 12.2, 12.5).
#[cfg(desktop)]
mod app_updates;
#[cfg(feature = "native-screen-share")]
pub mod game_capture;
mod hardware_encoder;
mod media_devices;
mod permissions;
mod screen_capture;
mod tray;
mod window;
mod window_icon;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

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

#[derive(Clone, serde::Deserialize)]
struct PersistedWindowStateEntry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    #[serde(default)]
    maximized: bool,
    #[serde(default)]
    fullscreen: bool,
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
    let path =
        runtime_settings_path().ok_or_else(|| "runtime settings path unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    std::fs::write(path, raw).map_err(|err| err.to_string())
}

pub(crate) fn log_window_state_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>, context: &str) {
    let Some(path) = app
        .path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(".window-state.json"))
    else {
        log::warn!("[WindowState][{context}] app_config_dir unavailable");
        return;
    };

    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let compact = raw.replace('\r', "").replace('\n', " ");
            log::info!(
                "[WindowState][{context}] file={} contents={}",
                path.display(),
                compact
            );
        }
        Err(err) => {
            log::info!(
                "[WindowState][{context}] file={} unreadable={}",
                path.display(),
                err
            );
        }
    }
}

fn read_persisted_window_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> Result<Option<PersistedWindowStateEntry>, String> {
    let Some(path) = app
        .path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(".window-state.json"))
    else {
        return Ok(None);
    };

    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.to_string()),
    };

    let states =
        serde_json::from_str::<std::collections::HashMap<String, PersistedWindowStateEntry>>(&raw)
            .map_err(|err| err.to_string())?;

    Ok(states.get(label).cloned())
}

pub(crate) fn restore_main_window_geometry_from_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    context: &str,
) -> Result<(), String> {
    let Some(state) = read_persisted_window_state(app, "main")? else {
        log::info!("[WindowState][{context}] no saved main window state");
        return Ok(());
    };

    let Some(window) = app.get_webview_window("main") else {
        log::info!("[WindowState][{context}] main window missing");
        return Ok(());
    };

    log::info!(
        "[WindowState][{context}] restoring main x={} y={} width={} height={} maximized={} fullscreen={}",
        state.x,
        state.y,
        state.width,
        state.height,
        state.maximized,
        state.fullscreen
    );

    if !state.fullscreen {
        window
            .set_size(tauri::PhysicalSize::new(state.width, state.height))
            .map_err(|err| err.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(state.x, state.y))
            .map_err(|err| err.to_string())?;
    }

    if state.maximized {
        window.maximize().map_err(|err| err.to_string())?;
    }

    if state.fullscreen {
        window.set_fullscreen(true).map_err(|err| err.to_string())?;
    }

    log_window_snapshot(&window, &format!("{context}:after"));
    Ok(())
}

#[tauri::command]
fn restore_main_window_geometry<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    restore_main_window_geometry_from_state(&app, "command:restore_main_window_geometry")
}

pub(crate) fn log_window_snapshot<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    context: &str,
) {
    let position = window
        .outer_position()
        .map(|pos| format!("{},{}", pos.x, pos.y))
        .unwrap_or_else(|err| format!("err:{err}"));
    let size = window
        .outer_size()
        .map(|size| format!("{}x{}", size.width, size.height))
        .unwrap_or_else(|err| format!("err:{err}"));
    let visible = window
        .is_visible()
        .map(|value| value.to_string())
        .unwrap_or_else(|err| format!("err:{err}"));
    let maximized = window
        .is_maximized()
        .map(|value| value.to_string())
        .unwrap_or_else(|err| format!("err:{err}"));

    log::info!(
        "[WindowState][{context}] label={} visible={} maximized={} pos={} size={}",
        window.label(),
        visible,
        maximized,
        position,
        size
    );
}

fn log_window_snapshot_by_label<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    context: &str,
) {
    if let Some(window) = app.get_webview_window(label) {
        log_window_snapshot(&window, context);
    } else {
        log::info!("[WindowState][{context}] label={} missing", label);
    }
}

fn spawn_window_state_diagnostics<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    reason: &'static str,
) {
    let handle = app.clone();
    let _ = std::thread::Builder::new()
        .name("RalphWindowStateDiag".into())
        .spawn(move || {
            let checkpoints = [
                (0u64, "immediate"),
                (250, "250ms"),
                (1000, "1s"),
                (3000, "3s"),
            ];
            let mut last_delay = 0u64;
            for (delay_ms, label) in checkpoints {
                if delay_ms > last_delay {
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms - last_delay));
                }
                let context = format!("{reason}:{label}");
                log_window_state_file(&handle, &context);
                log_window_snapshot_by_label(&handle, "main", &context);
                log_window_snapshot_by_label(&handle, "updater", &context);
                last_delay = delay_ms;
            }
        });
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
            close_to_tray: AtomicBool::new(false),
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
                // Stamp log entries in the machine's local time rather than UTC,
                // so desktop.log timestamps line up with the wall clock (and the
                // renderer's local-time console logs) instead of being ~hours ahead.
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .level(log::LevelFilter::Info)
                // Suppress xcap's noisy errors from protected system processes.
                .filter(|metadata| !metadata.target().starts_with("xcap"))
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        // tauri_plugin_shell removed: we use tauri_plugin_opener for external links.
        // The shell plugin's IPC invoke handler ran on every message, cloning scope
        // Vec<ScopeAllowedCommand> and hitting windows_registry::OpenOptions::open —
        // profiler showed 13–95% self-time across all threads from this alone.
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
            (
                "--disable-background-networking".to_string(),
                None::<String>,
            ),
            ("--disable-component-update".to_string(), None::<String>),
            ("--disable-default-apps".to_string(), None::<String>),
            ("--no-pings".to_string(), None::<String>),
            // ── WebRTC hardware encoding (legacy flags, belt-and-suspenders) ──────────
            // These tell libwebrtc to prefer HW codecs (NVENC / QuickSync / AMF).
            // `--enable-mf-h264-encoding` activates the MediaFoundation H264 path
            // inside libwebrtc — same path Discord uses via Electron's patched Chromium.
            (
                "--enable-webrtc-hw-h264-encoding".to_string(),
                None::<String>,
            ),
            (
                "--enable-webrtc-hw-vp8-encoding".to_string(),
                None::<String>,
            ),
            ("--enable-mf-h264-encoding".to_string(), None::<String>),
            // ── GPU compositor performance ─────────────────────────────────────────────
            // Without these, CEF falls back to software rasterization for compositing,
            // burning CPU in the GPU process even when a discrete GPU is available.
            // Electron enables both by default; our CEF fork does not.
            ("--enable-gpu-rasterization".to_string(), None::<String>),
            ("--enable-zero-copy".to_string(), None::<String>),
            // ── Renderer process: suppress unnecessary background work ─────────────────
            (
                "--disable-backgrounding-occluded-windows".to_string(),
                None::<String>,
            ),
            (
                "--disable-renderer-backgrounding".to_string(),
                None::<String>,
            ),
            (
                "--enable-features".to_string(),
                Some(
                    [
                        // Existing WGC / WebRTC flags
                        "WebRtcAllowInputVolumeAdjustment",
                        "AllowWgcScreenCapturer",
                        "AllowWgcScreenZeroHz",
                        "AllowWgcWindowCapturer",
                        "AllowWgcWindowZeroHz",
                        // Hardware video capture via MediaFoundation — the key flag that
                        // makes CEF’s own WebRTC encode path use GPU hardware (NVENC /
                        // QuickSync / AMF) instead of software libvpx / openh264.
                        // Electron 28+ enables this by default; our CEF fork does not.
                        "MediaFoundationVideoCapture",
                        "MediaFoundationD3D11VideoCapture",
                        // Hardware-accelerated decode in the renderer process.
                        "D3D11VideoDecoder",
                    ]
                    .join(","),
                ),
            ),
        ];
        if !runtime_settings.hardware_acceleration {
            chromium_args.push(("--disable-gpu".to_string(), None::<String>));
        }
        #[cfg(debug_assertions)]
        {
            if let Ok(port) = std::env::var("RALPH_CEF_DEVTOOLS_PORT") {
                chromium_args.push(("--remote-debugging-port".to_string(), Some(port)));
            }
        }
        log::info!("[CEF] Chromium args: {:?}", chromium_args);
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

            // Register the PendingUpdate state used by the fetch_update /
            // install_update commands exposed to the Settings UI.
            #[cfg(desktop)]
            app.manage(app_updates::PendingUpdate::default());

            // Note: The JS UpdateChecker component handles startup update checks
            // (with a 10s delay) and the user-facing toast UI. The Rust commands
            // (fetch_update / install_update) are available for the Settings page.

            // Persist window size & position across restarts
            // Persist window size & position across restarts (but NOT visibility)
            #[cfg(desktop)]
            app.handle()
                .plugin(
                    tauri_plugin_window_state::Builder::default()
                        .with_state_flags(
                            tauri_plugin_window_state::StateFlags::SIZE
                                | tauri_plugin_window_state::StateFlags::POSITION
                                | tauri_plugin_window_state::StateFlags::MAXIMIZED
                                | tauri_plugin_window_state::StateFlags::FULLSCREEN
                        )
                        .build()
                )?;

            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                log_window_state_file(&handle, "setup:after-window-state-plugin");
                if let Err(err) = restore_main_window_geometry_from_state(&handle, "setup:manual-restore") {
                    log::warn!("[WindowState][setup:manual-restore] failed: {err}");
                }
                log_window_snapshot_by_label(&handle, "main", "setup:after-window-state-plugin");
                log_window_snapshot_by_label(&handle, "updater", "setup:after-window-state-plugin");
                spawn_window_state_diagnostics(&handle, "startup");
            }

            // ── System tray ─────────────────────────────────────────────
            #[cfg(desktop)]
            tray::setup_tray(app)?;

            // ── Vulkan capture activation ────────────────────────────────
            // The Vulkan present hook is an implicit Vulkan layer the loader
            // only activates when its manifest is registered (and only at
            // vkCreateInstance time), so register at startup — before any
            // Vulkan game launches — rather than at injection time. Best-effort:
            // failure just means Vulkan games fall back (DX/GL capture is
            // unaffected).
            #[cfg(all(feature = "game-capture-hook", windows))]
            {
                let registered = game_capture::vulkan_layer::ensure_registered();
                log::info!(
                    "[DesktopRuntime] Vulkan implicit-layer registration: {registered} manifest(s) active"
                );
            }

            // Register deep-link schemes with the OS so `ralphmeet://` URLs
            // are routed to this executable. On Windows this writes the
            // HKCU\Software\Classes\ralphmeet registry key. Only needed during
            // development — the installer registers the scheme at install time.
            #[cfg(any(target_os = "linux", windows))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    log::warn!("[DesktopRuntime] deep-link register_all failed: {e}");
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
            if matches!(window.label(), "main" | "updater") {
                match event {
                    tauri::WindowEvent::Moved(position) => {
                        log::info!(
                            "[WindowState][event:moved] label={} pos={},{}",
                            window.label(),
                            position.x,
                            position.y
                        );
                    }
                    tauri::WindowEvent::Resized(size) => {
                        log::info!(
                            "[WindowState][event:resized] label={} size={}x{}",
                            window.label(),
                            size.width,
                            size.height
                        );
                    }
                    tauri::WindowEvent::Focused(focused) => {
                        log::info!(
                            "[WindowState][event:focused] label={} focused={}",
                            window.label(),
                            focused
                        );
                    }
                    tauri::WindowEvent::Destroyed => {
                        log::info!("[WindowState][event:destroyed] label={}", window.label());
                    }
                    _ => {}
                }
            }

            if window.label() == "updater" {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    if let Some(main) = window.app_handle().get_webview_window("main") {
                        if let Ok(false) = main.is_visible() {
                            log::info!("[WindowState][updater:destroyed-fallback] showing main after updater closed");
                            let _ = main.show();
                            let _ = main.set_focus();
                            log_window_snapshot(&main, "updater:destroyed-fallback:after");
                        }
                    }
                }
            }

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
            media_devices::get_native_audio_devices,
            media_devices::get_native_video_devices,
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
            native_share::update_native_screen_quality,
            #[cfg(feature = "native-screen-share")]
            native_share::get_native_screen_share_stats,
            #[cfg(feature = "native-screen-share")]
            native_share::start_preview_loopback,
            #[cfg(feature = "native-screen-share")]
            native_share::handle_preview_loopback_answer,
            #[cfg(feature = "native-screen-share")]
            native_share::handle_preview_loopback_ice_candidate,
            #[cfg(feature = "native-screen-share")]
            native_share::stop_preview_loopback,
            get_hardware_acceleration,
            set_hardware_acceleration,
            set_close_to_tray,
            set_start_minimized,
            restore_main_window_geometry,
            window::set_title_bar_dark_mode,
            window::set_taskbar_notification_attention,
            // Updater commands — exposed so the Settings UI can trigger
            // a manual check or display the current update status.
            #[cfg(desktop)]
            app_updates::fetch_update,
            #[cfg(desktop)]
            app_updates::install_update,
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
    log::info!(
        "[Settings] hardware_acceleration = {} (pending restart)",
        enabled
    );
    Ok(())
}
