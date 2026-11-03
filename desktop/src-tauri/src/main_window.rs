// ── Main window owner ───────────────────────────────────────────────────
//
// One place decides whether the main window is visible:
//
// - `complete_launch`: the updater window hands off (or closes). Shows the
//   window, or parks it in the tray when "start minimized" is on.
// - `reveal`: tray click, tray "Show", a second launch, a `yap://`
//   link. Restores from the tray state and foregrounds the window. Before the
//   launch handoff it only records that the launch must show the window.
// - `on_close_requested`: close to tray, or quit.
//
// The tray state is not `hide()`. On the CEF runtime hide() stops the
// window's message loop, minimize() crashes the GPU process (0x80000003) and
// set_skip_taskbar() is unimplemented. The window instead stays shown as a
// transparent, click-through tool window (`window::make_window_invisible`),
// and `window::restore_window_from_tray` undoes it.
//
// Deep links from every source (second-instance argv, the deep-link plugin,
// the cold-start command line) go through `route_deep_link`, which drops a
// repeat of the same URL, reveals the window and emits `DEEP_LINK_EVENT` once.
// Links that arrive before the frontend listens are queued until it calls
// `take_pending_deep_links`. See docs/desktop/window-shell.md.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::desktop_settings::DesktopSettingsStore;
use crate::TauriRuntime;

pub(crate) const MAIN_LABEL: &str = "main";
/// The one app event the frontend listens to for `yap://` (and `ralphmeet://`) links.
pub(crate) const DEEP_LINK_EVENT: &str = "rm://deep-link";
/// `yap`, then Ralph Meet's `ralphmeet`, which the installer still points at
/// this app so links shared before the rename keep working.
const DEEP_LINK_SCHEMES: [&str; 2] = ["yap", "ralphmeet"];
/// The same link through two paths (argv and the plugin) arrives together.
const DEEP_LINK_DEDUPE_WINDOW: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct DeepLinkPayload {
    pub url: String,
}

/// Normalizes a `yap://` or `ralphmeet://` URL, or `None` for anything else.
pub(crate) fn normalize_deep_link(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_matches('"');
    let url = tauri::Url::parse(trimmed).ok()?;
    DEEP_LINK_SCHEMES
        .iter()
        .any(|scheme| url.scheme().eq_ignore_ascii_case(scheme))
        .then(|| url.to_string())
}

/// The first deep-link URL in a command line. argv[0] is the executable.
pub(crate) fn deep_link_from_args<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .find_map(|arg| normalize_deep_link(arg.as_ref()))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DeepLinkAction {
    /// The same URL arrived within the dedupe window.
    Duplicate,
    /// Kept until the frontend listener is ready.
    Queued,
    /// Emit to the frontend now.
    Deliver(String),
}

#[derive(Default)]
pub(crate) struct DeepLinkQueue {
    last: Option<(String, Instant)>,
    listener_ready: bool,
    pending: Vec<String>,
}

impl DeepLinkQueue {
    pub(crate) fn accept(&mut self, url: String, now: Instant) -> DeepLinkAction {
        if let Some((last_url, at)) = &self.last {
            if *last_url == url && now.saturating_duration_since(*at) < DEEP_LINK_DEDUPE_WINDOW {
                return DeepLinkAction::Duplicate;
            }
        }
        self.last = Some((url.clone(), now));

        if self.listener_ready {
            DeepLinkAction::Deliver(url)
        } else {
            self.pending.push(url);
            DeepLinkAction::Queued
        }
    }

    /// Marks the frontend listener ready and hands over what arrived before.
    pub(crate) fn take_pending(&mut self) -> Vec<String> {
        self.listener_ready = true;
        std::mem::take(&mut self.pending)
    }
}

#[derive(Default)]
struct Inner {
    /// The launch handoff ran: the window was shown or parked in the tray.
    launched: bool,
    /// Something asked for the window before the launch handoff (a second
    /// launch, a deep link). The launch shows it even with start minimized.
    reveal_on_launch: bool,
    deep_links: DeepLinkQueue,
}

