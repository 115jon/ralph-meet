// ── Persisted desktop settings ──────────────────────────────────────────
//
// Rust owns the desktop preferences (open on startup, start minimized, close
// to tray, hardware acceleration, desktop notifications). They live in one
// JSON file next to `.window-state.json`, so they are known at launch before
// any webview loads: CEF reads hardware acceleration before it starts, the
// close interceptor reads close-to-tray, and the launch handoff reads start
// minimized.
//
// The frontend reads them with `get_desktop_settings` and changes them with
// `set_desktop_settings` (a partial patch). On the first launch after the
// file was introduced, `get` reports `persisted: false` and the frontend sends
// the values it kept in localStorage once; see docs/desktop/window-shell.md.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub(crate) const FILE_NAME: &str = "desktop-settings.json";
const LEGACY_RUNTIME_FILE_NAME: &str = "runtime-settings.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopSettings {
    pub open_on_startup: bool,
    pub start_minimized: bool,
    pub close_to_tray: bool,
    pub hardware_acceleration: bool,
    pub desktop_notifications: bool,
    /// Capture games with the game capture hook (the OBS Studio capture hook)
    /// when possible. Off: every share uses window capture (WGC).
    pub game_capture_hook: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            open_on_startup: false,
            start_minimized: false,
            close_to_tray: true,
            hardware_acceleration: true,
            desktop_notifications: true,
            game_capture_hook: true,
        }
    }
}

/// A change from the frontend. Missing fields keep their current value.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettingsPatch {
    pub open_on_startup: Option<bool>,
    pub start_minimized: Option<bool>,
    pub close_to_tray: Option<bool>,
    pub hardware_acceleration: Option<bool>,
    pub desktop_notifications: Option<bool>,
    pub game_capture_hook: Option<bool>,
}

impl DesktopSettings {
    fn apply(mut self, patch: DesktopSettingsPatch) -> Self {
        if let Some(value) = patch.open_on_startup {
            self.open_on_startup = value;
        }
        if let Some(value) = patch.start_minimized {
            self.start_minimized = value;
        }
        if let Some(value) = patch.close_to_tray {
            self.close_to_tray = value;
        }
        if let Some(value) = patch.hardware_acceleration {
            self.hardware_acceleration = value;
        }
        if let Some(value) = patch.desktop_notifications {
            self.desktop_notifications = value;
        }
        if let Some(value) = patch.game_capture_hook {
            self.game_capture_hook = value;
        }
        self
    }
}

/// What `get_desktop_settings` returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettingsSnapshot {
    pub settings: DesktopSettings,
    /// False until the settings file has been written once. The frontend then
    /// migrates its localStorage values with one `set_desktop_settings`.
    pub persisted: bool,
}

/// Only the field the old `runtime-settings.json` held.
#[derive(serde::Deserialize)]
struct LegacyRuntimeSettings {
    hardware_acceleration: Option<bool>,
}

/// Reads the settings file. `None` when it is missing or unreadable, so the
/// caller falls back to defaults and the frontend migration runs.
fn read_settings_file(path: &Path) -> Option<DesktopSettings> {
    let raw = std::fs::read_to_string(path).ok()?;
    match parse_settings(&raw) {
        Ok(settings) => Some(settings),
        Err(err) => {
            log::warn!("[Settings] ignoring {}: {err}", path.display());
            None
        }
    }
}

/// Parses the settings file. Unknown fields are ignored and missing fields
/// take their defaults, so older and newer builds can share the file.
fn parse_settings(raw: &str) -> Result<DesktopSettings, serde_json::Error> {
    serde_json::from_str(raw)
}

fn read_legacy_hardware_acceleration(paths: &[PathBuf]) -> Option<bool> {
    paths.iter().find_map(|path| {
        let raw = std::fs::read_to_string(path).ok()?;
        serde_json::from_str::<LegacyRuntimeSettings>(&raw)
            .ok()?
            .hardware_acceleration
    })
}

