// ── System tray setup ───────────────────────────────────────────────────
//
// Creates the system tray icon with a right-click context menu
// (Show / Quit) and left-click-to-show behavior.
//
// Uses the Win32 window helpers from `crate::window` for the CEF
// transparency hack (make_window_invisible / restore_window_visibility).

use tauri::image::Image;
use tauri::Listener;
use tauri::Manager;

use crate::DesktopNotificationStatePayload;

// ── Runtime type (must match lib.rs) ────────────────────────────────────
#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

const BADGE_ICON_SIZE: u32 = 64;

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

    // Listen for badge updates from the frontend
    let tray_handle = app.tray_by_id("main").or_else(|| {
        // TrayIconBuilder without an explicit id uses "main" by default
        // but fallback to first tray
        None
    });
    if let Some(tray) = tray_handle {
        let tray_clone = tray.clone();
        let app_handle = app.handle().clone();
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

        let tray_clone = tray.clone();
        app.listen("update-desktop-notification-state", move |event| {
            let payload = event.payload().trim_matches('"');
            let Ok(payload) = serde_json::from_str::<DesktopNotificationStatePayload>(payload)
            else {
                return;
            };

            let tooltip = if payload.tooltip.is_empty() {
                "Ralph Meet".to_string()
            } else {
                payload.tooltip.clone()
            };
            let _ = tray_clone.set_tooltip(Some(&tooltip));

            if payload.count == 0 && !payload.show_dot {
                if let Some(icon) = app_handle.default_window_icon() {
                    let _ = tray_clone.set_icon(Some(icon.clone()));
                }
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.set_overlay_icon(None);
                }
                return;
            }

            let badge_icon = render_badge_icon(payload.count, payload.show_dot);
            let _ = tray_clone.set_icon(Some(badge_icon.clone()));
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.set_overlay_icon(Some(badge_icon));
            }
        });
    }

    Ok(())
}

fn render_badge_icon(count: u32, show_dot: bool) -> Image<'static> {
    let mut rgba = vec![0u8; (BADGE_ICON_SIZE * BADGE_ICON_SIZE * 4) as usize];
    let size = BADGE_ICON_SIZE as i32;

    let (cx, cy, radius) = if show_dot || count < 10 {
        (size - 18, 18, if show_dot { 10 } else { 16 })
    } else {
        (size - 20, 18, 18)
    };

    fill_circle(&mut rgba, size, cx, cy, radius, [239, 68, 68, 255]);

    if !show_dot && count > 0 {
        let label = if count > 99 {
            "99+".to_string()
        } else {
            count.to_string()
        };
        draw_badge_label(&mut rgba, size, &label, cx, cy);
    }

    Image::new_owned(rgba, BADGE_ICON_SIZE, BADGE_ICON_SIZE)
}

fn fill_circle(rgba: &mut [u8], width: i32, cx: i32, cy: i32, radius: i32, color: [u8; 4]) {
    let height = width;
    let radius_sq = radius * radius;
    for y in 0..height {
        for x in 0..width {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= radius_sq {
                let idx = ((y * width + x) * 4) as usize;
                rgba[idx..idx + 4].copy_from_slice(&color);
            }
        }
    }
}

fn fill_rect(
    rgba: &mut [u8],
    width: i32,
    x: i32,
    y: i32,
    rect_w: i32,
    rect_h: i32,
    color: [u8; 4],
) {
    let height = width;
    let start_x = x.max(0);
    let start_y = y.max(0);
    let end_x = (x + rect_w).min(width);
    let end_y = (y + rect_h).min(height);

    for py in start_y..end_y {
        for px in start_x..end_x {
            let idx = ((py * width + px) * 4) as usize;
            rgba[idx..idx + 4].copy_from_slice(&color);
        }
    }
}

fn draw_badge_label(rgba: &mut [u8], width: i32, label: &str, center_x: i32, center_y: i32) {
    let glyph_width = 6;
    let glyph_height = 10;
    let spacing = 2;
    let total_width = (label.chars().count() as i32 * glyph_width)
        + ((label.chars().count().saturating_sub(1)) as i32 * spacing);
    let mut cursor_x = center_x - (total_width / 2);
    let top_y = center_y - (glyph_height / 2);
    for ch in label.chars() {
        draw_glyph(rgba, width, ch, cursor_x, top_y);
        cursor_x += glyph_width + spacing;
    }
}

fn draw_glyph(rgba: &mut [u8], width: i32, ch: char, x: i32, y: i32) {
    const WHITE: [u8; 4] = [255, 255, 255, 255];
    match ch {
        '0' => {
            fill_rect(rgba, width, x + 1, y, 4, 2, WHITE);
            fill_rect(rgba, width, x, y + 2, 2, 6, WHITE);
            fill_rect(rgba, width, x + 4, y + 2, 2, 6, WHITE);
            fill_rect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
        }
        '1' => {
            fill_rect(rgba, width, x + 2, y, 2, 10, WHITE);
            fill_rect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
        }
        '2' => {
            fill_rect(rgba, width, x + 1, y, 4, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 2, 2, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
            fill_rect(rgba, width, x, y + 6, 2, 2, WHITE);
            fill_rect(rgba, width, x, y + 8, 6, 2, WHITE);
        }
        '3' => {
            fill_rect(rgba, width, x + 1, y, 4, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 2, 2, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 6, 2, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
        }
        '4' => {
            fill_rect(rgba, width, x, y, 2, 6, WHITE);
            fill_rect(rgba, width, x + 4, y, 2, 10, WHITE);
            fill_rect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
        }
        '5' => {
            fill_rect(rgba, width, x, y, 6, 2, WHITE);
            fill_rect(rgba, width, x, y + 2, 2, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 6, 2, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
        }
        '6' => {
            fill_rect(rgba, width, x + 1, y, 4, 2, WHITE);
            fill_rect(rgba, width, x, y + 2, 2, 6, WHITE);
            fill_rect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 6, 2, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
        }
        '7' => {
            fill_rect(rgba, width, x, y, 6, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 2, 2, 8, WHITE);
        }
        '8' => {
            fill_rect(rgba, width, x + 1, y, 4, 2, WHITE);
            fill_rect(rgba, width, x, y + 2, 2, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 2, 2, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
            fill_rect(rgba, width, x, y + 6, 2, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 6, 2, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
        }
        '9' => {
            fill_rect(rgba, width, x + 1, y, 4, 2, WHITE);
            fill_rect(rgba, width, x, y + 2, 2, 2, WHITE);
            fill_rect(rgba, width, x + 4, y + 2, 2, 6, WHITE);
            fill_rect(rgba, width, x + 1, y + 4, 4, 2, WHITE);
            fill_rect(rgba, width, x + 1, y + 8, 4, 2, WHITE);
        }
        '+' => {
            fill_rect(rgba, width, x + 2, y + 1, 2, 8, WHITE);
            fill_rect(rgba, width, x, y + 4, 6, 2, WHITE);
        }
        _ => {}
    }
}