pub(crate) struct MainWindowState {
    /// This process was started by the OS autostart entry (`--autostart`).
    launched_by_autostart: bool,
    inner: Mutex<Inner>,
}

impl MainWindowState {
    /// Reads `--autostart` from this process's command line, once.
    pub(crate) fn from_env() -> Self {
        Self {
            launched_by_autostart: launched_by_autostart(std::env::args()),
            inner: Mutex::default(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// True when the command line (after argv[0]) carries `--autostart`.
pub(crate) fn launched_by_autostart<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .skip(1)
        .any(|arg| arg.as_ref() == crate::AUTOSTART_ARG)
}

/// Whether the launch handoff parks the window in the tray instead of
/// showing it. Only an OS autostart launch with start minimized on, and
/// nothing (second launch, deep link) asking for the window.
pub(crate) fn launch_to_tray(
    launched_by_autostart: bool,
    start_minimized: bool,
    reveal_requested: bool,
) -> bool {
    launched_by_autostart && start_minimized && !reveal_requested
}

/// Registers the deep-link sources. Call from `setup`.
pub(crate) fn setup(app: &tauri::App<TauriRuntime>) {
    use tauri_plugin_deep_link::DeepLinkExt;

    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        // The CEF runtime catches a second launch before the single-instance
        // plugin can, and reports a launch without a link as an empty open.
        let urls = event.urls();
        if urls.is_empty() {
            log::info!("[Window][relaunch] launched again; revealing the main window");
            reveal(&handle, "relaunch");
            return;
        }
        for url in urls {
            if let Some(url) = normalize_deep_link(url.as_str()) {
                route_deep_link(&handle, url, "plugin");
            }
        }
    });

    // Cold start: the link is on our own command line. The webview is not
    // listening yet, so this only queues it and marks the launch to show.
    if let Some(url) = deep_link_from_args(std::env::args()) {
        route_deep_link(app.handle(), url, "cold-start");
    }
}

/// The single-instance callback: a second launch, maybe with a link.
pub(crate) fn on_second_instance(app: &AppHandle<TauriRuntime>, argv: &[String]) {
    log::info!("[Window][second-instance] argv={argv:?}");
    match deep_link_from_args(argv) {
        Some(url) => route_deep_link(app, url, "second-instance"),
        None => reveal(app, "second-instance"),
    }
}

pub(crate) fn route_deep_link(app: &AppHandle<TauriRuntime>, url: String, source: &str) {
    let action = app
        .state::<MainWindowState>()
        .lock()
        .deep_links
        .accept(url.clone(), Instant::now());
    log::info!("[DeepLink][{source}] {url} -> {action:?}");
    if action == DeepLinkAction::Duplicate {
        return;
    }

    reveal(app, source);

    if let DeepLinkAction::Deliver(url) = action {
        if let Err(err) = app.emit(DEEP_LINK_EVENT, DeepLinkPayload { url }) {
            log::warn!("[DeepLink][{source}] emit failed: {err}");
        }
    }
}

/// Makes the main window visible and foreground, restoring it from the tray
/// state if needed. Before the launch handoff it only marks the launch to
/// show the window.
pub(crate) fn reveal(app: &AppHandle<TauriRuntime>, context: &str) {
    if crate::shutdown_in_progress(app) {
        log::debug!("[Window][{context}] reveal ignored while shutdown is in progress");
        return;
    }

    {
        let state = app.state::<MainWindowState>();
        let mut inner = state.lock();
        if !inner.launched {
            inner.reveal_on_launch = true;
            log::info!("[Window][{context}] reveal before launch handoff; launch will show");
            return;
        }
    }

    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
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
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        log::debug!("[Window][{context}] restored main window visibility and focus");
    }
}

