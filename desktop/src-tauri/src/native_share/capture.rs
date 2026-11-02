//! Capture-source resolution and capture-mode selection (WGC vs the zero-copy
//! game-capture hook), plus the hook capture thread. The thread is owned by a
//! [`ShareSession`](super::session::ShareSession) and stops on the session's
//! cancellation token.

use std::sync::Arc;
#[cfg(all(feature = "game-capture-hook", windows))]
use std::time::Duration;

use crate::d3d_device::D3dDevice;
use crate::game_capture::{
    apply_capture_policy, fallback_reason, resolve_capture_policy, select_capture_mode_v2,
    should_notify_unavailable, BackendGate, CaptureMode, CapturePolicy, CaptureResolution,
    FallbackReason, GraphicsApiBackend, InjectionOutcome, SafetyDecision, SelectionInputs,
    SourceKind,
};

#[cfg(all(feature = "game-capture-hook", windows))]
use super::session::{CancelToken, EndReason, SessionEnder};
use super::stats::NativeShareStats;
#[cfg(all(feature = "game-capture-hook", windows))]
use std::sync::Mutex as StdMutex;

// ── Resolve source ID to WGC capture item ─────────────────────────────────

pub(crate) fn resolve_wgc_item(
    source_id: &str,
) -> Result<windows::Graphics::Capture::GraphicsCaptureItem, String> {
    if let Some(raw_idx) = source_id.strip_prefix("monitor-") {
        let idx = raw_idx
            .parse::<usize>()
            .map_err(|_| format!("Invalid monitor source id: {source_id}"))?;
        crate::wgc_capture::capture_item_for_monitor_idx(idx)
            .map_err(|e| format!("Create WGC monitor item: {e}"))
    } else if let Some(raw_hwnd) = source_id.strip_prefix("window-") {
        let hwnd = raw_hwnd
            .parse::<isize>()
            .map_err(|_| format!("Invalid window source id: {source_id}"))?;
        crate::wgc_capture::capture_item_for_hwnd(hwnd)
            .map_err(|e| format!("Create WGC window item: {e}"))
    } else {
        Err(format!("Unsupported native capture source id: {source_id}"))
    }
}

/// Derive the [`SourceKind`] from a native capture `source_id`.
///
/// Source ids are the same strings `resolve_wgc_item` understands: a
/// `"monitor-<idx>"` id is a [`SourceKind::Monitor`] (always WGC, Req 6.2) and a
/// `"window-<hwnd>"` id is a [`SourceKind::Window`] (the only hook candidate,
/// Req 7.1). Any other prefix is treated as a window so it still flows through
/// the (conservative) selection — a non-window/non-monitor id never reaches
/// here because `resolve_wgc_item` rejects it first.
pub(crate) fn source_kind_from_id(source_id: &str) -> SourceKind {
    if source_id.starts_with("monitor-") {
        SourceKind::Monitor
    } else {
        SourceKind::Window
    }
}

/// Parse the raw `HWND` value out of a `"window-<hwnd>"` source id, if present.
/// Returns `None` for a monitor id or a malformed window id (in which case no
/// hook attach is attempted and the session stays on the WGC path).
///
/// `#[allow(dead_code)]`: on the `native-screen-share`-only (hook feature-off)
/// build the only caller is the `game-capture-hook`-gated `prepare_hook`, so the
/// non-test build would otherwise flag this as unused.
#[allow(dead_code)]
pub(crate) fn window_hwnd_from_id(source_id: &str) -> Option<isize> {
    source_id
        .strip_prefix("window-")
        .and_then(|raw| raw.parse::<isize>().ok())
}

/// Resolve the [`GraphicsApiBackend`] label to report for this session's target.
///
/// On the `game-capture-hook` + Windows build for a window source, this opens
/// the target process and inspects its loaded graphics runtimes
/// ([`detect_graphics_api`](crate::game_capture::inject::detect_graphics_api)) so
/// a DX12 game is reported as `dx12` rather than the historical hardcoded
/// `dx11`. DX11 and DX12 capture through the **same** DXGI present hook, so the
/// label never changes which interception path is used — only the
/// `Capture_Status` string and the active-backend gate.
///
/// Falls back to [`GraphicsApiBackend::Dx11`] when detection is unavailable: a
/// monitor source, a non-feature/non-Windows build, a window id that does not
/// resolve to a pid, or a process that loads no known runtime. DX11 is the safe
/// default because it is captured through the identical DXGI hook and was the
/// prior unconditional assumption.
pub(crate) fn detect_target_backend(
    source_id: &str,
    source_kind: SourceKind,
) -> GraphicsApiBackend {
    #[cfg(all(feature = "game-capture-hook", windows))]
    {
        if source_kind == SourceKind::Window {
            if let Some(backend) = window_hwnd_from_id(source_id)
                .and_then(window_pid_from_hwnd)
                .and_then(crate::game_capture::inject::detect_graphics_api)
            {
                return backend;
            }
        }
        GraphicsApiBackend::Dx11
    }
    #[cfg(not(all(feature = "game-capture-hook", windows)))]
    {
        let _ = (source_id, source_kind);
        GraphicsApiBackend::Dx11
    }
}

/// Whether the DX11 zero-copy game-capture hook may be attempted this session.
///
/// The hook is **additive and opt-in**: WGC is the proven, guaranteed path
/// (Req 6) and must remain the default, so the hook is only attempted when the
/// `RALPH_GAME_CAPTURE_HOOK` environment variable is set to a truthy value
/// (`1`, `true`, `yes`, or `on`, case-insensitive). With the variable unset or
/// any other value, `select_capture_mode` is still called but with
/// `hook_enabled = false`, so it always resolves to `wgc` and default behavior
/// is unchanged.
fn game_capture_hook_enabled() -> bool {
    // When the `game-capture-hook` feature is compiled in, the hook is ON by
    // default in production installs — no env var required. The env var still
    // works as an explicit override in both directions so dev scripts and
    // CI can force a specific state without a rebuild:
    //   RALPH_GAME_CAPTURE_HOOK=0/false/no/off  → force disabled
    //   RALPH_GAME_CAPTURE_HOOK=1/true/yes/on   → force enabled (redundant
    //                                              when the feature is in,
    //                                              useful when it's not)
    let feature_compiled_in = cfg!(feature = "game-capture-hook");
    match std::env::var("RALPH_GAME_CAPTURE_HOOK").ok().as_deref() {
        Some(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        // No env var → honour the compile-time feature flag as the default.
        None => feature_compiled_in,
    }
}

/// The runtime `Capture_Policy` setting for the session, read from the
/// `RALPH_CAPTURE_POLICY` environment variable (Req 5.1).
///
/// The dev script (`scripts/dev-deployed.ps1`) sets this variable so the
/// runtime setting wins over the build-feature default in development:
/// `"hook-exclusive"` ⇒ [`CapturePolicy::HookExclusive`], `"wgc-enabled"` ⇒
/// [`CapturePolicy::WgcEnabled`] (both case-insensitive, surrounding whitespace
/// trimmed). Any other value — including an unset variable — yields `None` so
/// [`resolve_capture_policy`] falls through to the build-feature default and,
/// failing that, the documented `wgc-enabled` default.
pub(crate) fn runtime_capture_policy() -> Option<CapturePolicy> {
    std::env::var("RALPH_CAPTURE_POLICY").ok().and_then(|v| {
        match v.trim().to_ascii_lowercase().as_str() {
            "hook-exclusive" => Some(CapturePolicy::HookExclusive),
            "wgc-enabled" => Some(CapturePolicy::WgcEnabled),
            _ => None,
        }
    })
}

/// The build-feature default `Capture_Policy` (Req 5.1).
///
/// Production installs should keep the hook available while still allowing the
/// guaranteed WGC fallback. The runtime env var `RALPH_CAPTURE_POLICY` (set by
/// dev scripts) still wins when present, so dev/CI can override without a
/// rebuild. Without the feature the default remains `None` and
/// [`resolve_capture_policy`] falls through to `wgc-enabled`.
pub(crate) fn feature_default_capture_policy() -> Option<CapturePolicy> {
    if cfg!(feature = "game-capture-hook") {
        Some(CapturePolicy::WgcEnabled)
    } else {
        None
    }
}

/// Whether a hook-injection `outcome` must trigger the "zero-copy hook
/// unavailable" user notification.
///
/// This is the pure decision that drives the `native-screen-share-status`
/// `"hook-unavailable…"` emit in [`start_native_screen_share`]: a hook attempt
/// that **failed** or was **blocked** (anti-cheat) falls back to WGC and must
/// notify the user (Req 6.3, 7.4). A [`InjectionOutcome::Success`] (the hook is
/// the active mode) or [`InjectionOutcome::NotAttempted`] (a monitor source or a
/// disabled hook, where WGC was always going to be used) is silent.
///
/// Extracted as a `pub fn` so the notification *decision* can be unit-tested at
/// a public seam without constructing a Tauri `AppHandle` (the `emit` itself
/// needs one and so cannot run in CI).
pub fn should_notify_hook_unavailable(outcome: InjectionOutcome) -> bool {
    matches!(
        outcome,
        InjectionOutcome::Failed | InjectionOutcome::Blocked
    )
}

/// Whether the Game_Capture_Hook may even be considered this session.
///
/// The hook is **doubly gated** (Req 12.2, 12.5): it is only built into the
/// binary behind the `game-capture-hook` Cargo feature, and even then it is
/// opt-in behind the `RALPH_GAME_CAPTURE_HOOK` environment variable
/// ([`game_capture_hook_enabled`]). On a `native-screen-share`-only build this
/// is always `false`, so [`SelectionInputs::hook_enabled`] is `false`, the v2
/// selection resolves to `wgc`, and the unavailable notification stays silent —
/// the session behaves as pure WGC.
pub(crate) fn hook_feature_enabled() -> bool {
    let compiled_in = cfg!(feature = "game-capture-hook");
    let env_on = game_capture_hook_enabled();
    // Loud, explicit diagnostics so a "why is the hook off?" investigation never
    // requires reading source. Each gate is reported independently because they
    // fail for very different reasons (build config vs runtime opt-in).
    if !compiled_in {
        log::info!(
            "[NativeShare] Game_Capture_Hook NOT compiled in (the `game-capture-hook` Cargo \
             feature is off in this build); using WGC. Rebuild with \
             `--features game-capture-hook` to enable the zero-copy hook."
        );
    } else if !env_on {
        // compiled_in is true but the env var was explicitly set to a falsy value.
        log::info!(
            "[NativeShare] Game_Capture_Hook compiled in but DISABLED at runtime \
             (RALPH_GAME_CAPTURE_HOOK explicitly set to a falsy value: 0/false/no/off); \
             using WGC. Unset the variable or set it to 1/true/yes/on to re-enable."
        );
    } else {
        log::info!(
            "[NativeShare] Game_Capture_Hook enabled (feature compiled in{}); the hook will \
             be attempted for an eligible window source.",
            if std::env::var("RALPH_GAME_CAPTURE_HOOK").is_ok() {
                " + RALPH_GAME_CAPTURE_HOOK override"
            } else {
                ", default-on"
            }
        );
    }
    compiled_in && env_on
}

/// The desktop setting "Game capture hook" (on by default). Off keeps every
/// share on WGC.
fn hook_setting_enabled<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    use tauri::Manager;
    let enabled = app
        .try_state::<crate::desktop_settings::DesktopSettingsStore>()
        .map(|store| store.settings().game_capture_hook)
        .unwrap_or(true);
    if !enabled {
        log::info!("[NativeShare] Game_Capture_Hook turned off in desktop settings; using WGC");
    }
    enabled
}

