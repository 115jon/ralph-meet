//! OBS game-capture IPC — the project's own clean-room consumer of OBS Studio's
//! shared-texture ("shtex") capture protocol (Requirements 1.4, 1.6, 1.7, 9.2,
//! 9.3, 11.4).
//!
//! This module is the **host side only**. It links no GPL OBS source; it speaks
//! OBS's named-event + shared-memory protocol across the process boundary to the
//! injected `graphics-hook` DLL.
//!
//! # Pinned to OBS Studio 32.1.2 (verified against source)
//!
//! Unlike the earlier scaffold, every constant and struct here was reconciled
//! against the real OBS 32.1.2 source:
//!   - `shared/obs-hook-config/graphics-hook-info.h` — the 648-byte `hook_info`
//!     struct (`static_assert(sizeof == 648)`), the `shtex_data`/`shmem_data`
//!     layouts, the object name macros, and `create_hook_info`.
//!   - `plugins/win-capture/graphics-hook/graphics-hook.c` — the injected DLL's
//!     init/handshake (`init_signals`, `init_mutexes`, `init_hook_info`,
//!     `capture_init_shtex`), which side creates each object, and the shtex
//!     mapping name `CaptureHook_Texture_<root-hwnd>_<map_id>`.
//!   - `plugins/win-capture/game-capture.c` — the host orchestration
//!     (`init_keepalive`, `init_hook_info` populating offsets, `init_events`,
//!     `SetEvent(hook_init)`, `init_data_map`, `init_shtex_capture`).
//!   - `plugins/win-capture/load-graphics-offsets.c` +
//!     `get-graphics-offsets/get-graphics-offsets.c` — running
//!     `get-graphics-offsets<bits>.exe` and parsing its INI to fill
//!     `hook_info.offsets`.
//!
//! # The real handshake (consumer view)
//!
//! All kernel objects are suffixed by the **target process id** and are
//! **created by the injected DLL** in `DllMain`; the host **opens** them. The
//! sequence the host performs (mirroring `init_hook` in `game-capture.c`):
//!
//! 1. Hold the **keepalive mutex** `CaptureHook_KeepAlive<pid>` open — the hook
//!    self-ejects if it ever goes away (`capture_alive`).
//! 2. Open the two texture mutexes `CaptureHook_TextureMutex1/2<pid>` (their
//!    existence proves the DLL finished `DllMain`; ERROR_FILE_NOT_FOUND ⇒ retry).
//! 3. Open + map the `hook_info` mapping `CaptureHook_HookInfo<pid>` (648 bytes)
//!    and **populate** it: write the DXGI/D3D `graphics_offsets` (from
//!    `get-graphics-offsets<bits>.exe`), `frame_interval`, `force_shmem=false`,
//!    `allow_srgb_alias=true`. Without the offsets the DLL logs "no DXGI hook
//!    address found" and never installs its Present hook.
//! 4. Open the events `CaptureHook_Restart/Stop/HookReady/Exit/Initialize<pid>`.
//! 5. `SetEvent(Initialize)` to release the DLL's `capture_loop`
//!    (`WaitForSingleObject(signal_init, INFINITE)`), then it begins hooking.
//! 6. On each presented frame the DLL copies the backbuffer into a shared
//!    texture and `SetEvent(HookReady)` **once per init/resize** (not per
//!    frame). On `HookReady` the host reads `hook_info.{type,format,cx,cy,
//!    map_id,window}` and opens the shtex mapping
//!    `CaptureHook_Texture_<root-hwnd>_<map_id>` whose 4-byte `shtex_data`
//!    carries the legacy DXGI `GetSharedHandle()` value to `OpenSharedResource`.
//!    The host then samples that shared texture every frame.
//!
//! # Scope of this file
//!
//! - **The pure `hook_info` codec** ([`encode_hook_info`]/[`decode_hook_info`],
//!   [`FrameMetadata`], [`HOOK_INFO_LEN`]) now encodes the **real** subset of the
//!   648-byte struct the host reads (version, type, window, format, cx, cy,
//!   map_id, map_size) at their true offsets, padded to 648. The round-trip
//!   property (Property 8 / Req 1.7) still holds and now pins our reader to the
//!   real layout.
//! - **The live, OS-bound [`ObsIpcChannel`]** (Windows only) implements the full
//!   handshake above (`start`/`next_metadata`/`handle_changed`/`target_exited`/
//!   `stop`).

use std::error::Error;
use std::fmt;

// ───────────────────────────────────────────────────────────────────────────
// Private_Namespace IPC object names (Req 2.1, 2.2, 2.3, 3.1).
//
// The ABI (the 648-byte `hook_info` layout, the shtex `shmem`/`shtex` data
// layouts, the keyed-mutex sharing mode) is pinned to OBS 32.1.2 and is
// UNCHANGED — only the object-name **strings** carry our private prefix so we
// never collide with a stock OBS install hooking the same target PID. Every
// per-target kernel object is suffixed by the target PROCESS ID, e.g.
// "RalphCaptureHook_HookInfo12345".
//
// CRITICAL — fork sync: [`PRIVATE_NS`] below is the SINGLE source of the prefix
// on the host side; every base name derives from it via [`private_name!`], so a
// re-pin changes one literal in one place. It MUST stay byte-for-byte in sync
// with the Forked_Hook_DLL's compiled-in `#define`s (the fork rewrites OBS's
// `EVENT_*` / `WINDOW_HOOK_KEEPALIVE` / `MUTEX_TEXTURE*` / `SHMEM_*` / the pipe
// name / `graphics_hook_dup_mutex` to this same prefix — owned-game-capture-hook
// task 1.1). Keep both prefixes auditable in one place each.
// ───────────────────────────────────────────────────────────────────────────

/// The single literal source of the Private_Namespace prefix. Used by
/// [`PRIVATE_NS`] and by [`private_name!`] so every base name below is built
/// from the same prefix — change this one literal to re-pin the namespace.
macro_rules! private_ns_prefix {
    () => {
        "RalphCaptureHook_"
    };
}

/// Build a Private_Namespace base name as a `&'static str` literal by prefixing
/// `$suffix` with [`private_ns_prefix!`]. `concat!` keeps the result a compile-
/// time literal so these stay `const`-usable and the prefix lives in one place.
macro_rules! private_name {
    ($suffix:literal) => {
        concat!(private_ns_prefix!(), $suffix)
    };
}

/// The project's private IPC object-name prefix (Req 2.1). Fixed, non-empty,
/// and distinct from OBS's `CaptureHook_` so no Private_Namespace object name
/// can equal an OBS `CaptureHook_*` name for the same target. This is the one
/// place the prefix string is defined on the host side; the Forked_Hook_DLL
/// compiles in the byte-for-byte identical prefix (task 1.1).
pub const PRIVATE_NS: &str = private_ns_prefix!();

/// The OBS Studio prefix the Private_Namespace deliberately avoids. The host
/// never **creates, opens, reads, writes, or signals** any object under this
/// prefix as part of capture (Req 2.4, 3.3); it is referenced only by
/// [`is_private_namespace`] (the disjointness invariant) and the read-only
/// [`foreign_obs_hook_present`] existence probe (Req 3.4).
pub const OBS_NS: &str = "CaptureHook_";

/// `EVENT_CAPTURE_RESTART` — host→hook "(re)start" (the DLL also sets this when
/// it is ready to be initialized).
pub const EVENT_CAPTURE_RESTART: &str = private_name!("Restart");
/// `EVENT_CAPTURE_STOP` — host→hook "stop capturing / remove interception".
pub const EVENT_CAPTURE_STOP: &str = private_name!("Stop");
/// `EVENT_HOOK_READY` — hook→host "a shared texture is ready" (per init/resize).
pub const EVENT_HOOK_READY: &str = private_name!("HookReady");
/// `EVENT_HOOK_EXIT` — hook→host "the hook is exiting".
pub const EVENT_HOOK_EXIT: &str = private_name!("Exit");
/// `EVENT_HOOK_INIT` — host→hook "begin hooking" (releases the DLL capture loop).
pub const EVENT_HOOK_INIT: &str = private_name!("Initialize");
/// `WINDOW_HOOK_KEEPALIVE` — host-held mutex; the hook self-ejects if it dies.
pub const WINDOW_HOOK_KEEPALIVE: &str = private_name!("KeepAlive");
/// `MUTEX_TEXTURE1` — first shared-texture access mutex.
pub const MUTEX_TEXTURE1: &str = private_name!("TextureMutex1");
/// `MUTEX_TEXTURE2` — second shared-texture access mutex.
pub const MUTEX_TEXTURE2: &str = private_name!("TextureMutex2");
/// `SHMEM_HOOK_INFO` — the 648-byte `hook_info` file mapping base name.
pub const SHMEM_HOOK_INFO: &str = private_name!("HookInfo");
/// `SHMEM_TEXTURE` — the shtex/shmem data mapping base name. The full name is
/// `RalphCaptureHook_Texture_<root-hwnd>_<map_id>` (see [`shtex_mapping_name`]).
pub const SHMEM_TEXTURE: &str = private_name!("Texture");
/// `PIPE_NAME` — the named pipe base name (OBS's `CaptureHook_Pipe`). Carried
/// under the Private_Namespace for completeness of the namespace coverage
/// (Req 2.2); the host's shtex path does not open it, but the fork names it
/// from this same prefix.
pub const PIPE_NAME: &str = private_name!("Pipe");
/// `DUP_GUARD_MUTEX` — the Forked_Hook_DLL's internal duplicate-injection guard
/// (OBS's `graphics_hook_dup_mutex`). Created/owned entirely inside the DLL; it
/// is named here under the Private_Namespace so the namespace coverage is
/// complete and auditable in one place (Req 2.2). Note: unlike the per-target
/// objects this guard is **not** PID-suffixed in OBS, so the host never builds
/// a per-target name from it.
pub const DUP_GUARD_MUTEX: &str = private_name!("graphics_hook_dup_mutex");

/// Whether `name` belongs to the Private_Namespace and therefore cannot collide
/// with any OBS `CaptureHook_*` object name — the disjointness invariant
/// Requirement 2.1 / 3.1 requires.
///
/// True iff `name` begins with [`PRIVATE_NS`] and does **not** begin with the
/// OBS [`OBS_NS`] prefix. Because `PRIVATE_NS` (`"RalphCaptureHook_"`) does not
/// start with `OBS_NS` (`"CaptureHook_"`), every name this module builds
/// satisfies it; the explicit second clause documents and guards the property
/// so a future re-pin to a colliding prefix is caught by the namespace test.
pub fn is_private_namespace(name: &str) -> bool {
    name.starts_with(PRIVATE_NS) && !name.starts_with(OBS_NS)
}

/// `sizeof(struct hook_info)` — pinned by OBS's `static_assert` to **648**.
pub const HOOK_INFO_LEN: usize = 648;

/// `CAPTURE_TYPE_MEMORY` (`enum capture_type`).
pub const CAPTURE_TYPE_MEMORY: u32 = 0;
/// `CAPTURE_TYPE_TEXTURE` (`enum capture_type`) — the shared-texture path.
pub const CAPTURE_TYPE_TEXTURE: u32 = 1;

/// Hook ABI major version the host supports. OBS refuses a DLL whose
/// `hook_ver_major` exceeds the plugin's (`start_capture`). The bundled DLL is
/// the matching 32.1.2 artifact, so this is informational on our side.
pub const HOOK_VER_MAJOR: u32 = 1;

// ── Byte offsets into the 648-byte `hook_info` struct (`#pragma pack(push, 8)`) ──
//
// struct hook_info {                                   offset  size
//   uint32_t hook_ver_major;                              0     4
//   uint32_t hook_ver_minor;                              4     4
//   enum capture_type type;        (int, 4 bytes)         8     4
//   uint32_t window;                                     12     4
//   uint32_t format;                                     16     4
//   uint32_t cx;                                         20     4
//   uint32_t cy;                                         24     4
//   uint32_t UNUSED_base_cx;                             28     4
//   uint32_t UNUSED_base_cy;                             32     4
//   uint32_t pitch;                                      36     4
//   uint32_t map_id;                                     40     4
//   uint32_t map_size;                                   44     4
//   bool flip;                                           48     1   (+3 pad)
//   uint64_t frame_interval;       (8-aligned)           56     8
//   bool UNUSED_use_scale;                               64     1
//   bool force_shmem;                                    65     1
//   bool capture_overlay;                                66     1
//   bool allow_srgb_alias;                               67     1   (+? pad)
//   struct graphics_offsets offsets;                     68    72
//   uint32_t reserved[126];                             140   504
// };  total = 648
//
// graphics_offsets (68..140):
//   d3d8   { present }                                   68     4
//   d3d9   { present, present_ex, present_swap,
//            d3d9_clsoff, is_d3d9ex_clsoff }             72    20
//   dxgi   { present, resize, present1 }                 92    12
//   ddraw  { 8 x uint32_t }                             104    32
//   dxgi2  { release }                                  136     4
//   d3d12  { execute_command_lists }                    140 -> wait, see note
//
// NOTE: graphics_offsets in graphics-hook-info.h is declared in the order
//   d3d8, d3d9, dxgi, ddraw, dxgi2, d3d12  (sizes 4,20,12,32,4,4 = 76).
// So offsets span 68..144 and `reserved[126]` (504 bytes) starts at 144,
// giving 144 + 504 = 648. The per-field absolute offsets below are derived
// from that ordering.
const OFF_HOOK_VER_MAJOR: usize = 0;
const OFF_HOOK_VER_MINOR: usize = 4;
const OFF_TYPE: usize = 8;
const OFF_WINDOW: usize = 12;
const OFF_FORMAT: usize = 16;
const OFF_CX: usize = 20;
const OFF_CY: usize = 24;
const OFF_PITCH: usize = 36;
const OFF_MAP_ID: usize = 40;
const OFF_MAP_SIZE: usize = 44;
const OFF_FLIP: usize = 48;
const OFF_FRAME_INTERVAL: usize = 56;
const OFF_FORCE_SHMEM: usize = 65;
const OFF_ALLOW_SRGB_ALIAS: usize = 67;
/// Start of `struct graphics_offsets` within `hook_info`.
const OFF_OFFSETS: usize = 68;
// graphics_offsets field offsets, relative to OFF_OFFSETS.
const GOFF_D3D8_PRESENT: usize = 0; // d3d8.present
const GOFF_D3D9: usize = 4; // d3d9 (5 x u32)
const GOFF_DXGI_PRESENT: usize = 24; // dxgi.present
const GOFF_DXGI_RESIZE: usize = 28; // dxgi.resize
const GOFF_DXGI_PRESENT1: usize = 32; // dxgi.present1
const GOFF_DDRAW: usize = 36; // ddraw (8 x u32)
const GOFF_DXGI2_RELEASE: usize = 68; // dxgi2.release
const GOFF_D3D12_EXEC: usize = 72; // d3d12.execute_command_lists
                                   // d3d9 sub-fields, relative to OFF_OFFSETS (the d3d9 block starts at GOFF_D3D9).
                                   // Absolute positions: present=72, present_ex=76, present_swap=80,
                                   // d3d9_clsoff=84, is_d3d9ex_clsoff=88.