/// The launch handoff: the main window was created hidden while the updater
/// window checked for updates. Shows it, or on an autostart launch with
/// "start minimized" parks it in the tray. Runs once; later calls do nothing.
pub(crate) fn complete_launch(app: &AppHandle<TauriRuntime>, context: &str) -> Result<(), String> {
    if crate::shutdown_in_progress(app) {
        return Err("application shutdown is already in progress".to_string());
    }

    let window = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "main window is unavailable".to_string())?;

    let state = app.state::<MainWindowState>();
    let reveal_requested = {
        let mut inner = state.lock();
        if inner.launched {
            return Ok(());
        }
        inner.launched = true;
        inner.reveal_on_launch
    };

    let start_minimized = app
        .state::<DesktopSettingsStore>()
        .settings()
        .start_minimized;
    let autostart = state.launched_by_autostart;
    let to_tray =
        cfg!(target_os = "windows") && launch_to_tray(autostart, start_minimized, reveal_requested);
    log::info!(
        "[Window][{context}] launch handoff autostart={autostart} start_minimized={start_minimized} reveal_requested={reveal_requested} to_tray={to_tray}"
    );

    let result = if to_tray {
        show_in_tray(&window)
    } else {
        window.show().map_err(|error| error.to_string()).map(|()| {
            if let Err(error) = window.set_focus() {
                log::warn!("[Window][{context}] main window shown but focus failed: {error}");
            }
        })
    };

    if result.is_err() {
        state.lock().launched = false;
    }
    result
}

/// Start minimized: put the window in the tray state, then show it, so it is
/// shown (message loop running) but invisible and off the taskbar.
fn show_in_tray(window: &tauri::WebviewWindow<TauriRuntime>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        crate::window::make_window_invisible(windows::Win32::Foundation::HWND(hwnd.0 as _));
    }
    window.show().map_err(|error| error.to_string())
}

/// The main window's close button: close to tray, or quit.
pub(crate) fn on_close_requested(
    window: &tauri::Window<TauriRuntime>,
    api: &tauri::CloseRequestApi,
) {
    #[cfg(target_os = "windows")]
    let close_to_tray = window
        .state::<DesktopSettingsStore>()
        .settings()
        .close_to_tray;
    #[cfg(not(target_os = "windows"))]
    let close_to_tray = false;

    log::warn!("[Window][close-requested] label=main close_to_tray={close_to_tray}");
    // Save before hiding: a tray-hidden app usually ends by updater install
    // or Windows shutdown, which skip exit hooks.
    crate::window_state::save_now(window.app_handle());
    api.prevent_close();
    if !close_to_tray {
        crate::spawn_app_exit(window.app_handle(), "main-close:quit", false);
        return;
    }

    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        crate::window::make_window_invisible(windows::Win32::Foundation::HWND(hwnd.0 as _));
    }
    log::info!("[Window] Close intercepted → became transparent (tray hack)");
}

// ── Commands ────────────────────────────────────────────────────────────

/// The updater window's handoff to the main window. Rust decides whether the
/// window shows or starts in the tray.
#[tauri::command]
pub(crate) fn launch_main_window(app: AppHandle<TauriRuntime>) -> Result<(), String> {
    complete_launch(&app, "launch")
}