// ───────────────────────────────────────────────────────────────────────────
// Game_Capture_Hook session wiring (task 11.1) — gated behind
// `game-capture-hook` + `windows`. On the feature-off / non-Windows build none
// of this is compiled and the session is pure WGC (Req 12.5, 13.2).
// ───────────────────────────────────────────────────────────────────────────

/// The result of preparing a hook attach: the eligibility/safety/injection
/// facts the v2 selection needs as plain values, plus the live
/// [`GameCaptureHook`](crate::game_capture::dx11::GameCaptureHook) when injection
/// succeeded.
///
/// Built by [`prepare_hook`] before the v2 selection runs so
/// [`select_capture_mode_v2`] / [`fallback_reason`] decide the mode from these
/// values. When the resolved mode is not `hook` the `hook` field is dropped,
/// which detaches the injected payload and stops the IPC channel (Req 7.5).
#[cfg(all(feature = "game-capture-hook", windows))]
pub(crate) struct HookPreparation {
    /// The matching-bitness payload + helper are present next to the binary
    /// (Req 2.5); derived from `plan_injection` feasibility.
    artifact_available: bool,
    /// The anti-cheat blocklist/allowlist decision (Req 10.2, 10.3).
    safety: SafetyDecision,
    /// The outcome of the OBS `inject-helper` run (Req 7.4, 10.4).
    injection: InjectionOutcome,
    /// Whether the target renders on the same GPU adapter as the
    /// `Shared_D3D_Device` (Req 5.4, 9.4). Best-effort — see [`prepare_hook`].
    same_adapter: bool,
    /// The live hook over the OBS IPC reader, present only on a successful
    /// injection. Moved onto the hook capture thread when the mode is `hook`,
    /// or dropped (detached) on the WGC fallback path.
    hook: Option<crate::game_capture::dx11::GameCaptureHook>,
    /// Async OBS inject-helper process for safe compatibility injection. OBS
    /// keeps this process alive while IPC starts; the capture loop polls it for
    /// a non-zero exit without blocking first-frame startup.
    helper: Option<std::process::Child>,
    /// The present offset for the target backend was zero/absent, so the
    /// backend cannot install its Present interception (Req 4.6). When set, no
    /// injection was attempted and the session wiring records
    /// [`FallbackReason::BackendDisabled`] and uses WGC (Req 5.8). Distinct from
    /// an offset-*resolution* failure (helper missing/non-zero/timeout/empty),
    /// which leaves `injection = NotAttempted` so the reason is
    /// `InjectionFailed` instead (Req 4.7).
    missing_offsets: bool,
    /// The hook build chosen for this target (`None` when none was chosen).
    flavor: Option<crate::game_capture::obs_ipc::HookFlavor>,
    /// Attached to a stock hook already resident in the game; nothing injected.
    attached: bool,
    /// Open, verified handles to the signed files; held until the helper exits.
    verified: Option<crate::game_capture::signed_hook::VerifiedSet>,
    /// The anti-cheat-protected executable, so a failed attempt is remembered.
    protected_exe: Option<String>,
    /// Where the Vulkan layer manifests for this build live.
    layer_dir: Option<std::path::PathBuf>,
}

#[cfg(all(feature = "game-capture-hook", windows))]
impl HookPreparation {
    /// A preparation for a session where no injection was attempted (a monitor
    /// source, a disabled/feature-off hook, a non-window id, or a backend whose
    /// gate is off): nothing available, nothing injected, no hook.
    fn not_attempted() -> Self {
        Self {
            artifact_available: false,
            safety: SafetyDecision::Allow,
            injection: InjectionOutcome::NotAttempted,
            same_adapter: true,
            hook: None,
            helper: None,
            missing_offsets: false,
            flavor: None,
            attached: false,
            verified: None,
            protected_exe: None,
            layer_dir: None,
        }
    }
}

/// The host process bitness (compile-time): the running binary is 64-bit on a
/// 64-bit target and 32-bit otherwise. Feeds the pure `plan_injection` so the
/// host/target match decides Direct vs CrossBitness injection (Req 2.2, 2.3).
#[cfg(all(feature = "game-capture-hook", windows))]
fn host_bitness() -> crate::game_capture::inject::Bitness {
    use crate::game_capture::inject::Bitness;
    #[cfg(target_pointer_width = "64")]
    {
        Bitness::X64
    }
    #[cfg(not(target_pointer_width = "64"))]
    {
        Bitness::X86
    }
}

/// Resolve the owning process id of a top-level window handle.
///
/// Used to map the selected `"window-<hwnd>"` source to the Target_Process the
/// OBS `inject-helper` injects and the IPC channel binds to. Returns `None` when
/// the handle is invalid (no attach is then attempted).
#[cfg(all(feature = "game-capture-hook", windows))]
#[derive(Clone, Copy)]
struct WindowTarget {
    pid: u32,
    thread_id: u32,
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn window_target_from_hwnd(hwnd: isize) -> Option<WindowTarget> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    let mut pid: u32 = 0;
    let thread_id = unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut _), Some(&mut pid)) };
    if thread_id == 0 || pid == 0 {
        None
    } else {
        Some(WindowTarget { pid, thread_id })
    }
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn window_pid_from_hwnd(hwnd: isize) -> Option<u32> {
    window_target_from_hwnd(hwnd).map(|target| target.pid)
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn source_targets_current_process(source_id: &str) -> bool {
    use windows::Win32::System::Threading::GetCurrentProcessId;

    window_hwnd_from_id(source_id)
        .and_then(window_pid_from_hwnd)
        .map(|pid| pid == unsafe { GetCurrentProcessId() })
        .unwrap_or(false)
}

/// Whether the screen-share `source_id` still refers to a live capture target.
///
/// For a `window-<hwnd>` source this is `IsWindow(hwnd)` — it returns `false`
/// the moment the user closes the shared window, which lets the capture loop
/// stop the share cleanly instead of hanging in `capture-unavailable` (the hook
/// stops delivering frames when its target window is destroyed, but the no-frame
/// watchdog alone cannot tell "window closed" from "transient stall"). Monitor
/// sources (`screen-<idx>`) and any other id are always considered live here —
/// a monitor does not "close", and the WGC `Closed` event handles a monitor that
/// is physically removed. Non-window ids return `true` so they are never
/// spuriously stopped.
#[cfg(windows)]
pub(crate) fn source_still_live(source_id: &str) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    if let Some(raw) = source_id.strip_prefix("window-") {
        if let Ok(hwnd) = raw.parse::<isize>() {
            // IsWindow returns FALSE once the window is destroyed.
            return unsafe { IsWindow(Some(HWND(hwnd as *mut _))).as_bool() };
        }
    }
    true
}

/// Resolve a process's full executable image path for the anti-cheat safety
/// gate (Req 10.1, 10.2). The blocklist matcher normalizes to the final path
/// component case-insensitively, so the full path is fine. Returns `None` when
/// the process cannot be opened/queried — the caller then treats the target as
/// unidentifiable and **does not** inject (conservative: never inject a target
/// we cannot screen against the blocklist).
#[cfg(all(feature = "game-capture-hook", windows))]
fn process_image_name(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 260];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        result.ok()?;
        Some(String::from_utf16_lossy(&buf[..size as usize]))
    }
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn process_parent_pid(pid: u32) -> Option<u32> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let mut found = None;
    let mut walk = unsafe { Process32FirstW(snapshot, &mut entry) };
    while walk.is_ok() {
        if entry.th32ProcessID == pid {
            found = Some(entry.th32ParentProcessID);
            break;
        }
        entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        walk = unsafe { Process32NextW(snapshot, &mut entry) };
    }

    unsafe {
        let _ = CloseHandle(snapshot);
    }
    found
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn process_is_descendant_of(pid: u32, ancestor_pid: u32) -> bool {
    const MAX_ANCESTOR_DEPTH: usize = 16;

    let mut current = pid;
    for _ in 0..MAX_ANCESTOR_DEPTH {
        if current == ancestor_pid {
            return true;
        }

        let Some(parent) = process_parent_pid(current) else {
            return false;
        };
        if parent == 0 || parent == current {
            return false;
        }
        current = parent;
    }

    false
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn hook_log_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| {
        std::path::PathBuf::from(base)
            .join("RalphMeet")
            .join("logs")
    })
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn pid_from_graphics_hook_log(path: &std::path::Path) -> Option<u32> {
    let stem = path.file_stem()?.to_string_lossy();
    stem.strip_prefix("graphics-hook-")?.parse::<u32>().ok()
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn fresh_graphics_hook_pid_since(since: std::time::SystemTime) -> Option<u32> {
    let dir = hook_log_dir()?;
    let entries = std::fs::read_dir(dir).ok()?;
    let mut newest: Option<(std::time::SystemTime, u32)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(pid) = pid_from_graphics_hook_log(&path) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if modified < since {
            continue;
        }
        if newest.map(|(at, _)| modified > at).unwrap_or(true) {
            newest = Some((modified, pid));
        }
    }
    newest.map(|(_, pid)| pid)
}

