//! Injector orchestration — bitness detection, OBS artifact discovery, and the
//! pure injection-strategy planner.
//!
//! This module is the host-side, clean-room `Injector` (Requirement 2). It does
//! **not** inject directly into a matching-bitness target; instead it plans
//! which reused OBS `graphics-hook` payload and (for the cross-bitness case)
//! which OBS `inject-helper` to use, and validates that the selected payload's
//! bitness equals the Target_Bitness before any injection is attempted
//! (Requirements 2.1–2.4). When the required artifact is absent the planner
//! reports [`FallbackReason::MissingArtifact`] so the caller falls back to WGC
//! and records the reason (Requirement 2.5).
//!
//! The work is split into two clearly separated halves:
//!
//! - **Pure, total, OS-independent planning.** [`plan_injection`] takes the host
//!   [`Bitness`], the target [`Bitness`], and an [`ObsArtifacts`] (whose
//!   `Option<PathBuf>` fields stand in for on-disk presence) and returns the
//!   [`InjectStrategy`] or an `Err(FallbackReason)`. It performs no I/O and is
//!   deterministic, so it is the target of Property 9 and runs in CI without a
//!   GPU, a game, or any anti-cheat software. The same property holds for
//!   [`classify_machine`], which maps the raw `IMAGE_FILE_MACHINE` values
//!   reported by the OS into a [`Bitness`].
//!
//! - **OS-bound bitness detection.** [`detect_bitness`] is the only function
//!   that touches the OS: it opens the target process and calls
//!   `IsWow64Process2` (correct on ARM64 and for newer process kinds, unlike the
//!   legacy `IsWow64Process`). It is deliberately isolated here so the planner
//!   stays pure.
//!
//! Everything in this module sits behind the `game-capture-hook` feature on top
//! of `native-screen-share`. The reused OBS `graphics-hook`/`inject-helper`
//! artifacts are separate-process GPLv2 components and are **not** linked here.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::game_capture::{FallbackReason, GraphicsApiBackend, InjectionOutcome};

/// The architecture (32- vs 64-bit) of a process.
///
/// Determined for a Target_Process via [`detect_bitness`] (which calls
/// `IsWow64Process2`). Any 64-bit native architecture (AMD64, ARM64, …) is
/// reported as [`Bitness::X64`]; only an x86/WOW64 process is [`Bitness::X86`]
/// — the OBS payloads ship as a 32-bit and a 64-bit artifact, so two buckets
/// are all the planner needs (Requirement 2.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Bitness {
    /// A 32-bit (x86 / WOW64) process. Uses the 32-bit OBS artifacts.
    X86,
    /// A 64-bit (AMD64 / ARM64 / …) process. Uses the 64-bit OBS artifacts.
    X64,
}

impl Bitness {
    /// Stable lower-case string form for logs and status.
    pub fn as_str(self) -> &'static str {
        match self {
            Bitness::X86 => "x86",
            Bitness::X64 => "x64",
        }
    }
}

// ── OBS artifact file names ─────────────────────────────────────────────────
//
// The reused OBS_Capture_Component ships these four files alongside the desktop
// binary. The exact names are pinned to the bundled OBS version
// (verify against pinned OBS source) and isolated here as constants so a future
// bundle upgrade is a single, visible edit.

/// 64-bit OBS `graphics-hook` payload DLL.
pub const GRAPHICS_HOOK64: &str = "graphics-hook64.dll";
/// 32-bit OBS `graphics-hook` payload DLL.
pub const GRAPHICS_HOOK32: &str = "graphics-hook32.dll";
/// 64-bit OBS `inject-helper` executable (cross-bitness injection).
pub const INJECT_HELPER64: &str = "inject-helper64.exe";
/// 32-bit OBS `inject-helper` executable (cross-bitness injection).
pub const INJECT_HELPER32: &str = "inject-helper32.exe";
/// 64-bit OBS `get-graphics-offsets` helper. The injected `graphics-hook`
/// payload runs this at hook time to resolve graphics API vtable offsets; it
/// must ship alongside the payload in the OBS_Capture_Component.
pub const GET_GRAPHICS_OFFSETS64: &str = "get-graphics-offsets64.exe";
/// 32-bit OBS `get-graphics-offsets` helper (see [`GET_GRAPHICS_OFFSETS64`]).
pub const GET_GRAPHICS_OFFSETS32: &str = "get-graphics-offsets32.exe";

/// The set of OBS_Capture_Component artifacts discovered next to the binary.
///
/// Each field is `Some(path)` iff the corresponding artifact was found, so the
/// planner can decide purely from this struct whether the required payload /
/// helper for a target is present (Requirements 2.5, 12.6). The fields are
/// `pub` and the struct derives [`Default`], so tests can build any combination
/// of present/absent artifacts without touching the filesystem.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ObsArtifacts {
    /// Path to the 64-bit `graphics-hook` payload, if present.
    pub graphics_hook64: Option<PathBuf>,
    /// Path to the 32-bit `graphics-hook` payload, if present.
    pub graphics_hook32: Option<PathBuf>,
    /// Path to the 64-bit `inject-helper`, if present.
    pub inject_helper64: Option<PathBuf>,
    /// Path to the 32-bit `inject-helper`, if present.
    pub inject_helper32: Option<PathBuf>,
}

impl ObsArtifacts {
    /// Plain constructor from the four optional paths.
    ///
    /// Useful for tests and for callers that have already resolved the paths by
    /// some other means; [`discover`](Self::discover) is the normal way to build
    /// one from a directory.
    pub fn new(
        graphics_hook64: Option<PathBuf>,
        graphics_hook32: Option<PathBuf>,
        inject_helper64: Option<PathBuf>,
        inject_helper32: Option<PathBuf>,
    ) -> Self {
        Self {
            graphics_hook64,
            graphics_hook32,
            inject_helper64,
            inject_helper32,
        }
    }

    /// Discover the four artifacts in `dir`, recording each that exists as a
    /// regular file. Missing artifacts stay `None`. Performs read-only
    /// filesystem probes and never fails — an unreadable directory simply yields
    /// all-`None`.
    pub fn discover(dir: &Path) -> Self {
        let present = |name: &str| -> Option<PathBuf> {
            let candidate = dir.join(name);
            candidate.is_file().then_some(candidate)
        };

        Self {
            graphics_hook64: present(GRAPHICS_HOOK64),
            graphics_hook32: present(GRAPHICS_HOOK32),
            inject_helper64: present(INJECT_HELPER64),
            inject_helper32: present(INJECT_HELPER32),
        }
    }

    /// The subdirectory (relative to a base dir) the OBS_Capture_Component is
    /// shipped under, both in the packaged app (Tauri `bundle.resources` copies
    /// `resources/obs-capture/` next to the binary, commonly under a
    /// `resources/` root) and in the repo (`src-tauri/resources/obs-capture/`).
    const RESOURCE_SUBDIR: &'static str = "obs-capture";

    /// Discover the OBS_Capture_Component, searching every realistic location
    /// the artifacts may live in for both a packaged build and `cargo tauri dev`.
    ///
    /// The artifacts are **not** simply next to the executable: Tauri's
    /// `bundle.resources` places them under a `resources/`-rooted tree, and a
    /// `cargo tauri dev` / `cargo test` run leaves them only in the source tree
    /// at `src-tauri/resources/obs-capture/` (the exe lives in `target/<profile>/`).
    /// So this probes, in order, a set of candidate directories derived from the
    /// current exe path and the build-time manifest dir, and uses the **first**
    /// directory that contains the required artifacts. The chosen directory (or
    /// the failure) is logged so a fallback to WGC is diagnosable.
    ///
    /// Returns an all-`None` set if none of the candidates contains the
    /// artifacts; the caller then records `MissingArtifact` and uses WGC.
    pub fn discover_next_to_binary() -> Self {
        let candidates = Self::candidate_dirs();
        for dir in &candidates {
            let found = Self::discover(dir);
            // A directory "has the bundle" if at least the matching-bitness
            // payload is present; require a graphics-hook so we don't latch onto
            // an empty dir that merely exists.
            if found.graphics_hook64.is_some() || found.graphics_hook32.is_some() {
                log::info!(
                    "[ObsArtifacts] found OBS_Capture_Component in {} (hook64={}, hook32={}, helper64={}, helper32={})",
                    dir.display(),
                    found.graphics_hook64.is_some(),
                    found.graphics_hook32.is_some(),
                    found.inject_helper64.is_some(),
                    found.inject_helper32.is_some(),
                );
                return found;
            }
        }
        log::warn!(
            "[ObsArtifacts] OBS_Capture_Component not found; searched {} candidate dir(s): {}. \
             The Game_Capture_Hook will fall back to WGC (MissingArtifact). Place the OBS \
             graphics-hook/inject-helper artifacts under a `{}/` directory next to the binary \
             (packaged) or in src-tauri/resources/{}/ (dev).",
            candidates.len(),
            candidates
                .iter()
                .map(|d| d.display().to_string())
                .collect::<Vec<_>>()
                .join("; "),
            Self::RESOURCE_SUBDIR,
            Self::RESOURCE_SUBDIR,
        );
        Self::default()
    }