const GOFF_D3D9_PRESENT: usize = GOFF_D3D9; // 4  -> 72
const GOFF_D3D9_PRESENT_EX: usize = GOFF_D3D9 + 4; // 8  -> 76
const GOFF_D3D9_PRESENT_SWAP: usize = GOFF_D3D9 + 8; // 12 -> 80
const GOFF_D3D9_CLSOFF: usize = GOFF_D3D9 + 12; // 16 -> 84
const GOFF_D3D9_IS_EX_CLSOFF: usize = GOFF_D3D9 + 16; // 20 -> 88

/// Absolute byte offset of the fork's `hook_info.frame_count` field — a present-
/// accurate publish counter the Forked_Hook_DLL increments once per captured
/// present (a real shared-texture copy). It sits immediately after the 76-byte
/// `graphics_offsets` block (`OFF_OFFSETS` 68 + 76 = 144), carved from the first
/// `u32` of OBS's original `reserved[126]` tail (now `reserved[125]`), so the
/// 648-byte `hook_info` ABI is preserved. The host polls this to forward a frame
/// ONLY when it advances, tracking the game's true present rate with no
/// duplicate re-encodes. MUST stay in sync with `graphics-hook-info.h`.
const OFF_FRAME_COUNT: usize = 144;

/// Absolute byte offset of the fork's `hook_info.hooked_api` field — the
/// actually-hooked graphics API the Forked_Hook_DLL records the moment it
/// installs a present interception (DXGI / D3D9 / D3D8 / Vulkan / OpenGL). It
/// sits immediately after `frame_count` (144 + 4 = 148). The host reads it to
/// report the TRUE backend rather than guessing from the target's loaded
/// modules (a Vulkan game also loads d3d11.dll, which made the guess wrong).
/// MUST stay in sync with `graphics-hook-info.h` (`enum ralph_hooked_api`).
const OFF_HOOKED_API: usize = 148;

/// `shtex_data` is a single `uint32_t tex_handle` (4 bytes) — the legacy DXGI
/// shared handle the hook published via `IDXGIResource::GetSharedHandle`.
pub const SHTEX_DATA_LEN: usize = 4;

/// The graphics API the injected fork DLL actually hooked, read from
/// `hook_info.hooked_api`. Mirrors `enum ralph_hooked_api` in
/// `graphics-hook-info.h` (the ABI MUST stay in sync). This is the **truthful**
/// backend — the DLL sets it from which present interception actually installed
/// (`attempt_hook` tries Vulkan → D3D12/DXGI → D3D9 → GL → D3D8 and records the
/// winner) — so the host never has to guess from the target's loaded modules.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HookedApi {
    /// Not yet hooked (the DLL has not installed a present interception).
    None,
    /// D3D10/11/12 — all present through the DXGI swapchain.
    Dxgi,
    /// Direct3D 9.
    D3d9,
    /// Direct3D 8.
    D3d8,
    /// Vulkan (`vkQueuePresentKHR`).
    Vulkan,
    /// OpenGL (`wglSwapBuffers` / `SwapBuffers`).
    OpenGl,
}

impl HookedApi {
    /// Map the raw `hook_info.hooked_api` value to a [`HookedApi`]. Unknown
    /// values (a future/garbled DLL) map to [`HookedApi::None`].
    pub fn from_raw(raw: u32) -> Self {
        match raw {
            1 => HookedApi::Dxgi,
            2 => HookedApi::D3d9,
            3 => HookedApi::D3d8,
            4 => HookedApi::Vulkan,
            5 => HookedApi::OpenGl,
            _ => HookedApi::None,
        }
    }

    /// Whether the DLL has reported an actual installed hook yet.
    pub fn is_hooked(self) -> bool {
        !matches!(self, HookedApi::None)
    }

    /// Stable lowercase label for `Capture_Status`.
    pub fn as_str(self) -> &'static str {
        match self {
            HookedApi::None => "n/a",
            HookedApi::Dxgi => "dxgi",
            HookedApi::D3d9 => "d3d9",
            HookedApi::D3d8 => "d3d8",
            HookedApi::Vulkan => "vulkan",
            HookedApi::OpenGl => "opengl",
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Pure frame metadata + codec (Req 1.7 / Property 8)
// ───────────────────────────────────────────────────────────────────────────

/// The subset of OBS's `hook_info` the host reads after a `HookReady` signal,
/// plus the resolved shared handle from the separate shtex mapping.
///
/// `width`/`height`/`format` are the captured swapchain values the DLL wrote;
/// `shared_handle` is the `shtex_data.tex_handle` (a legacy DXGI shared handle,
/// hence 32-bit, zero-extended into `u64`). `timestamp_qpc` has no field in
/// `hook_info` (OBS times frames host-side); it is retained for the encoder PTS
/// and the round-trip property and is carried in the reserved tail of the codec.
///
/// The round-trip `decode_hook_info(&encode_hook_info(&m)) == Ok(m)` is
/// Property 8 (Req 1.7).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameMetadata {
    /// Captured frame width in pixels (`hook_info.cx`).
    pub width: u32,
    /// Captured frame height in pixels (`hook_info.cy`).
    pub height: u32,
    /// Captured swapchain `DXGI_FORMAT` as `u32` (`hook_info.format`).
    pub format: u32,
    /// Host-assigned presentation timestamp (QPC ticks). Not a `hook_info`
    /// field; the live channel stamps it from `QueryPerformanceCounter` when a
    /// frame is observed. Kept for the encoder PTS and the round-trip property.
    pub timestamp_qpc: i64,
    /// The shared texture handle resolved from the shtex mapping
    /// (`shtex_data.tex_handle`), zero-extended to `u64`. Opened with
    /// `OpenSharedResource` on the `Shared_D3D_Device`.
    pub shared_handle: u64,
}

/// An error decoding the OBS `hook_info` wire bytes or operating the live
/// [`ObsIpcChannel`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IpcError {
    /// The decoded byte slice was not exactly [`HOOK_INFO_LEN`] bytes.
    MalformedHookInfo {
        /// The number of bytes actually supplied.
        got: usize,
        /// The number of bytes the layout requires ([`HOOK_INFO_LEN`]).
        expected: usize,
    },
    /// A Win32 call backing the live [`ObsIpcChannel`] failed.
    Os {
        /// The Win32 call site that failed (e.g. `"OpenFileMappingW"`).
        context: &'static str,
        /// The raw `HRESULT`/Win32 error code.
        code: i32,
    },
}

impl IpcError {
    /// Wrap a `windows` error from the call site `context` as [`IpcError::Os`].
    #[cfg(windows)]
    fn os(context: &'static str, err: windows::core::Error) -> Self {
        IpcError::Os {
            context,
            code: err.code().0,
        }
    }

    /// Build an [`IpcError::Os`] from the current `GetLastError` value.
    #[cfg(windows)]
    fn last_os(context: &'static str) -> Self {
        IpcError::Os {
            context,
            code: windows::core::Error::from_win32().code().0,
        }
    }
}

impl fmt::Display for IpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IpcError::MalformedHookInfo { got, expected } => {
                write!(
                    f,
                    "malformed hook_info: expected {expected} bytes, got {got}"
                )
            }
            IpcError::Os { context, code } => {
                write!(f, "OBS IPC Win32 call {context} failed (code {code:#010x})")
            }
        }
    }
}

impl Error for IpcError {}

/// Read a fixed `[u8; N]` from `bytes` at `offset` (in-bounds by construction
/// after the length check in [`decode_hook_info`]).
fn read_array<const N: usize>(bytes: &[u8], offset: usize) -> [u8; N] {
    bytes[offset..offset + N]
        .try_into()
        .expect("offset + N within HOOK_INFO_LEN after the length check")
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(read_array::<4>(bytes, offset))
}

/// Encode [`FrameMetadata`] into a 648-byte buffer matching OBS's `hook_info`
/// field offsets for the subset the host exchanges, with the QPC timestamp and
/// shtex handle stashed in the `reserved` tail so the round-trip is lossless.
///
/// This is a **writer-of-record** for the reader: it lets the round-trip
/// property (Property 8) pin [`decode_hook_info`] to the real field offsets
/// without requiring a live hook. The live channel does not use this to produce
/// real `hook_info` (the DLL does); it uses [`decode_hook_info`] to read it.
///
/// Validates: Requirements 1.7.
pub fn encode_hook_info(meta: &FrameMetadata) -> Vec<u8> {
    let mut bytes = vec![0u8; HOOK_INFO_LEN];
    bytes[OFF_TYPE..OFF_TYPE + 4].copy_from_slice(&CAPTURE_TYPE_TEXTURE.to_le_bytes());
    bytes[OFF_FORMAT..OFF_FORMAT + 4].copy_from_slice(&meta.format.to_le_bytes());
    bytes[OFF_CX..OFF_CX + 4].copy_from_slice(&meta.width.to_le_bytes());
    bytes[OFF_CY..OFF_CY + 4].copy_from_slice(&meta.height.to_le_bytes());
    // The QPC timestamp and (64-bit) handle have no native hook_info field, so
    // they live in the reserved tail for the round-trip — past the fork's
    // `frame_count` (144) AND `hooked_api` (148) fields so the codec never
    // clobbers either fork-extension slot. Timestamp at 152, handle at 160.
    bytes[152..160].copy_from_slice(&meta.timestamp_qpc.to_le_bytes());
    bytes[160..168].copy_from_slice(&meta.shared_handle.to_le_bytes());
    bytes
}

/// Decode the host-exchanged subset of a 648-byte `hook_info` buffer.
///
/// Returns [`IpcError::MalformedHookInfo`] for any slice that is not exactly
/// [`HOOK_INFO_LEN`] bytes. The inverse of [`encode_hook_info`] for the fields
/// it round-trips (Property 8 / Req 1.7).
///
/// Validates: Requirements 1.7.
pub fn decode_hook_info(bytes: &[u8]) -> Result<FrameMetadata, IpcError> {
    if bytes.len() != HOOK_INFO_LEN {
        return Err(IpcError::MalformedHookInfo {
            got: bytes.len(),
            expected: HOOK_INFO_LEN,
        });
    }
    Ok(FrameMetadata {
        width: read_u32(bytes, OFF_CX),
        height: read_u32(bytes, OFF_CY),
        format: read_u32(bytes, OFF_FORMAT),
        timestamp_qpc: i64::from_le_bytes(read_array::<8>(bytes, 152)),
        shared_handle: u64::from_le_bytes(read_array::<8>(bytes, 160)),
    })
}

// ───────────────────────────────────────────────────────────────────────────
// Pure handle-change detection (OS-independent, unit-testable)
// ───────────────────────────────────────────────────────────────────────────

/// Whether a freshly published `new_handle` differs from the handle the channel
/// last opened (`last_handle`). The first observation (`None`) counts as a
/// change so the initial surface is opened (Req 9.2).
fn handle_state_changed(last_handle: Option<u64>, new_handle: u64) -> bool {
    last_handle != Some(new_handle)
}

/// Build the per-target object name `"<base><pid>"` (OBS's `*_plus_id`).
///
/// `pub` so the namespace-privacy property test (`tests/prop_obs_ipc_names.rs`,
/// Property 1) can exercise the real per-target name constructor rather than a
/// reimplementation that could drift.
pub fn target_object_name(base: &str, target_pid: u32) -> String {
    format!("{base}{target_pid}")
}

/// Build the shtex data mapping name `"CaptureHook_Texture_<root-hwnd>_<map_id>"`.
///
/// In `graphics-hook.c::init_shared_info` the name is
/// `SHMEM_TEXTURE "_%" PRIu64 "_%u"` of `(GetAncestor(window, GA_ROOT), map_id)`.
/// The host (`game-capture.c::init_data_map`) opens the same name using the
/// `hook_info.window` value and `hook_info.map_id`.
///
/// `pub` so the namespace-privacy property test (`tests/prop_obs_ipc_names.rs`,
/// Property 1) can exercise the real shtex name constructor — including the
/// per-target root-window and `map_id` keys — rather than a reimplementation.
pub fn shtex_mapping_name(root_window: u64, map_id: u32) -> String {
    format!("{SHMEM_TEXTURE}_{root_window}_{map_id}")
}

// ───────────────────────────────────────────────────────────────────────────
// Live, OS-bound IPC channel (Windows only) — the full OBS 32.1.2 handshake.
// ───────────────────────────────────────────────────────────────────────────

