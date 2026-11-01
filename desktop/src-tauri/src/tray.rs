// ── System tray setup ───────────────────────────────────────────────────
//
// Creates the system tray icon with a right-click context menu
// (Show / Quit) and left-click-to-show behavior.
//
// Showing the window goes through `crate::main_window::reveal`, which owns
// the CEF tray state (see main_window.rs).

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

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
                crate::main_window::reveal(app, "tray:show");
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
                crate::main_window::reveal(app, "tray:left-click");
            }
        })
        .build(app)?;

    Ok(())
}