    /// The ordered list of directories to probe for the OBS_Capture_Component.
    ///
    /// Derived from the executable directory (packaged app + most dev runs) and
    /// the compile-time manifest dir (repo source tree). Each base is probed
    /// both directly and under the `obs-capture` resource subdir, including the
    /// Tauri `resources/`-rooted layout. Order favors the packaged locations so
    /// a shipped bundle wins over a stray dev copy.
    fn candidate_dirs() -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = Vec::new();
        let mut push = |dir: PathBuf| {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        };

        // Bases derived from the running executable's directory.
        if let Some(exe_dir) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
        {
            // Packaged: artifacts copied next to the binary, under the resource
            // subdir, and under a Tauri `resources/`-rooted tree.
            push(exe_dir.join(Self::RESOURCE_SUBDIR));
            push(exe_dir.join("resources").join(Self::RESOURCE_SUBDIR));
            push(exe_dir.clone());
            // `cargo tauri dev`: exe is in `target/<profile>/`; the source
            // resources live at `../../resources/obs-capture` relative to it.
            if let Some(target_profile_parent) = exe_dir.parent().and_then(Path::parent) {
                push(
                    target_profile_parent
                        .join("resources")
                        .join(Self::RESOURCE_SUBDIR),
                );
            }
        }

        // Base from the compile-time manifest dir (the `src-tauri` crate root):
        // covers `cargo test` / `cargo tauri dev` where the exe is far from the
        // source tree. `CARGO_MANIFEST_DIR` is the crate dir at build time.
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        push(manifest_dir.join("resources").join(Self::RESOURCE_SUBDIR));

        dirs
    }

    /// The `graphics-hook` payload path for the given bitness, if present.
    pub fn payload(&self, bitness: Bitness) -> Option<&Path> {
        match bitness {
            Bitness::X64 => self.graphics_hook64.as_deref(),
            Bitness::X86 => self.graphics_hook32.as_deref(),
        }
    }

    /// The `inject-helper` path for the given bitness, if present.
    pub fn helper(&self, bitness: Bitness) -> Option<&Path> {
        match bitness {
            Bitness::X64 => self.inject_helper64.as_deref(),
            Bitness::X86 => self.inject_helper32.as_deref(),
        }
    }

    /// The directory the artifacts live in (the parent of any discovered
    /// artifact). `None` when nothing was discovered. Used to locate the
    /// `get-graphics-offsets` helpers, which sit alongside the payloads.
    pub fn dir(&self) -> Option<PathBuf> {
        self.graphics_hook64
            .as_deref()
            .or(self.graphics_hook32.as_deref())
            .or(self.inject_helper64.as_deref())
            .or(self.inject_helper32.as_deref())
            .and_then(Path::parent)
            .map(Path::to_path_buf)
    }
}

/// Which payload + injection path to use for a target — the pure result of
/// [`plan_injection`] (Requirements 2.2–2.4).
///
/// In both variants the `payload` bitness always equals the Target_Bitness.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InjectStrategy {
    /// Host bitness equals the Target_Bitness: inject the matching-bitness
    /// payload directly, no `inject-helper` needed (Requirement 2.2).
    Direct {
        /// The payload bitness, equal to the Target_Bitness.
        payload: Bitness,
    },
    /// Host bitness differs from the Target_Bitness: use the target-bitness
    /// `inject-helper` to inject the target-bitness payload (Requirement 2.3).
    CrossBitness {
        /// The payload bitness, equal to the Target_Bitness.
        payload: Bitness,
        /// The `inject-helper` bitness, equal to the Target_Bitness.
        helper: Bitness,
    },
}

impl InjectStrategy {
    /// The payload bitness this strategy injects — always the Target_Bitness.
    pub fn payload(self) -> Bitness {
        match self {
            InjectStrategy::Direct { payload } => payload,
            InjectStrategy::CrossBitness { payload, .. } => payload,
        }
    }

    /// The `inject-helper` bitness, if this strategy uses one (cross-bitness).
    pub fn helper(self) -> Option<Bitness> {
        match self {
            InjectStrategy::Direct { .. } => None,
            InjectStrategy::CrossBitness { helper, .. } => Some(helper),
        }
    }
}

/// Pure, total selection of the injection strategy and artifact.
///
/// The Injector always selects the payload whose bitness equals the
/// Target_Bitness, then chooses between [`InjectStrategy::Direct`] and
/// [`InjectStrategy::CrossBitness`] by whether the host matches the target
/// (Requirements 2.2–2.4):
///
/// - **`host == target`** → [`InjectStrategy::Direct`] with the target-bitness
///   payload. Direct injection uses no `inject-helper`, so only the payload
///   artifact must be present.
/// - **`host != target`** → [`InjectStrategy::CrossBitness`] with the
///   target-bitness payload injected via the target-bitness `inject-helper`, so
///   both that payload **and** that helper must be present.
///
/// Because the payload is selected *by* the Target_Bitness, the invariant
/// "selected payload bitness == Target_Bitness" (Requirement 2.4) holds by
/// construction for every returned strategy.
///
/// Returns `Err(`[`FallbackReason::MissingArtifact`]`)` when the required
/// payload — or, for the cross-bitness case, the required helper — is absent
/// (Requirement 2.5), so the caller falls back to WGC and records the reason.
///
/// This function performs no filesystem or OS calls and is deterministic and
/// total over all inputs, so it is the target of Property 9 and runs in CI
/// without hardware.
///
/// Validates: Requirements 2.2, 2.3, 2.4, 2.5.
pub fn plan_injection(
    host: Bitness,
    target: Bitness,
    artifacts: &ObsArtifacts,
) -> Result<InjectStrategy, FallbackReason> {
    // Always select the payload whose bitness equals the Target_Bitness
    // (Req 2.4). By construction `payload == target`, so the bitness invariant
    // holds for every strategy this function returns.
    let payload = target;

    // The matching-bitness payload must be present regardless of strategy
    // (Req 2.5).
    if artifacts.payload(payload).is_none() {
        return Err(FallbackReason::MissingArtifact);
    }

    if host == target {
        // Matching bitness: inject the matching payload directly (Req 2.2). No
        // inject-helper is involved, so the payload presence checked above is
        // sufficient.
        Ok(InjectStrategy::Direct { payload })
    } else {
        // Differing bitness: the target-bitness inject-helper injects the
        // target-bitness payload (Req 2.3). That helper must also be present
        // (Req 2.5).
        let helper = target;
        if artifacts.helper(helper).is_none() {
            return Err(FallbackReason::MissingArtifact);
        }
        Ok(InjectStrategy::CrossBitness { payload, helper })
    }
}

// ── OS-bound bitness detection (isolated from the pure planner) ──────────────

use windows::core::Result as WinResult;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::SystemInformation::{
    IMAGE_FILE_MACHINE, IMAGE_FILE_MACHINE_I386, IMAGE_FILE_MACHINE_UNKNOWN,
};
use windows::Win32::System::Threading::{
    IsWow64Process2, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// Map the raw `IMAGE_FILE_MACHINE` values reported by `IsWow64Process2` into a
/// [`Bitness`]. Pure and total, so it is unit-tested without opening a process.
///
/// `IsWow64Process2` reports `process_machine == IMAGE_FILE_MACHINE_UNKNOWN`
/// when the target is **not** running under WOW64 — i.e. it is a native process,
/// whose bitness is therefore the host's `native_machine`. Otherwise
/// `process_machine` is the WOW64 (emulated) architecture, which is the
/// process's own bitness (e.g. `IMAGE_FILE_MACHINE_I386` for a 32-bit process on
/// 64-bit Windows). Any non-i386 machine (AMD64, ARM64, …) is treated as 64-bit.
fn classify_machine(
    process_machine: IMAGE_FILE_MACHINE,
    native_machine: IMAGE_FILE_MACHINE,
) -> Bitness {
    let effective = if process_machine == IMAGE_FILE_MACHINE_UNKNOWN {
        // Native process: its bitness is the host's native architecture.
        native_machine
    } else {
        // WOW64 process: the emulated architecture is the process bitness.
        process_machine
    };

    if effective == IMAGE_FILE_MACHINE_I386 {
        Bitness::X86
    } else {
        Bitness::X64
    }
}

/// Detect the [`Bitness`] of the process `pid` via `IsWow64Process2`.
///
/// This is the only OS-bound function in this module: it opens the target with
/// `PROCESS_QUERY_LIMITED_INFORMATION` (the minimal right that succeeds for the
/// widest range of targets), queries `IsWow64Process2`, and classifies the
/// result with the pure [`classify_machine`]. The process handle is always
/// closed before returning. Any failure is surfaced as the `windows` error so
/// the caller can treat it as an injection failure and fall back to WGC.
pub fn detect_bitness(pid: u32) -> WinResult<Bitness> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false.into(), pid)?;

        let mut process_machine = IMAGE_FILE_MACHINE_UNKNOWN;
        let mut native_machine = IMAGE_FILE_MACHINE_UNKNOWN;
        let query = IsWow64Process2(process, &mut process_machine, Some(&mut native_machine));

        // Always release the process handle before propagating any error.
        let _ = CloseHandle(process);
        query?;

        Ok(classify_machine(process_machine, native_machine))
    }
}

