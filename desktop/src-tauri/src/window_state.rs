// ── Main window geometry persistence ────────────────────────────────────
// Saves and restores the main window's size, position and maximized state.
//
// tauri-plugin-window-state did not work here. Config windows are built
// before `setup()` can register plugins, so its per-window hooks never ran,
// and it only wrote the file on a clean exit. Close-to-tray, updater installs
// and Windows shutdown end the process without one, so the file went stale
// and every launch reopened the same old rect.
//
// This module saves after every move or resize settles, and again on close
// and on quit. On restore it clamps the saved rect onto a connected monitor.
//
// Coordinates are the runtime's physical pixels. The CEF runtime computes
// them as Chromium DIPs times the scale of the display involved. Restore
// therefore converts back with the target monitor's own scale, not with the
// scale of the display the hidden window happens to sit on.
//
// The file keeps the plugin's JSON shape. The CEF runtime fork reads the same
// file when it builds the window (`load_persisted_window_state`).

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewWindow};

const FILE_NAME: &str = ".window-state.json";
const MAIN_LABEL: &str = "main";
/// Moves and resizes arrive as a stream. Write once the stream goes quiet.
const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
/// A saved rect counts as on screen only if this much of it shows on one
/// monitor, enough to grab the title bar.
const MIN_VISIBLE_WIDTH: u32 = 120;
const MIN_VISIBLE_HEIGHT: u32 = 40;
/// Windows parks minimized windows at (-32000, -32000).
const MINIMIZED_SENTINEL: i32 = -32000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn right(&self) -> i64 {
        self.x as i64 + self.width as i64
    }

    fn bottom(&self) -> i64 {
        self.y as i64 + self.height as i64
    }

    fn intersection(&self, other: &Rect) -> (u32, u32) {
        let width = self.right().min(other.right()) - (self.x.max(other.x) as i64);
        let height = self.bottom().min(other.bottom()) - (self.y.max(other.y) as i64);
        (width.max(0) as u32, height.max(0) as u32)
    }

    /// Shrinks the rect to fit `area`, then moves it fully inside.
    fn fit_within(&self, area: &Rect) -> Rect {
        let width = self.width.min(area.width);
        let height = self.height.min(area.height);
        let max_x = area.right() - width as i64;
        let max_y = area.bottom() - height as i64;
        Rect {
            x: (self.x as i64).clamp(area.x as i64, max_x) as i32,
            y: (self.y as i64).clamp(area.y as i64, max_y) as i32,
            width,
            height,
        }
    }

    /// Keeps the size (shrunk to fit) and centers the rect in `area`.
    fn centered_in(&self, area: &Rect) -> Rect {
        let width = self.width.min(area.width);
        let height = self.height.min(area.height);
        Rect {
            x: (area.x as i64 + (area.width - width) as i64 / 2) as i32,
            y: (area.y as i64 + (area.height - height) as i64 / 2) as i32,
            width,
            height,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Placement {
    pub rect: Rect,
    /// Index into the work areas passed to [`place`].
    pub monitor: usize,
}

/// Decides where a window with the last normal rect `saved` should open.
///
/// The rect goes to the monitor it overlaps most and is moved fully inside
/// that monitor's work area. If no monitor shows enough of it, for example
/// after a monitor was unplugged or a resolution dropped, it is centered on
/// the primary monitor instead.
pub(crate) fn place(saved: Rect, work_areas: &[Rect], primary: usize) -> Option<Placement> {
    let primary_area = work_areas.get(primary)?;
    let best = work_areas
        .iter()
        .enumerate()
        .map(|(index, area)| (index, saved.intersection(area)))
        .max_by_key(|(_, (width, height))| *width as u64 * *height as u64);

    if let Some((index, (width, height))) = best {
        if width >= MIN_VISIBLE_WIDTH.min(saved.width)
            && height >= MIN_VISIBLE_HEIGHT.min(saved.height)
        {
            return Some(Placement {
                rect: saved.fit_within(&work_areas[index]),
                monitor: index,
            });
        }
    }

    Some(Placement {
        rect: saved.centered_in(primary_area),
        monitor: primary,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
struct SavedState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    #[serde(default)]
    maximized: bool,
    #[serde(default)]
    fullscreen: bool,
}

impl SavedState {
    fn rect(&self) -> Rect {
        Rect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }

    fn with_rect(rect: Rect, maximized: bool, fullscreen: bool) -> Self {
        Self {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            maximized,
            fullscreen,
        }
    }
}

pub(crate) struct WindowStateStore {
    /// What the file holds now. Also the last normal rect, which a maximized
    /// window cannot report.
    saved: Mutex<Option<SavedState>>,
    save_requests: Sender<()>,
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME))
}

fn read_saved_state<R: Runtime>(app: &AppHandle<R>) -> Option<SavedState> {
    let mut paths: Vec<std::path::PathBuf> = state_path(app).into_iter().collect();
    #[cfg(target_os = "windows")]
    if let Some(base) = std::env::var_os("APPDATA") {
        paths.push(
            std::path::PathBuf::from(base)
                .join(crate::LEGACY_WINDOWS_APP_DATA_DIRECTORY_NAME)
                .join(FILE_NAME),
        );
    }

    for path in paths {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        match serde_json::from_str::<std::collections::HashMap<String, SavedState>>(&raw) {
            Ok(mut states) => {
                if let Some(state) = states.remove(MAIN_LABEL) {
                    return Some(state);
                }
            }
            Err(err) => log::warn!("[WindowState] ignoring {}: {err}", path.display()),
        }
    }
    None
}

fn write_saved_state<R: Runtime>(app: &AppHandle<R>, state: &SavedState) -> Result<(), String> {
    let path = state_path(app).ok_or_else(|| "app config dir unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let states = std::collections::HashMap::from([(MAIN_LABEL, state)]);
    let raw = serde_json::to_string_pretty(&states).map_err(|err| err.to_string())?;
    // Write a sibling file and rename it over the old one, so a kill mid-write
    // cannot leave a truncated file behind.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(|err| err.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|err| err.to_string())
}

fn monitor_work_area(monitor: &tauri::Monitor) -> Rect {
    let area = monitor.work_area();
    Rect {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    }
}

/// Moves the hidden main window to its saved place, or centers it on the
/// primary monitor on first launch. Must run before the window is shown.
pub(crate) fn restore<R: Runtime>(app: &AppHandle<R>) {
    let (tx, rx) = mpsc::channel();
    app.manage(WindowStateStore {
        saved: Mutex::new(None),
        save_requests: tx,
    });
    spawn_saver(app.clone(), rx);

    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        log::warn!("[WindowState][restore] main window missing");
        return;
    };
    if let Err(err) = apply_saved_state(app, &window) {
        log::warn!("[WindowState][restore] failed: {err}");
    }
}

fn apply_saved_state<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|err| err.to_string())?;
    let primary = window
        .primary_monitor()
        .map_err(|err| err.to_string())?
        .and_then(|primary| {
            monitors
                .iter()
                .position(|m| m.position() == primary.position() && m.size() == primary.size())
        })
        .unwrap_or(0);
    let work_areas: Vec<Rect> = monitors.iter().map(monitor_work_area).collect();

    let saved = read_saved_state(app);
    let (requested, maximized, fullscreen) = match saved {
        Some(state) => (state.rect(), state.maximized, state.fullscreen),
        None => {
            // First launch: keep the configured size, centered on the primary
            // monitor.
            let size = window.inner_size().map_err(|err| err.to_string())?;
            let rect = Rect {
                x: 0,
                y: 0,
                width: size.width,
                height: size.height,
            };
            let rect = work_areas
                .get(primary)
                .map(|area| rect.centered_in(area))
                .unwrap_or(rect);
            (rect, false, false)
        }
    };

    let Some(placement) = place(requested, &work_areas, primary) else {
        return Err("no monitors reported".to_string());
    };
    let scale = monitors[placement.monitor].scale_factor();
    let rect = placement.rect;
    log::info!(
        "[WindowState][restore] saved={saved:?} placed={rect:?} monitor={} scale={scale} maximized={maximized}",
        placement.monitor
    );

    window
        .set_position(LogicalPosition::new(
            rect.x as f64 / scale,
            rect.y as f64 / scale,
        ))
        .map_err(|err| err.to_string())?;
    window
        .set_size(LogicalSize::new(
            rect.width as f64 / scale,
            rect.height as f64 / scale,
        ))
        .map_err(|err| err.to_string())?;
    // The CEF runtime defers these on a hidden window and applies them when
    // the window is first shown, on the monitor it was just moved to.
    if maximized {
        window.maximize().map_err(|err| err.to_string())?;
    }
    if fullscreen {
        window.set_fullscreen(true).map_err(|err| err.to_string())?;
    }

    *app.state::<WindowStateStore>().saved.lock().unwrap() =
        Some(SavedState::with_rect(rect, maximized, fullscreen));
    Ok(())
}

