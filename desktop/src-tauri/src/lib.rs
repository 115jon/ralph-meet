// ── Yap Desktop — Tauri application entry point ──────────────────
//
// Module layout:
//   screen_capture  — xcap-based window/monitor enumeration + thumbnails
//   window          — Win32 DWM dark title bar + tray transparency hack
//   tray            — System tray icon, menu, and event handlers
//   main_window     — Main window visibility, tray state, deep-link routing
//   desktop_settings — Persisted desktop preferences (get/set commands)
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
mod desktop_settings;
#[cfg(feature = "native-screen-share")]
pub mod game_capture;
mod hardware_encoder;
mod main_window;
mod media_devices;
mod occlusion;
mod permissions;
mod screen_capture;
mod thumbnail_toolbar;
mod tray;
mod window;
mod window_icon;
mod window_state;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// Shutdown progress shared by the exit paths (tray quit, close, restart).
pub struct ShutdownState {
    pub shutdown_started: AtomicBool,
    pub exit_requested: AtomicBool,
}

pub(crate) fn shutdown_in_progress<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    app.state::<ShutdownState>()
        .shutdown_started
        .load(Ordering::Acquire)
}

const APP_DATA_DIRECTORY_NAME: &str = "Yap";
/// Ralph Meet's roaming data folder (`%APPDATA%\RalphMeet`), moved into
/// `APP_DATA_DIRECTORY_NAME` before CEF opens the profile (see
/// `move_legacy_app_data`). The installer does the same move.
#[cfg(target_os = "windows")]
const LEGACY_PRODUCT_APP_DATA_DIRECTORY_NAME: &str = "RalphMeet";
/// Marks a launch by the OS autostart entry (the HKCU `Run` value, or the
/// autostart plugin elsewhere). Only such launches honor "start minimized".
/// Relaunches (restart helper, installer) never pass it.
pub(crate) const AUTOSTART_ARG: &str = "--autostart";
const LEGACY_WINDOWS_APP_DATA_DIRECTORY_NAME: &str = "dev.jontitor.ralph-meet";
#[cfg(target_os = "windows")]
const WINDOWS_RESTART_HELPER_ARG: &str = "--ralph-restart-helper";
#[cfg(target_os = "windows")]
const WINDOWS_RESTART_HELPER_POLL_INTERVAL_MS: u64 = 150;
#[cfg(target_os = "windows")]
const WINDOWS_RESTART_HELPER_TIMEOUT_MS: u64 = 10_000;
#[cfg(target_os = "windows")]
const WINDOWS_RESTART_HELPER_SETTLE_DELAY_MS: u64 = 300;
/// The root launcher stub (desktop/launcher), installed by the installer.
#[cfg(target_os = "windows")]
const WINDOWS_ROOT_STUB_FILE_NAME: &str = "Yap.exe";
/// Same as `identifier` in tauri.conf.json (which the notification plugin uses
/// for toasts) and `RootLauncher.AppUserModelId` in the installer.
#[cfg(target_os = "windows")]
const WINDOWS_APP_USER_MODEL_ID: &str = "com.115jon.yap";

#[cfg(target_os = "windows")]
pub(crate) fn windows_app_data_root() -> Option<std::path::PathBuf> {
    std::env::var_os("APPDATA")
        .map(|base| std::path::PathBuf::from(base).join(APP_DATA_DIRECTORY_NAME))
}

#[cfg(target_os = "windows")]
fn legacy_windows_app_data_roots() -> Vec<std::path::PathBuf> {
    let mut roots = Vec::new();

    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        roots.push(std::path::PathBuf::from(base).join(LEGACY_WINDOWS_APP_DATA_DIRECTORY_NAME));
    }

    if let Some(base) = std::env::var_os("APPDATA") {
        roots.push(std::path::PathBuf::from(base).join(LEGACY_WINDOWS_APP_DATA_DIRECTORY_NAME));
    }

    roots
}

#[cfg(target_os = "windows")]
fn versioned_windows_install_root_from_exe_path(
    exe_path: &std::path::Path,
) -> Option<std::path::PathBuf> {
    let install_dir = exe_path.parent()?;
    let install_dir_name = install_dir.file_name()?.to_string_lossy();
    if !install_dir_name.starts_with("app-") {
        return None;
    }

    install_dir.parent().map(std::path::Path::to_path_buf)
}