/// Default per-frame poll bound, in milliseconds, for [`ObsIpcChannel::next_metadata`].
#[cfg(windows)]
pub const DEFAULT_FRAME_WAIT_MS: u32 = 100;

#[cfg(windows)]
use windows::core::HSTRING;
#[cfg(windows)]
use windows::Win32::Foundation::{
    CloseHandle, ERROR_FILE_NOT_FOUND, HANDLE, WAIT_ABANDONED_0, WAIT_OBJECT_0,
};
#[cfg(windows)]
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_ALL_ACCESS, FILE_MAP_READ,
    MEMORY_MAPPED_VIEW_ADDRESS,
};
#[cfg(windows)]
use windows::Win32::System::Performance::QueryPerformanceCounter;
#[cfg(windows)]
use windows::Win32::System::Threading::{
    CreateMutexW, OpenEventW, OpenMutexW, ReleaseMutex, SetEvent, WaitForSingleObject,
    SYNCHRONIZATION_ACCESS_RIGHTS,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GA_ROOT};

/// `SYNCHRONIZE` standard access right (`winnt.h`). Stable Win32 ABI value;
/// defined locally to avoid windows-rs module-path ambiguity across versions.
#[cfg(windows)]
const SYNCHRONIZE: u32 = 0x0010_0000;
/// `EVENT_MODIFY_STATE` access right (`winnt.h`) — required for `SetEvent`.
#[cfg(windows)]
const EVENT_MODIFY_STATE: u32 = 0x0002;

/// Drains the injected graphics-hook DLL's `hlog` diagnostics into `desktop.log`.
///
/// The DLL is an IPC pipe **client** that opens `\\.\pipe\RalphCaptureHook_Pipe<pid>`
/// (`graphics-hook.c::init_pipe`) and writes each `hlog(...)` message as a single
/// message-mode write of a NUL-terminated UTF-8 string
/// (`graphics-hook.c::hlogv`). The host is the pipe **server** and must create
/// the pipe before the DLL connects. Without this, the DLL's own capture-path
/// decisions — `setup_dxgi`'s "Found D3D11/D3D12 device on swap chain", "Hooked
/// D3D12", "no DXGI hook address found", and every init failure — are written
/// into a pipe nobody reads and lost. Surfacing them is the key to diagnosing
/// which backend the DLL actually selected and why a capture stalls.
///
/// A background thread owns the server pipe: it issues an **overlapped**
/// `ConnectNamedPipe` and waits on both that operation's event and a private
/// stop event, so `stop()` can cancel a pending connect/read immediately
/// (a synchronous `ConnectNamedPipe`/`ReadFile` cannot be unblocked by closing
/// the handle, which would deadlock the join on every share-stop). On a client
/// connect it reads `hlog` messages until the client disconnects, then loops to
/// accept a reconnect (the DLL re-opens the pipe on `capture_should_init`). On
/// stop it sets the stop event, cancels any in-flight I/O, and the thread exits
/// so the join returns promptly.
#[cfg(windows)]
struct HookLogPipe {
    /// Manual-reset event the drain thread waits on; `stop()` sets it to cancel
    /// a pending overlapped connect/read and end the thread.
    stop_event: HANDLE,
    handle: HANDLE,
    join: Option<std::thread::JoinHandle<()>>,
}

// SAFETY: the pipe + stop-event HANDLEs are only touched by the reader thread
// and the `stop` path; `stop` sets the stop event (thread-safe SetEvent) before
// joining, then closes both handles after the thread has exited.
#[cfg(windows)]
unsafe impl Send for HookLogPipe {}

#[cfg(windows)]
impl HookLogPipe {
    /// Create the server pipe for `target_pid` and spawn the drain thread.
    /// Returns `None` if the pipe could not be created (non-fatal — capture
    /// works without DLL logs).
    fn start(target_pid: u32) -> Option<Self> {
        use windows::Win32::Storage::FileSystem::{FILE_FLAG_OVERLAPPED, PIPE_ACCESS_INBOUND};
        use windows::Win32::System::Pipes::{
            CreateNamedPipeW, PIPE_READMODE_MESSAGE, PIPE_TYPE_MESSAGE, PIPE_WAIT,
        };
        use windows::Win32::System::Threading::CreateEventW;

        // Match the DLL's name exactly: "\\.\pipe\" + PIPE_NAME + <pid>.
        let pipe_name = format!(r"\\.\pipe\{}{}", PIPE_NAME, target_pid);
        let wide = HSTRING::from(pipe_name.as_str());

        // Inbound, message-mode, OVERLAPPED so connect/read are cancellable.
        // Single instance (one DLL per pid).
        let handle = unsafe {
            CreateNamedPipeW(
                &wide,
                PIPE_ACCESS_INBOUND | FILE_FLAG_OVERLAPPED,
                PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
                1,    // max instances
                4096, // out buffer (unused; inbound)
                4096, // in buffer
                0,    // default timeout
                None, // default security (the DLL connects same-user)
            )
        };
        // CreateNamedPipeW returns INVALID_HANDLE_VALUE on failure.
        if handle.is_invalid() {
            log::warn!(
                "[ObsIpcChannel] could not create hook log pipe for pid {target_pid} \
                 (DLL diagnostics will not be surfaced)"
            );
            return None;
        }

        // Manual-reset, initially-unset stop event used to cancel a pending
        // overlapped connect/read so the thread can exit promptly on stop().
        let stop_event = match unsafe { CreateEventW(None, true, false, None) } {
            Ok(ev) => ev,
            Err(e) => {
                log::warn!(
                    "[ObsIpcChannel] could not create hook log pipe stop event for pid \
                     {target_pid}: {e} (DLL diagnostics will not be surfaced)"
                );
                unsafe {
                    let _ = CloseHandle(handle);
                }
                return None;
            }
        };

        // HANDLE wraps a raw pointer and is not Send, so carry both across the
        // thread boundary as integer values and rebuild them inside the thread.
        let thread_pipe = handle.0 as usize;
        let thread_stop = stop_event.0 as usize;
        let join = match std::thread::Builder::new()
            .name("RalphHookLogPipe".into())
            .spawn(move || hook_log_pipe_thread(thread_pipe, thread_stop, target_pid))
        {
            Ok(j) => j,
            Err(e) => {
                // Could not spawn the drain thread — close what we created and
                // give up (non-fatal: capture works without logs).
                log::warn!(
                    "[ObsIpcChannel] could not spawn hook log pipe thread for pid \
                     {target_pid}: {e} (DLL diagnostics will not be surfaced)"
                );
                unsafe {
                    let _ = CloseHandle(handle);
                    let _ = CloseHandle(stop_event);
                }
                return None;
            }
        };

        log::info!(
            "[ObsIpcChannel] hook log pipe server listening for pid {target_pid} \
             (DLL hlog diagnostics → desktop.log)"
        );
        Some(Self {
            stop_event,
            handle,
            join: Some(join),
        })
    }

    /// Signal the drain thread to stop, unblock its overlapped wait, and join
    /// it, then close both handles. Idempotent via the join `take`.
    fn stop(&mut self) {
        // Signal cancellation; the thread's WaitForMultipleObjects observes the
        // stop event, cancels any pending I/O, and returns.
        unsafe {
            let _ = SetEvent(self.stop_event);
        }
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
        // Thread has exited; safe to release the handles it borrowed.
        unsafe {
            let _ = CloseHandle(self.handle);
            let _ = CloseHandle(self.stop_event);
        }
    }
}

/// Body of the hook-log-pipe drain thread: accept a DLL connection via
/// **overlapped** `ConnectNamedPipe`, read NUL-terminated `hlog` messages and
/// re-log them, and loop to accept reconnects until the stop event is set.
/// Best-effort throughout — any error ends the current connection and retries
/// (or exits if stopping). Uses overlapped I/O so the stop event can cancel a
/// pending connect/read immediately rather than deadlocking the join.
#[cfg(windows)]
fn hook_log_pipe_thread(pipe: usize, stop_event: usize, target_pid: u32) {
    use windows::Win32::Foundation::{
        ERROR_BROKEN_PIPE, ERROR_IO_PENDING, ERROR_PIPE_CONNECTED, WAIT_OBJECT_0,
    };
    use windows::Win32::Storage::FileSystem::ReadFile;
    use windows::Win32::System::Pipes::{ConnectNamedPipe, DisconnectNamedPipe};
    use windows::Win32::System::Threading::{CreateEventW, WaitForMultipleObjects, INFINITE};
    use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

    // Rebuild the HANDLEs from the integer values (HANDLE is not Send). Both are
    // owned by HookLogPipe, which joins this thread before closing them.
    let pipe = HANDLE(pipe as *mut core::ffi::c_void);
    let stop_event = HANDLE(stop_event as *mut core::ffi::c_void);

    // Per-operation event for the overlapped connect/read. Manual-reset so we
    // control when it clears. If it cannot be created, bail (no logs, non-fatal).
    let io_event = match unsafe { CreateEventW(None, true, false, None) } {
        Ok(ev) => ev,
        Err(_) => return,
    };

    // Helper: true if the stop event is already signaled (non-blocking check).
    let stopping = |stop: HANDLE| -> bool {
        unsafe { WaitForMultipleObjects(&[stop], true, 0) == WAIT_OBJECT_0 }
    };

    'accept: loop {
        if stopping(stop_event) {
            break;
        }

        // ── Overlapped ConnectNamedPipe ──────────────────────────────────
        let mut ov = OVERLAPPED::default();
        ov.hEvent = io_event;
        unsafe {
            let _ = windows::Win32::System::Threading::ResetEvent(io_event);
        }
        let connect = unsafe { ConnectNamedPipe(pipe, Some(&mut ov)) };
        let mut connected = true;
        if let Err(e) = connect {
            let code = e.code().0 as u32 & 0xffff;
            if code == ERROR_PIPE_CONNECTED.0 {
                // A client connected between create and connect — already ready.
                connected = true;
            } else if code == ERROR_IO_PENDING.0 {
                // Wait for either a client connect or a stop request.
                let wait =
                    unsafe { WaitForMultipleObjects(&[io_event, stop_event], false, INFINITE) };
                if wait != WAIT_OBJECT_0 {
                    // Stop requested (or wait failed): cancel the pending connect
                    // and exit.
                    unsafe {
                        let _ = CancelIoEx(pipe, Some(&ov));
                    }
                    break 'accept;
                }
                // Connect completed; confirm via GetOverlappedResult.
                let mut transferred: u32 = 0;
                connected =
                    unsafe { GetOverlappedResult(pipe, &ov, &mut transferred, false) }.is_ok();
            } else {
                // Unexpected connect failure — brief pause then retry.
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue 'accept;
            }
        }
        if !connected {
            unsafe {
                let _ = DisconnectNamedPipe(pipe);
            }
            continue 'accept;
        }

        // ── Read messages until the client disconnects or we stop ────────
        let mut buf = [0u8; 1024];
        loop {
            if stopping(stop_event) {
                unsafe {
                    let _ = CancelIoEx(pipe, None);
                    let _ = DisconnectNamedPipe(pipe);
                }
                break 'accept;
            }
            let mut ov_read = OVERLAPPED::default();
            ov_read.hEvent = io_event;
            unsafe {
                let _ = windows::Win32::System::Threading::ResetEvent(io_event);
            }
            let mut read: u32 = 0;
            let rf = unsafe { ReadFile(pipe, Some(&mut buf), Some(&mut read), Some(&mut ov_read)) };
            if let Err(e) = rf {
                let code = e.code().0 as u32 & 0xffff;
                if code == ERROR_IO_PENDING.0 {
                    let wait =
                        unsafe { WaitForMultipleObjects(&[io_event, stop_event], false, INFINITE) };
                    if wait != WAIT_OBJECT_0 {
                        // Stop requested: cancel the pending read and exit.
                        unsafe {
                            let _ = CancelIoEx(pipe, Some(&ov_read));
                            let _ = DisconnectNamedPipe(pipe);
                        }
                        break 'accept;
                    }
                    let ok = unsafe { GetOverlappedResult(pipe, &ov_read, &mut read, false) };
                    if ok.is_err() || read == 0 {
                        break; // client disconnected or error → accept reconnect
                    }
                } else if code == ERROR_BROKEN_PIPE.0 {
                    break; // client disconnected
                } else {
                    break; // unexpected error → accept reconnect
                }
            } else if read == 0 {
                break;
            }
            // The DLL writes a NUL-terminated string; trim trailing NUL/newlines.
            let bytes = &buf[..read as usize];
            let text = String::from_utf8_lossy(bytes);
            let msg = text.trim_end_matches(['\0', '\r', '\n']).trim();
            if !msg.is_empty() {
                log::info!("[graphics-hook pid {target_pid}] {msg}");
            }
        }

        // Client gone — disconnect so we can accept a reconnect.
        unsafe {
            let _ = DisconnectNamedPipe(pipe);
        }
    }

    unsafe {
        let _ = CloseHandle(io_event);
    }
}

/// All-backend graphics-hook offsets parsed by the [`Offset_Resolver`]. Re-exported
/// from [`crate::game_capture::inject`] so callers can populate `hook_info` for
/// every backend OBS 32.1.2 supports (D3D8/D3D9/DXGI/DXGI2/D3D12).
///
/// [`Offset_Resolver`]: crate::game_capture::inject
#[cfg(windows)]
pub use crate::game_capture::inject::AllGraphicsOffsets;

/// The DXGI graphics-hook vtable offsets, parsed from `get-graphics-offsets`.
/// These are written into the `hook_info` so the injected DLL can install its
/// `IDXGISwapChain::Present`/`Present1`/`ResizeBuffers` interception. Without
/// non-zero `dxgi.present` + `dxgi.resize` the DLL never hooks (it logs
/// "no DXGI hook address found").
#[cfg(windows)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DxgiOffsets {
    pub present: u32,
    pub resize: u32,
    pub present1: u32,
    pub release: u32,
}

