// ── Occlusion signal for the renderer ───────────────────────────────────
//
// Emits `rm://occlusion` (payload: bool) when the main window is unfocused
// AND either covered by a fullscreen window on its monitor (a game) or parked
// in the tray (the CEF alpha-0 tray hack keeps the page "visible" to
// Chromium). The frontend's `useAppActive()` combines it with focus and
// visibility and sets `<html data-app-inactive>`, which pauses every CSS
// animation and stops canvas/video loops.
//
// Cost: one parked thread. It blocks while the window is focused and polls
// the foreground window every POLL while unfocused, emitting only on change.

use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Runtime};

pub const OCCLUSION_EVENT: &str = "rm://occlusion";
const POLL: Duration = Duration::from_millis(1500);

static FOCUS_TX: OnceLock<Sender<bool>> = OnceLock::new();

/// Start the watcher for the main window. `main_hwnd` is the raw HWND
/// (0 when unknown or not on Windows). Call once from setup.
pub fn start<R: Runtime>(app: &AppHandle<R>, main_hwnd: isize) {
    let (tx, rx) = channel::<bool>();
    if FOCUS_TX.set(tx).is_err() {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("rm-occlusion".into())
        .spawn(move || {
            let mut focused = true;
            let mut last_emitted: Option<bool> = None;
            loop {
                let next = if focused {
                    rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
                } else {
                    rx.recv_timeout(POLL)
                };
                match next {
                    Ok(value) => focused = value,
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                let covered = !focused && is_covered(main_hwnd);
                if last_emitted != Some(covered) {
                    last_emitted = Some(covered);
                    log::info!("[Occlusion] main covered={covered}");
                    let _ = app.emit(OCCLUSION_EVENT, covered);
                }
            }
        });
    if let Err(err) = spawned {
        log::warn!("[Occlusion] watcher thread failed to start: {err}");
    }
}

/// Forward the main window's focus changes (from `on_window_event`).
pub fn on_main_focus_changed(focused: bool) {
    if let Some(tx) = FOCUS_TX.get() {
        let _ = tx.send(focused);
    }
}

#[cfg(target_os = "windows")]
fn is_covered(main_hwnd: isize) -> bool {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        MONITOR_DEFAULTTONULL,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, IsIconic,
        GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TOOLWINDOW,
    };

    if main_hwnd == 0 {
        return false;
    }
    let ours = HWND(main_hwnd as _);
    unsafe {
        if IsIconic(ours).as_bool() {
            return true;
        }
        // Tray hack (window::make_window_invisible): tool window + layered.
        let tray_bits = (WS_EX_TOOLWINDOW.0 | WS_EX_LAYERED.0) as isize;
        if GetWindowLongPtrW(ours, GWL_EXSTYLE) & tray_bits == tray_bits {
            return true;
        }

        let fg = GetForegroundWindow();
        if fg.0.is_null() || fg == ours {
            return false;
        }
        // The desktop and the taskbar span the monitor but cover nothing.
        let mut class = [0u16; 64];
        let len = GetClassNameW(fg, &mut class);
        if len > 0 {
            let name = String::from_utf16_lossy(&class[..len as usize]);
            if matches!(name.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
                return false;
            }
        }

        let monitor = MonitorFromWindow(ours, MONITOR_DEFAULTTONEAREST);
        if MonitorFromWindow(fg, MONITOR_DEFAULTTONULL) != monitor {
            return false;
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return false;
        }
        // Fullscreen (exclusive or borderless) covers the whole monitor; a
        // maximised window stops at the taskbar and does not count.
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
}

#[cfg(not(target_os = "windows"))]
fn is_covered(_main_hwnd: isize) -> bool {
    false
}
