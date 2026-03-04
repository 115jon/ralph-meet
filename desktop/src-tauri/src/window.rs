// ── Win32 window utilities ──────────────────────────────────────────────
//
// Native Windows API helpers for:
// - Dark/light title bar via DWM (DwmSetWindowAttribute)
// - Invisible "tray hack" window style manipulation
//
// All functions are `#[cfg(target_os = "windows")]` gated.

use tauri::Manager;

// ── Runtime type (must match lib.rs) ────────────────────────────────────
#[cfg(feature = "cef")]
type TauriRuntime = tauri::Cef;
#[cfg(not(feature = "cef"))]
type TauriRuntime = tauri::Wry;

// ── Dark title bar ──────────────────────────────────────────────────────

/// Apply dark or light title bar paint via the Windows DWM API.
///
/// Uses `DWMWA_USE_IMMERSIVE_DARK_MODE` (attribute 20), supported on:
///   - Windows 10 version 2004 (build 19041) and later
///   - All Windows 11 versions
///
/// On older builds this is a harmless no-op (DwmSetWindowAttribute returns
/// an error that we silently ignore).
#[cfg(target_os = "windows")]
pub fn set_dark_title_bar(hwnd: windows::Win32::Foundation::HWND, dark: bool) {
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};

    unsafe {
        let value: i32 = if dark { 1 } else { 0 };
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &value as *const i32 as *const _,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

/// Tauri command: called from the frontend whenever the theme changes.
/// Applies the corresponding dark/light title bar to the main window.
#[tauri::command]
pub async fn set_title_bar_dark_mode(
    app: tauri::AppHandle<TauriRuntime>,
    dark: bool,
) {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(hwnd) = window.hwnd() {
                let hw = windows::Win32::Foundation::HWND(hwnd.0 as _);
                set_dark_title_bar(hw, dark);
                // Force an immediate repaint of the title bar.
                // DwmSetWindowAttribute updates the internal state but Windows
                // won't repaint the non-client area until a focus/activation
                // event. Toggling WM_NCACTIVATE (deactivate → reactivate)
                // forces Windows to redraw the title bar with the new colors.
                // This is the same approach Chrome and Electron use.
                unsafe {
                    use windows::Win32::UI::WindowsAndMessaging::SendMessageW;
                    use windows::Win32::Foundation::{WPARAM, LPARAM};
                    const WM_NCACTIVATE: u32 = 0x0086;
                    // Deactivate then reactivate the non-client area
                    let _ = SendMessageW(hw, WM_NCACTIVATE, Some(WPARAM(0)), Some(LPARAM(0)));
                    let _ = SendMessageW(hw, WM_NCACTIVATE, Some(WPARAM(1)), Some(LPARAM(0)));
                }
                log::info!("[Window] Title bar dark mode set to: {}", dark);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, dark);
    }
}

// ── Tray transparency hack ──────────────────────────────────────────────

/// Make the window invisible but keep it painted (CEF tray workaround).
///
/// CEF crashes or freezes with standard minimize/hide flows. This hack:
/// 1. Replaces `WS_EX_APPWINDOW` with `WS_EX_TOOLWINDOW` to drop from taskbar
/// 2. Adds `WS_EX_LAYERED` with alpha=0 for mathematical invisibility
/// 3. Adds `WS_EX_TRANSPARENT` so clicks pass through
#[cfg(target_os = "windows")]
pub fn make_window_invisible(hwnd: windows::Win32::Foundation::HWND) {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
            WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_LAYERED, WS_EX_TRANSPARENT,
            SetLayeredWindowAttributes, LWA_ALPHA,
        };
        let mut style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // Convert to invisible tool window
        style &= !(WS_EX_APPWINDOW.0 as isize);
        style |= (WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as isize;
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
        // Make completely transparent (invisible) but mathematically still painted
        let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 0, LWA_ALPHA);
    }
}

/// Restore a window from the invisible tray-hack state.
///
/// Strips `WS_EX_TOOLWINDOW`, `WS_EX_LAYERED`, and `WS_EX_TRANSPARENT`,
/// restores `WS_EX_APPWINDOW`, and sets alpha back to 255 (fully opaque).
#[cfg(target_os = "windows")]
pub fn restore_window_visibility(hwnd: windows::Win32::Foundation::HWND) {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
            WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_LAYERED, WS_EX_TRANSPARENT,
            SetLayeredWindowAttributes, LWA_ALPHA,
        };
        let mut style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // Remove tool window, layered, and transparent styles
        style &= !((WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as isize);
        // Restore app window style
        style |= WS_EX_APPWINDOW.0 as isize;
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
        // Restore full opacity
        let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 255, LWA_ALPHA);
    }
}