#[cfg(windows)]
impl DxgiOffsets {
    /// Whether the offsets are sufficient for the DLL to hook DXGI
    /// (`dxgi_hookable`: present && resize).
    pub fn hookable(&self) -> bool {
        self.present != 0 && self.resize != 0
    }

    /// Lift these DXGI-only offsets into a full [`AllGraphicsOffsets`].
    ///
    /// The `present`/`resize`/`present1` fields populate the `dxgi` block and
    /// `release` populates the `dxgi2` block; every other backend stays zero
    /// (the DLL ignores backends whose `present` offset is zero). Used by the
    /// [`start_with_offsets`](ObsIpcChannel::start_with_offsets) compatibility
    /// wrapper.
    pub fn into_all(self) -> AllGraphicsOffsets {
        use crate::game_capture::inject::{Dxgi2Offsets, DxgiOffsets as InjectDxgiOffsets};
        AllGraphicsOffsets {
            dxgi: InjectDxgiOffsets {
                present: self.present,
                resize: self.resize,
                present1: self.present1,
            },
            dxgi2: Dxgi2Offsets {
                release: self.release,
            },
            ..AllGraphicsOffsets::default()
        }
    }
}

/// A live IPC channel to one injected OBS `graphics-hook` (OBS 32.1.2).
///
/// Performs the full host handshake (see the module docs): holds the keepalive
/// mutex, populates the `hook_info` offsets, signals `Initialize`, waits for
/// `HookReady`, then resolves + samples the shared texture handle.
#[cfg(windows)]
pub struct ObsIpcChannel {
    target_pid: u32,
    /// Keepalive mutex — held open for the channel's lifetime so the hook does
    /// not self-eject (`capture_alive`).
    keepalive_mutex: HANDLE,
    /// `hook_info` mapping object + writable view (648 bytes).
    hook_info_map: Option<HANDLE>,
    hook_info_view: MEMORY_MAPPED_VIEW_ADDRESS,
    /// The two texture mutexes (existence proves the DLL finished init).
    texture_mutexes: [HANDLE; 2],
    /// Host→hook / hook→host events.
    restart_event: HANDLE,
    stop_event: HANDLE,
    init_event: HANDLE,
    ready_event: HANDLE,
    exit_event: HANDLE,
    /// The opened shtex data mapping + view (4 bytes, holds `tex_handle`).
    shtex_map: Option<HANDLE>,
    shtex_view: MEMORY_MAPPED_VIEW_ADDRESS,
    /// The graphics offsets written into `hook_info` (from `get-graphics-offsets`),
    /// covering every backend OBS 32.1.2 can hook (D3D8/D3D9/DXGI/DXGI2/D3D12).
    offsets: AllGraphicsOffsets,
    /// Frame interval (ns) written into `hook_info.frame_interval`.
    frame_interval_ns: u64,
    /// Whether `Initialize` has been signaled (the offsets were published).
    initialized: bool,
    /// Whether a `HookReady` was observed and the shtex mapping resolved.
    ready: bool,
    /// The last shtex handle the consumer opened, for resize detection.
    last_handle: Option<u64>,
    /// The `map_id` of the most recently observed `HookReady`. The DLL bumps
    /// `map_id` on every init/resize, so a change here marks a resize /
    /// swapchain-recreate re-signal (Req 8.1, 8.2) — used only to log the
    /// transition; the re-resolve itself is driven by `resolve_shtex`.
    last_map_id: Option<u32>,
    /// The fork's `hook_info.frame_count` value at the last forwarded frame.
    ///
    /// The Forked_Hook_DLL increments `frame_count` once per captured present (a
    /// real shared-texture copy). `next_metadata` forwards a frame ONLY when the
    /// live counter differs from this — so delivery tracks the game's true
    /// present rate with no duplicate re-encodes (present-accurate sampling).
    /// `None` until the first frame is observed; the first non-zero count always
    /// counts as new so the initial frame is delivered.
    last_frame_count: Option<u32>,
    /// Whether the DLL's `frame_count` has been observed to advance at least
    /// once. Until confirmed, the channel cannot tell a fork DLL that publishes
    /// the counter from an older/stock DLL that leaves the field at zero
    /// forever, so it uses a bounded grace window then a paced reuse fallback
    /// (see `next_metadata`). Once `true`, delivery is purely present-accurate.
    counter_live: bool,
    /// When the current shtex surface resolved (set on each `HookReady`
    /// resolve). Used to bound the wait for the present counter to come alive
    /// before falling back to paced reuse delivery for a counter-less DLL.
    ready_since: Option<std::time::Instant>,
    /// Last time the paced reuse fallback emitted a frame (counter-less DLL
    /// path only). Caps that fallback at `frame_interval_ns` so a stale DLL
    /// still delivers at the negotiated rate without duplicate-encoding faster.
    last_legacy_emit: Option<std::time::Instant>,
    /// Poll budget retained from construction for API compatibility
    /// (`start_with_timeout`). No longer used as a per-frame `HookReady` wait —
    /// that wait is now non-blocking (timeout 0), because `HookReady` is a
    /// per-init/resize signal, not a per-frame one; blocking on it here capped
    /// delivery at ~`1000/timeout_ms` fps. Kept so the constructor surface is
    /// unchanged and a future bounded handshake can reuse it.
    #[allow(dead_code)]
    timeout_ms: u32,
    stopped: bool,
    /// Drains the injected DLL's `hlog` diagnostics (sent over the OBS
    /// `RalphCaptureHook_Pipe<pid>` named pipe) into `desktop.log`, so the DLL's
    /// own capture-path decisions ("Found D3D11/D3D12 device on swap chain",
    /// "Hooked D3D12", init failures, etc.) are visible host-side. `None` if the
    /// pipe server could not be created (non-fatal; capture still works).
    log_pipe: Option<HookLogPipe>,
}

// SAFETY: all handles + the view pointers are owned solely by this channel and
// touched only from the single capture thread the session moves it onto.
#[cfg(windows)]
unsafe impl Send for ObsIpcChannel {}

#[cfg(windows)]
impl ObsIpcChannel {
    /// Start the channel against `target_pid` with the default poll bound and a
    /// 60 fps frame interval, **without** real graphics offsets.
    ///
    /// This succeeds as long as the host-side handles can be created, but the
    /// hook cannot actually install its Present interception until real graphics
    /// offsets are supplied — use
    /// [`start_with_all_offsets`](Self::start_with_all_offsets) for live capture.
    /// Retained for tests and for the no-game smoke path.
    pub fn start(target_pid: u32) -> Result<Self, IpcError> {
        Self::start_with_all_offsets(
            target_pid,
            AllGraphicsOffsets::default(),
            default_frame_interval_ns(),
            DEFAULT_FRAME_WAIT_MS,
        )
    }

    /// Start the channel with an explicit poll bound (offsets defaulted).
    pub fn start_with_timeout(target_pid: u32, timeout_ms: u32) -> Result<Self, IpcError> {
        Self::start_with_all_offsets(
            target_pid,
            AllGraphicsOffsets::default(),
            default_frame_interval_ns(),
            timeout_ms,
        )
    }

    /// Start the channel and perform the OBS handshake using DXGI-only offsets.
    ///
    /// Convenience wrapper over [`start_with_all_offsets`](Self::start_with_all_offsets)
    /// for the common DX10/11 path: the [`DxgiOffsets`] are lifted into a full
    /// [`AllGraphicsOffsets`] (populating only the `dxgi`/`dxgi2` blocks) so
    /// existing callers keep working unchanged.
    ///
    /// Validates: Requirements 1.4, 9.3.
    pub fn start_with_offsets(
        target_pid: u32,
        offsets: DxgiOffsets,
        frame_interval_ns: u64,
        timeout_ms: u32,
    ) -> Result<Self, IpcError> {
        Self::start_with_all_offsets(
            target_pid,
            offsets.into_all(),
            frame_interval_ns,
            timeout_ms,
        )
    }

    /// Start the channel and perform the OBS handshake with all-backend offsets.
    ///
    /// `offsets` are the full set of vtable offsets from
    /// `get-graphics-offsets<bits>.exe` (see
    /// `game_capture::inject::load_all_graphics_offsets`), covering D3D8, D3D9,
    /// DXGI, DXGI2, and D3D12; `frame_interval_ns` is written to
    /// `hook_info.frame_interval`. Opens the keepalive mutex, texture mutexes,
    /// `hook_info` mapping, and events; populates `hook_info`; and signals
    /// `Initialize`. Returns [`IpcError::Os`] if a required object cannot be
    /// opened — except the texture mutexes / `hook_info` mapping, which the DLL
    /// may not have created yet (ERROR_FILE_NOT_FOUND ⇒ the channel starts
    /// "uninitialized" and retries on each [`next_metadata`](Self::next_metadata)).
    ///
    /// Validates: Requirements 2.1, 4.2, 4.3, 4.4, 4.5.
    pub fn start_with_all_offsets(
        target_pid: u32,
        offsets: AllGraphicsOffsets,
        frame_interval_ns: u64,
        timeout_ms: u32,
    ) -> Result<Self, IpcError> {
        // The keepalive mutex MUST exist for the hook to capture: the injected
        // DLL gates ALL capture init on `capture_alive()`
        // (graphics-hook.h::capture_should_init → capture_alive), which does
        // `OpenMutexW(CaptureHook_KeepAlive<pid>)` and bails if it is absent. In
        // OBS the HOST creates this mutex (game-capture.c::init_keepalive uses
        // `CreateMutexW`) and the DLL only opens it; if the host merely tried to
        // open it, it would never exist, `capture_alive()` would stay false, the
        // DLL would never run `capture_init_shtex`, and `HookReady` would never
        // fire (the observed `initialize_signaled_no_hookready` zero-frame bug).
        // So we CREATE it here and hold it open for the channel's lifetime; the
        // hook self-ejects (`capture_should_stop`) once we release it on stop.
        let keepalive_mutex = create_keepalive_mutex(target_pid).unwrap_or_default();

        let mut channel = Self {
            target_pid,
            keepalive_mutex,
            hook_info_map: None,
            hook_info_view: MEMORY_MAPPED_VIEW_ADDRESS::default(),
            texture_mutexes: [HANDLE::default(); 2],
            restart_event: HANDLE::default(),
            stop_event: HANDLE::default(),
            init_event: HANDLE::default(),
            ready_event: HANDLE::default(),
            exit_event: HANDLE::default(),
            shtex_map: None,
            shtex_view: MEMORY_MAPPED_VIEW_ADDRESS::default(),
            offsets,
            frame_interval_ns,
            initialized: false,
            ready: false,
            last_handle: None,
            last_map_id: None,
            last_frame_count: None,
            counter_live: false,
            ready_since: None,
            last_legacy_emit: None,
            timeout_ms,
            stopped: false,
            // Start draining the DLL's log pipe immediately. The host is the
            // pipe SERVER and must create it before the DLL (the client) opens
            // it; the DLL opens it lazily on (re)start, so creating it here —
            // before `Initialize` is signaled — wins the race in the common case.
            log_pipe: HookLogPipe::start(target_pid),
        };

        // Best-effort: try to complete init now. If the DLL has not created its
        // objects yet, this is a no-op and next_metadata() retries.
        channel.try_initialize();
        Ok(channel)
    }

    /// Attempt the init handshake: open the DLL-created objects, populate
    /// `hook_info`, and signal `Initialize`. Idempotent; a no-op once
    /// initialized. Silently returns if the DLL's objects are not present yet.
    fn try_initialize(&mut self) {
        if self.initialized || self.stopped {
            return;
        }

        // The texture mutexes are created by the DLL at the very end of its
        // init; their presence is OBS's "hook loaded yet?" probe.
        if self.texture_mutexes[0].is_invalid() {
            match open_mutex(MUTEX_TEXTURE1, self.target_pid) {
                Ok(h) => self.texture_mutexes[0] = h,
                Err(_) => return, // hook not loaded yet
            }
        }
        if self.texture_mutexes[1].is_invalid() {
            match open_mutex(MUTEX_TEXTURE2, self.target_pid) {
                Ok(h) => self.texture_mutexes[1] = h,
                Err(_) => return,
            }
        }

        // Keepalive — CREATE it now if we could not at start (see the rationale
        // in `start_with_all_offsets`). The DLL opens this name; it must exist
        // before the DLL's `capture_alive()` check or it never initializes.
        if self.keepalive_mutex.is_invalid() {
            if let Ok(h) = create_keepalive_mutex(self.target_pid) {
                self.keepalive_mutex = h;
            }
        }

        // Open + map the 648-byte hook_info (read/write so we can publish offsets).
        if self.hook_info_map.is_none() {
            let name = HSTRING::from(target_object_name(SHMEM_HOOK_INFO, self.target_pid));
            let map = match unsafe { OpenFileMappingW(FILE_MAP_ALL_ACCESS.0, false, &name) } {
                Ok(h) => h,
                Err(_) => return,
            };
            let view = unsafe { MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, HOOK_INFO_LEN) };
            if view.Value.is_null() {
                unsafe {
                    let _ = CloseHandle(map);
                }
                return;
            }
            self.hook_info_map = Some(map);
            self.hook_info_view = view;
        }

        // Open the events (created by the DLL's init_signals).
        if self.restart_event.is_invalid() {
            self.restart_event =
                open_event(EVENT_CAPTURE_RESTART, self.target_pid).unwrap_or_default();
        }
        if self.stop_event.is_invalid() {
            self.stop_event = open_event(EVENT_CAPTURE_STOP, self.target_pid).unwrap_or_default();
        }
        if self.ready_event.is_invalid() {
            self.ready_event = open_event(EVENT_HOOK_READY, self.target_pid).unwrap_or_default();
        }
        if self.exit_event.is_invalid() {
            self.exit_event = open_event(EVENT_HOOK_EXIT, self.target_pid).unwrap_or_default();
        }
        if self.init_event.is_invalid() {
            match open_event(EVENT_HOOK_INIT, self.target_pid) {
                Ok(h) => self.init_event = h,
                Err(_) => return, // the Initialize event must exist to proceed
            }
        }

