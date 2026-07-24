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

/// Force the title bar to repaint after a DWM attribute change.
///
/// CEF intercepts `WM_NCACTIVATE` and `SetWindowPos(SWP_FRAMECHANGED)`
/// messages, preventing the non-client area from repainting. The only
/// reliable approach is a 1px resize and restore — Windows MUST fully
/// recalculate the non-client area on a geometry change. The resize is
/// sub-millisecond so there's no visible flicker.
#[cfg(target_os = "windows")]
fn force_title_bar_repaint(hwnd: windows::Win32::Foundation::HWND) {
    unsafe {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER,
        };
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            let w = rect.right - rect.left;
            let h = rect.bottom - rect.top;
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                w + 1,
                h,
                SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                w,
                h,
                SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
}

/// Tauri command: called from the frontend whenever the theme changes.
/// Applies the dark/light title bar to ALL windows (main + DevTools).
#[tauri::command]
pub async fn set_title_bar_dark_mode(app: tauri::AppHandle<TauriRuntime>, dark: bool) {
    #[cfg(target_os = "windows")]
    {
        // Apply to the main window. Applying SetWindowPos to DevTools windows in CEF
        // causes the GPU process to hard crash (0x80000003).
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(hwnd) = window.hwnd() {
                let hw = windows::Win32::Foundation::HWND(hwnd.0 as _);
                set_dark_title_bar(hw, dark);
                force_title_bar_repaint(hw);
            }
        }
        log::info!("[Window] Title bar dark mode set to: {}", dark);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, dark);
    }
}

/// Start a native resize drag from one of the invisible edge handles in the
/// custom title bar. The CEF runtime does not implement Tauri's generic
/// `start_resize_dragging` dispatcher, so Windows must receive the native
/// non-client resize message directly.
#[tauri::command]
pub fn start_window_resize(
    window: tauri::WebviewWindow<TauriRuntime>,
    edge: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("window resize is only available for the main window".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{LPARAM, POINT, WPARAM};
        use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetCursorPos, SendMessageW, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT,
            HTTOP, HTTOPLEFT, HTTOPRIGHT, WM_NCLBUTTONDOWN,
        };

        let hit_test = match edge.as_str() {
            "top" => HTTOP,
            "right" => HTRIGHT,
            "bottom" => HTBOTTOM,
            "left" => HTLEFT,
            "top-left" => HTTOPLEFT,
            "top-right" => HTTOPRIGHT,
            "bottom-left" => HTBOTTOMLEFT,
            "bottom-right" => HTBOTTOMRIGHT,
            _ => return Err(format!("unsupported resize edge: {edge}")),
        };

        if window.is_maximized().map_err(|error| error.to_string())? {
            return Ok(());
        }

        let raw_hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as _);
        let mut cursor = POINT::default();
        unsafe {
            GetCursorPos(&mut cursor).map_err(|error| error.to_string())?;
            let packed_position =
                ((cursor.x as u32 & 0xffff) | ((cursor.y as u32 & 0xffff) << 16)) as i32 as isize;
            let _ = ReleaseCapture();
            SendMessageW(
                hwnd,
                WM_NCLBUTTONDOWN,
                Some(WPARAM(hit_test as usize)),
                Some(LPARAM(packed_position)),
            );
        }

        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, edge);
        Ok(())
    }
}

/// Start a native drag without using the CEF fork's pointer-valued
/// `WM_NCLBUTTONDOWN` payload.
#[tauri::command]
pub fn start_window_drag(window: tauri::WebviewWindow<TauriRuntime>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("window dragging is only available for the main window".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{LPARAM, POINT, WPARAM};
        use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetCursorPos, SendMessageW, HTCAPTION, WM_NCLBUTTONDOWN,
        };

        let raw_hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as _);
        let mut cursor = POINT::default();
        unsafe {
            GetCursorPos(&mut cursor).map_err(|error| error.to_string())?;
            let packed_position =
                ((cursor.x as u32 & 0xffff) | ((cursor.y as u32 & 0xffff) << 16)) as i32 as isize;
            let _ = ReleaseCapture();
            SendMessageW(
                hwnd,
                WM_NCLBUTTONDOWN,
                Some(WPARAM(HTCAPTION as usize)),
                Some(LPARAM(packed_position)),
            );
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    window.start_dragging().map_err(|error| error.to_string())
}

