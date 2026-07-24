// ── System tray setup ───────────────────────────────────────────────────
//
// Creates the system tray icon with a right-click context menu
// (Show / Quit) and left-click-to-show behavior.
//
// Uses the Win32 window helpers from `crate::window` for the CEF
// transparency hack (make_window_invisible / restore_window_visibility).

use std::{
    sync::atomic::Ordering,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager};

// ── Runtime type (must match lib.rs) ────────────────────────────────────
#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

const TRAY_ACTIVATION_DEBOUNCE: Duration = Duration::from_millis(500);

fn allow_tray_activation(last_activation: &Mutex<Option<Instant>>) -> bool {
    let now = Instant::now();
    let mut last_activation = last_activation
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if last_activation.is_some_and(|last| now.duration_since(last) < TRAY_ACTIVATION_DEBOUNCE) {
        return false;
    }

    *last_activation = Some(now);
    true
}

fn show_main_window(app: &AppHandle<TauriRuntime>, context: &str) {
    if app
        .state::<crate::DesktopSettings>()
        .shutdown_started
        .load(Ordering::Acquire)
    {
        log::debug!("[Window][{context}] ignored while shutdown is in progress");
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        log::warn!("[Window][{context}] main window missing");
        return;
    };

    #[cfg(target_os = "windows")]
    {
        match window.hwnd() {
            Ok(hwnd) => {
                let hw = windows::Win32::Foundation::HWND(hwnd.0 as _);
                let needs_cef_show = crate::window::restore_window_from_tray(hw);
                if needs_cef_show {
                    let _ = window.show();
                }
                log::debug!("[Window][{context}] restored main window through HWND");
            }
            Err(error) => {
                log::warn!("[Window][{context}] failed to resolve native HWND: {error}");
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        return;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        log::debug!("[Window][{context}] restored main window visibility and focus");
    }
}

/// Build the system tray icon, menu, and event handlers.
pub fn setup_tray(app: &tauri::App<TauriRuntime>) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_i = MenuItem::with_id(app, "show", "Show Ralph Meet", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
    let last_activation = Arc::new(Mutex::new(None));
    let menu_activation = Arc::clone(&last_activation);
    let icon_activation = Arc::clone(&last_activation);

    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Ralph Meet")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if !allow_tray_activation(&menu_activation) {
                    return;
                }
                show_main_window(app, "tray:show");
            }
            "quit" => {
                crate::spawn_app_exit(app, "tray:quit", false);
            }
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            // Left-click → show & focus the window
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if !allow_tray_activation(&icon_activation) {
                    return;
                }
                let app = tray.app_handle();
                show_main_window(&app, "tray:left-click");
            }
        })
        .build(app)?;

    Ok(())
}