        // Populate hook_info: write the graphics offsets + capture options the
        // DLL needs, mirroring game-capture.c::init_hook_info.
        self.write_hook_info();

        // Release the DLL's capture loop (it waits on Initialize forever).
        if !self.init_event.is_invalid() {
            unsafe {
                let _ = SetEvent(self.init_event);
            }
        }
        // Belt-and-suspenders: also poke Restart, which OBS's host sets when a
        // hook already exists in the process.
        if !self.restart_event.is_invalid() {
            unsafe {
                let _ = SetEvent(self.restart_event);
            }
        }

        self.initialized = true;
        let dxgi = &self.offsets.dxgi;
        let dxgi_hookable = dxgi.hookable();
        log::info!(
            "[ObsIpcChannel] initialized hook for pid {} (dxgi.present={:#x}, resize={:#x}, \
             present1={:#x}, dxgi2.release={:#x}, d3d9.present={:#x}, d3d8.present={:#x}, \
             d3d12.execute_command_lists={:#x}, dxgi_hookable={})",
            self.target_pid,
            dxgi.present,
            dxgi.resize,
            dxgi.present1,
            self.offsets.dxgi2.release,
            self.offsets.d3d9.present,
            self.offsets.d3d8.present,
            self.offsets.d3d12.execute_command_lists,
            dxgi_hookable,
        );
        if !dxgi_hookable {
            log::warn!(
                "[ObsIpcChannel] DXGI offsets are not hookable for pid {} — a DXGI (DX10/11/12) \
                 target's injected hook will NOT install a Present interception and no frames \
                 will arrive. Ensure get-graphics-offsets ran and produced non-zero \
                 dxgi.present/resize (non-DXGI backends may still hook via their own offsets).",
                self.target_pid
            );
        }
    }

    /// Write the `graphics_offsets` + capture options into the mapped
    /// `hook_info` (game-capture.c::init_hook_info). Writes every backend OBS
    /// 32.1.2 carries in `struct graphics_offsets` (D3D8/D3D9/DXGI/DXGI2/D3D12)
    /// at its real byte position; backends whose offsets are zero are ignored by
    /// the DLL, so writing all of them unconditionally is safe.
    ///
    /// Validates: Requirements 2.1, 4.2, 4.3, 4.4, 4.5.
    fn write_hook_info(&mut self) {
        if self.hook_info_view.Value.is_null() {
            return;
        }
        // SAFETY: the view is a writable mapping of exactly HOOK_INFO_LEN bytes.
        let buf = unsafe {
            std::slice::from_raw_parts_mut(self.hook_info_view.Value as *mut u8, HOOK_INFO_LEN)
        };
        let put_u32 = |buf: &mut [u8], off: usize, v: u32| {
            buf[off..off + 4].copy_from_slice(&v.to_le_bytes());
        };
        let o = &self.offsets;
        // d3d8 block (abs 68).
        put_u32(buf, OFF_OFFSETS + GOFF_D3D8_PRESENT, o.d3d8.present);
        // d3d9 block (abs 72..92).
        put_u32(buf, OFF_OFFSETS + GOFF_D3D9_PRESENT, o.d3d9.present);
        put_u32(buf, OFF_OFFSETS + GOFF_D3D9_PRESENT_EX, o.d3d9.present_ex);
        put_u32(
            buf,
            OFF_OFFSETS + GOFF_D3D9_PRESENT_SWAP,
            o.d3d9.present_swap,
        );
        put_u32(buf, OFF_OFFSETS + GOFF_D3D9_CLSOFF, o.d3d9.d3d9_clsoff);
        put_u32(
            buf,
            OFF_OFFSETS + GOFF_D3D9_IS_EX_CLSOFF,
            o.d3d9.is_d3d9ex_clsoff,
        );
        // dxgi block (abs 92..104) — the DLL keys on present + resize.
        put_u32(buf, OFF_OFFSETS + GOFF_DXGI_PRESENT, o.dxgi.present);
        put_u32(buf, OFF_OFFSETS + GOFF_DXGI_RESIZE, o.dxgi.resize);
        put_u32(buf, OFF_OFFSETS + GOFF_DXGI_PRESENT1, o.dxgi.present1);
        // ddraw block (abs 104..136) is unused — leave zero.
        // dxgi2 block (abs 136).
        put_u32(buf, OFF_OFFSETS + GOFF_DXGI2_RELEASE, o.dxgi2.release);
        // d3d12 block (abs 140).
        put_u32(
            buf,
            OFF_OFFSETS + GOFF_D3D12_EXEC,
            o.d3d12.execute_command_lists,
        );
        // frame_interval (u64) + capture options (game-capture.c init_hook_info).
        buf[OFF_FRAME_INTERVAL..OFF_FRAME_INTERVAL + 8]
            .copy_from_slice(&self.frame_interval_ns.to_le_bytes());
        buf[OFF_FORCE_SHMEM] = 0; // shared-texture path
                                  // allow_srgb_alias=0: make the DLL create the shared texture with a
                                  // TYPED UNORM format (e.g. B8G8R8A8_UNORM) instead of the TYPELESS
                                  // alias it uses when this is 1. Our encoder consumes the shared surface
                                  // through a D3D11 VideoProcessor, whose input view CANNOT be created
                                  // over a TYPELESS resource — with the alias on, the host was forced to
                                  // CopyResource the surface into an owned typed texture every frame (the
                                  // "[VP] normalizing hook surface" overhead). A typed UNORM shared
                                  // texture (matching exactly what WGC delivers) lets the VP bind it
                                  // directly with zero per-frame copy. The bytes are identical; treating
                                  // the sRGB-encoded backbuffer as straight UNORM is the same thing WGC
                                  // does and is correct for video (gamma-encoded) output.
        buf[OFF_ALLOW_SRGB_ALIAS] = 0;
        // ddraw block stays zero (untouched).
        // Reference the header-field constants the writer does not populate (the
        // DLL writes them) plus the unused ddraw block, so they do not trip
        // dead-code lints while staying documented at their offsets.
        let _ = (
            OFF_HOOK_VER_MAJOR,
            OFF_HOOK_VER_MINOR,
            OFF_TYPE,
            OFF_WINDOW,
            OFF_PITCH,
            OFF_MAP_SIZE,
            OFF_FLIP,
            GOFF_DDRAW,
            OFF_MAP_ID,
        );
    }

    /// Poll for the next shared-texture frame, present-accurately.
    ///
    /// `HookReady` fires once per init/resize (not per frame), so it cannot pace
    /// delivery. Instead the Forked_Hook_DLL increments `hook_info.frame_count`
    /// once per captured present (a real shared-texture copy), and this method
    /// forwards a frame **only when that counter advances** — so delivery tracks
    /// the game's true present rate with no duplicate re-encodes
    /// (present-accurate sampling, the design's peak-efficiency model):
    ///
    /// - On a `HookReady` (init/resize) it (re)resolves the shtex mapping,
    ///   records the current `frame_count` as the baseline, and returns
    ///   `Ok(None)` — it waits for the first genuinely-new present so it never
    ///   forwards the not-yet-copied (black) initial texture.
    /// - On the steady-state path it returns `Ok(Some(meta))` exactly once per
    ///   `frame_count` advance and `Ok(None)` otherwise. A game presenting below
    ///   the negotiated rate simply yields fewer `Some`s — the encoder holds the
    ///   last frame; nothing is re-encoded.
    ///
    /// Counter-less DLL compatibility: if `frame_count` never advances (an
    /// older/stock `graphics-hook` that does not publish the counter), the
    /// channel waits a short grace window and then falls back to paced reuse
    /// delivery — emitting the live surface at most once per `frame_interval_ns`
    /// — so a not-yet-rebuilt DLL still streams (rate-capped) instead of tripping
    /// the No_Frame_Watchdog. Once the counter is observed to advance even once,
    /// delivery is purely present-accurate for the rest of the session.
    ///
    /// Returns `Ok(None)` until the hook is ready (or after stop).
    ///
    /// Validates: Requirements 1.2, 1.4, 1.7, 8.3, 9.2.
    pub fn next_metadata(&mut self) -> Result<Option<FrameMetadata>, IpcError> {
        if self.stopped {
            return Ok(None);
        }
        if !self.initialized {
            self.try_initialize();
            if !self.initialized {
                return Ok(None);
            }
        }
        if self.target_exited() {
            return Ok(None);
        }

        // Did the hook (re)publish a texture (an init or a resize/recreate)?
        //
        // `HookReady` fires ONCE per init/resize, NOT per frame — the DLL keeps
        // copying each presented backbuffer into the SAME shared texture between
        // readies (graphics-hook.c) and bumps `hook_info.frame_count` on each.
        // So this is a NON-BLOCKING poll (timeout 0): it consumes a pending
        // init/resize signal if present, otherwise falls through to the
        // steady-state counter-watch path below.
        let signaled = if self.ready_event.is_invalid() {
            false
        } else {
            let wait = unsafe { WaitForSingleObject(self.ready_event, 0) };
            wait == WAIT_OBJECT_0
        };

        if signaled {
            // (Re)resolve the shtex mapping for this init/resize.
            if self.resolve_shtex()?.is_some() {
                self.ready = true;
                // Baseline the present counter to the value at resolve time, so
                // the first delivered frame is the first present AFTER resolve
                // (a genuinely copied frame, never the not-yet-written initial
                // texture). Reset the legacy-fallback pacer for the new surface.
                self.last_frame_count = Some(self.read_frame_count());
                self.ready_since = Some(std::time::Instant::now());
                self.last_legacy_emit = None;
            }
            // Never forward on the resolve poll itself — wait for the first
            // counter advance (or the counter-less grace fallback) below.
            return Ok(None);
        }

        // No new ready this round. Steady-state present-accurate delivery: only
        // forward when the DLL's per-present counter advanced.
        if !self.ready {
            return Ok(None);
        }

        let count = self.read_frame_count();
        let advanced = match self.last_frame_count {
            Some(prev) => count != prev,
            None => true,
        };

        if advanced {
            // A genuinely new present was captured — forward exactly this frame.
            let first_advance = !self.counter_live;
            self.last_frame_count = Some(count);
            self.counter_live = true;
            if first_advance {
                log::info!(
                    "[ObsIpcChannel] present-accurate delivery active for pid {} \
                     (hook_info.frame_count advancing; forwarding one frame per captured present)",
                    self.target_pid
                );
            }
            if let Some(meta) = self.current_meta()? {
                return Ok(Some(self.stamp(meta)));
            }
            return Ok(None);
        }

        // Counter did not advance this round.
        if self.counter_live {
            // The DLL is known to publish the counter, so "no advance" means no
            // new present this poll — present-accurate: forward nothing, the
            // encoder holds the last frame (no duplicate re-encode).
            return Ok(None);
        }

        // We have never observed the counter advance. Either the game has not
        // presented since resolve yet (transient — keep waiting through a short
        // grace window) or this is a counter-less (older/stock) DLL. After the
        // grace window, fall back to paced reuse so a counter-less DLL still
        // streams at the negotiated rate rather than tripping the watchdog.
        const COUNTER_GRACE: std::time::Duration = std::time::Duration::from_millis(750);
        let waited = self.ready_since.map(|t| t.elapsed()).unwrap_or_default();
        if waited < COUNTER_GRACE {
            return Ok(None);
        }
        // Legacy paced fallback: emit at most once per frame_interval_ns.
        let interval = std::time::Duration::from_nanos(self.frame_interval_ns.max(1));
        let due = self
            .last_legacy_emit
            .map(|t| t.elapsed() >= interval)
            .unwrap_or(true);
        if !due {
            return Ok(None);
        }
        if let Some(meta) = self.current_meta()? {
            if self.last_legacy_emit.is_none() {
                log::warn!(
                    "[ObsIpcChannel] hook_info.frame_count never advanced within {}ms for pid {} \
                     — DLL does not publish the present counter (older/stock graphics-hook?). \
                     Falling back to paced reuse delivery at frame_interval ({} ns). Rebuild the \
                     fork DLL (build-capture-fork.ps1) for present-accurate capture.",
                    COUNTER_GRACE.as_millis(),
                    self.target_pid,
                    self.frame_interval_ns,
                );
            }
            self.last_legacy_emit = Some(std::time::Instant::now());
            return Ok(Some(self.stamp(meta)));
        }
        Ok(None)
    }

    /// Update the DLL's capture-rate cap (`hook_info.frame_interval`, ns) in the
    /// LIVE mapping, so a mid-session fps change (e.g. 30→60 on a quality
    /// switch) takes effect without re-injection. The DLL gates each shtex copy
    /// on `frame_ready(frame_interval)` (`graphics-hook.h`), so without this the
    /// capture stays at the fps negotiated at injection even after the encoder
    /// is reconfigured to a higher fps — the "encoder says 60 but only 30 frames
    /// arrive" bug. `0` means "no cap" (capture every present). The 8-byte
    /// aligned store is atomic enough for the DLL's wall-clock pacing read.
    pub fn set_frame_interval(&mut self, frame_interval_ns: u64) {
        self.frame_interval_ns = frame_interval_ns;
        if self.hook_info_view.Value.is_null() {
            return;
        }
        // SAFETY: the view maps HOOK_INFO_LEN (648) bytes; OFF_FRAME_INTERVAL
        // (56) + 8 is well within bounds. Mirrors the DLL's u64 read.
        unsafe {
            (self.hook_info_view.Value as *mut u8)
                .add(OFF_FRAME_INTERVAL)
                .cast::<u64>()
                .write_unaligned(frame_interval_ns);
        }
    }

    /// Read the fork's `hook_info.hooked_api` — the graphics API the DLL
    /// actually installed a present hook on. `0` (`RALPH_HOOKED_API_NONE`) until
    /// a hook installs. The host uses this for a truthful backend label instead
    /// of guessing from the target's loaded modules. Same unaligned volatile
    /// cross-process read rationale as [`read_frame_count`].
    #[inline]
    pub fn read_hooked_api(&self) -> HookedApi {
        if self.hook_info_view.Value.is_null() {
            return HookedApi::None;
        }
        // SAFETY: the view maps HOOK_INFO_LEN (648) bytes; OFF_HOOKED_API (148)
        // + 4 is well within bounds.
        let raw = unsafe {
            (self.hook_info_view.Value as *const u8)
                .add(OFF_HOOKED_API)
                .cast::<u32>()
                .read_unaligned()
        };
        HookedApi::from_raw(raw)
    }

    /// Read the fork's per-present `hook_info.frame_count` (a `volatile u32` the
    /// DLL bumps once per captured present). Returns `0` if the mapping is not
    /// up yet. A relaxed unaligned read is sufficient: a 4-byte aligned load is
    /// atomic on x86/x64 and the caller only needs the monotonic "did it
    /// advance?" signal (wrap is harmless — it compares for inequality).
    #[inline]
    fn read_frame_count(&self) -> u32 {
        if self.hook_info_view.Value.is_null() {
            return 0;
        }
        // SAFETY: the view maps HOOK_INFO_LEN (648) bytes; OFF_FRAME_COUNT (144)
        // + 4 is well within bounds. The unaligned volatile-style read mirrors
        // the DLL's volatile store across the process boundary.
        unsafe {
            (self.hook_info_view.Value as *const u8)
                .add(OFF_FRAME_COUNT)
                .cast::<u32>()
                .read_unaligned()
        }
    }

    /// Resolve the shtex mapping from the current `hook_info` and read its
    /// `tex_handle`. Re-opens the mapping when `map_id`/`window` changed.
    fn resolve_shtex(&mut self) -> Result<Option<FrameMetadata>, IpcError> {
        let Some(info) = self.read_hook_info()? else {
            return Ok(None);
        };
        // HookReady observation (Req 6.3): log the cx/cy/format the DLL
        // published in hook_info for this init/resize. `resolve_shtex` runs only
        // on the signaled (HookReady) path of `next_metadata`, so this entry is
        // emitted once per init/resize — never on the per-frame reuse path.
        //
        // The DLL bumps `map_id` on every init/resize, so a changed `map_id`
        // marks a resize / swapchain-recreate re-signal (Req 8.1, 8.2). On such
        // a re-signal `close_shtex` (below) releases the prior shtex mapping
        // before the new one is opened, and `current_meta`/`current_meta_from`
        // return `None` while `shtex_view` is null, so no stale surface is ever
        // forwarded until the newly published texture resolves (Req 8.1).
        let is_resize = matches!(self.last_map_id, Some(prev) if prev != info.map_id);
        self.last_map_id = Some(info.map_id);
        log::info!(
            "[ObsIpcChannel] HookReady for pid {} ({}: cx={}, cy={}, format={}, type={}, map_id={})",
            self.target_pid,
            if is_resize { "resize/recreate" } else { "initial" },
            info.cx,
            info.cy,
            info.format,
            info.shtex_type,
            info.map_id,
        );
        if info.shtex_type != CAPTURE_TYPE_TEXTURE {
            // Shared-memory fallback path is not supported by our zero-copy
            // consumer; report no frame (the session falls back to WGC).
            return Ok(None);
        }
        // Close any prior shtex mapping (a resize publishes a new map_id).
        self.close_shtex();

        // (Re)open the shtex data mapping. The DLL names it from
        // `GetAncestor(OutputWindow, GA_ROOT)` (graphics-hook.c::init_shared_info)
        // but writes the RAW OutputWindow into `hook_info.window`. When the
        // swapchain's output window is itself the root these are identical, but
        // for a child/hosted swapchain they differ — so, exactly like OBS's host
        // (game-capture.c::init_capture_data, which tries the selected window
        // then falls back to `hook_info.window`), we try the GA_ROOT ancestor of
        // `hook_info.window` first and then the raw value (Req 3.1).
        let raw_window = info.window as u64;
        let root_window = root_ancestor_window(info.window);
        let mut candidates: Vec<u64> = Vec::with_capacity(2);
        candidates.push(root_window);
        if raw_window != root_window {
            candidates.push(raw_window);
        }

        let mut opened: Option<(String, HANDLE, MEMORY_MAPPED_VIEW_ADDRESS)> = None;
        let mut last_err_code: i32 = 0;
        for window_val in candidates {
            let mapping_name = shtex_mapping_name(window_val, info.map_id);
            let name = HSTRING::from(mapping_name.as_str());
            let map = match unsafe { OpenFileMappingW(FILE_MAP_READ.0, false, &name) } {
                Ok(h) => h,
                Err(e) => {
                    last_err_code = e.code().0;
                    continue;
                }
            };
            let view = unsafe { MapViewOfFile(map, FILE_MAP_READ, 0, 0, SHTEX_DATA_LEN) };
            if view.Value.is_null() {
                unsafe {
                    let _ = CloseHandle(map);
                }
                last_err_code = windows::core::Error::from_win32().code().0;
                continue;
            }
            opened = Some((mapping_name, map, view));
            break;
        }

        let Some((mapping_name, map, view)) = opened else {
            // shtex mapping resolution failure (Req 6.8). Report the names we
            // tried so the failure is diagnosable from logs alone.
            log::warn!(
                "[ObsIpcChannel] failed to resolve shtex mapping for pid {} \
                 (tried root_window={} raw_window={} map_id={}; last code={:#010x})",
                self.target_pid,
                root_window,
                raw_window,
                info.map_id,
                last_err_code,
            );
            return Ok(None);
        };
        self.shtex_map = Some(map);
        self.shtex_view = view;

        // shtex mapping resolution success (Req 6.4): log the resolved mapping
        // name and the shared handle read from it. Emitted once per
        // (re)resolution on the HookReady path (not per frame). `current_meta_from`
        // returns `None` while the published handle is still zero (transient),
        // so logging only on `Some` reports a genuinely resolved surface.
        let meta = self.current_meta_from(&info)?;
        if let Some(ref m) = meta {
            log::info!(
                "[ObsIpcChannel] resolved shtex mapping \"{}\" for pid {} (shared_handle={:#x})",
                mapping_name,
                self.target_pid,
                m.shared_handle,
            );
        }
        Ok(meta)
    }

    /// Read the current shtex handle (without re-opening) and combine with the
    /// last-known dimensions/format.
    fn current_meta(&mut self) -> Result<Option<FrameMetadata>, IpcError> {
        let Some(info) = self.read_hook_info()? else {
            return Ok(None);
        };
        if self.shtex_view.Value.is_null() {
            return Ok(None);
        }
        self.current_meta_from(&info)
    }

    /// Combine the parsed `hook_info` fields with the current shtex handle.
    fn current_meta_from(&self, info: &HookInfoFields) -> Result<Option<FrameMetadata>, IpcError> {
        if self.shtex_view.Value.is_null() {
            return Ok(None);
        }
        // SAFETY: shtex_view maps exactly SHTEX_DATA_LEN (4) bytes.
        let handle = unsafe { (self.shtex_view.Value as *const u32).read_unaligned() };
        if handle == 0 {
            return Ok(None);
        }
        Ok(Some(FrameMetadata {
            width: info.cx,
            height: info.cy,
            format: info.format,
            timestamp_qpc: 0, // stamped by stamp()
            shared_handle: handle as u64,
        }))
    }

    /// Read the host-relevant fields out of the mapped `hook_info`.
    fn read_hook_info(&self) -> Result<Option<HookInfoFields>, IpcError> {
        if self.hook_info_view.Value.is_null() {
            return Ok(None);
        }
        // SAFETY: a writable mapping of HOOK_INFO_LEN bytes.
        let bytes = unsafe {
            std::slice::from_raw_parts(self.hook_info_view.Value as *const u8, HOOK_INFO_LEN)
        };
        Ok(Some(HookInfoFields {
            shtex_type: read_u32(bytes, OFF_TYPE),
            window: read_u32(bytes, OFF_WINDOW),
            format: read_u32(bytes, OFF_FORMAT),
            cx: read_u32(bytes, OFF_CX),
            cy: read_u32(bytes, OFF_CY),
            map_id: read_u32(bytes, OFF_MAP_ID),
        }))
    }

    /// Stamp `meta` with a fresh QPC timestamp.
    fn stamp(&self, mut meta: FrameMetadata) -> FrameMetadata {
        let mut qpc = 0i64;
        unsafe {
            let _ = QueryPerformanceCounter(&mut qpc);
        }
        meta.timestamp_qpc = qpc;
        meta
    }

    /// Whether the published shtex handle in `meta` differs from the last opened.
    pub fn handle_changed(&self, meta: &FrameMetadata) -> bool {
        handle_state_changed(self.last_handle, meta.shared_handle)
    }

    /// Record that the consumer opened the surface for `meta`.
    pub fn mark_handle_opened(&mut self, meta: &FrameMetadata) {
        self.last_handle = Some(meta.shared_handle);
    }

    /// Whether the target signaled exit, the keepalive is gone, or we stopped.
    pub fn target_exited(&self) -> bool {
        if self.stopped {
            return true;
        }
        if !self.exit_event.is_invalid() {
            let wait = unsafe { WaitForSingleObject(self.exit_event, 0) };
            if wait == WAIT_OBJECT_0 {
                return true;
            }
        }
        false
    }

    /// The target process id this channel is bound to.
    pub fn target_pid(&self) -> u32 {
        self.target_pid
    }

    /// Acquire the OBS 32.1.2 texture-access lock (`CaptureHook_TextureMutex1`)
    /// before a per-frame read of the shared surface, waiting at most
    /// `timeout_ms` milliseconds. Returns `true` only if the lock is held on
    /// return.
    ///
    /// OBS 32.1.2's shtex path does not key the shared texture itself; the host
    /// instead serializes against the DLL via the texture mutexes
    /// (`CaptureHook_TextureMutex1/2<pid>`). The host only needs mutex 1 for the
    /// single-surface read model (`texture_mutexes[0]`).
    ///
    /// Acquisition outcomes:
    /// - `WAIT_OBJECT_0` ⇒ acquired, returns `true`.
    /// - `WAIT_ABANDONED_0` ⇒ a prior owner (the DLL) died while holding the
    ///   mutex, but ownership has still transferred to this thread — the lock
    ///   **is** held, so we return `true` (matching OBS, which treats acquiring
    ///   an abandoned mutex as still owning it) and rely on the caller's
    ///   dimension/handle validation to reject any torn surface. The caller must
    ///   still [`release_texture_lock`](Self::release_texture_lock).
    /// - anything else (`WAIT_TIMEOUT`, `WAIT_FAILED`) ⇒ not held, returns
    ///   `false` so the caller skips the frame rather than reading a torn or
    ///   partially-written surface.
    ///
    /// If the texture mutex handle is invalid (the DLL has not finished init, or
    /// the channel was stopped) there is no lock to acquire and this returns
    /// `false`.
    ///
    /// Validates: Requirements 3.4, 3.7.
    pub fn acquire_texture_lock(&self, timeout_ms: u32) -> bool {
        let mutex = self.texture_mutexes[0];
        if mutex.is_invalid() {
            return false;
        }
        let wait = unsafe { WaitForSingleObject(mutex, timeout_ms) };
        wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED_0
    }

    /// Release the OBS 32.1.2 texture-access lock acquired by
    /// [`acquire_texture_lock`](Self::acquire_texture_lock) after a per-frame
    /// read of the shared surface completes.
    ///
    /// No-op when the texture mutex handle is invalid (nothing was acquired).
    /// The `ReleaseMutex` result is intentionally discarded: a failure here
    /// (e.g. the mutex was not actually owned) is non-fatal to capture and is
    /// handled by the per-frame acquire/skip logic on the next read.
    ///
    /// Validates: Requirements 3.4, 3.7.
    pub fn release_texture_lock(&self) {
        let mutex = self.texture_mutexes[0];
        if mutex.is_invalid() {
            return;
        }
        unsafe {
            let _ = ReleaseMutex(mutex);
        }
    }

    /// Signal stop and release every handle/view. Idempotent; runs from `Drop`.
    pub fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;

        // Stop draining the DLL log pipe (joins its reader thread).
        if let Some(mut lp) = self.log_pipe.take() {
            lp.stop();
        }

        if !self.stop_event.is_invalid() {
            unsafe {
                let _ = SetEvent(self.stop_event);
            }
        }
        self.close_shtex();
        if !self.hook_info_view.Value.is_null() {
            unsafe {
                let _ = UnmapViewOfFile(self.hook_info_view);
            }
            self.hook_info_view = MEMORY_MAPPED_VIEW_ADDRESS::default();
        }
        if let Some(map) = self.hook_info_map.take() {
            close_if_valid(map);
        }
        // Releasing the keepalive mutex (closing the handle) lets the hook
        // self-eject (capture_alive returns false) — exactly OBS's teardown.
        close_if_valid(self.keepalive_mutex);
        self.keepalive_mutex = HANDLE::default();
        for h in [
            self.texture_mutexes[0],
            self.texture_mutexes[1],
            self.restart_event,
            self.stop_event,
            self.init_event,
            self.ready_event,
            self.exit_event,
        ] {
            close_if_valid(h);
        }
        self.texture_mutexes = [HANDLE::default(); 2];
        self.restart_event = HANDLE::default();
        self.stop_event = HANDLE::default();
        self.init_event = HANDLE::default();
        self.ready_event = HANDLE::default();
        self.exit_event = HANDLE::default();

        log::info!(
            "[ObsIpcChannel] stopped and released IPC for pid {}",
            self.target_pid
        );
    }

    fn close_shtex(&mut self) {
        if !self.shtex_view.Value.is_null() {
            unsafe {
                let _ = UnmapViewOfFile(self.shtex_view);
            }
            self.shtex_view = MEMORY_MAPPED_VIEW_ADDRESS::default();
        }
        if let Some(map) = self.shtex_map.take() {
            close_if_valid(map);
        }
    }
}