// ── OS-bound graphics-API detection (truthful Graphics_API_Backend label) ────

/// Best-effort detection of the graphics API a target process is using, by
/// inspecting which graphics runtime DLLs it has loaded.
///
/// The host's zero-copy capture path is API-agnostic on the wire: DX11 **and**
/// DX12 both present through the DXGI swapchain, so the injected graphics-hook
/// intercepts `IDXGISwapChain::Present` for either (the DLL picks the right
/// device internally via `setup_dxgi`). What differs is only the **label** we
/// report in `Capture_Status`. Historically the host hardcoded `Dx11`, so a
/// DX12 game was mislabeled "dx11"; this resolves the real API so the status is
/// truthful.
///
/// Detection precedence (a process can load several of these; pick the
/// highest-level renderer actually present):
///   1. `d3d12.dll`  → [`GraphicsApiBackend::Dx12`]
///   2. `d3d11.dll` / `dxgi.dll` → [`GraphicsApiBackend::Dx11`]
///   3. `vulkan-1.dll` → [`GraphicsApiBackend::Vulkan`]
///   4. `opengl32.dll` → [`GraphicsApiBackend::OpenGl`]
///
/// `d3d12.dll` wins over `d3d11.dll` because many DX12 titles also load
/// `d3d11.dll` (for D3D11On12 interop / overlays), but the reverse is not true.
///
/// Returns `None` when the process cannot be snapshotted (e.g. access denied or
/// it exited) or loads none of the known runtimes — callers then keep their
/// prior default. This is purely informational and never gates capture: it only
/// drives the reported backend string.
pub fn detect_graphics_api(pid: u32) -> Option<GraphicsApiBackend> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W, TH32CS_SNAPMODULE,
        TH32CS_SNAPMODULE32,
    };

    // Snapshot the target's loaded modules. TH32CS_SNAPMODULE32 is included so a
    // 32-bit (WOW64) target enumerates correctly from a 64-bit host.
    let snapshot =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) }.ok()?;

    // Track the best (highest-precedence) match seen while walking the modules.
    let mut found_dx12 = false;
    let mut found_dx11 = false;
    let mut found_vulkan = false;
    let mut found_opengl = false;

    let mut entry = MODULEENTRY32W::default();
    entry.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;

    // Module32FirstW returns Err once there are no modules (or on failure).
    let mut walk = unsafe { Module32FirstW(snapshot, &mut entry) };
    while walk.is_ok() {
        // szModule is a NUL-terminated wide string; read up to the NUL.
        let name_len = entry
            .szModule
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(entry.szModule.len());
        let module = String::from_utf16_lossy(&entry.szModule[..name_len]).to_ascii_lowercase();
        match module.as_str() {
            "d3d12.dll" => found_dx12 = true,
            "d3d11.dll" | "dxgi.dll" => found_dx11 = true,
            "vulkan-1.dll" => found_vulkan = true,
            "opengl32.dll" => found_opengl = true,
            _ => {}
        }
        entry = MODULEENTRY32W::default();
        entry.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;
        walk = unsafe { Module32NextW(snapshot, &mut entry) };
    }

    unsafe {
        let _ = CloseHandle(snapshot);
    }

    // Precedence: DX12 > DX11 > Vulkan > OpenGL (see doc comment).
    if found_dx12 {
        Some(GraphicsApiBackend::Dx12)
    } else if found_dx11 {
        Some(GraphicsApiBackend::Dx11)
    } else if found_vulkan {
        Some(GraphicsApiBackend::Vulkan)
    } else if found_opengl {
        Some(GraphicsApiBackend::OpenGl)
    } else {
        None
    }
}

// ── OBS inject-helper child process (separate-process GPLv2 boundary) ────────
//
// The host **never** injects directly: doing so would require linking OBS's
// GPLv2 `inject-library` code into the proprietary binary. Instead it launches
// the reused OBS `inject-helper` executable as a **separate child process**,
// which keeps the GPLv2 surface entirely on the far side of a process boundary
// (Requirements 11.1, 11.2, 11.5). The helper is the only thing that calls
// `OpenProcess` / `CreateRemoteThread` / `LoadLibraryW` against the target.
//
// inject-helper argv contract (verify against pinned OBS source —
// obs-studio `plugins/win-capture/inject-helper/inject-helper.c`, which requires
// exactly `argc == 4`):
//
//   inject-helper.exe  <dll_path>  <use_safe_inject>  <id>
//
//   argv[1] = <dll_path>         absolute path to the matching-bitness
//                                `graphics-hook` payload to inject.
//   argv[2] = <use_safe_inject>  "0" → direct `CreateRemoteThread` injection,
//                                where <id> is a **process id**; non-zero → the
//                                anti-cheat-compatible `SetWindowsHookEx` path,
//                                where <id> is a **thread id**.
//   argv[3] = <id>               process id for direct mode, or window thread id
//                                for safe mode.
//
// inject-helper exit codes (verify against pinned OBS source —
// `plugins/win-capture/inject-library.h`). The C `main` returns these directly,
// so they surface as the child process exit code (a negative `int` becomes the
// equivalent `DWORD`, which `ExitStatus::code()` reads back as the same negative
// `i32` on Windows):
//
//   0  success — the payload was injected.
//  -1  INJECT_ERROR_INJECT_FAILED   — generic injection failure.
//  -2  INJECT_ERROR_INVALID_PARAMS  — bad argv / zero id.
//  -3  INJECT_ERROR_OPEN_PROCESS_FAIL — `OpenProcess` was denied; this is the
//                                     ACCESS_DENIED / anti-cheat signal and maps
//                                     to `Blocked` (Requirement 10.4).
//  -4  INJECT_ERROR_UNLIKELY_FAIL   — an "unlikely" Win32 failure.

use std::process::{Child, Command, Stdio};

/// inject-helper success code (payload injected). From OBS `inject-library.h`.
pub const INJECT_SUCCESS: i32 = 0;
/// inject-helper `INJECT_ERROR_INJECT_FAILED` (generic failure).
pub const INJECT_ERROR_INJECT_FAILED: i32 = -1;
/// inject-helper `INJECT_ERROR_INVALID_PARAMS` (bad argv / zero id).
pub const INJECT_ERROR_INVALID_PARAMS: i32 = -2;
/// inject-helper `INJECT_ERROR_OPEN_PROCESS_FAIL` — `OpenProcess` denied. This
/// is the ACCESS_DENIED / anti-cheat signal mapped to [`InjectionOutcome::Blocked`]
/// (Requirement 10.4).
pub const INJECT_ERROR_OPEN_PROCESS_FAIL: i32 = -3;
/// inject-helper `INJECT_ERROR_UNLIKELY_FAIL` (an unlikely Win32 failure).
pub const INJECT_ERROR_UNLIKELY_FAIL: i32 = -4;

/// `CREATE_NO_WINDOW` process-creation flag, so launching the console-subsystem
/// `inject-helper` never flashes a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The raw result of running the `inject-helper` child process.
///
/// This isolates the OS-bound spawn (which needs the real OBS artifacts and a
/// live target) from the pure outcome mapping in [`classify_helper_result`], so
/// the mapping — the only part with branching policy — is unit-testable without
/// spawning anything.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HelperRunResult {
    /// The `inject-helper` process could not be spawned at all (e.g. the
    /// executable was missing, or the OS refused to create the process).
    SpawnFailed,
    /// The `inject-helper` ran to completion and returned this exit code.
    Exited(i32),
    /// The `inject-helper` was terminated without returning an exit code (e.g.
    /// killed by a signal/crash), so no OBS error code is available.
    NoExitCode,
}