/// Called once the frontend deep-link listener is attached. Returns links
/// that arrived before it; later links come as `DEEP_LINK_EVENT`.
#[tauri::command]
pub(crate) fn take_pending_deep_links(app: AppHandle<TauriRuntime>) -> Vec<String> {
    app.state::<MainWindowState>()
        .lock()
        .deep_links
        .take_pending()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_link_from_argv() {
        assert_eq!(
            deep_link_from_args([r"C:\Yap\app-3.7.0\Yap.exe", "ralphmeet://invite/abc123"]),
            Some("ralphmeet://invite/abc123".to_string())
        );
        assert_eq!(
            deep_link_from_args([r"C:\Yap\app-3.7.0\Yap.exe", "yap://invite/abc123"]),
            Some("yap://invite/abc123".to_string())
        );
        assert_eq!(
            normalize_deep_link("YAP://invite/x").as_deref(),
            Some("yap://invite/x")
        );
        assert_eq!(normalize_deep_link("https://invite/x"), None);
    }

    #[test]
    fn extracts_quoted_and_mixed_case_links() {
        assert_eq!(
            deep_link_from_args(["Yap.exe", "--flag", "\"RalphMeet://invite/abc\""]),
            Some("ralphmeet://invite/abc".to_string())
        );
    }

    #[test]
    fn ignores_argv0_and_other_arguments() {
        assert_eq!(deep_link_from_args(["ralphmeet://invite/argv0"]), None);
        assert_eq!(
            deep_link_from_args(["Yap.exe", "--type=renderer", "https://example.com"]),
            None
        );
        assert_eq!(deep_link_from_args(Vec::<String>::new()), None);
    }

    #[test]
    fn argv_and_plugin_forms_normalize_the_same() {
        let from_argv = deep_link_from_args(["Yap.exe", "ralphmeet://invite/abc"]).unwrap();
        let from_plugin = normalize_deep_link(
            tauri::Url::parse("ralphmeet://invite/abc")
                .unwrap()
                .as_str(),
        )
        .unwrap();
        assert_eq!(from_argv, from_plugin);
    }

    #[test]
    fn autostart_flag_is_not_a_deep_link() {
        assert_eq!(deep_link_from_args(["Yap.exe", "--autostart"]), None);
        assert_eq!(
            deep_link_from_args(["Yap.exe", "--autostart", "ralphmeet://invite/a"]),
            Some("ralphmeet://invite/a".to_string())
        );
    }

    #[test]
    fn detects_the_autostart_flag_after_argv0() {
        assert!(launched_by_autostart(["Yap.exe", "--autostart"]));
        assert!(!launched_by_autostart(["Yap.exe"]));
        assert!(!launched_by_autostart(["--autostart"]));
        assert!(!launched_by_autostart(["Yap.exe", "--autostart=1"]));
    }

    #[test]
    fn only_autostart_with_start_minimized_and_no_reveal_goes_to_tray() {
        assert!(launch_to_tray(true, true, false));
        assert!(!launch_to_tray(false, true, false));
        assert!(!launch_to_tray(true, false, false));
        assert!(!launch_to_tray(true, true, true));
        assert!(!launch_to_tray(false, false, false));
    }

    #[test]
    fn queues_until_the_listener_is_ready() {
        let mut queue = DeepLinkQueue::default();
        let now = Instant::now();
        assert_eq!(
            queue.accept("ralphmeet://invite/a".into(), now),
            DeepLinkAction::Queued
        );
        assert_eq!(
            queue.take_pending(),
            vec!["ralphmeet://invite/a".to_string()]
        );
        assert!(queue.take_pending().is_empty());
        assert_eq!(
            queue.accept("ralphmeet://invite/b".into(), now),
            DeepLinkAction::Deliver("ralphmeet://invite/b".into())
        );
    }

    #[test]
    fn drops_the_same_link_within_the_window() {
        let mut queue = DeepLinkQueue::default();
        queue.take_pending();
        let now = Instant::now();
        let url = "ralphmeet://invite/a".to_string();
        assert_eq!(
            queue.accept(url.clone(), now),
            DeepLinkAction::Deliver(url.clone())
        );
        assert_eq!(
            queue.accept(url.clone(), now + Duration::from_millis(300)),
            DeepLinkAction::Duplicate
        );
        assert_eq!(
            queue.accept(
                url.clone(),
                now + DEEP_LINK_DEDUPE_WINDOW + Duration::from_millis(400)
            ),
            DeepLinkAction::Deliver(url)
        );
    }

    #[test]
    fn a_different_link_is_not_a_duplicate() {
        let mut queue = DeepLinkQueue::default();
        queue.take_pending();
        let now = Instant::now();
        queue.accept("ralphmeet://invite/a".into(), now);
        assert_eq!(
            queue.accept("ralphmeet://invite/b".into(), now),
            DeepLinkAction::Deliver("ralphmeet://invite/b".into())
        );
    }

    #[test]
    fn duplicate_before_ready_is_queued_once() {
        let mut queue = DeepLinkQueue::default();
        let now = Instant::now();
        queue.accept("ralphmeet://invite/a".into(), now);
        assert_eq!(
            queue.accept("ralphmeet://invite/a".into(), now),
            DeepLinkAction::Duplicate
        );
        assert_eq!(queue.take_pending().len(), 1);
    }
}