/// Loads the settings from `path`, or defaults (with hardware acceleration
/// from the old runtime-settings file) when there is no usable file yet.
fn load(path: Option<&Path>, legacy_runtime_paths: &[PathBuf]) -> DesktopSettingsSnapshot {
    if let Some(settings) = path.and_then(read_settings_file) {
        return DesktopSettingsSnapshot {
            settings,
            persisted: true,
        };
    }

    let mut settings = DesktopSettings::default();
    if let Some(enabled) = read_legacy_hardware_acceleration(legacy_runtime_paths) {
        settings.hardware_acceleration = enabled;
    }
    DesktopSettingsSnapshot {
        settings,
        persisted: false,
    }
}

/// Writes a sibling temp file and renames it over the old one, so a kill
/// mid-write cannot leave a truncated file behind.
fn write_settings_file(path: &Path, settings: &DesktopSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(|err| err.to_string())?;
    std::fs::rename(&tmp, path).map_err(|err| err.to_string())
}

/// The directory that holds the settings file. Computable before the Tauri
/// app exists (CEF needs hardware acceleration first). On Windows this is
/// the same directory as the app config dir (`%APPDATA%\RalphMeet`).
fn settings_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        crate::windows_app_data_root()
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(|base| {
            PathBuf::from(base)
                .join(".config")
                .join(crate::APP_DATA_DIRECTORY_NAME)
        })
    }
}

fn legacy_runtime_settings_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = settings_dir()
        .map(|dir| dir.join(LEGACY_RUNTIME_FILE_NAME))
        .into_iter()
        .collect();

    #[cfg(target_os = "windows")]
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        paths.push(
            PathBuf::from(base)
                .join(crate::LEGACY_WINDOWS_APP_DATA_DIRECTORY_NAME)
                .join(LEGACY_RUNTIME_FILE_NAME),
        );
    }

    paths
}

pub struct DesktopSettingsStore {
    path: Option<PathBuf>,
    state: Mutex<DesktopSettingsSnapshot>,
}

impl DesktopSettingsStore {
    /// Reads the settings file from the app data directory.
    pub fn load() -> Self {
        let path = settings_dir().map(|dir| dir.join(FILE_NAME));
        let snapshot = load(path.as_deref(), &legacy_runtime_settings_paths());
        Self {
            path,
            state: Mutex::new(snapshot),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, DesktopSettingsSnapshot> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn snapshot(&self) -> DesktopSettingsSnapshot {
        *self.lock()
    }

    pub fn settings(&self) -> DesktopSettings {
        self.lock().settings
    }

    /// Applies `patch`, runs the side effects of what changed, and persists.
    fn update<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        patch: DesktopSettingsPatch,
    ) -> Result<DesktopSettings, String> {
        let mut state = self.lock();
        let previous = state.settings;
        let next = previous.apply(patch);

        if next.open_on_startup != previous.open_on_startup {
            apply_open_on_startup(app, next.open_on_startup)?;
        }

        // The Vulkan capture layer is registered only while the hook is on.
        #[cfg(all(feature = "game-capture-hook", windows))]
        if next.game_capture_hook != previous.game_capture_hook {
            crate::game_capture::vulkan_layer::spawn_sync(crate::native_share::hook_layer_wanted(
                next.game_capture_hook,
            ));
        }

        let path = self
            .path
            .as_deref()
            .ok_or_else(|| "desktop settings path unavailable".to_string())?;
        write_settings_file(path, &next)?;

        state.settings = next;
        state.persisted = true;
        log::info!("[Settings] saved {next:?}");
        Ok(next)
    }
}

impl DesktopSettingsStore {
    /// Brings an existing autostart entry up to the current command (for
    /// example a `Run` value written before `--autostart` existed). Writes
    /// only when open on startup is on and the value differs.
    pub fn repair_autostart_entry(&self) {
        if !self.settings().open_on_startup {
            return;
        }

        #[cfg(target_os = "windows")]
        {
            let desired = match crate::build_windows_startup_command() {
                Ok(command) => command,
                Err(err) => {
                    log::warn!("[Settings] autostart command unavailable: {err}");
                    return;
                }
            };
            let current = read_windows_run_key_value(RUN_VALUE_NAME);
            if !run_value_needs_rewrite(current.as_deref(), &desired) {
                return;
            }
            match set_windows_run_key_value(RUN_VALUE_NAME, Some(&desired)) {
                Ok(()) => log::info!("[Settings] rewrote Run value from {current:?} to {desired}"),
                Err(err) => log::warn!("[Settings] failed to rewrite Run value: {err}"),
            }
        }
    }
}

/// True when the stored `Run` command is missing or differs (ignoring ASCII
/// case, as Windows paths do) from the one this build writes.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn run_value_needs_rewrite(current: Option<&str>, desired: &str) -> bool {
    !current.is_some_and(|current| current.trim().eq_ignore_ascii_case(desired))
}