/// OBS inject-helper mode.
///
/// `Safe` mirrors OBS's anti-cheat compatibility hook path: the helper receives
/// `use_safe_inject=1` and a target window thread id. `Direct` is the legacy
/// process-id path (`use_safe_inject=0`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InjectionMode {
    Direct { pid: u32 },
    Safe { thread_id: u32 },
}

impl InjectionMode {
    fn helper_args(self) -> (&'static str, String) {
        match self {
            InjectionMode::Direct { pid } => ("0", pid.to_string()),
            InjectionMode::Safe { thread_id } => ("1", thread_id.to_string()),
        }
    }

    fn label(self) -> &'static str {
        match self {
            InjectionMode::Direct { .. } => "direct",
            InjectionMode::Safe { .. } => "safe",
        }
    }
}

/// Pure mapping from a [`HelperRunResult`] to an [`InjectionOutcome`].
///
/// - A clean exit with [`INJECT_SUCCESS`] is [`InjectionOutcome::Success`].
/// - A clean exit with [`INJECT_ERROR_OPEN_PROCESS_FAIL`] is
///   [`InjectionOutcome::Blocked`]: `OpenProcess` was denied, which is treated
///   as an anti-cheat block (Requirement 10.4) so the caller falls back to WGC.
/// - Every other exit code, a spawn failure, and a kill-without-exit-code are
///   all [`InjectionOutcome::Failed`] (Requirement 7.4).
///
/// This function never returns [`InjectionOutcome::NotAttempted`]: reaching it
/// means an injection attempt was made (the safety/eligibility gate ran first).
///
/// Pure, total, and deterministic, so it is unit-tested directly.
///
/// Validates: Requirements 7.4, 10.4.
pub fn classify_helper_result(result: HelperRunResult) -> InjectionOutcome {
    match result {
        HelperRunResult::Exited(code) if code == INJECT_SUCCESS => InjectionOutcome::Success,
        HelperRunResult::Exited(code) if code == INJECT_ERROR_OPEN_PROCESS_FAIL => {
            // `OpenProcess` denied → anti-cheat / ACCESS_DENIED block (Req 10.4).
            InjectionOutcome::Blocked
        }
        // Any other non-zero exit code is a spawn/handshake/injection failure.
        HelperRunResult::Exited(_) => InjectionOutcome::Failed,
        // Could not launch the helper, or it died without an exit code (Req 7.4).
        HelperRunResult::SpawnFailed | HelperRunResult::NoExitCode => InjectionOutcome::Failed,
    }
}

/// Spawn the OBS `inject-helper` child process for `strategy` and wait for it.
///
/// This is the only OS-bound part of injection. It resolves the matching-bitness
/// helper + payload paths from `artifacts`, builds the OBS argv contract, runs
/// the helper to completion with `CREATE_NO_WINDOW`, and reduces the result to a
/// [`HelperRunResult`] for the pure [`classify_helper_result`] to interpret.
///
/// The helper and payload are always selected at the Target_Bitness: for
/// [`InjectStrategy::Direct`] that is the (matching) host/target bitness, and for
/// [`InjectStrategy::CrossBitness`] it is the differing target bitness — in both
/// cases `strategy.payload()` is the Target_Bitness by construction. If either
/// artifact is somehow absent (the caller's [`plan_injection`] should have caught
/// this) the spawn is reported as [`HelperRunResult::SpawnFailed`].
fn spawn_inject_helper(
    strategy: InjectStrategy,
    artifacts: &ObsArtifacts,
    mode: InjectionMode,
) -> HelperRunResult {
    let mut command = match build_inject_helper_command(strategy, artifacts, mode) {
        Some(command) => command,
        None => return HelperRunResult::SpawnFailed,
    };

    match command.status() {
        Ok(status) => match status.code() {
            Some(code) => HelperRunResult::Exited(code),
            None => HelperRunResult::NoExitCode,
        },
        Err(_) => HelperRunResult::SpawnFailed,
    }
}

/// Build the OBS inject-helper command line without starting it.
fn build_inject_helper_command(
    strategy: InjectStrategy,
    artifacts: &ObsArtifacts,
    mode: InjectionMode,
) -> Option<Command> {
    // The payload is always the Target_Bitness artifact (Req 2.4). The helper is
    // the matching-bitness `inject-helper`: for Direct that equals the payload
    // bitness; for CrossBitness it is the explicit target-bitness helper.
    let payload_bitness = strategy.payload();
    let helper_bitness = match strategy {
        InjectStrategy::Direct { payload } => payload,
        InjectStrategy::CrossBitness { helper, .. } => helper,
    };

    let (Some(helper_path), Some(payload_path)) = (
        artifacts.helper(helper_bitness),
        artifacts.payload(payload_bitness),
    ) else {
        return None;
    };

    // Build the OBS inject-helper argv: <dll_path> <use_safe_inject> <id>.
    // Direct mode passes a process id; safe mode passes a window thread id.
    let (use_safe_inject, target_id) = mode.helper_args();
    let mut command = Command::new(helper_path);
    command
        .arg(payload_path)
        .arg(use_safe_inject)
        .arg(target_id);

    // Never flash a console window for the console-subsystem helper.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    Some(command)
}

/// Run the OBS `inject-helper` as a separate child process and map the result to
/// an [`InjectionOutcome`].
///
/// The host launches the reused OBS `inject-helper` (a separate-process GPLv2
/// artifact) rather than linking OBS/GPL source into the proprietary binary;
/// interaction is across the process boundary only (Requirements 11.1, 11.2,
/// 11.5). The helper injects the matching-bitness `graphics-hook` payload
/// selected by `strategy`, using either the OBS safe thread-id path or the
/// legacy direct process-id path described by `mode`.
///
/// Outcome mapping (via [`classify_helper_result`]):
/// - `OpenProcess`/ACCESS_DENIED (exit `-3`) → [`InjectionOutcome::Blocked`]
///   (anti-cheat, Requirement 10.4),
/// - a spawn failure or any other non-zero/handshake failure →
///   [`InjectionOutcome::Failed`] (Requirement 7.4),
/// - a clean success (exit `0`) → [`InjectionOutcome::Success`].
///
/// # Safety gate precondition
///
/// This function does **not** consult the Process_Blocklist/Process_Allowlist: a
/// blocklisted target must never reach here. The caller's safety gate
/// (`game_capture::blocklist::safety_decision`, Requirement 10.2) runs *before*
/// injection and guarantees a protected title is never injected.
///
/// Validates: Requirements 1.1, 7.4, 10.4, 11.1, 11.2, 11.5.
pub fn run_inject_helper(
    strategy: InjectStrategy,
    artifacts: &ObsArtifacts,
    mode: InjectionMode,
) -> InjectionOutcome {
    let outcome = classify_helper_result(spawn_inject_helper(strategy, artifacts, mode));
    log::info!(
        "[inject] inject-helper mode={} -> {:?}",
        mode.label(),
        outcome
    );
    outcome
}

/// Spawn the OBS `inject-helper` and return immediately, mirroring OBS game
/// capture's compatibility path. Safe injection posts messages for up to four
/// seconds; waiting for that process to exit delays host IPC initialization and
/// can make the hook sit idle before `Initialize` is signaled.
pub fn spawn_inject_helper_async(
    strategy: InjectStrategy,
    artifacts: &ObsArtifacts,
    mode: InjectionMode,
) -> Result<Child, InjectionOutcome> {
    let Some(mut command) = build_inject_helper_command(strategy, artifacts, mode) else {
        return Err(InjectionOutcome::Failed);
    };
    match command.spawn() {
        Ok(child) => {
            log::info!(
                "[inject] inject-helper mode={} spawned asynchronously",
                mode.label()
            );
            Ok(child)
        }
        Err(_) => Err(InjectionOutcome::Failed),
    }
}

/// Map an asynchronously spawned helper's completed exit status to an injection
/// outcome. `None` means the helper is still running and no conclusion can be
/// drawn yet.
pub fn poll_async_helper(child: &mut Child) -> Option<InjectionOutcome> {
    match child.try_wait() {
        Ok(Some(status)) => Some(classify_helper_result(match status.code() {
            Some(code) => HelperRunResult::Exited(code),
            None => HelperRunResult::NoExitCode,
        })),
        Ok(None) => None,
        Err(_) => Some(InjectionOutcome::Failed),
    }
}

// ── get-graphics-offsets (DXGI hook vtable offsets) ──────────────────────────
//
// The injected `graphics-hook` DLL needs the DXGI `Present`/`ResizeBuffers`/
// `Present1` vtable offsets written into its `hook_info` before it can install
// its present interception (OBS `game-capture.c::init_hook_info` copies
// `offsets64`/`offsets32`, which OBS populates by running the standalone
// `get-graphics-offsets<bits>.exe` and parsing its INI — `load-graphics-offsets.c`).
//
// We do the same: run the bundled `get-graphics-offsets<bits>.exe`, capture its
// stdout, and parse the `[dxgi]` section. The exe filename matches the target
// bitness so the offsets are valid for the target's `dxgi.dll`.