/// The installed launcher at the install root: the native `Yap.exe` stub,
/// or `Update.exe` (which needs `--processStart`) for installs made before the
/// stub existed. The bool is true for `Update.exe`. See docs/desktop/launch.md.
#[cfg(target_os = "windows")]
fn windows_root_launcher(root: &std::path::Path) -> Option<(std::path::PathBuf, bool)> {
    let stub = root.join(WINDOWS_ROOT_STUB_FILE_NAME);
    if stub.is_file() {
        return Some((stub, false));
    }

    let update_exe = root.join("Update.exe");
    update_exe.is_file().then_some((update_exe, true))
}

#[cfg(target_os = "windows")]
fn resolve_windows_startup_executable() -> Result<(std::path::PathBuf, bool), String> {
    let current_exe = std::env::current_exe().map_err(|err| err.to_string())?;
    if current_exe
        .file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case("Update.exe"))
        .unwrap_or(false)
    {
        return Ok((current_exe, true));
    }

    if let Some(launcher) = versioned_windows_install_root_from_exe_path(&current_exe)
        .and_then(|root| windows_root_launcher(&root))
    {
        return Ok(launcher);
    }

    Ok((current_exe, false))
}

/// Gives the process the AppUserModelID the installer puts on the Start menu and
/// desktop shortcuts, so the taskbar groups this window with them and a pin made
/// from the running window starts the root stub instead of `app-<version>`. Only
/// for installed builds; dev runs keep the default per-path identity.
#[cfg(target_os = "windows")]
fn set_windows_app_user_model_id() {
    let Ok(current_exe) = std::env::current_exe() else {
        return;
    };
    if versioned_windows_install_root_from_exe_path(&current_exe).is_none() {
        return;
    }

    let app_id = windows::core::HSTRING::from(WINDOWS_APP_USER_MODEL_ID);
    if let Err(err) =
        unsafe { windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(&app_id) }
    {
        eprintln!("[DesktopRuntime] SetCurrentProcessExplicitAppUserModelID failed: {err}");
    }
}

#[cfg(target_os = "windows")]
fn build_windows_startup_command_for_executable(
    executable: &std::path::Path,
    is_update_launcher: bool,
) -> String {
    let mut command = format!("\"{}\"", executable.display());
    for argument in windows_startup_arguments(is_update_launcher) {
        command.push(' ');
        command.push_str(argument);
    }

    command
}

/// Arguments of the autostart (`Run`) command. The legacy `Update.exe`
/// launcher keeps `--processStart` only: it does not forward extra arguments,
/// so start minimized does not apply there.
#[cfg(target_os = "windows")]
fn windows_startup_arguments(is_update_launcher: bool) -> &'static [&'static str] {
    if is_update_launcher {
        &["--processStart", WINDOWS_ROOT_STUB_FILE_NAME]
    } else {
        &[AUTOSTART_ARG]
    }
}

/// Arguments of a relaunch (restart helper). Never `--autostart`: a restart
/// must come back visible.
#[cfg(target_os = "windows")]
fn windows_relaunch_arguments(is_update_launcher: bool) -> &'static [&'static str] {
    if is_update_launcher {
        &["--processStart", WINDOWS_ROOT_STUB_FILE_NAME]
    } else {
        &[]
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn build_windows_startup_command() -> Result<String, String> {
    let (executable, is_update_launcher) = resolve_windows_startup_executable()?;
    Ok(build_windows_startup_command_for_executable(
        &executable,
        is_update_launcher,
    ))
}

#[cfg(target_os = "windows")]
fn parse_windows_restart_helper_parent_pid<I>(args: I) -> Result<Option<u32>, String>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg != WINDOWS_RESTART_HELPER_ARG {
            continue;
        }

        let parent_pid = args
            .next()
            .ok_or_else(|| format!("{WINDOWS_RESTART_HELPER_ARG} missing parent pid"))?;
        let parsed_parent_pid = parent_pid
            .parse::<u32>()
            .map_err(|err| format!("invalid restart helper parent pid `{parent_pid}`: {err}"))?;
        return Ok(Some(parsed_parent_pid));
    }

    Ok(None)
}