/// Writes or deletes the autostart entry. Called only when the value changes.
fn apply_open_on_startup<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let command = if enabled {
            Some(crate::build_windows_startup_command()?)
        } else {
            None
        };
        set_windows_run_key_value(RUN_VALUE_NAME, command.as_deref())?;
        match command {
            Some(command) => log::info!("[Settings] open_on_startup = true command={command}"),
            None => log::info!("[Settings] open_on_startup = false"),
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let autolaunch = app.autolaunch();
        let result = if enabled {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        result.map_err(|err| err.to_string())
    }
}

#[cfg(target_os = "windows")]
const RUN_VALUE_NAME: &str = "RalphMeet";
#[cfg(target_os = "windows")]
const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// The `Run` value's string, or `None` when it is missing or not a string.
#[cfg(target_os = "windows")]
fn read_windows_run_key_value(value_name: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

    let subkey = HSTRING::from(RUN_SUBKEY);
    let value_name = HSTRING::from(value_name);
    let mut size: u32 = 0;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            &subkey,
            &value_name,
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut size),
        )
    };
    if status != ERROR_SUCCESS || size == 0 {
        return None;
    }

    let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            &subkey,
            &value_name,
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
}

#[cfg(target_os = "windows")]
fn set_windows_run_key_value(value_name: &str, command: Option<&str>) -> Result<(), String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    let subkey = HSTRING::from(RUN_SUBKEY);
    let mut key = HKEY::default();
    let open = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    };
    if open != ERROR_SUCCESS {
        return Err(format!("RegCreateKeyExW failed: {}", open.0));
    }

    let value_name = HSTRING::from(value_name);
    let result = match command {
        Some(command) => {
            let encoded: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes = unsafe {
                std::slice::from_raw_parts(
                    encoded.as_ptr() as *const u8,
                    encoded.len() * std::mem::size_of::<u16>(),
                )
            };
            unsafe {
                RegSetValueExW(
                    key,
                    PCWSTR(value_name.as_ptr()),
                    Some(0),
                    REG_SZ,
                    Some(bytes),
                )
            }
        }
        None => unsafe { RegDeleteValueW(key, PCWSTR(value_name.as_ptr())) },
    };

    unsafe {
        let _ = RegCloseKey(key);
    }

    if result == ERROR_SUCCESS || result == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(format!(
            "{} failed: {}",
            if command.is_some() {
                "RegSetValueExW"
            } else {
                "RegDeleteValueW"
            },
            result.0
        ))
    }
}

// ── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_desktop_settings(
    store: tauri::State<'_, DesktopSettingsStore>,
) -> DesktopSettingsSnapshot {
    store.snapshot()
}