/// The host-relevant fields parsed out of a mapped `hook_info`.
#[cfg(windows)]
struct HookInfoFields {
    shtex_type: u32,
    window: u32,
    format: u32,
    cx: u32,
    cy: u32,
    map_id: u32,
}

#[cfg(windows)]
impl Drop for ObsIpcChannel {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Default frame interval (ns) for `hook_info.frame_interval` — 60 fps. OBS
/// derives this from the OBS video FPS; we use the session's target encode rate
/// upstream, defaulting to 60.
#[cfg(windows)]
fn default_frame_interval_ns() -> u64 {
    1_000_000_000u64 / 60
}

/// Open an existing per-target named event with modify+sync access. Maps
/// ERROR_FILE_NOT_FOUND (the DLL has not created it yet) to an error the caller
/// treats as "retry later".
#[cfg(windows)]
fn open_event(base: &str, target_pid: u32) -> Result<HANDLE, IpcError> {
    let name = HSTRING::from(target_object_name(base, target_pid));
    unsafe {
        OpenEventW(
            SYNCHRONIZATION_ACCESS_RIGHTS(EVENT_MODIFY_STATE | SYNCHRONIZE),
            false,
            &name,
        )
    }
    .map_err(|_| IpcError::last_os("OpenEventW"))
}

/// Open an existing per-target named mutex with sync access.
#[cfg(windows)]
fn open_mutex(base: &str, target_pid: u32) -> Result<HANDLE, IpcError> {
    let name = HSTRING::from(target_object_name(base, target_pid));
    unsafe { OpenMutexW(SYNCHRONIZATION_ACCESS_RIGHTS(SYNCHRONIZE), false, &name) }.map_err(|e| {
        // Preserve ERROR_FILE_NOT_FOUND so the caller can distinguish "not yet"
        // from a real failure.
        if e.code().0 == windows::core::HRESULT::from(ERROR_FILE_NOT_FOUND).0 {
            IpcError::Os {
                context: "OpenMutexW",
                code: e.code().0,
            }
        } else {
            IpcError::os("OpenMutexW", e)
        }
    })
}

/// Resolve the GA_ROOT ancestor of a window handle value, returned as the
/// `u64` the shtex mapping name uses.
///
/// The injected DLL names the shared-texture mapping from
/// `GetAncestor(OutputWindow, GA_ROOT)` (graphics-hook.c::init_shared_info) but
/// stores the RAW OutputWindow in `hook_info.window`. To reconstruct the DLL's
/// name the host must apply the same `GetAncestor(.., GA_ROOT)`. If the call
/// fails (e.g. the window is already gone) we fall back to the input value so
/// the caller can still attempt the raw-window name.
#[cfg(windows)]
fn root_ancestor_window(window: u32) -> u64 {
    use windows::Win32::Foundation::HWND;
    let hwnd = HWND(window as usize as *mut core::ffi::c_void);
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    if root.0.is_null() {
        window as u64
    } else {
        root.0 as usize as u64
    }
}

/// CREATE (or open-if-existing) the per-target keepalive mutex
/// `CaptureHook_KeepAlive<pid>`.
///
/// This mirrors OBS's host side (`game-capture.c::init_keepalive`, which calls
/// `CreateMutexW(NULL, false, name)`): the **host** owns this object's lifetime
/// and the injected DLL only *opens* it in `capture_alive()`
/// (`graphics-hook.h`). The DLL's `capture_should_init()` refuses to initialize
/// capture — and therefore never signals `HookReady` — while this mutex does not
/// exist, so the host must create it up front and hold it open. `CreateMutexW`
/// with an existing name returns a handle to the existing mutex (with
/// `ERROR_ALREADY_EXISTS` set, which is harmless here), so this is safe even if
/// somehow created elsewhere first. Releasing/closing the handle on
/// [`ObsIpcChannel::stop`] lets the hook self-eject via `capture_should_stop`.
#[cfg(windows)]
fn create_keepalive_mutex(target_pid: u32) -> Result<HANDLE, IpcError> {
    let name = HSTRING::from(target_object_name(WINDOW_HOOK_KEEPALIVE, target_pid));
    // initial_owner=false: we want the mutex to exist as a named kernel object,
    // not to actually take ownership of it (the DLL never waits on it — it only
    // probes existence via OpenMutexW). lpMutexAttributes=None (default DACL).
    unsafe { CreateMutexW(None, false, &name) }.map_err(|e| IpcError::os("CreateMutexW", e))
}

/// Read-only probe for a Foreign_Hook: whether a stock-OBS `CaptureHook_*`
/// object set exists for `pid` (Req 3.4).
///
/// A Foreign_Hook is "a graphics-hook installed by a different host (e.g. stock
/// OBS Studio) that is not our Forked_Hook_DLL." Its detectable signal is the
/// presence of OBS's `CaptureHook_*` objects for the target PID, which are
/// **disjoint** from our Private_Namespace objects ([`is_private_namespace`]),
/// so this never observes our own objects.
///
/// This probe is strictly **read-only**: it `Open`s the OBS-named objects only
/// to test existence and immediately closes them. It never **creates**,
/// **signals**, **reads from**, or **writes to** any `CaptureHook_*` object, so
/// a stock OBS install capturing the same target is never torn down or disturbed
/// (Req 3.3). It probes the DLL-created objects OBS publishes per target — the
/// `HookReady`/`Exit` events, the `HookInfo` mapping, and `TextureMutex1` — and
/// returns `true` as soon as any one opens successfully.
///
/// Windows-only; the host builds the OBS names from [`OBS_NS`] + the OBS suffix
/// + `pid`, exactly the names a stock OBS DLL would create.
///
/// Validates: Requirements 3.3, 3.4.
#[cfg(windows)]
pub fn foreign_obs_hook_present(pid: u32) -> bool {
    /// Build an OBS-namespace per-target object name `"CaptureHook_<suffix><pid>"`.
    fn obs_object_name(suffix: &str, pid: u32) -> String {
        format!("{OBS_NS}{suffix}{pid}")
    }

    // Open an OBS event read-only (SYNCHRONIZE only — no EVENT_MODIFY_STATE, so
    // we cannot and do not signal it). Existence ⇒ a foreign hook is present.
    let obs_event_exists = |suffix: &str| -> bool {
        let name = HSTRING::from(obs_object_name(suffix, pid));
        match unsafe { OpenEventW(SYNCHRONIZATION_ACCESS_RIGHTS(SYNCHRONIZE), false, &name) } {
            Ok(h) => {
                close_if_valid(h);
                true
            }
            Err(_) => false,
        }
    };
    // Open an OBS mutex read-only (SYNCHRONIZE) for existence only.
    let obs_mutex_exists = |suffix: &str| -> bool {
        let name = HSTRING::from(obs_object_name(suffix, pid));
        match unsafe { OpenMutexW(SYNCHRONIZATION_ACCESS_RIGHTS(SYNCHRONIZE), false, &name) } {
            Ok(h) => {
                close_if_valid(h);
                true
            }
            Err(_) => false,
        }
    };
    // Open the OBS hook_info file mapping read-only for existence only.
    let obs_mapping_exists = |suffix: &str| -> bool {
        let name = HSTRING::from(obs_object_name(suffix, pid));
        match unsafe { OpenFileMappingW(FILE_MAP_READ.0, false, &name) } {
            Ok(h) => {
                close_if_valid(h);
                true
            }
            Err(_) => false,
        }
    };

    // The OBS suffixes mirror our private base names with the OBS prefix. We
    // probe the DLL-created objects (events/mapping/mutex) rather than the
    // host-created keepalive so the signal reflects an actual injected OBS hook.
    obs_event_exists("HookReady")
        || obs_event_exists("Exit")
        || obs_event_exists("Restart")
        || obs_mapping_exists("HookInfo")
        || obs_mutex_exists("TextureMutex1")
}

/// Close a handle if it is valid (non-null, non-INVALID).
#[cfg(windows)]
fn close_if_valid(handle: HANDLE) {
    if !handle.is_invalid() {
        unsafe {
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> FrameMetadata {
        FrameMetadata {
            width: 1920,
            height: 1080,
            format: 87, // DXGI_FORMAT_B8G8R8A8_UNORM
            timestamp_qpc: -1_234_567_890_123,
            shared_handle: 0x0000_0000_DEAD_BEEF,
        }
    }

    #[test]
    fn hook_info_len_matches_obs_static_assert() {
        // OBS pins sizeof(struct hook_info) == 648 via static_assert.
        assert_eq!(HOOK_INFO_LEN, 648);
    }

    #[test]
    fn encode_produces_fixed_length() {
        assert_eq!(encode_hook_info(&sample()).len(), HOOK_INFO_LEN);
    }

    #[test]
    fn round_trip_recovers_all_fields() {
        let meta = sample();
        let decoded = decode_hook_info(&encode_hook_info(&meta)).expect("round-trip decodes");
        assert_eq!(decoded, meta);
    }

    #[test]
    fn round_trip_handles_field_extremes() {
        for meta in [
            FrameMetadata {
                width: 0,
                height: 0,
                format: 0,
                timestamp_qpc: 0,
                shared_handle: 0,
            },
            FrameMetadata {
                width: u32::MAX,
                height: u32::MAX,
                format: u32::MAX,
                timestamp_qpc: i64::MAX,
                shared_handle: u64::MAX,
            },
            FrameMetadata {
                width: 1,
                height: u32::MAX,
                format: 0,
                timestamp_qpc: i64::MIN,
                shared_handle: u64::MAX,
            },
        ] {
            let decoded = decode_hook_info(&encode_hook_info(&meta)).expect("round-trip decodes");
            assert_eq!(decoded, meta);
        }
    }

    #[test]
    fn encoded_fields_sit_at_obs_offsets() {
        // The host-exchanged dimension/format fields land at their real
        // hook_info byte offsets (so decode reads the live DLL struct correctly).
        let meta = FrameMetadata {
            width: 0x1111_2222,
            height: 0x3333_4444,
            format: 87,
            timestamp_qpc: 0,
            shared_handle: 0,
        };
        let bytes = encode_hook_info(&meta);
        assert_eq!(read_u32(&bytes, OFF_CX), 0x1111_2222);
        assert_eq!(read_u32(&bytes, OFF_CY), 0x3333_4444);
        assert_eq!(read_u32(&bytes, OFF_FORMAT), 87);
        assert_eq!(read_u32(&bytes, OFF_TYPE), CAPTURE_TYPE_TEXTURE);
    }

    #[test]
    fn decode_rejects_wrong_length() {
        for len in [0usize, HOOK_INFO_LEN - 1, HOOK_INFO_LEN + 1, 28] {
            assert!(matches!(
                decode_hook_info(&vec![0u8; len]),
                Err(IpcError::MalformedHookInfo { .. })
            ));
        }
    }

    #[test]
    fn error_display_is_descriptive() {
        let msg = IpcError::MalformedHookInfo {
            got: 3,
            expected: HOOK_INFO_LEN,
        }
        .to_string();
        assert!(msg.contains("hook_info"));
        assert!(msg.contains("648"));
    }

    #[test]
    fn object_name_appends_pid() {
        assert_eq!(
            target_object_name(SHMEM_HOOK_INFO, 4321),
            "RalphCaptureHook_HookInfo4321"
        );
        assert_eq!(
            target_object_name(EVENT_HOOK_READY, 1),
            "RalphCaptureHook_HookReady1"
        );
        assert_eq!(
            target_object_name(WINDOW_HOOK_KEEPALIVE, 7),
            "RalphCaptureHook_KeepAlive7"
        );
    }

    #[test]
    fn shtex_mapping_name_matches_obs_format() {
        // graphics-hook.c: SHMEM_TEXTURE "_%PRIu64_%u" of (root-hwnd, map_id),
        // now under the Private_Namespace prefix.
        assert_eq!(
            shtex_mapping_name(0x1234, 5),
            "RalphCaptureHook_Texture_4660_5"
        );
    }

    #[test]
    fn private_namespace_prefix_is_fixed_and_disjoint_from_obs() {
        // Req 2.1: the prefix is non-empty, distinct from OBS, and OBS's prefix
        // is not itself a prefix of ours (so no private name can equal an OBS
        // name for the same target).
        assert!(!PRIVATE_NS.is_empty());
        assert_ne!(PRIVATE_NS, OBS_NS);
        assert!(!PRIVATE_NS.starts_with(OBS_NS));
        assert_eq!(PRIVATE_NS, "RalphCaptureHook_");
        assert_eq!(OBS_NS, "CaptureHook_");
    }

    #[test]
    fn every_base_name_is_private_and_not_obs() {
        // Req 2.1, 2.2: each base name (events, keepalive, texture mutexes,
        // hook_info, shtex, pipe, dup-guard) is in the Private_Namespace and is
        // not an OBS name.
        for base in [
            EVENT_CAPTURE_RESTART,
            EVENT_CAPTURE_STOP,
            EVENT_HOOK_READY,
            EVENT_HOOK_EXIT,
            EVENT_HOOK_INIT,
            WINDOW_HOOK_KEEPALIVE,
            MUTEX_TEXTURE1,
            MUTEX_TEXTURE2,
            SHMEM_HOOK_INFO,
            SHMEM_TEXTURE,
            PIPE_NAME,
            DUP_GUARD_MUTEX,
        ] {
            assert!(is_private_namespace(base), "{base} must be private");
            assert!(base.starts_with(PRIVATE_NS), "{base} must carry the prefix");
            assert!(!base.starts_with(OBS_NS), "{base} must not be an OBS name");
        }
    }

    #[test]
    fn per_target_names_stay_private_and_disjoint_from_obs() {
        // Req 2.3, 3.1: the per-target name built from a private base + pid is
        // private, and never equals the OBS name built from the same suffix+pid.
        for (private_base, obs_suffix) in [
            (EVENT_CAPTURE_RESTART, "Restart"),
            (EVENT_HOOK_READY, "HookReady"),
            (WINDOW_HOOK_KEEPALIVE, "KeepAlive"),
            (SHMEM_HOOK_INFO, "HookInfo"),
            (MUTEX_TEXTURE1, "TextureMutex1"),
        ] {
            for pid in [0u32, 1, 4321, u32::MAX] {
                let private = target_object_name(private_base, pid);
                let obs = format!("CaptureHook_{obs_suffix}{pid}");
                assert!(is_private_namespace(&private));
                assert_ne!(private, obs);
            }
        }
    }

    #[test]
    fn is_private_namespace_rejects_obs_and_foreign_names() {
        assert!(is_private_namespace("RalphCaptureHook_HookReady123"));
        assert!(!is_private_namespace("CaptureHook_HookReady123"));
        assert!(!is_private_namespace("SomethingElse"));
        assert!(!is_private_namespace(""));
    }

    #[test]
    fn handle_state_changed_semantics() {
        assert!(handle_state_changed(None, 0));
        assert!(handle_state_changed(None, 0xDEAD));
        assert!(!handle_state_changed(Some(0xABCD), 0xABCD));
        assert!(handle_state_changed(Some(0x1111), 0x2222));
    }

    #[cfg(windows)]
    #[test]
    fn dxgi_offsets_hookable_requires_present_and_resize() {
        assert!(!DxgiOffsets::default().hookable());
        assert!(!DxgiOffsets {
            present: 0x10,
            resize: 0,
            ..Default::default()
        }
        .hookable());
        assert!(DxgiOffsets {
            present: 0x10,
            resize: 0x20,
            ..Default::default()
        }
        .hookable());
    }

    #[cfg(windows)]
    #[test]
    fn live_channel_start_stop_is_idempotent_against_arbitrary_pid() {
        // No DLL is injected into this arbitrary pid, so the texture mutexes /
        // hook_info mapping never appear: the channel starts uninitialized,
        // produces no frame, and stops cleanly (and idempotently).
        let mut channel = ObsIpcChannel::start_with_timeout(0xFFFF_FFF0, 5)
            .expect("channel construction never fails (handles opened lazily)");
        assert_eq!(channel.next_metadata(), Ok(None));
        assert!(!channel.target_exited());
        channel.stop();
        assert!(channel.target_exited());
        channel.stop(); // idempotent
        assert_eq!(channel.next_metadata(), Ok(None));
    }

    #[cfg(windows)]
    #[test]
    fn host_creates_keepalive_mutex_so_dll_capture_alive_succeeds() {
        // Regression test for the zero-frame bug: the injected OBS DLL gates ALL
        // capture init on `capture_alive()` (graphics-hook.h), which does
        // `OpenMutexW(CaptureHook_KeepAlive<pid>)` and bails if it is absent. The
        // HOST must CREATE that mutex (mirroring game-capture.c::init_keepalive),
        // not merely try to open it — otherwise the DLL never runs
        // `capture_init_shtex` and never signals HookReady (the observed
        // `initialize_signaled_no_hookready`, frames_received=0 condition).
        //
        // Use a pid value unlikely to collide with a real CaptureHook_KeepAlive
        // object so the assertion reflects OUR creation, not a pre-existing one.
        use windows::core::HSTRING;
        use windows::Win32::System::Threading::{OpenMutexW, SYNCHRONIZATION_ACCESS_RIGHTS};

        let pid: u32 = 0xFFFF_FE01;
        let name = HSTRING::from(target_object_name(WINDOW_HOOK_KEEPALIVE, pid));

        // Before the channel exists, the keepalive must NOT exist (no creator).
        let pre = unsafe { OpenMutexW(SYNCHRONIZATION_ACCESS_RIGHTS(SYNCHRONIZE), false, &name) };
        assert!(
            pre.is_err(),
            "keepalive mutex unexpectedly already existed before channel start"
        );

        let mut channel = ObsIpcChannel::start_with_timeout(pid, 5)
            .expect("channel construction never fails (handles opened lazily)");

        // While the channel is alive the keepalive mutex must be openable — this
        // is exactly what the DLL's `capture_alive()` does, so its success here
        // means the DLL would proceed to initialize capture.
        let during =
            unsafe { OpenMutexW(SYNCHRONIZATION_ACCESS_RIGHTS(SYNCHRONIZE), false, &name) };
        assert!(
            during.is_ok(),
            "host did not create the keepalive mutex; the DLL's capture_alive() \
             would fail and HookReady would never fire"
        );
        if let Ok(h) = during {
            close_if_valid(h);
        }

        // After stop the host releases the keepalive, letting the hook self-eject
        // (capture_should_stop). The named mutex should no longer be openable.
        channel.stop();
        let post = unsafe { OpenMutexW(SYNCHRONIZATION_ACCESS_RIGHTS(SYNCHRONIZE), false, &name) };
        assert!(
            post.is_err(),
            "keepalive mutex still existed after stop; the hook would not self-eject"
        );
    }

    #[cfg(windows)]
    #[test]
    fn root_ancestor_window_falls_back_for_unknown_window() {
        // A bogus window handle has no GA_ROOT ancestor, so the helper returns
        // the input value (so the caller can still try the raw-window name).
        assert_eq!(root_ancestor_window(0xDEAD_BEEF), 0xDEAD_BEEFu64);
    }

    // ── Req 2.5: the host CREATES (not merely opens) the keepalive mutex under
    //    its Private_Namespace name before the injector loads the DLL. ─────────

    #[cfg(windows)]
    #[test]
    fn create_keepalive_mutex_creates_object_that_open_alone_would_not_find() {
        // Req 2.5: the distinction that matters is CREATE vs OPEN. On a fresh
        // per-target name nothing has created the keepalive yet, so an
        // open-only call (what the DLL's `capture_alive()` does) FAILS. The
        // host's `create_keepalive_mutex` must CREATE the object so that a
        // subsequent open succeeds — proving the host is the creator, mirroring
        // OBS `game-capture.c::init_keepalive` (`CreateMutexW`). A host that
        // "merely opened" would never bring the object into existence and the
        // DLL would never initialize capture.
        let pid: u32 = 0xFFFF_FE02;

        // Open-only on a name nobody has created must fail.
        assert!(
            open_mutex(WINDOW_HOOK_KEEPALIVE, pid).is_err(),
            "keepalive unexpectedly existed before any create; test pid collided"
        );

        // CREATE brings the named kernel object into existence.
        let created = create_keepalive_mutex(pid).expect("create_keepalive_mutex must create it");
        assert!(
            !created.is_invalid(),
            "created keepalive handle must be valid"
        );

        // Now an open-only probe (the DLL's `capture_alive()` semantics) succeeds
        // — only because the HOST created the object, not because it opened one.
        let opened = open_mutex(WINDOW_HOOK_KEEPALIVE, pid);
        assert!(
            opened.is_ok(),
            "after create, the keepalive must be openable (capture_alive would pass)"
        );
        if let Ok(h) = opened {
            close_if_valid(h);
        }

        // Releasing the host's only handle destroys the object again, so a fresh
        // open-only probe fails — confirming the host's create is what kept it alive.
        close_if_valid(created);
        assert!(
            open_mutex(WINDOW_HOOK_KEEPALIVE, pid).is_err(),
            "keepalive should be gone once the host closes its created handle"
        );
    }

    #[cfg(windows)]
    #[test]
    fn keepalive_exists_before_any_dll_created_object_on_channel_start() {
        // Req 2.5: "before the Owned_Injector loads the Forked_Hook_DLL". The
        // injector lives outside this module (native_share/inject), but the
        // host-side guarantee is observable here: constructing the channel does
        // NOT inject anything, yet it must create the keepalive up front. So
        // while the channel is alive the keepalive (host-created) is openable,
        // while every DLL-created required object (texture mutexes, hook_info
        // mapping) is still absent — i.e. the keepalive exists independently of,
        // and ahead of, any injected DLL.
        let pid: u32 = 0xFFFF_FE03;

        let mut channel = ObsIpcChannel::start_with_timeout(pid, 5)
            .expect("channel construction never fails (handles opened lazily)");

        // Host-created keepalive is present...
        assert!(
            open_mutex(WINDOW_HOOK_KEEPALIVE, pid)
                .map(close_if_valid)
                .is_ok(),
            "host must create the keepalive on channel start (before any injection)"
        );
        // ...while DLL-created required objects are absent (nothing was injected).
        assert!(
            open_mutex(MUTEX_TEXTURE1, pid).is_err(),
            "no DLL was injected, so the texture mutex must not exist yet"
        );
        assert!(
            open_mutex(MUTEX_TEXTURE2, pid).is_err(),
            "no DLL was injected, so the second texture mutex must not exist yet"
        );
        assert!(
            open_event(EVENT_HOOK_READY, pid).is_err(),
            "no DLL was injected, so the HookReady event must not exist yet"
        );

        channel.stop();
        // After stop the host releases the keepalive so the hook self-ejects.
        assert!(
            open_mutex(WINDOW_HOOK_KEEPALIVE, pid).is_err(),
            "keepalive must be released on stop so the hook self-ejects"
        );
    }

    // ── Req 2.7: a required-object create/open failure surfaces an error that
    //    names the object/operation, and the reader NEVER substitutes a
    //    CaptureHook_* (OBS) object for a Private_Namespace one. ───────────────
    //
    // NOTE: the orchestration that *consumes* such a failure — marking the hook
    // unavailable for the target and recording the failed IPC object name in
    // Capture_Status — lives in `native_share.rs` and is wired by task 5.3.
    // These tests pin the obs_ipc.rs behavior that exists today: failures are
    // returned (not swallowed) and identify the failing object, and every name
    // the reader can build is in the Private_Namespace.

    #[cfg(windows)]
    #[test]
    fn failed_required_object_open_errors_and_names_the_failing_operation() {
        // Req 2.7: with no DLL injected, the required DLL-created objects do not
        // exist. Opening them must FAIL with an `IpcError::Os` whose `context`
        // names the failing Win32 operation (the object kind), so the caller in
        // native_share.rs (task 5.3) can record the failed object and treat the
        // hook as unavailable rather than silently proceeding.
        let pid: u32 = 0xFFFF_FE04;

        let init_err = open_event(EVENT_HOOK_INIT, pid)
            .expect_err("the Initialize event cannot be opened without an injected DLL");
        match init_err {
            IpcError::Os { context, .. } => assert_eq!(context, "OpenEventW"),
            other => panic!("expected IpcError::Os naming the event open, got {other:?}"),
        }
        assert!(
            init_err.to_string().contains("OpenEventW"),
            "the error must identify the failing object operation"
        );

        let tex_err = open_mutex(MUTEX_TEXTURE1, pid)
            .expect_err("the texture mutex cannot be opened without an injected DLL");
        match tex_err {
            IpcError::Os { context, .. } => assert_eq!(context, "OpenMutexW"),
            other => panic!("expected IpcError::Os naming the mutex open, got {other:?}"),
        }
    }

    #[test]
    fn failed_object_handling_never_substitutes_an_obs_capturehook_object() {
        // Req 2.7: the reader must NEVER create, open, or signal any OBS
        // `CaptureHook_*` object as a substitute when a required object cannot
        // be resolved. The structural guarantee is at the name-construction
        // seam: every required per-target name the reader builds is in the
        // Private_Namespace and is never equal to (nor prefixed by) the OBS name
        // for the same object kind and target PID — so there is no code path
        // that could fall back to a `CaptureHook_*` substitute.
        let required: [(&str, &str); 9] = [
            (WINDOW_HOOK_KEEPALIVE, "KeepAlive"),
            (MUTEX_TEXTURE1, "TextureMutex1"),
            (MUTEX_TEXTURE2, "TextureMutex2"),
            (SHMEM_HOOK_INFO, "HookInfo"),
            (EVENT_HOOK_INIT, "Initialize"),
            (EVENT_HOOK_READY, "HookReady"),
            (EVENT_CAPTURE_RESTART, "Restart"),
            (EVENT_CAPTURE_STOP, "Stop"),
            (EVENT_HOOK_EXIT, "Exit"),
        ];
        for (private_base, obs_suffix) in required {
            for pid in [0u32, 1, 4321, u32::MAX] {
                let name = target_object_name(private_base, pid);
                assert!(
                    is_private_namespace(&name),
                    "{name} must be a Private_Namespace object"
                );
                assert!(
                    !name.starts_with(OBS_NS),
                    "{name} must never be an OBS CaptureHook_* substitute"
                );
                let obs = format!("{OBS_NS}{obs_suffix}{pid}");
                assert_ne!(name, obs, "the reader must not name the OBS object {obs}");
            }
        }

        // The shtex data mapping name is likewise private and never an OBS substitute.
        let shtex = shtex_mapping_name(0x1234, 9);
        assert!(is_private_namespace(&shtex), "{shtex} must be private");
        assert_ne!(
            shtex,
            format!("{OBS_NS}Texture_4660_9"),
            "the shtex mapping must not name the OBS object"
        );
    }
}