/// The bitness-matched `get-graphics-offsets` artifact name shipped in the
/// OBS_Capture_Component.
pub const GET_GRAPHICS_OFFSETS_FOR: fn(Bitness) -> &'static str = |b| match b {
    Bitness::X64 => GET_GRAPHICS_OFFSETS64,
    Bitness::X86 => GET_GRAPHICS_OFFSETS32,
};

/// The DXGI vtable offsets parsed from `get-graphics-offsets`, mirroring
/// `struct dxgi_offsets` (+ `dxgi_offsets2.release`). Plain `u32`s so the parse
/// is pure and unit-testable.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ParsedDxgiOffsets {
    pub present: u32,
    pub resize: u32,
    pub present1: u32,
    pub release: u32,
}

impl ParsedDxgiOffsets {
    /// Whether the DLL can hook DXGI with these offsets (`dxgi_hookable`:
    /// present && resize must be non-zero).
    pub fn hookable(&self) -> bool {
        self.present != 0 && self.resize != 0
    }
}

// ── Per-backend graphics offsets (full OBS 32.1.2 `graphics_offsets`) ────────
//
// `get-graphics-offsets<bits>.exe` emits a `[section]` per graphics backend, not
// just `[dxgi]`. The host today resolves and writes only the DXGI set, so non-
// DX11 targets never hook (Requirement 4). The structs below model every
// backend that lives in the OBS 32.1.2 `graphics_offsets` struct so the parser
// (task 1.2) and the `hook_info` writer (task 2.1) can populate all of them.
//
// `ParsedDxgiOffsets` above is retained unchanged for the existing DXGI-only
// callers (`parse_graphics_offsets`, `load_graphics_offsets`, `native_share`);
// the new types are additive. Note the field split versus `ParsedDxgiOffsets`:
// here `release` belongs to [`Dxgi2Offsets`] (mirroring OBS's `dxgi_offsets2`),
// while [`DxgiOffsets`] carries only `present`/`resize`/`present1`.

/// D3D8 offsets (`struct d3d8_offsets`): just the `Present` vtable offset.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct D3d8Offsets {
    /// `IDirect3DDevice8::Present` vtable offset.
    pub present: u32,
}

/// D3D9 offsets (`struct d3d9_offsets`): the `Present`/`PresentEx`/swap-chain
/// `Present` vtable offsets plus the two class-offset discriminators OBS uses to
/// distinguish a plain `IDirect3DDevice9` from an `IDirect3DDevice9Ex`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct D3d9Offsets {
    /// `IDirect3DDevice9::Present` vtable offset.
    pub present: u32,
    /// `IDirect3DDevice9Ex::PresentEx` vtable offset.
    pub present_ex: u32,
    /// `IDirect3DSwapChain9::Present` vtable offset.
    pub present_swap: u32,
    /// Class-pointer offset OBS reads to locate the D3D9 device.
    pub d3d9_clsoff: u32,
    /// Class-pointer offset OBS reads to detect a D3D9Ex device.
    pub is_d3d9ex_clsoff: u32,
}

/// DXGI offsets (`struct dxgi_offsets`): the `Present`/`ResizeBuffers`/`Present1`
/// vtable offsets. The `release` offset lives separately in [`Dxgi2Offsets`]
/// (OBS's `dxgi_offsets2`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DxgiOffsets {
    /// `IDXGISwapChain::Present` vtable offset.
    pub present: u32,
    /// `IDXGISwapChain::ResizeBuffers` vtable offset.
    pub resize: u32,
    /// `IDXGISwapChain1::Present1` vtable offset.
    pub present1: u32,
}

impl DxgiOffsets {
    /// Whether the DLL can hook DXGI with these offsets (`dxgi_hookable`:
    /// present && resize must be non-zero).
    pub fn hookable(&self) -> bool {
        self.present != 0 && self.resize != 0
    }
}

/// DXGI2 offsets (`struct dxgi_offsets2`): the `IDXGIResource::Release` vtable
/// offset OBS uses on the shared backbuffer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Dxgi2Offsets {
    /// `IDXGIResource::Release` vtable offset.
    pub release: u32,
}

/// D3D12 offsets (`struct d3d12_offsets`): the
/// `ID3D12CommandQueue::ExecuteCommandLists` vtable offset.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct D3d12Offsets {
    /// `ID3D12CommandQueue::ExecuteCommandLists` vtable offset.
    pub execute_command_lists: u32,
}

/// All graphics-hook offsets parsed from `get-graphics-offsets` output, covering
/// every backend the OBS 32.1.2 `graphics_offsets` struct carries.
///
/// Vulkan and OpenGL are intentionally **not** modeled here: OBS 32.1.2 does not
/// hook them via `hook_info` vtable offsets (they hook at the loader/ICD level),
/// so there are no offset fields to write. The host's job is to supply the
/// DXGI/D3D9/D3D8/D3D12 offsets; see the design's "Data Models" section.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AllGraphicsOffsets {
    /// D3D8 `Present` offset.
    pub d3d8: D3d8Offsets,
    /// D3D9 / D3D9Ex offsets.
    pub d3d9: D3d9Offsets,
    /// DXGI (`present`/`resize`/`present1`) offsets.
    pub dxgi: DxgiOffsets,
    /// DXGI2 (`release`) offset.
    pub dxgi2: Dxgi2Offsets,
    /// D3D12 (`execute_command_lists`) offset.
    pub d3d12: D3d12Offsets,
}

/// Parse a single `get-graphics-offsets` value into a `u32`.
///
/// The C emits `0x`-prefixed lowercase hex (`PRIx32` with a literal `0x`
/// prefix), e.g. `present=0x4f0`. We accept that, an upper-case `0X` prefix, and
/// a bare decimal value as a lenient fallback. Anything unparseable yields `0`,
/// keeping the parsers pure and total.
fn parse_offset_value(value: &str) -> u32 {
    let value = value.trim();
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .or_else(|| value.parse::<u32>().ok())
        .unwrap_or(0)
}

/// Parse the `[dxgi]` section of `get-graphics-offsets` INI-style stdout
/// (`get-graphics-offsets.c`: `present=0x..`, `present1=0x..`, `resize=0x..`,
/// `release=0x..`). Pure and total — unknown/missing keys stay zero, so it is
/// unit-tested without running the exe.
///
/// Retained unchanged for the DXGI-only callers; [`parse_all_graphics_offsets`]
/// is the forward-looking parser that covers every backend.
pub fn parse_graphics_offsets(stdout: &str) -> ParsedDxgiOffsets {
    let mut offsets = ParsedDxgiOffsets::default();
    let mut in_dxgi = false;
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            in_dxgi = line.eq_ignore_ascii_case("[dxgi]");
            continue;
        }
        if !in_dxgi {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        // Values are `0x`-prefixed hex (PRIx32 with a `0x` prefix in the C).
        let parsed = parse_offset_value(value);
        match key {
            "present" => offsets.present = parsed,
            "resize" => offsets.resize = parsed,
            "present1" => offsets.present1 = parsed,
            "release" => offsets.release = parsed,
            _ => {}
        }
    }
    offsets
}

