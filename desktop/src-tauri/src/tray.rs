// ── System tray setup ───────────────────────────────────────────────────
//
// Creates the system tray icon with a right-click context menu
// (Show / Quit) and left-click-to-show behavior.
//
// Uses the Win32 window helpers from `crate::window` for the CEF
// transparency hack (make_window_invisible / restore_window_visibility).

use tauri::Manager;

// ── Runtime type (must match lib.rs) ────────────────────────────────────
#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

/// Build the system tray icon, menu, and event handlers.
pub fn setup_tray(app: &tauri::App<TauriRuntime>) -> Result<(), Box<dyn std::error::Error>> {
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
                    #[cfg(target_os = "windows")]
                    if let Ok(hwnd) = window.hwnd() {
                        let hw = windows::Win32::Foundation::HWND(hwnd.0 as _);
                        crate::window::restore_window_visibility(hw);
                    }
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
                    #[cfg(target_os = "windows")]
                    if let Ok(hwnd) = window.hwnd() {
                        let hw = windows::Win32::Foundation::HWND(hwnd.0 as _);
                        crate::window::restore_window_visibility(hw);
                    }
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