/// Applies a partial change and returns the full settings now in effect.
/// Hardware acceleration takes effect on the next launch.
#[tauri::command]
pub fn set_desktop_settings(
    app: tauri::AppHandle<crate::TauriRuntime>,
    store: tauri::State<'_, DesktopSettingsStore>,
    patch: DesktopSettingsPatch,
) -> Result<DesktopSettings, String> {
    store.update(&app, patch)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ralph-desktop-settings-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_loads_defaults_as_not_persisted() {
        let dir = temp_dir("missing");
        let snapshot = load(Some(&dir.join(FILE_NAME)), &[]);
        assert_eq!(snapshot.settings, DesktopSettings::default());
        assert!(!snapshot.persisted);
        assert!(snapshot.settings.close_to_tray);
        assert!(snapshot.settings.hardware_acceleration);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_takes_hardware_acceleration_from_legacy_runtime_file() {
        let dir = temp_dir("legacy");
        let legacy = dir.join(LEGACY_RUNTIME_FILE_NAME);
        std::fs::write(&legacy, r#"{ "hardware_acceleration": false }"#).unwrap();
        let snapshot = load(
            Some(&dir.join(FILE_NAME)),
            &[dir.join("absent.json"), legacy],
        );
        assert!(!snapshot.persisted);
        assert!(!snapshot.settings.hardware_acceleration);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn existing_file_wins_over_legacy_runtime_file() {
        let dir = temp_dir("existing");
        let path = dir.join(FILE_NAME);
        let legacy = dir.join(LEGACY_RUNTIME_FILE_NAME);
        std::fs::write(&legacy, r#"{ "hardware_acceleration": false }"#).unwrap();
        std::fs::write(&path, r#"{ "startMinimized": true }"#).unwrap();
        let snapshot = load(Some(&path), &[legacy]);
        assert!(snapshot.persisted);
        assert!(snapshot.settings.start_minimized);
        assert!(snapshot.settings.hardware_acceleration);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_is_treated_as_not_persisted() {
        let dir = temp_dir("corrupt");
        let path = dir.join(FILE_NAME);
        std::fs::write(&path, "{ not json").unwrap();
        let snapshot = load(Some(&path), &[]);
        assert!(!snapshot.persisted);
        assert_eq!(snapshot.settings, DesktopSettings::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_ignores_unknown_fields_and_defaults_missing_ones() {
        let settings = parse_settings(
            r#"{ "closeToTray": false, "someFutureSetting": 3, "openOnStartup": true }"#,
        )
        .unwrap();
        assert_eq!(
            settings,
            DesktopSettings {
                open_on_startup: true,
                close_to_tray: false,
                ..DesktopSettings::default()
            }
        );
    }

    #[test]
    fn parse_rejects_wrong_types() {
        assert!(parse_settings(r#"{ "closeToTray": "yes" }"#).is_err());
    }

    #[test]
    fn patch_changes_only_given_fields() {
        let patch: DesktopSettingsPatch =
            serde_json::from_str(r#"{ "startMinimized": true }"#).unwrap();
        let next = DesktopSettings::default().apply(patch);
        assert_eq!(
            next,
            DesktopSettings {
                start_minimized: true,
                ..DesktopSettings::default()
            }
        );
    }

    #[test]
    fn write_then_load_round_trips_and_leaves_no_temp_file() {
        let dir = temp_dir("roundtrip");
        let path = dir.join(FILE_NAME);
        let settings = DesktopSettings {
            open_on_startup: true,
            start_minimized: true,
            close_to_tray: false,
            hardware_acceleration: false,
            desktop_notifications: false,
            game_capture_hook: false,
        };
        write_settings_file(&path, &settings).unwrap();
        // Overwrite once more: rename must replace the existing file.
        write_settings_file(&path, &settings).unwrap();
        let snapshot = load(Some(&path), &[]);
        assert!(snapshot.persisted);
        assert_eq!(snapshot.settings, settings);
        assert!(!path.with_extension("json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_value_is_rewritten_only_when_it_differs() {
        let desired = r#""C:\RalphMeet\RalphMeet.exe" --autostart"#;
        assert!(!run_value_needs_rewrite(Some(desired), desired));
        assert!(!run_value_needs_rewrite(
            Some(r#""c:\ralphmeet\RalphMeet.exe" --autostart"#),
            desired
        ));
        assert!(run_value_needs_rewrite(
            Some(r#""C:\RalphMeet\RalphMeet.exe""#),
            desired
        ));
        assert!(run_value_needs_rewrite(None, desired));
    }

    #[test]
    fn serializes_camel_case_for_the_frontend() {
        let value = serde_json::to_value(DesktopSettingsSnapshot {
            settings: DesktopSettings::default(),
            persisted: false,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "settings": {
                    "openOnStartup": false,
                    "startMinimized": false,
                    "closeToTray": true,
                    "hardwareAcceleration": true,
                    "desktopNotifications": true,
                    "gameCaptureHook": true,
                },
                "persisted": false,
            })
        );
    }
}