#[cfg(target_os = "windows")]
fn wait_for_windows_process_exit(parent_pid: u32) -> Result<(), String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    let deadline = std::time::Instant::now()
        + std::time::Duration::from_millis(WINDOWS_RESTART_HELPER_TIMEOUT_MS);

    std::thread::sleep(std::time::Duration::from_millis(
        WINDOWS_RESTART_HELPER_POLL_INTERVAL_MS,
    ));

    loop {
        match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false.into(), parent_pid) } {
            Ok(handle) => {
                let _ = unsafe { CloseHandle(handle) };
                if std::time::Instant::now() >= deadline {
                    return Err(format!(
                        "timed out waiting for pid {parent_pid} to exit before relaunch"
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(
                    WINDOWS_RESTART_HELPER_POLL_INTERVAL_MS,
                ));
            }
            Err(_) => break,
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(
        WINDOWS_RESTART_HELPER_SETTLE_DELAY_MS,
    ));
    Ok(())
}

#[cfg(target_os = "windows")]
fn launch_windows_restart_target() -> Result<(), String> {
    let (executable, is_update_launcher) = resolve_windows_startup_executable()?;
    std::process::Command::new(&executable)
        .args(windows_relaunch_arguments(is_update_launcher))
        .spawn()
        .map_err(|err| format!("failed to launch {}: {err}", executable.display()))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn spawn_windows_restart_helper(parent_pid: u32) -> Result<u32, String> {
    let current_exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let parent_pid = parent_pid.to_string();
    let helper = std::process::Command::new(&current_exe)
        .arg(WINDOWS_RESTART_HELPER_ARG)
        .arg(parent_pid)
        .spawn()
        .map_err(|err| {
            format!(
                "failed to spawn restart helper {}: {err}",
                current_exe.display()
            )
        })?;
    Ok(helper.id())
}

#[cfg(target_os = "windows")]
fn maybe_run_windows_restart_helper() -> Result<bool, String> {
    let Some(parent_pid) = parse_windows_restart_helper_parent_pid(std::env::args())? else {
        return Ok(false);
    };

    if let Err(err) = wait_for_windows_process_exit(parent_pid) {
        eprintln!("[RestartHelper] {err}");
    }

    launch_windows_restart_target()?;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn should_runtime_register_windows_deep_links() -> bool {
    cfg!(debug_assertions) || std::env::var_os("RALPH_ALLOW_RUNTIME_DEEP_LINK_REGISTER").is_some()
}

#[cfg(target_os = "windows")]
fn migrate_directory_contents(
    source: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    std::fs::create_dir_all(destination).map_err(|err| err.to_string())?;

    for entry in std::fs::read_dir(source).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let entry_path = entry.path();
        let entry_name = entry.file_name();
        let destination_path = destination.join(&entry_name);
        let metadata = entry.metadata().map_err(|err| err.to_string())?;

        if metadata.is_dir() {
            let directory_name = entry_name.to_string_lossy();
            if matches!(directory_name.as_ref(), "cef" | "logs") {
                continue;
            }

            migrate_directory_contents(&entry_path, &destination_path)?;
            continue;
        }

        if destination_path.exists() {
            continue;
        }

        if let Some(parent) = destination_path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        std::fs::copy(&entry_path, &destination_path).map_err(|err| err.to_string())?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn migrate_legacy_windows_app_data() -> Result<(), String> {
    let Some(destination_root) = windows_app_data_root() else {
        return Ok(());
    };

    for legacy_root in legacy_windows_app_data_roots() {
        if legacy_root == destination_root {
            continue;
        }

        migrate_directory_contents(&legacy_root, &destination_root)?;
    }

    Ok(())
}

/// What `migrate_legacy_product_app_data` did, logged once logging is up.
#[cfg(target_os = "windows")]
static LEGACY_PRODUCT_APP_DATA_NOTES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

/// Moves Ralph Meet's data folder into Yap's before CEF opens its profile
/// there, for runs the installer did not migrate (dev builds, portable runs, a
/// failed installer step), so the signed-in session and settings carry over.
#[cfg(target_os = "windows")]
fn migrate_legacy_product_app_data() {
    let Some(base) = std::env::var_os("APPDATA").map(std::path::PathBuf::from) else {
        return;
    };
    let notes = move_legacy_app_data(
        &base.join(LEGACY_PRODUCT_APP_DATA_DIRECTORY_NAME),
        &base.join(APP_DATA_DIRECTORY_NAME),
    );
    let _ = LEGACY_PRODUCT_APP_DATA_NOTES.set(notes);
}

/// The installer's rule (`LegacyCleanup.MigrateUserData`): one rename when
/// `destination` does not exist, otherwise each top-level entry it lacks is
/// moved. An entry `destination` already has stays in `legacy` (never
/// overwritten, never deleted), except the disposable `logs` folder. `legacy`
/// is removed once empty. Returns one note per action.
#[cfg(target_os = "windows")]
fn move_legacy_app_data(legacy: &std::path::Path, destination: &std::path::Path) -> Vec<String> {
    let mut notes = Vec::new();
    if !legacy.is_dir() || legacy == destination {
        return notes;
    }

    if !destination.exists() {
        if let Some(parent) = destination.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::rename(legacy, destination) {
            Ok(()) => {
                notes.push(format!("moved {} to {}", legacy.display(), destination.display()));
                return notes;
            }
            Err(err) => notes.push(format!(
                "could not move {} as a whole ({err}); moving its entries",
                legacy.display()
            )),
        }
    }

    if let Err(err) = std::fs::create_dir_all(destination) {
        notes.push(format!("could not create {}: {err}", destination.display()));
        return notes;
    }

    // The profile (the sign-in) goes first. If it cannot move (Ralph Meet still
    // running), move nothing else either, so the two installs do not end up
    // with half each. CEF then starts a fresh profile here and the old one is
    // kept in place (dev runs only: the installer stops Ralph Meet first).
    let legacy_profile = legacy.join("cef");
    let profile = destination.join("cef");
    if legacy_profile.is_dir() && !profile.exists() {
        match std::fs::rename(&legacy_profile, &profile) {
            Ok(()) => notes.push(format!("moved {} to {}", legacy_profile.display(), profile.display())),
            Err(err) => {
                notes.push(format!(
                    "could not move {} ({err}); left Ralph Meet's data in place",
                    legacy_profile.display()
                ));
                return notes;
            }
        }
    }

    let Ok(entries) = std::fs::read_dir(legacy) else {
        return notes;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let source = entry.path();
        let target = destination.join(&name);
        if target.exists() {
            if name.eq_ignore_ascii_case("logs") {
                let _ = std::fs::remove_dir_all(&source);
            } else {
                notes.push(format!("kept {}: Yap already has its own", source.display()));
            }
            continue;
        }
        match std::fs::rename(&source, &target) {
            Ok(()) => notes.push(format!("moved {} to {}", source.display(), target.display())),
            Err(err) => notes.push(format!("kept {}: {err}", source.display())),
        }
    }

    // Only succeeds once the folder is empty.
    if std::fs::remove_dir(legacy).is_ok() {
        notes.push(format!("removed {}", legacy.display()));
    }
    notes
}

fn claim_shutdown<R: tauri::Runtime>(app: &tauri::AppHandle<R>, context: &'static str) -> bool {
    let settings = app.state::<ShutdownState>();
    if settings.shutdown_started.swap(true, Ordering::AcqRel) {
        log::debug!("[DesktopRuntime][{context}] shutdown already in progress");
        false
    } else {
        true
    }
}

fn spawn_app_exit_claimed<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    context: &'static str,
    restart: bool,
) {
    let watchdog_app = app.clone();
    let _ = std::thread::Builder::new()
        .name("RalphExitWatchdog".into())
        .spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let settings = watchdog_app.state::<ShutdownState>();
            if !settings.exit_requested.swap(true, Ordering::AcqRel) {
                log::warn!(
                    "[DesktopRuntime][{context}] shutdown exceeded 5 seconds; forcing application termination"
                );
                if restart {
                    watchdog_app.request_restart();
                } else {
                    watchdog_app.exit(0);
                }
            }
        });

    let app = app.clone();
    let _ = tauri::async_runtime::spawn(async move {
        window_state::save_now(&app);

        #[cfg(feature = "native-screen-share")]
        {
            let state = app.state::<native_share::NativeShareState>();
            let prep = native_share::prepare_native_share_for_update(state.inner()).await;
            log::info!(
                "[DesktopRuntime][{context}] native-share shutdown_required={} hook_related_active={} residual_state_detected={}",
                prep.shutdown_required(),
                prep.hook_related_state_was_active(),
                prep.residual_state_detected(),
            );
        }

        let settings = app.state::<ShutdownState>();
        if !settings.exit_requested.swap(true, Ordering::AcqRel) {
            if restart {
                app.request_restart();
            } else {
                app.exit(0);
            }
        }
    });
}

pub(crate) fn spawn_app_exit<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    context: &'static str,
    restart: bool,
) {
    if claim_shutdown(app, context) {
        spawn_app_exit_claimed(app, context, restart);
    }
}