/// Saves after the window stops moving. Cheap to call on every event.
pub(crate) fn schedule_save<R: Runtime>(app: &AppHandle<R>) {
    if let Some(store) = app.try_state::<WindowStateStore>() {
        let _ = store.save_requests.send(());
    }
}

fn spawn_saver<R: Runtime>(app: AppHandle<R>, rx: mpsc::Receiver<()>) {
    let _ = std::thread::Builder::new()
        .name("RalphWindowState".into())
        .spawn(move || {
            while rx.recv().is_ok() {
                loop {
                    match rx.recv_timeout(SAVE_DEBOUNCE) {
                        Ok(()) => continue,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                save_now(&app);
            }
        });
}

/// Reads the main window's geometry and writes it if it changed.
pub(crate) fn save_now<R: Runtime>(app: &AppHandle<R>) {
    let Some(store) = app.try_state::<WindowStateStore>() else {
        return;
    };
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    // Window getters wait on the UI thread, and the UI thread calls this too
    // (on close), so never hold the lock while reading the window.
    let previous = *store.saved.lock().unwrap();
    let Some(next) = capture(&window, previous) else {
        return;
    };
    let mut saved = store.saved.lock().unwrap();
    if *saved == Some(next) {
        return;
    }
    match write_saved_state(app, &next) {
        Ok(()) => {
            log::info!("[WindowState][save] {next:?}");
            *saved = Some(next);
        }
        Err(err) => log::warn!("[WindowState][save] failed: {err}"),
    }
}

fn capture<R: Runtime>(
    window: &WebviewWindow<R>,
    previous: Option<SavedState>,
) -> Option<SavedState> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);

    if maximized || fullscreen {
        // The window reports its maximized bounds, so keep the last normal
        // rect. If the window was moved to another monitor while maximized,
        // carry that rect over so it restores (and un-maximizes) there.
        let mut rect = previous?.rect();
        if let Ok(Some(monitor)) = window.current_monitor() {
            if let Some(placement) = place(rect, &[monitor_work_area(&monitor)], 0) {
                rect = placement.rect;
            }
        }
        return Some(SavedState::with_rect(rect, maximized, fullscreen));
    }

    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    if position.x <= MINIMIZED_SENTINEL || size.width == 0 || size.height == 0 {
        return None;
    }
    Some(SavedState::with_rect(
        Rect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        false,
        false,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    // 1080p primary with a 48px taskbar, and a 1440p monitor to its left.
    const PRIMARY: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1032,
    };
    const LEFT: Rect = Rect {
        x: -2560,
        y: -200,
        width: 2560,
        height: 1392,
    };

    #[test]
    fn keeps_a_rect_that_is_fully_on_screen() {
        let saved = rect(441, 112, 1216, 644);
        let placed = place(saved, &[PRIMARY, LEFT], 0).unwrap();
        assert_eq!(
            placed,
            Placement {
                rect: saved,
                monitor: 0
            }
        );
    }

    #[test]
    fn keeps_a_rect_on_a_secondary_monitor() {
        let saved = rect(-1800, 100, 1216, 644);
        let placed = place(saved, &[PRIMARY, LEFT], 0).unwrap();
        assert_eq!(
            placed,
            Placement {
                rect: saved,
                monitor: 1
            }
        );
    }

    #[test]
    fn centers_on_primary_when_the_saved_monitor_is_gone() {
        let saved = rect(-1800, 100, 1216, 644);
        let placed = place(saved, &[PRIMARY], 0).unwrap();
        assert_eq!(placed.monitor, 0);
        assert_eq!(placed.rect, rect(352, 194, 1216, 644));
    }

    #[test]
    fn centers_on_primary_when_only_a_sliver_is_visible() {
        // 20px of the window pokes onto the primary's left edge.
        let saved = rect(-1196, 100, 1216, 644);
        let placed = place(saved, &[PRIMARY], 0).unwrap();
        assert_eq!(placed.rect, rect(352, 194, 1216, 644));
    }

    #[test]
    fn pulls_a_partly_off_screen_rect_inside_the_work_area() {
        // Hanging off the bottom-right corner, over the taskbar.
        let saved = rect(1500, 800, 1216, 644);
        let placed = place(saved, &[PRIMARY, LEFT], 0).unwrap();
        assert_eq!(placed.monitor, 0);
        assert_eq!(placed.rect, rect(704, 388, 1216, 644));
    }

    #[test]
    fn picks_the_monitor_holding_most_of_a_straddling_rect() {
        // 1000px on the left monitor, 216px on the primary.
        let saved = rect(-1000, 100, 1216, 644);
        let placed = place(saved, &[PRIMARY, LEFT], 0).unwrap();
        assert_eq!(placed.monitor, 1);
        assert_eq!(placed.rect, rect(-1216, 100, 1216, 644));
    }

    #[test]
    fn shrinks_a_rect_saved_on_a_larger_display() {
        // Saved on a 4K panel, restored after the resolution dropped to 1080p.
        let saved = rect(200, 100, 3000, 1800);
        let placed = place(saved, &[PRIMARY], 0).unwrap();
        assert_eq!(placed.rect, rect(0, 0, 1920, 1032));
    }

    #[test]
    fn handles_a_primary_that_is_not_first() {
        let saved = rect(5000, 5000, 1216, 644);
        let placed = place(saved, &[LEFT, PRIMARY], 1).unwrap();
        assert_eq!(placed.monitor, 1);
        assert_eq!(placed.rect, rect(352, 194, 1216, 644));
    }

    #[test]
    fn returns_none_without_monitors() {
        assert_eq!(place(rect(0, 0, 100, 100), &[], 0), None);
    }

    #[test]
    fn reads_the_plugin_file_format() {
        let raw = r#"{
            "updater": { "width": 320, "height": 400, "x": 800, "y": 316 },
            "main": {
                "width": 1216, "height": 644, "x": 441, "y": 112,
                "prev_x": 404, "prev_y": 117, "maximized": true,
                "visible": true, "decorated": true, "fullscreen": false
            }
        }"#;
        let states: std::collections::HashMap<String, SavedState> =
            serde_json::from_str(raw).unwrap();
        let main = states["main"];
        assert_eq!(main.rect(), rect(441, 112, 1216, 644));
        assert!(main.maximized);
        assert!(!main.fullscreen);
    }
}