#[cfg(all(feature = "game-capture-hook", windows))]
fn resolve_safe_injection_ipc_pid(
    selected_pid: u32,
    since: std::time::SystemTime,
    timeout: std::time::Duration,
) -> u32 {
    let started = std::time::Instant::now();
    let mut observed_pid = None;
    while started.elapsed() < timeout {
        if let Some(pid) = fresh_graphics_hook_pid_since(since) {
            observed_pid = Some(pid);
            if pid == selected_pid || process_is_descendant_of(pid, selected_pid) {
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }

    match observed_pid {
        Some(pid) if pid == selected_pid => {
            log::info!(
                "[NativeShare] observed graphics-hook diagnostics for selected pid {selected_pid}; keeping OBS IPC bound to selected pid"
            );
            selected_pid
        }
        Some(pid) if process_is_descendant_of(pid, selected_pid) => {
            log::info!(
                "[NativeShare] safe inject loaded graphics-hook in descendant pid {pid} of selected pid {selected_pid}; using observed pid for OBS IPC"
            );
            pid
        }
        Some(pid) => {
            log::warn!(
                "[NativeShare] safe inject observed unrelated graphics-hook pid {pid} while targeting pid {selected_pid}; ignoring it and keeping OBS IPC bound to selected pid"
            );
            selected_pid
        }
        None => {
            log::info!(
                "[NativeShare] no fresh graphics-hook diagnostics observed within {}ms after safe inject spawn; keeping OBS IPC bound to selected pid {selected_pid}",
                timeout.as_millis()
            );
            selected_pid
        }
    }
}

/// Decide hook eligibility and, when eligible, run the full injection
/// preparation for a window source.
///
/// Eligible only for a window source with the hook enabled and the backend's
/// gate on and active-capable (Req 3.1–3.3, 8.2). Anything else — including a
/// monitor source — returns [`HookPreparation::not_attempted`] (the safe WGC
/// default).
#[cfg(all(feature = "game-capture-hook", windows))]
#[allow(clippy::too_many_arguments)]
pub(crate) fn prepare_hook(
    d3d: &Arc<D3dDevice>,
    source_id: &str,
    source_kind: SourceKind,
    backend: GraphicsApiBackend,
    gate: BackendGate,
    hook_enabled: bool,
    foreign_hook_present: bool,
    fps: u32,
) -> HookPreparation {
    let eligible = hook_enabled
        && source_kind == SourceKind::Window
        && gate.enabled(backend)
        && backend.is_active_capable();
    if !eligible {
        return HookPreparation::not_attempted();
    }
    if source_targets_current_process(source_id) {
        log::info!(
            "[NativeShare] selected window belongs to the current RalphMeet process; skipping game-capture hook and keeping capture on WGC"
        );
        return HookPreparation::not_attempted();
    }
    // A competing OBS-derived hook (Discord Go Live / OBS Game Capture) is
    // already present. We still ATTEMPT our hook: two independent Detours hooks
    // on the same present can chain, so coexistence may work. The remedy was
    // logged at the detection site; the DLL's early-pipe diagnostics will now
    // report whether our present hook actually installs and delivers frames
    // alongside the foreign one. (We deliberately do NOT skip here — skipping
    // would guarantee failure whenever Discord is merely running, and would
    // also hide the diagnostic data we need.)
    if foreign_hook_present {
        log::info!(
            "[NativeShare] foreign hook present; attempting our hook anyway (Detours hooks can \
             chain). Watch the [graphics-hook pid N] diagnostics for whether our present hook \
             installs and delivers frames."
        );
    }
    match window_hwnd_from_id(source_id) {
        Some(hwnd) => attempt_hook_injection(d3d, hwnd, backend, fps),
        None => HookPreparation::not_attempted(),
    }
}

/// Run the OBS `inject-helper` + start the IPC reader for a window target, and
/// report the facts the v2 selection needs.
///
/// Flow (design §"Capture-mode and safety-gate selection"):
/// 1. Resolve the Target_Process id from the window (else `Failed`).
/// 2. Discover the OBS artifacts next to the binary and detect the target
///    bitness (`IsWow64Process2`); a detection failure is `Failed`.
/// 3. Pure `plan_injection` — its `Ok`/`Err(MissingArtifact)` is exactly the
///    `artifact_available` fact (Req 2.5).
/// 4. Resolve the target exe and run the **pure** `safety_decision` against the
///    default blocklist (no allowlist configured) — a `Deny` short-circuits
///    **before** injection so a blocklisted title is never injected (Req 10.2).
/// 5. Only on `Allow`: run the OBS `inject-helper` as a separate child process
///    (Req 1.1, 11.1) and, on success, start the [`ObsIpcChannel`] and build the
///    [`GameCaptureHook`].
///
/// `same_adapter` is best-effort: the target's render-adapter LUID is only
/// available through deeper OBS `hook_info` integration, so on the validated
/// single-GPU target this defaults to `true` (the `Shared_D3D_Device` is the
/// game's adapter). The multi-GPU cross-adapter hard-check via
/// [`d3d_device::same_adapter`](crate::d3d_device::same_adapter) is a known
/// integration limitation validated by the manual integration tests (task 11.4).
///
/// [`ObsIpcChannel`]: crate::game_capture::obs_ipc::ObsIpcChannel
/// [`GameCaptureHook`]: crate::game_capture::dx11::GameCaptureHook
#[cfg(all(feature = "game-capture-hook", windows))]
fn attempt_hook_injection(
    d3d: &Arc<D3dDevice>,
    hwnd: isize,
    backend: GraphicsApiBackend,
    fps: u32,
) -> HookPreparation {
    use crate::game_capture::blocklist::{
        anti_cheat_marker_near, default_blocklist, safety_decision,
    };
    use crate::game_capture::dx11::GameCaptureHook;
    use crate::game_capture::hook_policy::{self, choose_flavor, FlavorChoice, FlavorInputs};
    use crate::game_capture::inject::{
        detect_bitness, load_all_graphics_offsets, plan_injection, run_inject_helper,
        spawn_inject_helper_async, InjectionMode, ObsArtifacts,
    };
    use crate::game_capture::obs_ipc::{stock_host_active, HookFlavor, ObsIpcChannel};
    use crate::game_capture::signed_hook;

    let mut prep = HookPreparation::not_attempted();

    // 1. Target PID + window thread id from the window handle. Safe injection
    // mirrors OBS's anti-cheat compatibility mode and requires the thread id.
    let Some(target) = window_target_from_hwnd(hwnd) else {
        prep.injection = InjectionOutcome::Failed;
        return prep;
    };
    let target_pid = target.pid;
    let target_image = process_image_name(target_pid).unwrap_or_else(|| "<unknown>".to_string());
    log::info!(
        "[NativeShare] selected hook target hwnd={:#x} pid={} thread_id={} image={}",
        hwnd,
        target.pid,
        target.thread_id,
        target_image
    );

    // 2. Target bitness.
    let target_bitness = match detect_bitness(target_pid) {
        Ok(bitness) => bitness,
        Err(err) => {
            log::warn!("[NativeShare] bitness detection failed for pid {target_pid}: {err}");
            prep.injection = InjectionOutcome::Failed;
            return prep;
        }
    };

    // 3. Anti-cheat safety gate (pure). Resolve the target exe first; if it
    //    cannot be identified, do NOT inject (conservative — Req 10.1). The
    //    executable blocklist holds the anti-cheat services and the games
    //    under kernel anti-cheats (Vanguard, FACEIT) or VAC: always WGC.
    let Some(target_exe) = process_image_name(target_pid) else {
        log::warn!(
            "[NativeShare] could not resolve target exe for pid {target_pid}; skipping injection"
        );
        prep.injection = InjectionOutcome::Failed;
        return prep;
    };
    // Reasons decided before the artifacts are looked at must not be reported
    // as `missing_artifact`, which the selection checks first.
    let deny = |mut prep: HookPreparation, reason: FallbackReason| {
        prep.artifact_available = true;
        prep.safety = SafetyDecision::Deny(reason);
        prep
    };
    // No operator allowlist is configured here; an empty allowlist means
    // "allow any not-blocklisted target" (Req 10.3).
    if let SafetyDecision::Deny(reason) = safety_decision(&target_exe, &default_blocklist(), &[]) {
        log::info!(
            "[NativeShare] safety gate denied injection for {target_exe} (pid {target_pid}): {}",
            reason.as_str()
        );
        return deny(prep, reason);
    }

    // 4. Which hook build. A game with an Easy Anti-Cheat or BattlEye install
    //    marker gets only the OBS-signed hook (those vendors allowlist it), and
    //    one attempt per app run.
    let marker = anti_cheat_marker_near(std::path::Path::new(&target_exe));
    let protected = marker.is_some();
    let inputs = FlavorInputs {
        protected,
        protected_attempt_failed: protected && hook_policy::protected_attempt_failed(&target_exe),
        other_host_active: stock_host_active(target_pid),
        own_requested: hook_policy::own_flavor_requested(),
    };
    let flavor = match choose_flavor(&inputs) {
        FlavorChoice::Use(flavor) => flavor,
        FlavorChoice::Skip(reason) => {
            log::info!(
                "[NativeShare] not hooking {target_exe} (pid {target_pid}): {} \
                 (protected={protected}, other_host_active={})",
                reason.as_str(),
                inputs.other_host_active,
            );
            return deny(prep, reason);
        }
    };
    if let Some(marker) = &marker {
        log::info!(
            "[NativeShare] {target_exe} is anti-cheat protected (install marker {}); using the \
             OBS-signed hook only, one attempt this run",
            marker.display()
        );
        prep.protected_exe = Some(target_exe.clone());
    }
    prep.flavor = Some(flavor);

    // 5. The files for that build. The signed set is verified (SHA-256 against
    //    the lock, Authenticode, signer) and kept open until the helper exits.
    let artifacts = match flavor {
        HookFlavor::ObsSigned => {
            if signed_hook::bundled_dir().is_none() {
                log::info!(
                    "[NativeShare] the OBS-signed capture hook is not bundled with this build \
                     (run desktop/scripts/fetch-obs-signed-hook.ps1); using WGC"
                );
                return prep;
            }
            let verified = signed_hook::ensure_staged().and_then(|dir| {
                signed_hook::open_verified(&dir, &signed_hook::file_names(target_bitness))
            });
            match verified {
                Ok(set) => {
                    let lock = signed_hook::lock();
                    log::info!(
                        "[NativeShare] OBS-signed hook verified (OBS {}, hook {}, {:?}, signer {}) in {}",
                        lock.obs_version,
                        lock.hook_ver,
                        target_bitness,
                        lock.signer_subject,
                        set.dir.display()
                    );
                    let artifacts = ObsArtifacts::discover(&set.dir);
                    prep.layer_dir = Some(set.dir.clone());
                    prep.verified = Some(set);
                    artifacts
                }
                Err(err) => {
                    log::warn!(
                        "[NativeShare] OBS-signed hook failed verification: {err}; using WGC \
                         (hook_artifact_unverified)"
                    );
                    return deny(prep, FallbackReason::HookArtifactUnverified);
                }
            }
        }
        HookFlavor::Own => {
            log::warn!(
                "[NativeShare] RALPH_CAPTURE_HOOK_FLAVOR=own: using the unsigned fork build \
                 (development only)"
            );
            let artifacts = ObsArtifacts::discover_next_to_binary();
            prep.layer_dir = artifacts.dir();
            artifacts
        }
    };

    // Pure injection planning. Ok ⇒ the matching-bitness payload (+ helper)
    // are present (artifact_available); Err(MissingArtifact) ⇒ they are not
    // (Req 2.5) — leave injection NotAttempted so the reason is MissingArtifact.
    let strategy = match plan_injection(host_bitness(), target_bitness, &artifacts) {
        Ok(strategy) => {
            prep.artifact_available = true;
            strategy
        }
        Err(reason) => {
            log::info!(
                "[NativeShare] {} hook artifacts unavailable for {:?} target (pid {target_pid}): {}",
                flavor.as_str(),
                target_bitness,
                reason.as_str()
            );
            return prep;
        }
    };

    // 6. A stock hook already resident in the game (ours from an earlier
    //    share, or OBS's own copy; the stock DLL stays loaded until the game
    //    exits). Nobody is driving it (checked above), so attach to it instead
    //    of injecting a second copy, after checking the loaded module is
    //    signed by the OBS Project.
    let mut attach = false;
    if flavor == HookFlavor::ObsSigned
        && crate::game_capture::obs_ipc::foreign_obs_hook_present(target_pid)
    {
        let module = crate::game_capture::vulkan_layer::process_hook_module_path(target_pid);
        match module.as_deref().map(signed_hook::is_obs_signed_module) {
            Some(Ok(signer)) => {
                log::info!(
                    "[NativeShare] attaching to the stock hook already loaded in pid {target_pid} \
                     ({}, signer {} {})",
                    module
                        .as_deref()
                        .map(|p| p.display().to_string())
                        .unwrap_or_default(),
                    signer.subject,
                    signer.thumbprint
                );
                attach = true;
            }
            other => {
                log::warn!(
                    "[NativeShare] pid {target_pid} has CaptureHook_ objects from a hook that is \
                     not a verified OBS-signed graphics-hook ({:?}); using WGC (hook_in_use)",
                    other.map(|r| r.map(|s| s.subject))
                );
                return deny(prep, FallbackReason::HookInUse);
            }
        }
    }
    prep.attached = attach;

    // A Vulkan game is hooked through the implicit layer, which attaches only
    // at vkCreateInstance. Without a graphics-hook module already in the game
    // there is nothing to drive; do not inject a DLL into it for nothing.
    if backend == GraphicsApiBackend::Vulkan
        && !crate::game_capture::vulkan_layer::process_has_hook_module(target_pid)
    {
        log::info!(
            "[NativeShare] Vulkan target pid {target_pid} has no capture layer loaded (the layer \
             is registered only during hook shares, so a game started before the share has \
             none); skipping injection and using WGC (backend_disabled)"
        );
        prep.missing_offsets = true;
        return prep;
    }

    // 7. Resolve the hook vtable offsets for ALL backends for the TARGET
    //    bitness by running get-graphics-offsets<bits>.exe from the same set
    //    as the DLL. The injected DLL cannot install its Present interception
    //    without these. Two failure modes feed two fallback reasons:
    //
    //    a) `None`: the helper is missing, exited non-zero, timed out (>5s), or
    //       produced no parseable output (Req 4.7). Leave `injection =
    //       NotAttempted` so the pure `fallback_reason` reports
    //       `InjectionFailed`.
    //    b) `Some` but the present offset for the target backend is zero
    //       (Req 4.6): record `missing_offsets` (`BackendDisabled`, Req 5.8).
    let Some(all_offsets) = load_all_graphics_offsets(&artifacts, target_bitness, target_pid)
    else {
        log::warn!(
            "[NativeShare] graphics offset resolution failed for pid {target_pid} ({:?}); \
             skipping injection and falling back to WGC",
            target_bitness,
        );
        return prep;
    };

    // DX11 and DX12 present through DXGI, so the gate is the DXGI `present`
    // offset (and `resize`, via `dxgi.hookable()`). Vulkan/OpenGL do not hook
    // via hook_info offsets.
    let backend_hookable = match backend {
        GraphicsApiBackend::Dx11 | GraphicsApiBackend::Dx12 => all_offsets.dxgi.hookable(),
        GraphicsApiBackend::Vulkan | GraphicsApiBackend::OpenGl => true,
    };
    if !backend_hookable {
        log::warn!(
            "[NativeShare] {} hook offsets are not hookable for pid {target_pid} \
             (dxgi.present={:#x}, dxgi.resize={:#x}); skipping injection and falling back to WGC \
             (backend_disabled)",
            backend.as_str(),
            all_offsets.dxgi.present,
            all_offsets.dxgi.resize,
        );
        prep.missing_offsets = true;
        return prep;
    }

    let frame_interval_ns = if fps > 0 {
        1_000_000_000u64 / fps as u64
    } else {
        0
    };
    let start_channel = |pid: u32| {
        ObsIpcChannel::start_flavor(
            flavor,
            pid,
            all_offsets.clone(),
            frame_interval_ns,
            crate::game_capture::obs_ipc::DEFAULT_FRAME_WAIT_MS,
        )
    };
    // The stock DLL opens its log pipe once, as it loads, and checks the
    // keepalive mutex: like OBS's own host, create both before injecting.
    // (The fork retries its pipe, and its IPC pid is only known after the
    // helper has run; it starts the channel after injection.)
    let mut early_channel = None;
    if !flavor.writes_pid_log() {
        match start_channel(target_pid) {
            Ok(ipc) => early_channel = Some(ipc),
            Err(err) => {
                log::warn!(
                    "[NativeShare] OBS IPC channel failed to start for pid {target_pid}: {err}; \
                     not injecting, falling back to WGC"
                );
                prep.injection = InjectionOutcome::Failed;
                return prep;
            }
        }
    }

    // 8. Inject (unless attaching): run the safe inject-helper as a SEPARATE
    //    child process (no GPL linkage, Req 11.1, 11.2), but do not wait for
    //    it. OBS compatibility injection posts messages for up to four seconds
    //    while the host opens IPC objects and signals Initialize.
    let inject_started_at = std::time::SystemTime::now();
    let helper = if attach {
        prep.injection = InjectionOutcome::Success;
        None
    } else {
        match spawn_inject_helper_async(
            strategy,
            &artifacts,
            InjectionMode::Safe {
                thread_id: target.thread_id,
            },
        ) {
            Ok(child) => {
                prep.injection = InjectionOutcome::Success;
                Some(child)
            }
            Err(outcome) => {
                log::warn!(
                    "[NativeShare] safe inject-helper could not spawn for pid {target_pid} thread {}; retrying direct injection",
                    target.thread_id
                );
                let direct = run_inject_helper(
                    strategy,
                    &artifacts,
                    InjectionMode::Direct { pid: target_pid },
                );
                prep.injection = if direct.is_success() { direct } else { outcome };
                None
            }
        }
    };
    let outcome = prep.injection;
    prep.helper = helper;
    // Only the fork writes graphics-hook-<pid>.log, which tells which process
    // the safe injection actually loaded the DLL into.
    let ipc_pid = if prep.helper.is_some() && flavor.writes_pid_log() {
        resolve_safe_injection_ipc_pid(
            target_pid,
            inject_started_at,
            std::time::Duration::from_millis(1200),
        )
    } else {
        target_pid
    };
    log::info!(
        "[NativeShare] {} hook for selected pid {target_pid} ipc pid {ipc_pid} thread {} ({:?}) -> {:?}{}",
        flavor.as_str(),
        target.thread_id,
        target_bitness,
        outcome,
        if attach {
            " (attached to resident hook)"
        } else if prep.helper.is_some() {
            " (async safe)"
        } else {
            ""
        }
    );

    // 9. Start the IPC reader (publishing ALL backend offsets into hook_info)
    //    and build the hook. The frame interval caps the DLL's per-present
    //    shared-texture copy at the negotiated encode rate. `fps == 0` means
    //    "no cap" (interval 0 ⇒ the DLL captures every present).
    if outcome.is_success() {
        let channel = match early_channel.take() {
            Some(ipc) => Ok(ipc),
            None => start_channel(ipc_pid),
        };
        match channel {
            Ok(ipc) => {
                prep.hook = Some(GameCaptureHook::new(Arc::clone(d3d), ipc, backend, ipc_pid));
            }
            Err(err) => {
                log::warn!(
                    "[NativeShare] OBS IPC channel failed to start for pid {target_pid}: {err}; \
                     falling back to WGC"
                );
                // A successful injection we cannot read from is a failed attempt.
                prep.injection = InjectionOutcome::Failed;
            }
        }
    }

    prep
}

/// A live Game_Capture_Hook capture thread: pulls hook surfaces and feeds them
/// into the encoder in place of WGC. Owned by its
/// [`ShareSession`](super::session::ShareSession); the thread exits when the
/// session's cancellation token fires, and stopping joins it. The thread runs
/// [`GameCaptureHook::detach`](crate::game_capture::dx11::GameCaptureHook::detach)
/// on the way out, releasing the shared surface + IPC channel (Req 1.6, 7.4),
/// and drops any WGC capture it started on a mid-session fallback.
#[cfg(all(feature = "game-capture-hook", windows))]
pub struct HookCaptureSession {
    cancel: CancelToken,
    join: Option<std::thread::JoinHandle<()>>,
}

/// Lets the hook thread retire the WGC pre-roll once the first hook frame
/// arrives.
#[cfg(all(feature = "game-capture-hook", windows))]
#[derive(Clone)]
pub(crate) struct HookWgcPrerollController {
    pub(crate) frame_gate: Arc<std::sync::atomic::AtomicBool>,
    pub(crate) wgc_capture: Arc<StdMutex<Option<crate::wgc_capture::WgcCapture>>>,
}

#[cfg(all(feature = "game-capture-hook", windows))]
impl HookCaptureSession {
    /// Cancel (the session token, which the thread watches) and join. Blocks;
    /// session teardown calls it off the async runtime. Idempotent.
    pub(crate) fn stop(&mut self) {
        self.cancel.cancel();
        if let Some(handle) = self.join.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(all(feature = "game-capture-hook", windows))]
impl Drop for HookCaptureSession {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Everything the hook capture thread needs from its session.
#[cfg(all(feature = "game-capture-hook", windows))]
pub(crate) struct HookThreadContext<R: tauri::Runtime> {
    pub(crate) hook: crate::game_capture::dx11::GameCaptureHook,
    pub(crate) helper: Option<std::process::Child>,
    /// Verified signed files, held open until the helper has exited.
    pub(crate) verified: Option<crate::game_capture::signed_hook::VerifiedSet>,
    /// Set for an anti-cheat-protected target: a failed attempt is remembered.
    pub(crate) protected_exe: Option<String>,
    pub(crate) d3d: Arc<D3dDevice>,
    pub(crate) source_id: String,
    pub(crate) frames: crate::wmf_encoder::FrameSender,
    pub(crate) stats: Arc<NativeShareStats>,
    pub(crate) frame_interval_ns: Arc<std::sync::atomic::AtomicU64>,
    pub(crate) hook_exclusive: bool,
    pub(crate) first_frame_timeout: Duration,
    pub(crate) app: tauri::AppHandle<R>,
    pub(crate) wgc_preroll: Option<HookWgcPrerollController>,
    pub(crate) cancel: CancelToken,
    pub(crate) ender: SessionEnder,
}

/// Spawn the background hook capture thread and return its
/// [`HookCaptureSession`] handle.
#[cfg(all(feature = "game-capture-hook", windows))]
pub(crate) fn spawn_hook_capture_session<R: tauri::Runtime>(
    ctx: HookThreadContext<R>,
) -> HookCaptureSession {
    let cancel = ctx.cancel.clone();
    let join = std::thread::Builder::new()
        .name("RalphHookCapture".into())
        .spawn(move || run_hook_capture_loop(ctx))
        .ok();
    HookCaptureSession { cancel, join }
}

/// Why the hook capture loop ([`run_hook_capture_loop`]) stopped delivering
/// frames — drives whether the share continues, falls back, or ends.
#[cfg(all(feature = "game-capture-hook", windows))]
enum HookLoopOutcome {
    /// The session's stop flag was set (the user stopped the share, or the
    /// session is being torn down). Nothing more to do.
    CleanStop,
    /// The captured source is gone for good — the shared window was closed or
    /// the target process exited. Neither the hook nor WGC can capture a source
    /// that no longer exists, so the share is ENDED (the renderer is signalled
    /// to tear it down) rather than falling back or hanging in
    /// `capture-unavailable`. Carries the reason for stats/diagnostics.
    SourceGone(FallbackReason),
    /// The hook stopped delivering frames while the source is still alive (a
    /// transient stall, an IPC error, or a no-frame watchdog timeout). This is
    /// recoverable: under `wgc-enabled` the session falls back to WGC; under
    /// `hook-exclusive` it transitions to `capture-unavailable`. Carries the
    /// reason.
    FallbackToWgc(FallbackReason),
}

/// The hook capture loop: pull zero-copy hook surfaces, feed the encoder frame
/// channel in place of WGC (Req 7.1), and apply the resolved `Capture_Policy`
/// mid-session on a target exit or a no-frame watchdog timeout without ever
/// terminating the session.
///
/// Retain-at-most-one (Req 7.5) is enforced by waiting for each delivered
/// frame's release token (set by the encoder after its fused-blit read, or on
/// frame drop) before pulling the next surface, so exactly one opened surface is
/// live at a time. A run of no-frame results (or an IPC error, or a detected
/// target exit) past the watchdog deadline detaches the hook and then applies
/// the resolved policy (Req 5.2, 5.3):
///
///   * `wgc-enabled` (`hook_exclusive == false`) — start WGC as the guaranteed
///     fallback, record the reason, and notify the user (the prior behavior).
///   * `hook-exclusive` (`hook_exclusive == true`) — do NOT start WGC; set the
///     capture-unavailable status with the reason, stop delivering frames,
///     retain the resolved policy in stats, and park until stop (Req 5.3).
///
/// Negotiated capture parameters (Req 9.1, 9.3): the loop populates the
/// negotiated width/height/fps in `NativeShareStats` from the first forwarded
/// hook surface's dimensions (the size the encoder receives) and the session
/// `fps`, and re-publishes them whenever a later surface arrives at different
/// dimensions (a swapchain resize/renegotiation, Req 10.6) so the reported
/// parameters update no later than the next stats read. Until the first surface
/// resolves, the not-yet-negotiated sentinel cleared at session start stands
/// (Req 9.4).
///
/// This is GPU/IPC-bound host wiring; the real injection/IPC/zero-copy behavior
/// is validated by the manual integration tests (task 11.4). The control flow
/// (watchdog → detach → policy branch → park until stop) is what those tests
/// exercise on hardware.
#[cfg(all(feature = "game-capture-hook", windows))]
fn run_hook_capture_loop<R: tauri::Runtime>(ctx: HookThreadContext<R>) {
    use std::sync::atomic::Ordering as AtomicOrdering;
    use std::time::Instant;
    use tauri::Emitter;

    let HookThreadContext {
        mut hook,
        mut helper,
        mut verified,
        protected_exe,
        d3d,
        source_id,
        frames: frame_tx,
        stats,
        frame_interval_ns,
        hook_exclusive,
        first_frame_timeout,
        app,
        wgc_preroll,
        cancel,
        ender,
    } = ctx;

    /// Encoder-stall watchdog: how long to wait for the encoder to RELEASE a
    /// delivered frame's shared surface before concluding the **encoder** (not
    /// the hook) is wedged and falling back. This guards only the
    /// retain-at-most-one release wait — a frame was captured and handed off,
    /// but the encoder never finished with it. Generous, because a brief encoder
    /// hitch (GPU contention, a quality reconfigure) is recoverable and should
    /// not tear down the session.
    const ENCODER_STALL_TIMEOUT: Duration = Duration::from_secs(5);
    // Initial-hook watchdog: how long to wait for the FIRST frame after
    // `Initialize` before concluding the hook never installed (dead/foreign-
    // blocked) and falling back. Policy decides the bound: WGC-enabled sessions
    // use a short speculative-hook timeout, while hook-exclusive keeps the
    // longer hook-only diagnostic wait.
    /// Idle poll interval when no new present is available this round.
    /// 4 ms is well under one frame at 30 fps (33 ms) while cutting
    /// scheduler wakeups 4× vs the prior 1 ms constant.
    const IDLE_POLL: Duration = Duration::from_millis(4);
    /// Encoder-release wait: the release token is polled via `WaitOnAddress`
    /// so the thread blocks with zero CPU cost until the encoder signals it,
    /// falling back to a 2 ms timeout to handle spurious wake-ups and ensure
    /// we still honour the `ENCODER_STALL_TIMEOUT` watchdog.
    const RELEASE_POLL_TIMEOUT_MS: u32 = 2;

    // Defensive COM init: the mid-session WGC fallback below re-creates a WGC
    // capture item (a WinRT activation) on this thread. Harmless if COM is
    // already initialised (RPC_E_CHANGED_MODE is ignored). The actual
    // mid-session WGC restart is validated by the hardware-gated integration
    // tests (task 11.4).
    unsafe {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    // Target interval for the periodic hook-stats log entry (Req 6.5, 10.4).
    const STATS_LOG_INTERVAL: Duration = Duration::from_millis(1000);

    // Cumulative delivery counters for the periodic stats log (Req 6.5):
    // `frames_received` counts surfaces pulled from the hook, `frames_forwarded`
    // counts surfaces handed to the encoder channel.
    let mut frames_received: u64 = 0;
    let mut frames_forwarded: u64 = 0;
    let mut last_stats_log = Instant::now();
    // Backend / pid are fixed for the session; snapshot them once so the
    // periodic log can read them without re-borrowing `hook` (which is borrowed
    // mutably by `next_captured_frame` inside the loop).
    let hook_pid = hook.target_pid();
    let hook_backend = hook.backend();
    log::info!(
        "[NativeShare] hook capture loop started target_pid={} backend={} source_id={} policy={} first_frame_timeout_ms={} wgc_preroll={}",
        hook_pid,
        hook_backend.as_str(),
        source_id,
        if hook_exclusive {
            CapturePolicy::HookExclusive.as_str()
        } else {
            CapturePolicy::WgcEnabled.as_str()
        },
        first_frame_timeout.as_millis(),
        wgc_preroll.is_some(),
    );
    // The truthful active backend the DLL actually hooked (Vulkan/DXGI/D3D9/…),
    // read live from `hook_info.hooked_api`. Starts as the host's module-based
    // guess and is corrected to the real API the moment the DLL reports it (so
    // a Vulkan game mis-guessed as dx11 is relabeled). Tracked here so the
    // periodic stats log shows the real backend and `set_active_backend_hooked`
    // updates `Capture_Status` once.
    let mut reported_hooked_api = crate::game_capture::obs_ipc::HookedApi::None;
    // The capture-rate cap last pushed into the live `hook_info.frame_interval`.
    // A live quality switch updates the shared `frame_interval_ns` atomic; when
    // it differs from this we write it into the DLL mapping so the DLL's
    // shtex-copy rate follows the new fps (e.g. 30→60) without re-injection.
    // Seeded so the first loop iteration syncs the session's initial interval.
    let mut applied_frame_interval_ns: u64 = u64::MAX;

    // Emit the periodic stats entry when the cadence has elapsed (Req 6.5,
    // 10.4). Invoked both at the top of the outer loop and inside the
    // release-wait below so that a long encoder wait (up to NO_FRAME_TIMEOUT)
    // never leaves more than ~2000ms between consecutive entries. Kept DRY as a
    // local macro because it must borrow the loop-local counters by value.
    macro_rules! maybe_log_hook_stats {
        () => {
            if last_stats_log.elapsed() >= STATS_LOG_INTERVAL {
                // Surface per-frame GPU + encode timing (EWMA, ns→µs) alongside
                // the delivery counts so the capture overhead is profilable from
                // logs alone: `gpu_us` is the fused VideoProcessorBlt
                // (BGRA→NV12 + scale) cost on the shared D3D device (this is the
                // work that competes with the game's GPU), `enc_us` is the MFT
                // ProcessInput submit cost. A spike in `gpu_us` points at the VP
                // normalize-copy path; high `enc_us` points at the encoder.
                let gpu_us = stats.fused_gpu_ns_ewma.load(AtomicOrdering::Relaxed) / 1000;
                let enc_us = stats.encode_submit_ns_ewma.load(AtomicOrdering::Relaxed) / 1000;
                // Raw (un-smoothed) worst single VP-blit in THIS interval — read
                // and reset so a transient spike (correlates with a game stutter)
                // surfaces in the logs instead of being averaged away by the EWMA.
                let gpu_max_us = stats.take_fused_gpu_ns_window_max() / 1000;
                let dropped = stats.dropped_frames.load(AtomicOrdering::Relaxed);
                let backend_label = if reported_hooked_api.is_hooked() {
                    reported_hooked_api.as_str()
                } else {
                    hook_backend.as_str()
                };
                log::info!(
                    "[NativeShare] hook stats (pid {}, backend {}): received={}, forwarded={}, \
                     dropped={}, gpu_us={}, gpu_max_us={}, enc_us={}",
                    hook_pid,
                    backend_label,
                    frames_received,
                    frames_forwarded,
                    dropped,
                    gpu_us,
                    gpu_max_us,
                    enc_us
                );
                last_stats_log = Instant::now();
            }
        };
    }

    let mut last_progress = Instant::now();
    let hook_loop_started_at = Instant::now();
    let mut promoted_from_wgc_preroll = false;
    // Present-accurate delivery: the IPC channel returns `Some` exactly once per
    // genuinely-new captured present (it watches the DLL's per-present
    // `hook_info.frame_count`), and `None` otherwise. So the loop simply
    // forwards whatever the channel yields — the cadence is the game's true
    // present rate, capped at the negotiated encode rate by the DLL's
    // `frame_interval`. No wall-clock pacer: we never re-encode a duplicate of a
    // frame the game did not actually present, and we never sleep past a real
    // new frame. A short idle sleep on `None` keeps the poll from busy-spinning.
    // (IDLE_POLL = 4 ms is defined at the top of this function.)
    // The loop yields a `HookLoopOutcome` describing why hook delivery ended:
    // a clean session stop, a recoverable fallback-to-WGC, or a terminal
    // source-gone that should END the whole share (the shared window was closed
    // / the target process exited — neither the hook nor WGC can capture a
    // source that no longer exists, so hanging in `capture-unavailable` or
    // flipping to a dead WGC item is wrong; we stop the share like Discord does).
    let outcome: HookLoopOutcome = loop {
        // Periodic delivery stats on a ~1000ms cadence (Req 6.5, 10.4).
        maybe_log_hook_stats!();

        // Live capture-rate sync: a quality switch updates the shared interval
        // atomic; push any change into the DLL's `hook_info.frame_interval` so
        // its shtex-copy rate follows the new fps (e.g. 30→60) without a
        // re-injection or stream restart. Cheap unsynchronized read; only writes
        // the mapping when the value actually changed.
        let desired_interval = frame_interval_ns.load(AtomicOrdering::Relaxed);
        if desired_interval != applied_frame_interval_ns {
            hook.set_capture_frame_interval(desired_interval);
            applied_frame_interval_ns = desired_interval;
            log::info!(
                "[NativeShare] capture frame_interval updated to {} ns (DLL copy-rate cap follows fps)",
                desired_interval
            );
        }

        if cancel.is_cancelled() {
            break HookLoopOutcome::CleanStop; // clean session stop
        }
        // Source window closed by the user → the share's source is gone for
        // good; end the share (do not fall back to a WGC item that can no longer
        // resolve the window). Detected directly via IsWindow, so we don't wait
        // out the no-frame watchdog or mislabel it as a transient stall.
        if !source_still_live(&source_id) {
            log::info!(
                "[NativeShare] shared source {} closed (window destroyed); ending screen share",
                source_id
            );
            break HookLoopOutcome::SourceGone(FallbackReason::TargetExited);
        }
        // Target process exited after a successful frame → the source is gone;
        // end the share. Before the first frame, safe compatibility injection may
        // transiently bind IPC to the process that loaded the DLL while the
        // selected source window remains alive, so the window liveness check
        // above is the authority during startup.
        if frames_received > 0 && hook.target_exited() {
            log::info!(
                "[NativeShare] target process for source {} exited; ending screen share",
                source_id
            );
            break HookLoopOutcome::SourceGone(FallbackReason::TargetExited);
        }

        if helper.is_none() && verified.is_some() {
            // The helper has exited (or none ran): the files may be released.
            verified = None;
        }
        if let Some(child) = helper.as_mut() {
            if let Some(outcome) = crate::game_capture::inject::poll_async_helper(child) {
                helper = None;
                if !outcome.is_success() && frames_received == 0 {
                    log::warn!(
                        "[NativeShare] async inject-helper exited with {:?} before the hook delivered a frame; falling back",
                        outcome
                    );
                    break HookLoopOutcome::FallbackToWgc(FallbackReason::InjectionFailed);
                }
                log::info!(
                    "[NativeShare] async inject-helper completed with {:?}; continuing hook IPC",
                    outcome
                );
            }
        }

        match hook.next_captured_frame(u32::MAX, u32::MAX) {
            Ok(Some(frame)) => {
                if !promoted_from_wgc_preroll {
                    if let Some(controller) = wgc_preroll.as_ref() {
                        controller.frame_gate.store(false, AtomicOrdering::Release);
                        if let Ok(mut wgc) = controller.wgc_capture.lock() {
                            *wgc = None;
                        }
                        promoted_from_wgc_preroll = true;
                        stats.set_capture_mode(CaptureMode::Hook);
                        stats.set_active_backend(Some(hook_backend));
                        stats.set_fallback_reason(FallbackReason::None);
                        log::info!(
                            "[NativeShare] first hook frame arrived after {}ms; promoted live source from WGC pre-roll to hook (target_pid={}, backend={}, frames_received={}, frames_forwarded={})",
                            hook_loop_started_at.elapsed().as_millis(),
                            hook_pid,
                            hook_backend.as_str(),
                            frames_received,
                            frames_forwarded,
                        );
                        let _ = app.emit(
                            "native-screen-share-status",
                            "hook-promoted: first hook frame arrived; switching from WGC pre-roll to hook"
                                .to_string(),
                        );
                    }
                }
                if frames_received == 0 {
                    stats.set_hook_version(hook.hook_version());
                }
                frames_received += 1;
                last_progress = Instant::now();
                // Correct the reported backend to the API the DLL actually
                // hooked (truthful, no module guessing). Cheap volatile read;
                // only act when it first becomes known or changes.
                let live_api = hook.hooked_api();
                if live_api != reported_hooked_api && live_api.is_hooked() {
                    reported_hooked_api = live_api;
                    stats.set_active_backend_hooked(live_api, hook_backend);
                    log::info!(
                        "[NativeShare] active backend resolved from hook: {} (host module guess was {})",
                        live_api.as_str(),
                        hook_backend.as_str(),
                    );
                }
                // Hook surfaces arrive at the swapchain size; the encoder
                // detects a size change, refits the aspect ratio inside the
                // quality box, and publishes the negotiated parameters.
                let release = Arc::clone(&frame.release);
                if frame_tx.try_send(frame) {
                    frames_forwarded += 1;
                } else {
                    // Encoder channel full or closed — the returned frame is
                    // dropped here, which sets `release` (Req 7.5 never blocks
                    // the hook's surface supply). Count the drop.
                    stats.dropped_frames.fetch_add(1, AtomicOrdering::Relaxed);
                }
                // Retain-at-most-one (Req 7.5): do NOT open the next surface
                // until the encoder has finished reading this one (its release
                // token fires after the fused blit, or immediately on the drop
                // above). The encoder must keep up; if its release never fires
                // within the watchdog window the ENCODER (not the hook) has
                // genuinely stalled — fall back rather than loop (which would
                // open a second surface and break retain-at-most-one).
                let mut stalled = false;
                while !release.load(AtomicOrdering::Acquire) {
                    if cancel.is_cancelled() {
                        break;
                    }
                    if last_progress.elapsed() > ENCODER_STALL_TIMEOUT {
                        stalled = true;
                        break;
                    }
                    // Keep the stats cadence alive during a long release wait so
                    // the gap between entries stays under 2000ms (Req 6.5).
                    maybe_log_hook_stats!();
                    // Block until the encoder sets the release flag (or timeout).
                    // `WaitOnAddress` wakes as soon as the byte at `release`
                    // differs from `expected_false` — consuming zero CPU while
                    // idle, vs the prior 2 ms busy-poll (~500 syscalls/s).
                    let expected_false: u8 = 0;
                    #[cfg(windows)]
                    unsafe {
                        use windows::Win32::System::Threading::WaitOnAddress;
                        // SAFETY: AtomicBool is a single byte; we read the raw
                        // pointer for WaitOnAddress (compare-and-wait semantics).
                        let _ = WaitOnAddress(
                            release.as_ptr().cast::<std::ffi::c_void>(),
                            std::ptr::addr_of!(expected_false).cast::<std::ffi::c_void>(),
                            1,
                            Some(RELEASE_POLL_TIMEOUT_MS),
                        );
                    }
                    #[cfg(not(windows))]
                    std::thread::sleep(Duration::from_millis(RELEASE_POLL_TIMEOUT_MS as u64));
                }
                if stalled {
                    log::warn!(
                        "[NativeShare] encoder did not release a frame within {}s — encoder \
                         stalled; falling back",
                        ENCODER_STALL_TIMEOUT.as_secs()
                    );
                    break HookLoopOutcome::FallbackToWgc(FallbackReason::HookStoppedMidSession);
                }
                // No wall-clock pacing: `next_captured_frame` already gates on
                // the DLL's per-present counter, so the next pull blocks (via
                // the channel's poll) until the game actually presents a new
                // frame. Loop straight back to pull the next genuine present.
            }
            Ok(None) => {
                // No new present this round. This is NORMAL and expected for
                // long stretches: a game between presents, a loading screen, a
                // paused/minimized game, an alt-tab, or a swapchain recreation
                // (resolution/format change) all stop presents for seconds at a
                // time. The DLL keeps its present interception installed across
                // all of these (a Vulkan swapchain recreate re-inits via
                // OBS_CreateSwapchainKHR), so `frame_count` simply resumes
                // advancing when the game presents again — and we deliver again.
                //
                // Therefore, once the hook has delivered at least one frame, a
                // present stall is NOT a hook failure as long as the source
                // window and target process are still alive (both checked at the
                // loop top, which END the share when they genuinely go away). We
                // do NOT tear the hook down here — doing so was the
                // "hook died at the loading screen" bug: a few seconds of no
                // presents permanently flipped the session to capture-unavailable
                // even though the game was about to resume. We just idle and keep
                // waiting; delivery resumes the instant the game presents.
                //
                // The ONLY watchdog that still fires is the INITIAL one: until
                // the first frame ever arrives, a bounded wait distinguishes a
                // genuinely dead/never-installing hook (→ fall back) from one
                // still settling. After that, source-liveness is the authority.
                if hook.version_unsupported() {
                    break HookLoopOutcome::FallbackToWgc(FallbackReason::HookVersionUnsupported);
                }
                if frames_received == 0 && last_progress.elapsed() > first_frame_timeout {
                    // No hook objects ever appeared: the DLL never loaded in
                    // the target (an anti-cheat refusing it, typically).
                    let reason = if hook.ipc_initialized() {
                        FallbackReason::HookNoFirstFrame
                    } else {
                        FallbackReason::HookNotLoaded
                    };
                    log::warn!(
                        "[NativeShare] no first frame within {}ms of Initialize — hook never \
                         delivered ({}); falling back",
                        first_frame_timeout.as_millis(),
                        reason.as_str()
                    );
                    break HookLoopOutcome::FallbackToWgc(reason);
                }
                std::thread::sleep(IDLE_POLL);
            }
            Err(err) => {
                log::warn!("[NativeShare] hook capture error: {err}; falling back to WGC");
                break HookLoopOutcome::FallbackToWgc(FallbackReason::HookStoppedMidSession);
            }
        }
    };

    // Tear the hook down (release the shared surface + stop the IPC channel)
    // before either returning or starting the WGC fallback (Req 1.6, 7.4).
    hook.detach();

    let reason = match outcome {
        HookLoopOutcome::CleanStop => {
            // Clean stop — the session is being torn down; nothing more to do.
            return;
        }
        HookLoopOutcome::SourceGone(reason) => {
            // The shared window was closed / the target process exited. The
            // source no longer exists, so neither the hook nor WGC can capture
            // it — end the share entirely (the production-correct behavior,
            // matching Discord) instead of hanging in `capture-unavailable` or
            // flipping to a dead WGC item. Signal the frontend to tear the share
            // down via a dedicated event; the session's frames simply stop.
            log::info!(
                "[NativeShare] source gone (reason={}, frames_received={}, frames_forwarded={}); \
                 ending native screen share",
                reason.as_str(),
                frames_received,
                frames_forwarded,
            );
            stats.set_capture_unavailable(false);
            stats.set_fallback_reason(reason);
            stats.clear_negotiated_params();
            // End this session; the renderer is told (`native-screen-share-ended`
            // with reason `source-closed`) and stops the share.
            ender(EndReason::SourceClosed(reason.as_str().to_string()));
            return;
        }
        HookLoopOutcome::FallbackToWgc(reason) => reason,
    };
    if frames_received == 0 {
        if let Some(exe) = protected_exe.as_deref() {
            crate::game_capture::hook_policy::record_protected_failure(exe);
        }
    }

    if wgc_preroll.is_some() && !promoted_from_wgc_preroll {
        // The WGC pre-roll stays the active capture; record why the hook lost
        // so stats and the streaming panel show `WGC · <reason>`, not `none`.
        stats.set_fallback_reason(reason);
        log::info!(
            "[NativeShare] capture_mode=wgc reason={} — hook probe ended before promotion after {}ms (target_pid={}, backend={}, frames_received={}, frames_forwarded={}); leaving WGC pre-roll active",
            reason.as_str(),
            hook_loop_started_at.elapsed().as_millis(),
            hook_pid,
            hook_backend.as_str(),
            frames_received,
            frames_forwarded,
        );
        let _ = app.emit(
            "native-screen-share-status",
            format!(
                "hook-unavailable: zero-copy game-capture hook unavailable ({}); continuing screen share on WGC",
                reason.as_str()
            ),
        );
        return;
    }

    // Mid-session the resolved `Capture_Policy` decides what happens when the
    // hook stops delivering frames (Req 5.2, 5.3). Derive the last completed
    // handshake step from the delivery counters for diagnostics (Req 6.6): a
    // forwarded frame implies the full path
    // (offsets → Initialize → HookReady → shtex → forward) completed at least
    // once; a received-but-not-forwarded frame implies the shtex surface
    // resolved but the encoder channel rejected it; zero received implies the
    // handshake completed (Initialize signaled) but no HookReady/shtex ever
    // resolved before the watchdog tripped.
    let last_handshake_step = if frames_forwarded > 0 {
        "frame_forwarded_to_encoder"
    } else if frames_received > 0 {
        "shtex_resolved"
    } else {
        "initialize_signaled_no_hookready"
    };

    if hook_exclusive {
        // ── hook-exclusive (Req 5.3) ─────────────────────────────────────
        // Do NOT start WGC. Transition to capture-unavailable, record the
        // reason, stop delivering frames, and retain the resolved policy in
        // stats. The negotiated parameters are reset to the not-yet-negotiated
        // sentinel since no capture is running (Req 9.4). The peer connection
        // and encoder stay up; the session simply produces no further video
        // until it is stopped.
        log::warn!(
            "[NativeShare] zero-copy hook stopped mid-session (reason={}, last_handshake_step={}, \
             frames_received={}, frames_forwarded={}); hook-exclusive policy — capture is now \
             unavailable (no WGC fallback)",
            reason.as_str(),
            last_handshake_step,
            frames_received,
            frames_forwarded,
        );
        // Keep the active mode/backend as the hook's (it was the resolved mode);
        // the capture-unavailable flag + reason convey that no frames flow.
        stats.set_capture_unavailable(true);
        stats.set_fallback_reason(reason);
        stats.clear_negotiated_params();
        let _ = app.emit(
            "native-screen-share-status",
            format!(
                "capture-unavailable: zero-copy game-capture hook stopped ({}); \
                 capture is unavailable under the hook-exclusive policy (no WGC fallback)",
                reason.as_str()
            ),
        );

        // Park until the session stops — no frame source runs (Req 5.3).
        cancel.wait();
        return;
    }

    // ── wgc-enabled (Req 5.2) ────────────────────────────────────────────
    // Fall back to the guaranteed WGC path — continue the session, record the
    // reason, and notify the user (Req 8.4, 8.5, 14.4).
    log::warn!(
        "[NativeShare] zero-copy hook stopped mid-session (reason={}, last_handshake_step={}, \
         frames_received={}, frames_forwarded={}); continuing on WGC",
        reason.as_str(),
        last_handshake_step,
        frames_received,
        frames_forwarded,
    );
    stats.set_capture_mode(CaptureMode::Wgc);
    stats.set_active_backend(None);
    stats.set_fallback_reason(reason);
    // The negotiated parameters are re-published by the WGC capture path as it
    // delivers frames; reset to the not-yet-negotiated sentinel until WGC
    // negotiates (Req 9.4) so a stale hook resolution is not reported as the
    // WGC negotiated size.
    stats.clear_negotiated_params();
    let _ = app.emit(
        "native-screen-share-status",
        format!(
            "hook-unavailable: zero-copy game-capture hook stopped ({}); continuing screen share on WGC",
            reason.as_str()
        ),
    );

    // Start WGC as the live frame source and hold it for the rest of the
    // session. WGC captures at the native size; the encoder's video processor
    // scales to the encode dimensions, exactly as the up-front WGC path does.
    // Publish the WGC negotiated parameters (native source size + session fps,
    // Req 9.1) so the stats report a negotiated resolution on the fallback path.
    let on_closed: crate::wgc_capture::ItemClosedCallback = {
        let ender = Arc::clone(&ender);
        Arc::new(move || ender(EndReason::SourceClosed("target_exited".to_string())))
    };
    let wgc = match resolve_wgc_item(&source_id).and_then(|item| {
        crate::wgc_capture::start_wgc_capture(
            item,
            &d3d,
            frame_tx,
            Arc::clone(&stats),
            Arc::new(std::sync::atomic::AtomicBool::new(true)),
            Arc::clone(&frame_interval_ns),
            Some(on_closed),
        )
    }) {
        Ok(capture) => Some(capture),
        Err(err) => {
            log::error!("[NativeShare] mid-session WGC fallback failed to start: {err}");
            None
        }
    };

    // Park until the session stops, keeping the WGC capture alive. Also end the
    // share if the source window is closed while on the WGC fallback — a closed
    // window cannot be WGC-captured either, so stop rather than stream nothing.
    while !cancel.wait_timeout(Duration::from_millis(100)) {
        if !source_still_live(&source_id) {
            log::info!(
                "[NativeShare] shared source {} closed while on WGC fallback; ending screen share",
                source_id
            );
            stats.set_fallback_reason(FallbackReason::TargetExited);
            stats.clear_negotiated_params();
            ender(EndReason::SourceClosed(
                FallbackReason::TargetExited.as_str().to_string(),
            ));
            break;
        }
    }
    drop(wgc);
}

// ── Capture-mode selection for one session ─────────────────────────────────

/// The resolved capture plan for a session: which frame source runs, why, and
/// (on the hook path) the live hook to run it with.
pub(crate) struct CaptureSelection {
    pub(crate) source_kind: SourceKind,
    pub(crate) policy: CapturePolicy,
    pub(crate) capture_mode: CaptureMode,
    /// Hook-exclusive policy with the hook unavailable: start no frame source.
    pub(crate) capture_unavailable: bool,
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub(crate) hook: Option<crate::game_capture::dx11::GameCaptureHook>,
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub(crate) helper: Option<std::process::Child>,
    /// Keeps the Vulkan capture layer registered while this hook share runs.
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub(crate) vulkan_layer: Option<crate::game_capture::vulkan_layer::LayerLease>,
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub(crate) verified: Option<crate::game_capture::signed_hook::VerifiedSet>,
    #[cfg(all(feature = "game-capture-hook", windows))]
    pub(crate) protected_exe: Option<String>,
}

impl CaptureSelection {
    /// Whether the session should run the zero-copy hook.
    pub(crate) fn start_hook(&self) -> bool {
        #[cfg(all(feature = "game-capture-hook", windows))]
        {
            self.capture_mode == CaptureMode::Hook && self.hook.is_some()
        }
        #[cfg(not(all(feature = "game-capture-hook", windows)))]
        {
            false
        }
    }
}

/// Resolve the capture policy, probe for a foreign hook, prepare (inject) the
/// hook when eligible, and run the pure selection. Records the outcome in
/// `stats` and emits the `native-screen-share-status` notices the UI shows.
///
/// Blocking (hook preparation runs helper processes with timeouts); call from
/// a blocking context.
pub(crate) fn select_capture<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    d3d: &Arc<D3dDevice>,
    source_id: &str,
    fps: u32,
    stats: &NativeShareStats,
) -> CaptureSelection {
    use tauri::Emitter;

    // ── Resolve the session Capture_Policy (Req 5.1, 5.5) ────────────────
    // Runtime setting (RALPH_CAPTURE_POLICY, set by the dev script) wins over
    // the build-feature default; absent both, `wgc-enabled` applies.
    let policy = resolve_capture_policy(runtime_capture_policy(), feature_default_capture_policy());
    stats.set_capture_policy(policy == CapturePolicy::HookExclusive);
    log::info!(
        "[NativeShare] resolved capture policy: {} (runtime={:?})",
        policy.as_str(),
        runtime_capture_policy(),
    );

    // ── Capture-mode + safety-gate selection (Req 7/8/9/10/13) ───────────
    // WGC is the guaranteed path (Req 8.1). The hook is additive: a monitor
    // source, non-Windows, a disabled hook/backend, a missing artifact, a
    // blocklisted/denied target, a failed injection, or a cross-adapter target
    // all resolve to `wgc` (Req 8.2, 8.3, 10.2, 13.2).
    let source_kind = source_kind_from_id(source_id);
    // The detected API only decides the reported *label*; DX11 and DX12 share
    // the DXGI present hook.
    let backend = detect_target_backend(source_id, source_kind);
    let gate = BackendGate::dxgi(); // DX11 + DX12 share the DXGI present hook (Req 3.1).
    log::info!(
        "[NativeShare] detected target graphics backend: {} (source_kind={:?})",
        backend.as_str(),
        source_kind,
    );
    let hook_enabled = hook_feature_enabled() && hook_setting_enabled(app);
    let is_windows = cfg!(windows); // Req 13.2.

    // ── Foreign-hook detection (Req 3.4) ─────────────────────────────────
    // A stock OBS / Discord graphics-hook already in the target publishes
    // `CaptureHook_*` objects the read-only probe can open. Recorded in
    // `Capture_Status`; the session still proceeds and degrades per policy.
    #[cfg(all(feature = "game-capture-hook", windows))]
    let foreign_hook_present = {
        if hook_enabled && source_kind == SourceKind::Window {
            let present = window_hwnd_from_id(source_id)
                .and_then(window_pid_from_hwnd)
                .map(crate::game_capture::obs_ipc::foreign_obs_hook_present)
                .unwrap_or(false);
            if present {
                log::warn!(
                    "[NativeShare] Foreign_Hook detected: another OBS-derived game-capture hook \
                     (CaptureHook_* objects) is ALREADY injected into the target process. This is \
                     almost always Discord (Go Live / Stream / overlay) or OBS Studio with a Game \
                     Capture source on the same window — both ship the OBS graphics-hook under \
                     C:\\ProgramData\\obs-studio-hook\\. Two graphics hooks Detours-patching the \
                     same IDXGISwapChain::Present conflict, which typically prevents our hook from \
                     ever delivering a frame (the 'initialize_signaled_no_hookready' / 0-frame \
                     symptom). To use the zero-copy hook, CLOSE the other capturer (stop Discord \
                     Go Live/streaming and disable its overlay for this game, and/or stop OBS's \
                     Game Capture), then re-share. Proceeding with the attempt and degrading per \
                     policy without terminating the target (Req 3.4, 3.5)."
                );
            }
            present
        } else {
            false
        }
    };
    #[cfg(not(all(feature = "game-capture-hook", windows)))]
    let foreign_hook_present = false;
    stats.set_foreign_hook(foreign_hook_present);

    // Injection preparation (feature- + Windows-gated). Without the feature
    // these are the NotAttempted defaults and selection resolves to `wgc`.
    #[cfg(all(feature = "game-capture-hook", windows))]
    let prep = prepare_hook(
        d3d,
        source_id,
        source_kind,
        backend,
        gate,
        hook_enabled,
        foreign_hook_present,
        fps,
    );
    #[cfg(all(feature = "game-capture-hook", windows))]
    let (artifact_available, safety, injection_outcome, same_adapter, missing_offsets) = (
        prep.artifact_available,
        prep.safety,
        prep.injection,
        prep.same_adapter,
        prep.missing_offsets,
    );
    #[cfg(not(all(feature = "game-capture-hook", windows)))]
    let (artifact_available, safety, injection_outcome, same_adapter, missing_offsets) = {
        let _ = (d3d, fps);
        (
            false,
            SafetyDecision::Allow,
            InjectionOutcome::NotAttempted,
            true,
            false,
        )
    };

    let selection = SelectionInputs {
        is_windows,
        source_kind,
        backend,
        gate,
        hook_enabled,
        artifact_available,
        safety,
        injection: injection_outcome,
        same_adapter,
    };

    let capture_mode = select_capture_mode_v2(&selection);
    let mut reason = fallback_reason(&selection);
    #[cfg(all(feature = "game-capture-hook", windows))]
    {
        stats.set_hook_flavor(
            if capture_mode == CaptureMode::Hook {
                prep.flavor
            } else {
                None
            },
            prep.attached,
        );
        if capture_mode != CaptureMode::Hook && injection_outcome != InjectionOutcome::NotAttempted
        {
            if let Some(exe) = prep.protected_exe.as_deref() {
                crate::game_capture::hook_policy::record_protected_failure(exe);
            }
        }
    }
    // Injection skipped because the backend's present offset was zero/absent
    // (Req 4.6) is the more precise `BackendDisabled` (Req 5.8).
    if missing_offsets && capture_mode != CaptureMode::Hook {
        reason = FallbackReason::BackendDisabled;
    }
    stats.set_capture_mode(capture_mode);
    stats.set_active_backend(if capture_mode == CaptureMode::Hook {
        Some(backend)
    } else {
        None
    });
    stats.set_fallback_reason(reason);

    // ── Apply the resolved Capture_Policy (Req 4.2, 4.5, 5.2, 5.3, 5.4) ──
    let resolution = apply_capture_policy(&selection, policy);
    let capture_unavailable = matches!(resolution, CaptureResolution::Unavailable { .. });
    stats.set_capture_unavailable(capture_unavailable);
    log::info!(
        "[NativeShare] capture_mode={} reason={} policy={} resolution={} (source_kind={:?}, hook_enabled={}, injection={:?}, foreign_hook={})",
        capture_mode.as_str(),
        reason.as_str(),
        policy.as_str(),
        match resolution {
            CaptureResolution::Hook => "hook",
            CaptureResolution::Wgc { .. } => "wgc",
            CaptureResolution::Unavailable { .. } => "unavailable",
        },
        source_kind,
        hook_enabled,
        injection_outcome,
        foreign_hook_present,
    );

    // Notify the UI of the resolved capture state (Req 5.6).
    if capture_unavailable {
        log::warn!(
            "[NativeShare] capture unavailable under hook-exclusive policy ({}); \
             not starting WGC and delivering no frames (Req 5.3)",
            reason.as_str()
        );
        let _ = app.emit(
            "native-screen-share-status",
            format!(
                "capture-unavailable: zero-copy game-capture hook unavailable ({}); \
                 capture is unavailable under the hook-exclusive policy (no WGC fallback)",
                reason.as_str()
            ),
        );
    } else if should_notify_unavailable(&selection) {
        log::warn!(
            "[NativeShare] zero-copy hook unavailable ({}); continuing on WGC fallback",
            reason.as_str()
        );
        let _ = app.emit(
            "native-screen-share-status",
            format!(
                "hook-unavailable: zero-copy game-capture hook unavailable ({}); continuing screen share on WGC",
                reason.as_str()
            ),
        );
    }

    // Never leave an injected-but-unused hook running on the WGC path (Req
    // 7.5): dropping it detaches.
    #[cfg(all(feature = "game-capture-hook", windows))]
    let hook = if capture_mode == CaptureMode::Hook {
        prep.hook
    } else {
        drop(prep.hook);
        None
    };

    CaptureSelection {
        source_kind,
        policy,
        capture_mode,
        capture_unavailable,
        #[cfg(all(feature = "game-capture-hook", windows))]
        hook,
        #[cfg(all(feature = "game-capture-hook", windows))]
        helper: prep.helper,
        #[cfg(all(feature = "game-capture-hook", windows))]
        vulkan_layer: match (capture_mode, prep.layer_dir.as_deref()) {
            (CaptureMode::Hook, Some(dir)) => {
                Some(crate::game_capture::vulkan_layer::LayerLease::acquire(dir))
            }
            _ => None,
        },
        #[cfg(all(feature = "game-capture-hook", windows))]
        verified: prep.verified,
        #[cfg(all(feature = "game-capture-hook", windows))]
        protected_exe: prep.protected_exe,
    }
}

#[cfg(test)]
mod capture_mode_wiring_tests {
    use super::*;
    // The legacy `select_capture_mode` is still exercised here for the
    // orchestration helper tests; it is no longer imported at module scope (the
    // session now uses `select_capture_mode_v2`), so bring it in locally.
    use crate::game_capture::select_capture_mode;

    #[test]
    fn source_kind_derives_monitor_from_monitor_id() {
        assert_eq!(source_kind_from_id("monitor-0"), SourceKind::Monitor);
        assert_eq!(source_kind_from_id("monitor-3"), SourceKind::Monitor);
    }

    #[test]
    fn source_kind_derives_window_from_window_id() {
        assert_eq!(source_kind_from_id("window-12345"), SourceKind::Window);
        // Any non-monitor id is treated conservatively as a window candidate.
        assert_eq!(source_kind_from_id("other-xyz"), SourceKind::Window);
    }

    #[test]
    fn window_hwnd_parsed_only_for_window_ids() {
        assert_eq!(window_hwnd_from_id("window-12345"), Some(12345));
        assert_eq!(window_hwnd_from_id("window--7"), Some(-7));
        // Monitor ids and malformed window ids yield no hwnd (no attach attempt).
        assert_eq!(window_hwnd_from_id("monitor-0"), None);
        assert_eq!(window_hwnd_from_id("window-notanumber"), None);
        assert_eq!(window_hwnd_from_id("garbage"), None);
    }

    #[test]
    fn monitor_source_always_selects_wgc_even_with_success() {
        // Mirrors the orchestration call: a monitor source forces WGC (Req 6.2)
        // regardless of the (irrelevant) injection outcome.
        let mode = select_capture_mode(
            source_kind_from_id("monitor-1"),
            GraphicsApiBackend::Dx11,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn window_source_with_disabled_hook_selects_wgc() {
        // Default behavior (flag off ⇒ hook_enabled false, NotAttempted) keeps
        // the proven WGC pipeline (Req 6.1).
        let mode = select_capture_mode(
            source_kind_from_id("window-42"),
            GraphicsApiBackend::Dx11,
            false,
            true,
            InjectionOutcome::NotAttempted,
        );
        assert_eq!(mode, CaptureMode::Wgc);
    }

    #[test]
    fn window_source_with_successful_injection_selects_hook() {
        let mode = select_capture_mode(
            source_kind_from_id("window-42"),
            GraphicsApiBackend::Dx11,
            true,
            true,
            InjectionOutcome::Success,
        );
        assert_eq!(mode, CaptureMode::Hook);
    }

    #[test]
    fn failed_or_blocked_injection_falls_back_to_wgc() {
        for outcome in [InjectionOutcome::Failed, InjectionOutcome::Blocked] {
            let mode = select_capture_mode(
                source_kind_from_id("window-42"),
                GraphicsApiBackend::Dx11,
                true,
                true,
                outcome,
            );
            assert_eq!(mode, CaptureMode::Wgc, "{outcome:?} must fall back to WGC");
        }
    }

    #[test]
    fn hook_enable_flag_respects_env_override() {
        // Explicit truthy values always enable regardless of compile features.
        let truthy = ["1", "true", "TRUE", "Yes", "on", " on "];
        // Explicit falsy values always disable regardless of compile features.
        let falsy = ["0", "false", "no", "off", "", "enabled?", "2"];

        for v in truthy {
            std::env::set_var("RALPH_GAME_CAPTURE_HOOK", v);
            assert!(game_capture_hook_enabled(), "{v:?} should enable the hook");
        }
        for v in falsy {
            std::env::set_var("RALPH_GAME_CAPTURE_HOOK", v);
            assert!(
                !game_capture_hook_enabled(),
                "{v:?} should not enable the hook"
            );
        }
        // When no env var is set, the result matches the compile-time feature flag.
        // In a `game-capture-hook` build the hook is on by default (production
        // installs don't set env vars); in a bare `native-screen-share` build it
        // stays off.
        std::env::remove_var("RALPH_GAME_CAPTURE_HOOK");
        let expected = cfg!(feature = "game-capture-hook");
        assert_eq!(
            game_capture_hook_enabled(),
            expected,
            "unset env var should default to the compile-time feature flag ({})",
            if expected { "on" } else { "off" }
        );
    }

    #[test]
    fn feature_default_capture_policy_tracks_hook_build_default() {
        assert_eq!(
            feature_default_capture_policy(),
            if cfg!(feature = "game-capture-hook") {
                Some(CapturePolicy::WgcEnabled)
            } else {
                None
            }
        );
        assert_eq!(
            resolve_capture_policy(None, feature_default_capture_policy()),
            CapturePolicy::WgcEnabled
        );
    }
}