// ── Runtime type: CEF (Chromium) or Wry (native webview) ────────────────
// When the `cef` feature is enabled, the app uses a full Chromium engine.
// This gives us native getDisplayMedia, consistent WebRTC, and full DevTools.
#[cfg(feature = "cef")]
pub(crate) type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
pub(crate) type TauriRuntime = tauri::Wry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg_attr(feature = "cef", tauri::cef_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    match maybe_run_windows_restart_helper() {
        Ok(true) => return,
        Ok(false) => {}
        Err(err) => {
            eprintln!("[RestartHelper] {err}");
            std::process::exit(1);
        }
    }

    // Before any window exists.
    #[cfg(target_os = "windows")]
    set_windows_app_user_model_id();

    // Before the settings load and CEF opens its profile in %APPDATA%\Yap.
    #[cfg(target_os = "windows")]
    migrate_legacy_product_app_data();

    // Install the rustls ring crypto provider before anything touches TLS.
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Read before any window or webview exists: CEF needs hardware
    // acceleration, the launch needs start minimized and close to tray.
    let desktop_settings = desktop_settings::DesktopSettingsStore::load();
    #[cfg(feature = "cef")]
    let hardware_acceleration = desktop_settings.settings().hardware_acceleration;

    let mut builder = tauri::Builder::<TauriRuntime>::default()
        .manage(ShutdownState {
            shutdown_started: AtomicBool::new(false),
            exit_requested: AtomicBool::new(false),
        })
        .manage(desktop_settings)
        .manage(main_window::MainWindowState::from_env())
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
            // ── Renderer process priority ──────────────────────────────────────────────
            // Keep the renderer's process priority up under game CPU load (WebRTC
            // jitter). Occlusion backgrounding stays ON: a window covered by a game
            // stops rAF, CSS animations and compositor frames. Voice activity runs
            // in an AudioWorklet (src/lib/voice/vad-processor.worklet.js), which the
            // page's timer throttling cannot slow down.
            (
                "--disable-renderer-backgrounding".to_string(),
                None::<String>,
            ),
            // CEF defaults to INFO logging into debug.log; a multi-hour call should
            // not grow it. Warnings in debug builds, errors only in release.
            (
                "--log-severity".to_string(),
                Some(
                    if cfg!(debug_assertions) {
                        "warning"
                    } else {
                        "error"
                    }
                    .to_string(),
                ),
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
        if !hardware_acceleration {
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
        // A second launch (shortcut, `yap://` or `ralphmeet://` link) reveals this
        // instance's window and routes its link.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            main_window::on_second_instance(app, &argv);
        }));
    }

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Err(err) = migrate_legacy_windows_app_data() {
                log::warn!("[DesktopRuntime] failed to migrate legacy Windows app data: {err}");
            }
            #[cfg(target_os = "windows")]
            for note in LEGACY_PRODUCT_APP_DATA_NOTES.get().into_iter().flatten() {
                log::info!("[DesktopRuntime] Ralph Meet data: {note}");
            }

            if let Ok(log_dir) = app.path().app_log_dir() {
                log::info!(
                    "[Logging] Writing desktop logs to {}",
                    log_dir.join("desktop.log").display()
                );
            }
            // Loaded before the log plugin existed; log it here.
            let settings_store = app.state::<desktop_settings::DesktopSettingsStore>();
            let settings = settings_store.snapshot();
            log::info!(
                "[DesktopRuntime] desktop settings persisted={} {:?} autostart_launch={}",
                settings.persisted,
                settings.settings,
                main_window::launched_by_autostart(std::env::args())
            );
            // Run values written before `--autostart` existed lack the flag.
            settings_store.repair_autostart_entry();

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

            // Restore the main window's size, position and maximized state
            // while it is still hidden. See window_state.rs for why this does
            // not use tauri-plugin-window-state.
            #[cfg(desktop)]
            window_state::restore(app.handle());

            // ── System tray ─────────────────────────────────────────────
            #[cfg(desktop)]
            tray::setup_tray(app)?;

            // ── Vulkan capture layer ─────────────────────────────────────
            // Like OBS, keep the (dormant) OBS-signed Vulkan layer registered
            // while "Game capture hook" is on, so a Vulkan game started
            // before a share can still be captured. This also moves the
            // registration to the pinned version and removes entries left by
            // older versions and the old unsigned layer.
            #[cfg(all(feature = "game-capture-hook", windows))]
            game_capture::vulkan_layer::spawn_sync(native_share::hook_layer_wanted(
                settings.settings.game_capture_hook,
            ));

            // Register deep-link schemes with the OS so `yap://` and
            // `ralphmeet://` URLs are routed to this executable. On Windows this
            // writes the HKCU\Software\Classes\<scheme> keys. Only needed during
            // development — the installer registers the scheme at install time.
            #[cfg(target_os = "linux")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    log::warn!("[DesktopRuntime] deep-link register_all failed: {e}");
                }
            }

            #[cfg(target_os = "windows")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if should_runtime_register_windows_deep_links() {
                    if let Err(e) = app.deep_link().register_all() {
                        log::warn!("[DesktopRuntime] deep-link register_all failed: {e}");
                    }
                } else {
                    log::info!(
                        "[DesktopRuntime] skipping Windows runtime deep-link registration; installer owns the scheme"
                    );
                }
            }

            // Route yap:// and ralphmeet://invite/<code> links (plugin events and the
            // cold-start command line) through the main window owner. Sign-in
            // uses a device code, not a deep link.
            main_window::setup(app);

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
                // The default window icon is the .ico's 32 px entry, which the
                // tray and its unread badge are drawn from. Give the window
                // itself the 256 px art, so the taskbar and Alt+Tab scale down
                // at 125% and above instead of up.
                if let Err(err) = win.set_icon(tauri::include_image!("icons/128x128@2x.png")) {
                    log::warn!("[Window] failed to set the 256px window icon: {err}");
                }
            }

            #[cfg(target_os = "windows")]
            thumbnail_toolbar::setup_taskbar_thumbnail_toolbar(app)?;

            // ── Occlusion signal (rm://occlusion) for useAppActive() ────
            {
                #[cfg(target_os = "windows")]
                let main_hwnd = app
                    .get_webview_window("main")
                    .and_then(|win| win.hwnd().ok())
                    .map(|hwnd| hwnd.0 as isize)
                    .unwrap_or(0);
                #[cfg(not(target_os = "windows"))]
                let main_hwnd = 0isize;
                occlusion::start(app.handle(), main_hwnd);
            }

            Ok(())
        })
        // ── Minimize to tray on close ────────────────────────────────────
        // CEF runtime limitations: hide() kills msg loop, minimize() crashes GPU
        // at 0x80000003, and set_skip_taskbar() is unimplemented.
        // See main_window.rs and window::make_window_invisible().
        .on_window_event(|window, event| {
            if matches!(window.label(), "main" | "updater") {
                match event {
                    tauri::WindowEvent::Moved(position) => {
                        if window.label() == "main" {
                            window_state::schedule_save(window.app_handle());
                        }
                        log::info!(
                            "[WindowState][event:moved] label={} pos={},{}",
                            window.label(),
                            position.x,
                            position.y
                        );
                    }
                    tauri::WindowEvent::Resized(size) => {
                        if window.label() == "main" {
                            window_state::schedule_save(window.app_handle());
                        }
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
                        if window.label() == "main" {
                            occlusion::on_main_focus_changed(*focused);
                        }
                    }
                    tauri::WindowEvent::Destroyed => {
                        log::info!("[WindowState][event:destroyed] label={}", window.label());
                    }
                    _ => {}
                }
            }

            // The updater closed without handing off: run the launch handoff
            // now. It does nothing if the handoff already ran.
            if window.label() == "updater"
                && matches!(event, tauri::WindowEvent::Destroyed)
                && !shutdown_in_progress(window.app_handle())
            {
                if let Err(err) =
                    main_window::complete_launch(window.app_handle(), "updater:destroyed-fallback")
                {
                    log::warn!("[Window][updater:destroyed-fallback] {err}");
                }
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Only intercept close on the main window — let DevTools and
                // other secondary windows close normally.
                if window.label() == "main" {
                    main_window::on_close_requested(window, api);
                }
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
            native_share::stop_preview_loopback,
            restart_app,
            desktop_settings::get_desktop_settings,
            desktop_settings::set_desktop_settings,
            main_window::launch_main_window,
            main_window::take_pending_deep_links,
            close_updater_window,
            thumbnail_toolbar::sync_taskbar_thumbnail_toolbar,
            window::set_title_bar_dark_mode,
            window::start_window_resize,
            window::start_window_drag,
            window::minimize_main_window,
            window::set_maximized_main_window,
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

// ── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn close_updater_window(app: tauri::AppHandle<TauriRuntime>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("updater") {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle<TauriRuntime>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if !claim_shutdown(&app, "restart") {
            return Ok(());
        }
        let parent_pid = std::process::id();
        let helper_pid = match spawn_windows_restart_helper(parent_pid) {
            Ok(pid) => pid,
            Err(error) => {
                app.state::<ShutdownState>()
                    .shutdown_started
                    .store(true, Ordering::Release);
                spawn_app_exit_claimed(&app, "restart-helper-failed", false);
                return Err(error);
            }
        };
        log::info!(
            "[DesktopRuntime] restart requested helper_pid={} parent_pid={}",
            helper_pid,
            parent_pid
        );
        // The external helper owns relaunch on Windows; the parent only exits
        // after native-share cleanup completes.
        spawn_app_exit_claimed(&app, "restart", false);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        spawn_app_exit(&app, "restart", true);
        Ok(())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_startup_registration_tests {
    use super::{
        build_windows_startup_command_for_executable, parse_windows_restart_helper_parent_pid,
        versioned_windows_install_root_from_exe_path, windows_relaunch_arguments,
        windows_root_launcher, WINDOWS_APP_USER_MODEL_ID,
    };
    use std::path::Path;

    #[test]
    fn root_launcher_prefers_stub_then_update_exe() {
        let root = std::env::temp_dir().join(format!("yap-root-launcher-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        assert_eq!(windows_root_launcher(&root), None);

        std::fs::write(root.join("Update.exe"), b"update").unwrap();
        assert_eq!(
            windows_root_launcher(&root),
            Some((root.join("Update.exe"), true))
        );

        std::fs::write(root.join("Yap.exe"), b"stub").unwrap();
        let (launcher, is_update_launcher) = windows_root_launcher(&root).unwrap();
        assert_eq!(launcher, root.join("Yap.exe"));
        assert!(!is_update_launcher);
        assert_eq!(
            build_windows_startup_command_for_executable(&launcher, is_update_launcher),
            format!("\"{}\" --autostart", root.join("Yap.exe").display())
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn app_user_model_id_matches_tauri_identifier() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], WINDOWS_APP_USER_MODEL_ID);
    }

    #[test]
    fn versioned_install_root_resolves_from_app_directory() {
        let root = versioned_windows_install_root_from_exe_path(Path::new(
            r"C:\Users\jon\AppData\Local\Yap\app-1.13.0\Yap.exe",
        ));
        assert_eq!(
            root.as_deref(),
            Some(Path::new(r"C:\Users\jon\AppData\Local\Yap"))
        );
    }

    #[test]
    fn non_versioned_paths_do_not_report_install_root() {
        let root = versioned_windows_install_root_from_exe_path(Path::new(
            r"C:\Users\jon\AppData\Local\Yap\Yap.exe",
        ));
        assert!(root.is_none());
    }

    #[test]
    fn startup_command_targets_stable_update_launcher_when_available() {
        let command = build_windows_startup_command_for_executable(
            Path::new(r"C:\Users\jon\AppData\Local\Yap\Update.exe"),
            true,
        );
        assert_eq!(
            command,
            "\"C:\\Users\\jon\\AppData\\Local\\Yap\\Update.exe\" --processStart Yap.exe"
        );
    }

    #[test]
    fn startup_command_marks_the_stub_launch_as_autostart() {
        let command = build_windows_startup_command_for_executable(
            Path::new(r"C:\Users\jon\AppData\Local\Yap\Yap.exe"),
            false,
        );
        assert_eq!(
            command,
            "\"C:\\Users\\jon\\AppData\\Local\\Yap\\Yap.exe\" --autostart"
        );
    }

    #[test]
    fn relaunch_never_passes_autostart() {
        assert!(windows_relaunch_arguments(false).is_empty());
        assert_eq!(
            windows_relaunch_arguments(true),
            ["--processStart", "Yap.exe"]
        );
    }

    #[test]
    fn restart_helper_parser_ignores_autostart() {
        let parent_pid = parse_windows_restart_helper_parent_pid([
            "Yap.exe".to_string(),
            "--autostart".to_string(),
        ])
        .unwrap();
        assert_eq!(parent_pid, None);
    }

    #[test]
    fn restart_helper_parent_pid_parser_extracts_pid() {
        let parent_pid = parse_windows_restart_helper_parent_pid([
            "Yap.exe".to_string(),
            "--flag".to_string(),
            "--ralph-restart-helper".to_string(),
            "12345".to_string(),
        ])
        .unwrap();
        assert_eq!(parent_pid, Some(12345));
    }

    #[test]
    fn restart_helper_parent_pid_parser_ignores_regular_launches() {
        let parent_pid = parse_windows_restart_helper_parent_pid([
            "Yap.exe".to_string(),
            "--type=gpu-process".to_string(),
        ])
        .unwrap();
        assert_eq!(parent_pid, None);
    }
}

#[cfg(all(test, target_os = "windows"))]
mod legacy_product_app_data_tests {
    use super::move_legacy_app_data;
    use std::path::{Path, PathBuf};

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("yap-legacy-data-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn moves_the_whole_folder_when_yap_has_none() {
        let root = temp_root("whole");
        let (legacy, yap) = (root.join("RalphMeet"), root.join("Yap"));
        write(&legacy.join("cef").join("Network").join("Cookies"), "session");
        write(&legacy.join("desktop-settings.json"), "{}");

        move_legacy_app_data(&legacy, &yap);

        assert!(!legacy.exists());
        assert_eq!(read(&yap.join("cef").join("Network").join("Cookies")), "session");
        assert_eq!(read(&yap.join("desktop-settings.json")), "{}");
        // A second run has nothing left to do.
        assert!(move_legacy_app_data(&legacy, &yap).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn keeps_entries_yap_already_has_and_moves_the_rest() {
        let root = temp_root("merge");
        let (legacy, yap) = (root.join("RalphMeet"), root.join("Yap"));
        write(&yap.join("cef").join("Preferences"), "yap");
        write(&yap.join("logs").join("installer").join("a.log"), "new");
        write(&legacy.join("cef").join("Preferences"), "ralph");
        write(&legacy.join("logs").join("installer").join("a.log"), "old");
        write(&legacy.join(".window-state.json"), "{}");

        move_legacy_app_data(&legacy, &yap);

        assert_eq!(read(&yap.join("cef").join("Preferences")), "yap");
        assert_eq!(read(&legacy.join("cef").join("Preferences")), "ralph");
        assert_eq!(read(&yap.join(".window-state.json")), "{}");
        assert_eq!(read(&yap.join("logs").join("installer").join("a.log")), "new");
        assert!(!legacy.join("logs").exists());
        assert!(legacy.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn moves_nothing_while_the_legacy_profile_is_locked() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = temp_root("locked");
        let (legacy, yap) = (root.join("RalphMeet"), root.join("Yap"));
        write(&yap.join("logs").join("installer").join("a.log"), "new");
        let cookies = legacy.join("cef").join("Network").join("Cookies");
        write(&cookies, "session");
        write(&legacy.join("desktop-settings.json"), "{}");

        // FILE_SHARE_READ only: like a running CEF holding its profile.
        let handle = std::fs::OpenOptions::new().read(true).share_mode(1).open(&cookies).unwrap();
        move_legacy_app_data(&legacy, &yap);
        drop(handle);

        assert_eq!(read(&legacy.join("desktop-settings.json")), "{}");
        assert!(!yap.join("cef").exists());
        assert!(!yap.join("desktop-settings.json").exists());

        move_legacy_app_data(&legacy, &yap);
        assert_eq!(read(&yap.join("cef").join("Network").join("Cookies")), "session");
        assert_eq!(read(&yap.join("desktop-settings.json")), "{}");
        assert!(!legacy.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn does_nothing_without_a_legacy_folder() {
        let root = temp_root("none");
        assert!(move_legacy_app_data(&root.join("RalphMeet"), &root.join("Yap")).is_empty());
        assert!(!root.join("Yap").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