/// Parse **all** backend offset sections of `get-graphics-offsets` INI-style
/// stdout into an [`AllGraphicsOffsets`] (Requirement 4.1).
///
/// This is the forward-looking counterpart to [`parse_graphics_offsets`]: rather
/// than reading only `[dxgi]`, it walks every section and maps each section's
/// keys to the corresponding per-backend struct field.
///
/// Section/key mapping (per the design's "Data Models" section):
///
/// - `[d3d8]` → `present`
/// - `[d3d9]` → `present`, `present_ex`, `present_swap`, `d3d9_clsoff`,
///   `is_d3d9ex_clsoff`
/// - `[dxgi]` → `present`, `resize`, `present1` (and `release`, see below)
/// - `[dxgi2]` → `release`
/// - `[d3d12]` → `execute_command_lists`
///
/// The bundled OBS 32.1.2 `get-graphics-offsets<bits>.exe` prints
/// `dxgi_offsets2.release` **inside** the `[dxgi]` section (it has no `[dxgi2]`
/// section and emits no `[d3d12]` section at all — verify against the pinned
/// OBS source `get-graphics-offsets.c`). To work against the real artifact while
/// still honoring the design's `dxgi2 { release }` / `d3d12 { … }` data model,
/// `release` is accepted under **both** `[dxgi]` and a `[dxgi2]` section and
/// routed to [`Dxgi2Offsets::release`], and `execute_command_lists` is accepted
/// under a `[d3d12]` section if a future helper emits one.
///
/// Pure and total: unknown sections and keys are ignored (forward-compatible),
/// and missing keys stay zero via [`Default`], so it is unit-tested without
/// running the exe.
pub fn parse_all_graphics_offsets(stdout: &str) -> AllGraphicsOffsets {
    let mut offsets = AllGraphicsOffsets::default();
    // The current section name, lower-cased and stripped of the `[...]`. Lines
    // before the first section header (or in an unknown section) are ignored.
    let mut section = String::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            section = name.trim().to_ascii_lowercase();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let parsed = parse_offset_value(value);
        match section.as_str() {
            "d3d8" => {
                if key == "present" {
                    offsets.d3d8.present = parsed;
                }
            }
            "d3d9" => match key {
                "present" => offsets.d3d9.present = parsed,
                "present_ex" => offsets.d3d9.present_ex = parsed,
                "present_swap" => offsets.d3d9.present_swap = parsed,
                "d3d9_clsoff" => offsets.d3d9.d3d9_clsoff = parsed,
                "is_d3d9ex_clsoff" => offsets.d3d9.is_d3d9ex_clsoff = parsed,
                _ => {}
            },
            "dxgi" => match key {
                "present" => offsets.dxgi.present = parsed,
                "resize" => offsets.dxgi.resize = parsed,
                "present1" => offsets.dxgi.present1 = parsed,
                // OBS 32.1.2 prints `dxgi_offsets2.release` inside `[dxgi]`; the
                // design models it as `dxgi2.release`, so route it there.
                "release" => offsets.dxgi2.release = parsed,
                _ => {}
            },
            "dxgi2" => {
                if key == "release" {
                    offsets.dxgi2.release = parsed;
                }
            }
            "d3d12" => {
                if key == "execute_command_lists" {
                    offsets.d3d12.execute_command_lists = parsed;
                }
            }
            // Unknown sections (e.g. a future `[vulkan]`/`[opengl]`/`[ddraw]`)
            // are ignored — forward-compatible.
            _ => {}
        }
    }
    offsets
}