/// Minimize the main window without routing through CEF's minimize dispatcher.
/// The CEF fork documents that dispatcher as unsafe for this application.
#[tauri::command]
pub fn minimize_main_window(window: tauri::WebviewWindow<TauriRuntime>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("minimize is only available for the main window".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_MINIMIZE};

        let raw_hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as _);
        unsafe {
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    window.minimize().map_err(|error| error.to_string())
}

/// Set maximize/restore without routing through CEF's generic window
/// dispatcher. The dispatcher can misclassify a maximize request as a close
/// request while the CEF host window is transitioning.
#[cfg(target_os = "windows")]
pub fn set_maximized_native(hwnd: windows::Win32::Foundation::HWND, maximized: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{IsZoomed, ShowWindow, SW_MAXIMIZE, SW_RESTORE};

    unsafe {
        let before = IsZoomed(hwnd).as_bool();
        let command = if maximized { SW_MAXIMIZE } else { SW_RESTORE };
        let _ = ShowWindow(hwnd, command);
        let after = IsZoomed(hwnd).as_bool();
        log::info!(
            "[Window][set-maximized-native] requested={} before={} after={}",
            maximized,
            before,
            after
        );
    }
}

#[tauri::command]
pub fn set_maximized_main_window(
    window: tauri::WebviewWindow<TauriRuntime>,
    maximized: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("maximize is only available for the main window".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let raw_hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as _);
        set_maximized_native(hwnd, maximized);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        if maximized {
            window.maximize().map_err(|error| error.to_string())
        } else {
            window.unmaximize().map_err(|error| error.to_string())
        }
    }
}

/// Flash or clear the main window's taskbar button on Windows.
///
/// `active = true` uses `FLASHW_TRAY | FLASHW_TIMERNOFG`, which keeps the
/// taskbar button flashing until the app is foregrounded. `active = false`
/// stops any existing flash immediately.
#[tauri::command]
pub async fn set_taskbar_notification_attention(
    app: tauri::AppHandle<TauriRuntime>,
    active: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            FlashWindowEx, FLASHWINFO, FLASHW_STOP, FLASHW_TIMERNOFG, FLASHW_TRAY,
        };

        let Some(window) = app.get_webview_window("main") else {
            return Ok(());
        };

        let hwnd = window.hwnd().map_err(|err| err.to_string())?;
        let hw = windows::Win32::Foundation::HWND(hwnd.0 as _);
        let flags = if active {
            FLASHW_TRAY | FLASHW_TIMERNOFG
        } else {
            FLASHW_STOP
        };

        unsafe {
            let mut flash = FLASHWINFO {
                cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
                hwnd: hw,
                dwFlags: flags,
                uCount: 0,
                dwTimeout: 0,
            };
            let _ = FlashWindowEx(&mut flash);
        }

        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, active);
        Ok(())
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
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
            LWA_ALPHA, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
        };
        let mut style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // Convert to invisible tool window
        style &= !(WS_EX_APPWINDOW.0 as isize);
        style |= (WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as isize;
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
        // Make completely transparent (invisible) but mathematically still painted
        let _ =
            SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 0, LWA_ALPHA);
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
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
            LWA_ALPHA, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
        };
        let mut style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // Remove tool window, layered, and transparent styles
        style &= !((WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as isize);
        // Restore app window style
        style |= WS_EX_APPWINDOW.0 as isize;
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
        // Restore full opacity
        let _ = SetLayeredWindowAttributes(
            hwnd,
            windows::Win32::Foundation::COLORREF(0),
            255,
            LWA_ALPHA,
        );
    }
}

/// Restore and foreground the existing native window after tray activation.
///
/// The CEF runtime's generic show/focus messages are asynchronous and can
/// accumulate during rapid tray clicks. The HWND path is idempotent and avoids
/// queueing CEF window operations for a window that is already alive.
#[cfg(target_os = "windows")]
pub fn restore_window_from_tray(hwnd: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };

    restore_window_visibility(hwnd);

    unsafe {
        let was_hidden = !IsWindowVisible(hwnd).as_bool();
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else if was_hidden {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        let _ = SetForegroundWindow(hwnd);
        was_hidden
    }
}