/// Run the bundled `get-graphics-offsets<bits>.exe` for `target_bitness` and
/// parse the DXGI offsets from its stdout.
///
/// This is the OS-bound counterpart to [`parse_graphics_offsets`]. Returns
/// `None` (rather than erroring) when the artifact is absent or the process
/// fails — the caller then proceeds with zero offsets, which means the hook will
/// not install (and the session falls back to WGC), logged loudly upstream.
///
/// The exe is run with `CREATE_NO_WINDOW`. It must match the **target** bitness
/// because the offsets are read from that bitness's `dxgi.dll`.
pub fn load_graphics_offsets(
    artifacts: &ObsArtifacts,
    target_bitness: Bitness,
) -> Option<ParsedDxgiOffsets> {
    let dir = artifacts.dir()?;
    let exe = dir.join(GET_GRAPHICS_OFFSETS_FOR(target_bitness));
    if !exe.is_file() {
        log::warn!(
            "[inject] {} not found next to the OBS artifacts; cannot resolve DXGI hook offsets",
            exe.display()
        );
        return None;
    }

    let mut command = Command::new(&exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = match command.output() {
        Ok(out) => out,
        Err(e) => {
            log::warn!("[inject] failed to run {}: {e}", exe.display());
            return None;
        }
    };
    if !output.status.success() {
        log::warn!(
            "[inject] {} exited with {:?}",
            exe.display(),
            output.status.code()
        );
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let offsets = parse_graphics_offsets(&stdout);
    log::info!(
        "[inject] resolved DXGI offsets ({:?}): present={:#x} resize={:#x} present1={:#x} release={:#x} (hookable={})",
        target_bitness,
        offsets.present,
        offsets.resize,
        offsets.present1,
        offsets.release,
        offsets.hookable(),
    );
    Some(offsets)
}

/// Run the bundled `get-graphics-offsets<bits>.exe` for `target_bitness` and
/// parse **all** backend offsets (D3D8, D3D9, DXGI, DXGI2, D3D12) from its
/// stdout into an [`AllGraphicsOffsets`] (Requirements 4.1, 4.7, 6.1, 6.7).
///
/// This is the all-backend successor to [`load_graphics_offsets`] (which only
/// resolves the DXGI set). It uses the same artifact-discovery and
/// bitness-matching spawn logic, but differs in three ways that the
/// frame-delivery spec requires:
///
/// 1. **A hard 5000 ms timeout (Requirement 4.7).** Unlike
///    [`load_graphics_offsets`], which blocks on `Command::output()` with no
///    bound, this spawns the child with its stdout piped and polls
///    [`Child::try_wait`] against a deadline. If the deadline is exceeded the
///    child is killed and `None` is returned, so a hung helper can never stall
///    the injection path indefinitely.
/// 2. **All sections are parsed** via [`parse_all_graphics_offsets`] instead of
///    only `[dxgi]`.
/// 3. **`target_pid` is logged on failure (Requirement 6.7).** The signature
///    takes an extra `target_pid` purely so an offset-resolution failure can be
///    attributed to the Target_Process in the logs; it does not affect which
///    artifact is run (that is still selected by `target_bitness`). Task 5.3,
///    which wires this into the injection path, must pass the real PID.
///
/// Returns `None` (so the caller records the failure and falls back to WGC) on
/// any of: a missing artifact, a failure to spawn, a non-zero exit, the 5000 ms
/// timeout, or empty/unparseable stdout (empty output parses to all-zero
/// offsets, which can never hook, so it is treated as a failure here).
///
/// On success it logs the resolved DXGI present/resize/release offsets as
/// distinct fields together with the backend bitness (Requirement 6.1).
///
/// Validates: Requirements 4.1, 4.7, 6.1, 6.7.
/// Process-lifetime cache of resolved graphics offsets, keyed by target bitness.
///
/// The `get-graphics-offsets<bits>.exe` helper computes vtable offsets from the
/// **system's** D3D/DXGI runtime DLLs inside its own process — the result is
/// identical for every target of a given bitness on this machine and only
/// changes if the OS's D3D runtime is updated (which requires an app restart to
/// matter). Resolving them spawns a child process and waits for it (tens to
/// hundreds of ms, and up to the 5 s timeout on a cold/contended run), which is
/// the single biggest contributor to go-live latency. Caching the first
/// successful result per bitness makes every subsequent share inject
/// immediately, matching the "instant second go-live" behavior other capture
/// apps get by keeping offsets warm.
///
/// Only **successful** resolutions are cached; a failure is never cached, so a
/// transient helper failure does not permanently disable the hook.
static OFFSET_CACHE: OnceLock<Mutex<HashMap<Bitness, AllGraphicsOffsets>>> = OnceLock::new();

fn offset_cache() -> &'static Mutex<HashMap<Bitness, AllGraphicsOffsets>> {
    OFFSET_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Resolve all backend graphics offsets for `target_bitness`, using the
/// process-lifetime [`OFFSET_CACHE`] so the `get-graphics-offsets` helper runs
/// **at most once per bitness** per app session (Requirement 4.1, plus the
/// go-live latency optimization).
///
/// On a cache hit this returns immediately with no child process. On a miss it
/// runs [`resolve_all_graphics_offsets_uncached`]; a successful result is cached
/// for future shares, a failure is not.
pub fn load_all_graphics_offsets(
    artifacts: &ObsArtifacts,
    target_bitness: Bitness,
    target_pid: u32,
) -> Option<AllGraphicsOffsets> {
    if let Ok(cache) = offset_cache().lock() {
        if let Some(hit) = cache.get(&target_bitness) {
            log::info!(
                "[inject] using cached graphics offsets for pid {target_pid} ({:?}) — \
                 skipping get-graphics-offsets helper (go-live fast path)",
                target_bitness
            );
            return Some(hit.clone());
        }
    }

    let resolved = resolve_all_graphics_offsets_uncached(artifacts, target_bitness, target_pid)?;

    if let Ok(mut cache) = offset_cache().lock() {
        cache.insert(target_bitness, resolved.clone());
    }
    Some(resolved)
}

fn resolve_all_graphics_offsets_uncached(
    artifacts: &ObsArtifacts,
    target_bitness: Bitness,
    target_pid: u32,
) -> Option<AllGraphicsOffsets> {
    /// The wall-clock budget for the helper, per Requirement 4.7.
    const OFFSET_RESOLUTION_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(5000);
    /// Poll cadence while waiting for the child to exit. Short enough to keep
    /// first-frame latency low, long enough not to busy-spin.
    const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);

    let Some(dir) = artifacts.dir() else {
        log::warn!(
            "[inject] offset resolution failed for pid {target_pid}: OBS artifacts directory \
             not found (reason=missing_artifact)"
        );
        return None;
    };
    let exe = dir.join(GET_GRAPHICS_OFFSETS_FOR(target_bitness));
    if !exe.is_file() {
        log::warn!(
            "[inject] offset resolution failed for pid {target_pid}: {} not found next to the \
             OBS artifacts (reason=missing_artifact)",
            exe.display()
        );
        return None;
    }

    // Spawn with stdout piped so we can read it after the process completes,
    // while retaining the handle to enforce the timeout via `try_wait`.
    let mut command = Command::new(&exe);
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            log::warn!(
                "[inject] offset resolution failed for pid {target_pid}: failed to run {} \
                 (reason=spawn_failed: {e})",
                exe.display()
            );
            return None;
        }
    };

    // Poll for completion against a deadline; kill the child if it overruns the
    // 5000 ms budget (Requirement 4.7).
    let deadline = std::time::Instant::now() + OFFSET_RESOLUTION_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    log::warn!(
                        "[inject] offset resolution failed for pid {target_pid}: {} did not \
                         complete within {} ms; killed (reason=timeout)",
                        exe.display(),
                        OFFSET_RESOLUTION_TIMEOUT.as_millis()
                    );
                    return None;
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                log::warn!(
                    "[inject] offset resolution failed for pid {target_pid}: error waiting on {} \
                     (reason=wait_failed: {e})",
                    exe.display()
                );
                return None;
            }
        }
    };

    if !status.success() {
        log::warn!(
            "[inject] offset resolution failed for pid {target_pid}: {} exited with {:?} \
             (reason=nonzero_exit)",
            exe.display(),
            status.code()
        );
        return None;
    }

    // Read the captured stdout now that the process has exited.
    let mut stdout = String::new();
    if let Some(mut out) = child.stdout.take() {
        use std::io::Read;
        if let Err(e) = out.read_to_string(&mut stdout) {
            log::warn!(
                "[inject] offset resolution failed for pid {target_pid}: could not read {} stdout \
                 (reason=read_failed: {e})",
                exe.display()
            );
            return None;
        }
    }
    if stdout.trim().is_empty() {
        log::warn!(
            "[inject] offset resolution failed for pid {target_pid}: {} produced no output \
             (reason=empty_output)",
            exe.display()
        );
        return None;
    }

    let offsets = parse_all_graphics_offsets(&stdout);
    // Empty/unparseable output yields all-zero offsets, which can never hook;
    // treat a zero DXGI present offset as a resolution failure (Requirement 4.7).
    if offsets == AllGraphicsOffsets::default() {
        log::warn!(
            "[inject] offset resolution failed for pid {target_pid}: {} output parsed to all-zero \
             offsets (reason=empty_output)",
            exe.display()
        );
        return None;
    }

    log::info!(
        "[inject] resolved graphics offsets for pid {target_pid} ({:?}): \
         dxgi.present={:#x} dxgi.resize={:#x} dxgi2.release={:#x} dxgi.present1={:#x} \
         d3d9.present={:#x} d3d12.execute_command_lists={:#x} (dxgi_hookable={})",
        target_bitness,
        offsets.dxgi.present,
        offsets.dxgi.resize,
        offsets.dxgi2.release,
        offsets.dxgi.present1,
        offsets.d3d9.present,
        offsets.d3d12.execute_command_lists,
        offsets.dxgi.hookable(),
    );
    Some(offsets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::SystemInformation::{
        IMAGE_FILE_MACHINE_AMD64, IMAGE_FILE_MACHINE_ARM64,
    };

    fn p(name: &str) -> Option<PathBuf> {
        Some(PathBuf::from(name))
    }

    /// An [`ObsArtifacts`] with all four artifacts present.
    fn all_artifacts() -> ObsArtifacts {
        ObsArtifacts::new(
            p("graphics-hook64.dll"),
            p("graphics-hook32.dll"),
            p("inject-helper64.exe"),
            p("inject-helper32.exe"),
        )
    }

    #[test]
    fn bitness_strings_are_stable() {
        assert_eq!(Bitness::X86.as_str(), "x86");
        assert_eq!(Bitness::X64.as_str(), "x64");
    }

    #[test]
    fn payload_and_helper_accessors_select_by_bitness() {
        let artifacts = all_artifacts();
        assert_eq!(
            artifacts.payload(Bitness::X64),
            Some(Path::new("graphics-hook64.dll"))
        );
        assert_eq!(
            artifacts.payload(Bitness::X86),
            Some(Path::new("graphics-hook32.dll"))
        );
        assert_eq!(
            artifacts.helper(Bitness::X64),
            Some(Path::new("inject-helper64.exe"))
        );
        assert_eq!(
            artifacts.helper(Bitness::X86),
            Some(Path::new("inject-helper32.exe"))
        );
    }

    #[test]
    fn missing_artifacts_default_to_none() {
        let artifacts = ObsArtifacts::default();
        assert!(artifacts.payload(Bitness::X64).is_none());
        assert!(artifacts.payload(Bitness::X86).is_none());
        assert!(artifacts.helper(Bitness::X64).is_none());
        assert!(artifacts.helper(Bitness::X86).is_none());
    }

    #[test]
    fn direct_strategy_when_host_matches_target() {
        let artifacts = all_artifacts();
        // 64-bit host, 64-bit target.
        let strategy = plan_injection(Bitness::X64, Bitness::X64, &artifacts).unwrap();
        assert_eq!(
            strategy,
            InjectStrategy::Direct {
                payload: Bitness::X64
            }
        );
        assert_eq!(strategy.payload(), Bitness::X64);
        assert_eq!(strategy.helper(), None);

        // 32-bit host, 32-bit target.
        let strategy = plan_injection(Bitness::X86, Bitness::X86, &artifacts).unwrap();
        assert_eq!(
            strategy,
            InjectStrategy::Direct {
                payload: Bitness::X86
            }
        );
    }

    #[test]
    fn cross_bitness_strategy_when_host_differs_from_target() {
        let artifacts = all_artifacts();
        // 64-bit host injecting a 32-bit target → use the 32-bit helper + payload.
        let strategy = plan_injection(Bitness::X64, Bitness::X86, &artifacts).unwrap();
        assert_eq!(
            strategy,
            InjectStrategy::CrossBitness {
                payload: Bitness::X86,
                helper: Bitness::X86,
            }
        );
        assert_eq!(strategy.payload(), Bitness::X86);
        assert_eq!(strategy.helper(), Some(Bitness::X86));

        // 32-bit host injecting a 64-bit target → use the 64-bit helper + payload.
        let strategy = plan_injection(Bitness::X86, Bitness::X64, &artifacts).unwrap();
        assert_eq!(
            strategy,
            InjectStrategy::CrossBitness {
                payload: Bitness::X64,
                helper: Bitness::X64,
            }
        );
    }

    #[test]
    fn selected_payload_bitness_always_equals_target() {
        let artifacts = all_artifacts();
        for host in [Bitness::X86, Bitness::X64] {
            for target in [Bitness::X86, Bitness::X64] {
                let strategy = plan_injection(host, target, &artifacts).unwrap();
                assert_eq!(
                    strategy.payload(),
                    target,
                    "host {host:?}, target {target:?}: payload must match target"
                );
            }
        }
    }

    #[test]
    fn missing_payload_is_missing_artifact() {
        // Only the 32-bit payload/helper present; targeting a 64-bit process
        // has no payload.
        let artifacts = ObsArtifacts::new(
            None,
            p("graphics-hook32.dll"),
            None,
            p("inject-helper32.exe"),
        );
        let err = plan_injection(Bitness::X64, Bitness::X64, &artifacts).unwrap_err();
        assert_eq!(err, FallbackReason::MissingArtifact);
    }

    #[test]
    fn cross_bitness_missing_helper_is_missing_artifact() {
        // Both payloads present, but no helpers at all. A direct (matching)
        // injection still succeeds, but a cross-bitness one needs the helper.
        let artifacts = ObsArtifacts::new(
            p("graphics-hook64.dll"),
            p("graphics-hook32.dll"),
            None,
            None,
        );
        // Matching bitness → Direct, no helper required → Ok.
        assert!(plan_injection(Bitness::X64, Bitness::X64, &artifacts).is_ok());
        // Differing bitness → CrossBitness needs the target-bitness helper → Err.
        let err = plan_injection(Bitness::X64, Bitness::X86, &artifacts).unwrap_err();
        assert_eq!(err, FallbackReason::MissingArtifact);
    }

    #[test]
    fn missing_payload_takes_precedence_over_missing_helper() {
        // Cross-bitness with neither the target payload nor helper present: the
        // payload check fires first and the reason is still MissingArtifact.
        let artifacts = ObsArtifacts::default();
        let err = plan_injection(Bitness::X64, Bitness::X86, &artifacts).unwrap_err();
        assert_eq!(err, FallbackReason::MissingArtifact);
    }

    #[test]
    fn discover_reports_only_present_files() {
        // Build a unique temp dir and create just two of the four artifacts.
        let dir = std::env::temp_dir().join(format!(
            "ralph_obs_artifacts_{}_{}",
            std::process::id(),
            // A monotonic-ish suffix to avoid collisions across test runs.
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        std::fs::write(dir.join(GRAPHICS_HOOK64), b"stub").expect("write payload");
        std::fs::write(dir.join(INJECT_HELPER64), b"stub").expect("write helper");

        let artifacts = ObsArtifacts::discover(&dir);
        assert_eq!(
            artifacts.payload(Bitness::X64),
            Some(dir.join(GRAPHICS_HOOK64).as_path())
        );
        assert_eq!(
            artifacts.helper(Bitness::X64),
            Some(dir.join(INJECT_HELPER64).as_path())
        );
        // The 32-bit artifacts were never created.
        assert!(artifacts.payload(Bitness::X86).is_none());
        assert!(artifacts.helper(Bitness::X86).is_none());

        // A matching 64-bit injection can be planned from the discovered set.
        assert!(plan_injection(Bitness::X64, Bitness::X64, &artifacts).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_empty_dir_yields_all_none() {
        let dir = std::env::temp_dir().join(format!(
            "ralph_obs_artifacts_empty_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");

        let artifacts = ObsArtifacts::discover(&dir);
        assert_eq!(artifacts, ObsArtifacts::default());

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── classify_machine (pure mapping of IsWow64Process2 output) ───────────

    #[test]
    fn classify_native_64bit_process() {
        // Native process (process_machine == UNKNOWN) on a 64-bit host.
        assert_eq!(
            classify_machine(IMAGE_FILE_MACHINE_UNKNOWN, IMAGE_FILE_MACHINE_AMD64),
            Bitness::X64
        );
        assert_eq!(
            classify_machine(IMAGE_FILE_MACHINE_UNKNOWN, IMAGE_FILE_MACHINE_ARM64),
            Bitness::X64
        );
    }

    #[test]
    fn classify_native_32bit_process() {
        // Native process on a 32-bit host.
        assert_eq!(
            classify_machine(IMAGE_FILE_MACHINE_UNKNOWN, IMAGE_FILE_MACHINE_I386),
            Bitness::X86
        );
    }

    #[test]
    fn classify_wow64_32bit_process_on_64bit_host() {
        // 32-bit process under WOW64: process_machine == I386, host is AMD64.
        assert_eq!(
            classify_machine(IMAGE_FILE_MACHINE_I386, IMAGE_FILE_MACHINE_AMD64),
            Bitness::X86
        );
    }

    // ── classify_helper_result (pure inject-helper outcome mapping) ─────────

    #[test]
    fn helper_success_exit_maps_to_success() {
        assert_eq!(
            classify_helper_result(HelperRunResult::Exited(INJECT_SUCCESS)),
            InjectionOutcome::Success
        );
    }

    #[test]
    fn helper_open_process_fail_maps_to_blocked() {
        // OpenProcess denied is the anti-cheat / ACCESS_DENIED signal (Req 10.4).
        assert_eq!(
            classify_helper_result(HelperRunResult::Exited(INJECT_ERROR_OPEN_PROCESS_FAIL)),
            InjectionOutcome::Blocked
        );
    }

    #[test]
    fn helper_other_error_exit_codes_map_to_failed() {
        // Every non-success, non-open-process-fail exit code is a failure (Req 7.4).
        for code in [
            INJECT_ERROR_INJECT_FAILED,
            INJECT_ERROR_INVALID_PARAMS,
            INJECT_ERROR_UNLIKELY_FAIL,
            // An arbitrary unexpected code is still a failure, never a block.
            42,
            -99,
        ] {
            assert_eq!(
                classify_helper_result(HelperRunResult::Exited(code)),
                InjectionOutcome::Failed,
                "exit code {code} must map to Failed"
            );
        }
    }

    #[test]
    fn helper_spawn_failure_maps_to_failed() {
        // Could not launch the helper at all → Failed, fall back to WGC (Req 7.4).
        assert_eq!(
            classify_helper_result(HelperRunResult::SpawnFailed),
            InjectionOutcome::Failed
        );
    }

    #[test]
    fn helper_no_exit_code_maps_to_failed() {
        // Killed without an exit code (crash/signal) → Failed, not Blocked.
        assert_eq!(
            classify_helper_result(HelperRunResult::NoExitCode),
            InjectionOutcome::Failed
        );
    }

    #[test]
    fn classify_helper_result_never_returns_not_attempted() {
        // Reaching the helper means an attempt was made, so NotAttempted is
        // impossible regardless of the run result.
        for result in [
            HelperRunResult::Exited(INJECT_SUCCESS),
            HelperRunResult::Exited(INJECT_ERROR_OPEN_PROCESS_FAIL),
            HelperRunResult::Exited(INJECT_ERROR_INJECT_FAILED),
            HelperRunResult::Exited(7),
            HelperRunResult::SpawnFailed,
            HelperRunResult::NoExitCode,
        ] {
            assert_ne!(
                classify_helper_result(result),
                InjectionOutcome::NotAttempted,
                "result {result:?} must never be NotAttempted"
            );
        }
    }

    #[test]
    fn run_inject_helper_missing_artifact_is_failed() {
        // With no artifacts present, the spawn cannot resolve paths and the
        // outcome is Failed (the caller's plan_injection guards this earlier).
        let artifacts = ObsArtifacts::default();
        let outcome = run_inject_helper(
            InjectStrategy::Direct {
                payload: Bitness::X64,
            },
            &artifacts,
            InjectionMode::Safe { thread_id: 1234 },
        );
        assert_eq!(outcome, InjectionOutcome::Failed);
    }

    #[test]
    fn injection_mode_helper_args_match_obs_contract() {
        assert_eq!(
            InjectionMode::Direct { pid: 1234 }.helper_args(),
            ("0", "1234".to_string())
        );
        assert_eq!(
            InjectionMode::Safe { thread_id: 5678 }.helper_args(),
            ("1", "5678".to_string())
        );
    }

    // ── parse_graphics_offsets (pure INI parse of get-graphics-offsets) ─────

    #[test]
    fn parse_graphics_offsets_reads_dxgi_section() {
        // Mirrors get-graphics-offsets.c stdout (d3d8/d3d9/dxgi sections).
        let stdout = "\
[d3d8]
present=0x1234
[d3d9]
present=0xaaaa
present_ex=0xbbbb
present_swap=0xcccc
d3d9_clsoff=0x1
is_d3d9ex_clsoff=0x2
[dxgi]
present=0x4f0
present1=0x510
resize=0x4d8
release=0x60
";
        let off = parse_graphics_offsets(stdout);
        assert_eq!(off.present, 0x4f0);
        assert_eq!(off.present1, 0x510);
        assert_eq!(off.resize, 0x4d8);
        assert_eq!(off.release, 0x60);
        assert!(off.hookable(), "present + resize non-zero ⇒ hookable");
    }

    #[test]
    fn parse_graphics_offsets_ignores_non_dxgi_and_missing() {
        // Only a d3d9 section: the dxgi offsets stay zero and are not hookable.
        let stdout = "[d3d9]\npresent=0xaaaa\npresent_ex=0xbbbb\n";
        let off = parse_graphics_offsets(stdout);
        assert_eq!(off, ParsedDxgiOffsets::default());
        assert!(!off.hookable());
        // Empty input is total and yields all-zero.
        assert_eq!(parse_graphics_offsets(""), ParsedDxgiOffsets::default());
    }

    #[test]
    fn parse_graphics_offsets_accepts_decimal_values() {
        // Be lenient: a non-0x value still parses as decimal.
        let off = parse_graphics_offsets("[dxgi]\npresent=1264\nresize=1240\n");
        assert_eq!(off.present, 1264);
        assert_eq!(off.resize, 1240);
        assert!(off.hookable());
    }

    #[test]
    fn obs_artifacts_dir_is_the_parent_of_a_discovered_artifact() {
        let artifacts = ObsArtifacts::new(
            Some(PathBuf::from(
                r"C:\app\resources\obs-capture\graphics-hook64.dll",
            )),
            None,
            None,
            None,
        );
        assert_eq!(
            artifacts.dir(),
            Some(PathBuf::from(r"C:\app\resources\obs-capture"))
        );
        assert_eq!(ObsArtifacts::default().dir(), None);
    }
}
