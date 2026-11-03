//! The permanent, dormant Vulkan implicit layer for game capture.
//!
//! # Why a layer
//!
//! DX8/9/10/11/12 and OpenGL presents are intercepted by the injected
//! `graphics-hook` DLL Detours-patching the present function inside the game.
//! A Vulkan present cannot be hooked that way. OBS's `vulkan-capture.c` is an
//! **implicit Vulkan layer** instead: it exports `OBS_Negotiate`, and the Vulkan
//! loader loads the DLL at `vkCreateInstance` of every Vulkan process, if the
//! layer's JSON manifest is registered under
//! `SOFTWARE\Khronos\Vulkan\ImplicitLayers`. The loader reads the registry only
//! at `vkCreateInstance`, so a layer registered after a game started never
//! reaches that game.
//!
//! # How OBS does it, and what this module copies
//!
//! OBS registers its layer **permanently**, not per capture
//! (`plugins/win-capture/game-capture-file-init.c`, `init_hook_files` →
//! `init_vulkan_registry`, called from `obs_module_load`): it copies
//! `graphics-hook{64,32}.dll` and `obs-vulkan{64,32}.json` to
//! `%ProgramData%\obs-studio-hook\` and writes one `REG_DWORD 0` value per
//! manifest under `SOFTWARE\Khronos\Vulkan\ImplicitLayers`, in `HKLM` when OBS
//! runs elevated and `HKCU` otherwise, unless the value already exists. The
//! layer is named `VK_LAYER_OBS_HOOK` (`obs-vulkan64.json`). Nothing unregisters
//! it when capture stops.
//!
//! The loaded DLL is dormant until a host asks for capture. `DllMain` only
//! creates the named objects and a capture thread that blocks
//! (`graphics-hook.c`: `capture_loop` waits `INFINITE` on the Initialize
//! event). Per present, `OBS_QueuePresentKHR` → `vk_capture` does one swapchain
//! lookup and `capture_should_init()`, which makes a single non-blocking
//! `WaitForSingleObject(signal_restart, 0)` while no host is capturing
//! (`graphics-hook.h`). That is the whole idle cost.
//!
//! This module does the same for the OBS-signed DLL we stage under
//! `%LOCALAPPDATA%\Yap\capture-hook\obs-<ver>-<sha8>\` (`signed_hook.rs`):
//!
//! * [`sync`] runs at app start and whenever the "Game capture hook" setting
//!   changes. With the setting on it registers the staged manifests, after the
//!   DLLs verify (SHA-256, Authenticode, signer) against the lock. With it off,
//!   or when no verified set exists, it removes them.
//! * It keeps one registration per bitness, always at the current pinned
//!   version's folder, and deletes entries for older staged folders and for the
//!   old unsigned `obs-capture` layer ([`is_own_registration`]).
//! * The installer removes the registrations on uninstall (`desktop/installer`).
//!
//! # Coexistence with an installed OBS
//!
//! The Vulkan loader drops a later layer with the **same name** as an earlier
//! one (`loader_remove_duplicate_layers` in `loader.c`, before it looks at
//! bitness), but our layer names differ from OBS's, so both would load. Both DLLs
//! use one dup-guard mutex
//! (`graphics_hook_dup_mutex<pid>`), so the second `DllMain` returns FALSE; the
//! loader logs that at INFO and creates the instance without that layer (only
//! an application-requested layer turns it into `VK_ERROR_LAYER_NOT_PRESENT`).
//! That is harmless but wasteful, so [`sync`] skips a bitness whose OBS layer
//! is already usable: registered and enabled, manifest naming
//! `VK_LAYER_OBS_HOOK`, DLL present, signed by the OBS Project, hook major
//! version 1. The hook protocol and the `CaptureHook_` object names are the same
//! for any OBS-signed DLL, so the host drives either copy (`capture.rs`,
//! "attach to a resident hook"). If OBS registers its layer after our last
//! [`sync`], both stay registered until the next one; the dup-guard keeps it to
//! one hook per game.
//!
//! `HKCU\SOFTWARE\Khronos` is shared by both registry views (only `HKLM` is
//! redirected), so one `HKCU` key holds the 64-bit and the 32-bit manifest, as it
//! does for OBS. The loader skips the other bitness's entry with an INFO log.
//! That is why each of our manifests has its own layer name
//! (`signed_hook::LAYER_NAME_PREFIX` + `_64` / `_32`): with one shared name the
//! loader keeps only the first and the other bitness never loads. OBS uses one
//! name for both, so [`obs_serves`] models that too.
//!
//! The unsigned fork DLL (`RALPH_CAPTURE_HOOK_FLAVOR=own`, development only) is
//! never registered as a global layer.

#![cfg(all(feature = "game-capture-hook", windows))]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegEnumValueW, RegOpenKeyExW, RegSetValueExW,
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
    KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SAM_FLAGS,
};

use crate::game_capture::inject::Bitness;
use crate::game_capture::signed_hook;

/// The Khronos implicit-layer registry subkey (per the Vulkan loader spec). The
/// loader enumerates each REG_DWORD value here as a manifest path; a value of
/// `0` enables the layer, non-zero disables it.
const IMPLICIT_LAYERS_SUBKEY: &str = r"SOFTWARE\Khronos\Vulkan\ImplicitLayers";

/// The start of the layer names our manifests declare (`signed_hook.rs`; one
/// name per bitness, see `vulkan_manifest`).
const OWN_LAYER_NAME: &str = signed_hook::LAYER_NAME_PREFIX;
/// OBS's own layer name, from `obs-vulkan{64,32}.json`. Its registrations are
/// never touched; they only decide whether ours is needed.
const OBS_LAYER_NAME: &str = "VK_LAYER_OBS_HOOK";
/// The folder the old unsigned fork's manifests shipped in, next to the binary.
const OWN_ARTIFACT_DIR: &str = "obs-capture";
/// The parent of the staged signed-hook folders (`obs-<ver>-<sha8>`), see
/// `signed_hook.rs`.
const STAGED_PARENT_DIR: &str = "capture-hook";

/// One layer manifest per loader bitness.
struct LayerFiles {
    bitness: Bitness,
    manifest: &'static str,
    dll: &'static str,
}

const LAYERS: [LayerFiles; 2] = [
    LayerFiles {
        bitness: Bitness::X64,
        manifest: "obs-vulkan64.json",
        dll: "graphics-hook64.dll",
    },
    LayerFiles {
        bitness: Bitness::X86,
        manifest: "obs-vulkan32.json",
        dll: "graphics-hook32.dll",
    },
];

// ── Pure planning ───────────────────────────────────────────────────────────

/// Whether a registered manifest path is one this app wrote: an
/// `obs-vulkan{64,32}.json` inside a staged signed-hook folder
/// (`capture-hook\obs-<ver>-<sha8>\`), or inside an `obs-capture` folder (the
/// old unsigned layer: `RalphMeet\app-<ver>\obs-capture\` and dev
/// `target\<profile>\obs-capture\`). OBS's own manifests live in
/// `obs-studio-hook` or OBS's install folder and never match.
///
/// `manifest_text` is the manifest's contents when it still exists. A manifest
/// that exists must also declare [`OWN_LAYER_NAME`], so a third party that
/// happened to use the same folder name is left alone. A missing manifest is
/// judged by its path alone (that is the stale case being cleaned up).
fn is_own_registration(path: &str, manifest_text: Option<&str>) -> bool {
    let path = Path::new(path);
    let file_matches = path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| LAYERS.iter().any(|l| n.eq_ignore_ascii_case(l.manifest)));
    let name_of = |p: Option<&Path>| {
        p.and_then(|d| d.file_name())
            .and_then(|n| n.to_str())
            .map(str::to_ascii_lowercase)
    };
    let parent = path.parent();
    let dir_matches = match (name_of(parent), name_of(parent.and_then(Path::parent))) {
        (Some(dir), _) if dir == OWN_ARTIFACT_DIR => true,
        (Some(dir), Some(grand)) => dir.starts_with("obs-") && grand == STAGED_PARENT_DIR,
        _ => false,
    };
    if !(file_matches && dir_matches) {
        return false;
    }
    match manifest_text {
        Some(text) => text.contains(OWN_LAYER_NAME),
        None => true,
    }
}

/// One value under an `ImplicitLayers` key.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Registered {
    path: String,
    /// `REG_DWORD 0`, the only value the loader treats as enabled.
    enabled: bool,
}

/// What one bitness's layer should be.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LayerWish {
    /// The setting is off, or there is no verified DLL to point at.
    Off,
    /// A usable OBS layer already serves this bitness.
    YieldToObs,
    /// Register our manifest for the staged, verified DLL.
    Ours,
}

fn wish(setting_on: bool, ours_ready: bool, obs_layer_usable: bool) -> LayerWish {
    if !setting_on {
        LayerWish::Off
    } else if obs_layer_usable {
        LayerWish::YieldToObs
    } else if ours_ready {
        LayerWish::Ours
    } else {
        LayerWish::Off
    }
}

/// The registry writes that bring the key to the wanted state.
#[derive(Debug, Default, PartialEq, Eq)]
struct Plan {
    /// Manifest paths to write as `REG_DWORD 0`.
    set: Vec<String>,
    /// Registered manifest paths to delete.
    remove: Vec<String>,
}

/// `wanted` is the full set of manifests that should be registered;
/// `own_registered` is every registered value [`is_own_registration`] accepts.
/// Everything own and unwanted is removed, so older staged versions and the old
/// unsigned layer go. A wanted path that cleanup could not find again later
/// (not [`is_own_registration`]) is never registered.
fn plan(wanted: &[String], own_registered: &[Registered]) -> Plan {
    let same = |a: &str, b: &str| a.eq_ignore_ascii_case(b);
    let wanted: Vec<&String> = wanted
        .iter()
        .filter(|w| is_own_registration(w, None))
        .collect();
    Plan {
        set: wanted
            .iter()
            .filter(|w| {
                !own_registered
                    .iter()
                    .any(|r| r.enabled && same(&r.path, w.as_str()))
            })
            .map(|w| (*w).clone())
            .collect(),
        remove: own_registered
            .iter()
            .filter(|r| !wanted.iter().any(|w| same(&r.path, w.as_str())))
            .map(|r| r.path.clone())
            .collect(),
    }
}

/// A layer found in a manifest file.
#[derive(Debug, PartialEq, Eq)]
struct ManifestLayer {
    name: String,
    library_path: String,
}

/// The layers a manifest declares (`layer` or `layers`, per the loader spec).
fn parse_manifest(text: &str) -> Vec<ManifestLayer> {
    let Ok(root) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let single = root.get("layer").into_iter();
    let many = root
        .get("layers")
        .and_then(|l| l.as_array())
        .into_iter()
        .flatten();
    single
        .chain(many)
        .filter_map(|layer| {
            Some(ManifestLayer {
                name: layer.get("name")?.as_str()?.to_string(),
                library_path: layer.get("library_path")?.as_str()?.to_string(),
            })
        })
        .collect()
}

/// Where the loader finds `library_path`: absolute as written, one with a path
/// separator relative to the manifest's folder. A bare file name goes through
/// the system DLL search, which cannot be verified, so it resolves to `None`.
fn resolve_library(manifest: &Path, library_path: &str) -> Option<PathBuf> {
    let lib = Path::new(library_path);
    if lib.is_absolute() {
        Some(lib.to_path_buf())
    } else if library_path.contains(['\\', '/']) {
        Some(manifest.parent()?.join(lib))
    } else {
        None
    }
}

/// Which loader bitness a hook DLL serves, by the name OBS gives it.
fn library_bitness(library: &Path) -> Option<Bitness> {
    let name = library.file_name()?.to_str()?;
    LAYERS
        .iter()
        .find(|l| name.eq_ignore_ascii_case(l.dll))
        .map(|l| l.bitness)
}

/// What is known about one registered OBS layer.
struct ObsLayerFacts {
    enabled: bool,
    library_exists: bool,
    signed_by_obs: bool,
    hook_major: Option<u16>,
}

/// Whether the OBS layer can stand in for ours: the same protocol (hook major
/// version), the same signer, and a DLL that is there.
fn obs_layer_usable(facts: &ObsLayerFacts, our_hook_major: u16) -> bool {
    facts.enabled
        && facts.library_exists
        && facts.signed_by_obs
        && facts.hook_major == Some(our_hook_major)
}

// ── Windows registry and files ──────────────────────────────────────────────

/// An `ImplicitLayers` key location. Production uses [`KeyLocation::user`];
/// tests point `subkey` at a throwaway key.
#[derive(Clone, Copy)]
struct KeyLocation<'a> {
    root: HKEY,
    subkey: &'a str,
    view: REG_SAM_FLAGS,
}

impl KeyLocation<'static> {
    /// The per-user key. `HKCU\SOFTWARE\Khronos` is shared by both registry
    /// views, so the 64-bit view reaches the entries both loaders read.
    fn user() -> Self {
        Self {
            root: HKEY_CURRENT_USER,
            subkey: IMPLICIT_LAYERS_SUBKEY,
            view: KEY_WOW64_64KEY,
        }
    }
}

impl KeyLocation<'_> {
    /// Open the key; `Ok(None)` when it does not exist and `create` is false.
    fn open(&self, access: REG_SAM_FLAGS, create: bool) -> Result<Option<HKEY>, String> {
        let subkey = HSTRING::from(self.subkey);
        let mut key = HKEY::default();
        // SAFETY: valid root + a well-formed subkey; phkresult is a live local.
        let status = unsafe {
            if create {
                RegCreateKeyExW(
                    self.root,
                    PCWSTR(subkey.as_ptr()),
                    Some(0),
                    PCWSTR::null(),
                    REG_OPTION_NON_VOLATILE,
                    access | self.view,
                    None,
                    &mut key,
                    None,
                )
            } else {
                RegOpenKeyExW(
                    self.root,
                    PCWSTR(subkey.as_ptr()),
                    Some(0),
                    access | self.view,
                    &mut key,
                )
            }
        };
        if status == ERROR_SUCCESS {
            Ok(Some(key))
        } else if status == ERROR_FILE_NOT_FOUND {
            Ok(None)
        } else {
            Err(format!("open ImplicitLayers failed: {}", status.0))
        }
    }

    /// Every value under the key (none when the key does not exist).
    fn read(&self) -> Vec<Registered> {
        match self.open(KEY_QUERY_VALUE, false) {
            Ok(Some(key)) => {
                let values = read_values(key);
                unsafe {
                    let _ = RegCloseKey(key);
                }
                values
            }
            Ok(None) => Vec::new(),
            Err(e) => {
                log::warn!("[VulkanLayer] cannot read ImplicitLayers: {e}");
                Vec::new()
            }
        }
    }
}

/// Every value under `key`, with whether it is a `REG_DWORD 0`.
fn read_values(key: HKEY) -> Vec<Registered> {
    let mut values = Vec::new();
    // Manifest paths are well under 32k UTF-16 units (the registry limit for a
    // value name is 16,383 characters).
    let mut name = vec![0u16; 16_384];
    for index in 0..10_000u32 {
        let mut name_len = name.len() as u32;
        let mut kind = 0u32;
        let mut data = [0u8; 8];
        let mut data_len = data.len() as u32;
        // SAFETY: every pointer describes a live local buffer of that size.
        let status = unsafe {
            RegEnumValueW(
                key,
                index,
                Some(PWSTR(name.as_mut_ptr())),
                &mut name_len,
                None,
                Some(&mut kind),
                Some(data.as_mut_ptr()),
                Some(&mut data_len),
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == ERROR_SUCCESS || status == ERROR_MORE_DATA {
            let enabled = status == ERROR_SUCCESS
                && kind == REG_DWORD.0
                && data_len == 4
                && data[..4] == [0, 0, 0, 0];
            values.push(Registered {
                path: String::from_utf16_lossy(&name[..name_len as usize]),
                enabled,
            });
        }
    }
    values
}

/// Write one manifest path as `REG_DWORD 0` (enabled).
fn set_enabled(key: HKEY, manifest: &str) -> Result<(), String> {
    let value_name = HSTRING::from(manifest);
    let enabled: u32 = 0;
    // SAFETY: `key` is a live handle; the data slice lives for the call.
    let status = unsafe {
        RegSetValueExW(
            key,
            PCWSTR(value_name.as_ptr()),
            Some(0),
            REG_DWORD,
            Some(&enabled.to_ne_bytes()),
        )
    };
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("RegSetValueExW failed: {}", status.0))
    }
}

/// Delete one value. `ERROR_FILE_NOT_FOUND` counts as success.
fn delete_value(key: HKEY, name: &str) -> Result<(), String> {
    let value_name = HSTRING::from(name);
    let status = unsafe { RegDeleteValueW(key, PCWSTR(value_name.as_ptr())) };
    if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(format!("RegDeleteValueW failed: {}", status.0))
    }
}

/// Split registered values into this app's own and everyone else's. A manifest
/// that still exists is read, so a foreign layer that happens to use our folder
/// names is kept (see [`is_own_registration`]).
fn classify(values: Vec<Registered>) -> (Vec<Registered>, Vec<Registered>) {
    values.into_iter().partition(|v| {
        let text = std::fs::read_to_string(&v.path).ok();
        is_own_registration(&v.path, text.as_deref())
    })
}

/// Read-only: the registered manifest paths, split into this app's own and
/// everyone else's (what [`remove_registrations`] would keep).
pub fn list_registrations() -> (Vec<String>, Vec<String>) {
    let (own, others) = classify(KeyLocation::user().read());
    (
        own.into_iter().map(|v| v.path).collect(),
        others.into_iter().map(|v| v.path).collect(),
    )
}

/// Bring the key to the state `wanted` describes (see [`plan`]). Returns the
/// number of values written and removed.
fn apply(location: &KeyLocation, wanted: &[String]) -> (usize, usize) {
    let (own, _) = classify(location.read());
    let plan = plan(wanted, &own);
    if plan.set.is_empty() && plan.remove.is_empty() {
        return (0, 0);
    }
    let key = match location.open(KEY_WRITE | KEY_QUERY_VALUE, !plan.set.is_empty()) {
        Ok(Some(key)) => key,
        Ok(None) => return (0, 0),
        Err(e) => {
            log::warn!("[VulkanLayer] cannot open ImplicitLayers for writing: {e}");
            return (0, 0);
        }
    };
    let (mut written, mut removed) = (0, 0);
    for manifest in &plan.set {
        match set_enabled(key, manifest) {
            Ok(()) => {
                written += 1;
                log::info!("[VulkanLayer] registered implicit layer {manifest}");
            }
            Err(e) => log::warn!("[VulkanLayer] failed to register {manifest}: {e}"),
        }
    }
    for stale in &plan.remove {
        match delete_value(key, stale) {
            Ok(()) => {
                removed += 1;
                log::debug!("[VulkanLayer] removed registration {stale}");
            }
            Err(e) => log::warn!("[VulkanLayer] could not remove registration {stale}: {e}"),
        }
    }
    unsafe {
        let _ = RegCloseKey(key);
    }
    (written, removed)
}

/// Remove every implicit-layer registration this app has written (staged
/// signed-hook folders of every version, and the old unsigned layer's
/// `obs-capture` folders). Registrations by OBS or anyone else are kept.
/// Returns the number of values removed.
pub fn remove_registrations() -> usize {
    let (_, removed) = apply(&KeyLocation::user(), &[]);
    log::info!(
        "[VulkanLayer] removed {removed} implicit-layer registration(s) written by this app"
    );
    removed
}

/// The PE `FileVersion` of a file, from its version resource.
fn file_version(path: &Path) -> Option<[u16; 4]> {
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO,
    };

    let wide = HSTRING::from(path.as_os_str());
    // SAFETY: `wide` is a NUL-terminated path; the buffer is sized by the
    // size query; the fixed-info pointer points into that buffer.
    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut block = vec![0u8; size as usize];
        GetFileVersionInfoW(PCWSTR(wide.as_ptr()), None, size, block.as_mut_ptr().cast()).ok()?;
        let mut info: *mut std::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let root = HSTRING::from("\\");
        let found = VerQueryValueW(
            block.as_ptr().cast(),
            PCWSTR(root.as_ptr()),
            &mut info,
            &mut len,
        );
        if !found.as_bool() || info.is_null() || (len as usize) < size_of::<VS_FIXEDFILEINFO>() {
            return None;
        }
        let info = &*(info as *const VS_FIXEDFILEINFO);
        Some([
            (info.dwFileVersionMS >> 16) as u16,
            info.dwFileVersionMS as u16,
            (info.dwFileVersionLS >> 16) as u16,
            info.dwFileVersionLS as u16,
        ])
    }
}

/// One enabled registration of a manifest that declares `VK_LAYER_OBS_HOOK`,
/// as a loader discovers it.
#[derive(Clone, Copy)]
struct ObsCandidate {
    /// The bitness of the DLL the manifest points at, by its name.
    bitness: Option<Bitness>,
    /// Whether that DLL can stand in for ours (see [`obs_layer_usable`]).
    usable: bool,
}

/// Whether the loader of bitness `loader` ends up running OBS's layer.
/// `candidates` are what that loader discovers, in order: its `HKLM` view, then
/// `HKCU`. The loader keeps only the first layer of a given name
/// (`loader_remove_duplicate_layers`) before it checks bitness, so the first
/// candidate is the only one that can run. OBS registers both of its manifests
/// under the same name, in the shared `HKCU` key when it is not elevated, which
/// leaves a 32-bit loader with the 64-bit manifest and no OBS layer.
fn obs_serves(loader: Bitness, candidates: &[ObsCandidate]) -> bool {
    candidates
        .first()
        .is_some_and(|c| c.usable && c.bitness == Some(loader))
}

/// The `HKLM` registry view a loader of this bitness reads.
fn hklm_view(loader: Bitness) -> REG_SAM_FLAGS {
    match loader {
        Bitness::X64 => KEY_WOW64_64KEY,
        Bitness::X86 => KEY_WOW64_32KEY,
    }
}

/// Which loader bitnesses already run a usable OBS layer, from `HKLM` (where OBS
/// writes when elevated) or `HKCU`.
fn bitnesses_served_by_obs() -> Vec<Bitness> {
    let our_major = signed_hook::lock()
        .hook_ver
        .split('.')
        .next()
        .and_then(|m| m.parse::<u16>().ok())
        .unwrap_or(1);
    let mut served = Vec::new();
    for loader in LAYERS.iter().map(|l| l.bitness) {
        let locations = [
            KeyLocation {
                root: HKEY_LOCAL_MACHINE,
                subkey: IMPLICIT_LAYERS_SUBKEY,
                view: hklm_view(loader),
            },
            KeyLocation::user(),
        ];
        let mut candidates = Vec::new();
        let mut winner = None;
        for registered in locations.iter().flat_map(KeyLocation::read) {
            if !registered.enabled {
                continue;
            }
            let manifest = Path::new(&registered.path);
            let Ok(text) = std::fs::read_to_string(manifest) else {
                continue;
            };
            for layer in parse_manifest(&text) {
                if layer.name != OBS_LAYER_NAME {
                    continue;
                }
                let library = resolve_library(manifest, &layer.library_path);
                let library_exists = library.as_deref().is_some_and(Path::is_file);
                let facts = ObsLayerFacts {
                    enabled: true,
                    library_exists,
                    signed_by_obs: library_exists
                        && library
                            .as_deref()
                            .is_some_and(|l| signed_hook::is_obs_signed_module(l).is_ok()),
                    hook_major: library.as_deref().and_then(file_version).map(|v| v[0]),
                };
                if winner.is_none() {
                    winner = library.clone();
                }
                candidates.push(ObsCandidate {
                    bitness: library.as_deref().and_then(library_bitness),
                    usable: obs_layer_usable(&facts, our_major),
                });
            }
        }
        if obs_serves(loader, &candidates) {
            log::info!(
                "[VulkanLayer] OBS's own layer already serves {} Vulkan games ({}); not \
                 registering ours",
                loader.as_str(),
                winner.map(|l| l.display().to_string()).unwrap_or_default()
            );
            served.push(loader);
        }
    }
    served
}

/// Serializes [`sync`] runs (app start, setting changes).
static SYNC_LOCK: Mutex<()> = Mutex::new(());
/// The newest requested state, so two quick toggles end on the last one.
static HOOK_WANTED: AtomicBool = AtomicBool::new(false);

/// Make the registry match the "Game capture hook" setting. On: stage and
/// verify the pinned OBS-signed set and register its manifests (per bitness,
/// unless OBS's own layer already serves it). Off: remove every registration
/// this app wrote. Either way, entries for older staged versions and the old
/// unsigned layer are removed. Best-effort and idempotent; failures are logged.
pub fn sync(hook_wanted: bool) {
    let _serial = SYNC_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    sync_locked(hook_wanted);
}

fn sync_locked(hook_wanted: bool) {
    let staged = if hook_wanted {
        match signed_hook::ensure_staged() {
            Ok(dir) => Some(dir),
            Err(e) => {
                log::info!("[VulkanLayer] no verified signed hook to register ({e})");
                None
            }
        }
    } else {
        None
    };
    let obs = if staged.is_some() {
        bitnesses_served_by_obs()
    } else {
        Vec::new()
    };

    let mut wanted = Vec::new();
    for layer in &LAYERS {
        let manifest = staged.as_deref().map(|dir| dir.join(layer.manifest));
        let ours_ready = match (&staged, &manifest) {
            (Some(dir), Some(manifest)) => {
                manifest.is_file() && signed_hook::open_verified(dir, &[layer.dll]).is_ok()
            }
            _ => false,
        };
        match wish(hook_wanted, ours_ready, obs.contains(&layer.bitness)) {
            LayerWish::Ours => wanted.extend(manifest.map(|m| m.to_string_lossy().into_owned())),
            LayerWish::YieldToObs => {}
            LayerWish::Off => {
                if staged.is_some() {
                    log::warn!(
                        "[VulkanLayer] {} did not verify; {} Vulkan capture is off",
                        layer.dll,
                        layer.bitness.as_str()
                    );
                }
            }
        }
    }

    let (written, removed) = apply(&KeyLocation::user(), &wanted);
    log::info!(
        "[VulkanLayer] hook {}: {} manifest(s) wanted, {written} written, {removed} stale \
         registration(s) removed",
        if hook_wanted { "on" } else { "off" },
        wanted.len()
    );
}

/// [`sync`] on a background thread (staging and verifying the DLLs reads and
/// hashes about a megabyte, which must not delay startup or a settings save).
pub fn spawn_sync(hook_wanted: bool) {
    HOOK_WANTED.store(hook_wanted, Ordering::SeqCst);
    let spawned = std::thread::Builder::new()
        .name("vulkan-layer-sync".into())
        .spawn(|| {
            let _serial = SYNC_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            sync_locked(HOOK_WANTED.load(Ordering::SeqCst));
        });
    if let Err(e) = spawned {
        log::warn!("[VulkanLayer] could not start the layer sync thread: {e}");
    }
}

/// Whether the target process has a `graphics-hook{64,32}.dll` loaded, which
/// for a Vulkan game means a capture layer attached at `vkCreateInstance`. A
/// Vulkan target without it cannot be hooked, so injecting would only put a
/// DLL in the game for nothing.
pub fn process_has_hook_module(pid: u32) -> bool {
    process_hook_module_path(pid).is_some()
}

/// The full path of the `graphics-hook{64,32}.dll` loaded in `pid`, if any.
pub fn process_hook_module_path(pid: u32) -> Option<PathBuf> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W, TH32CS_SNAPMODULE,
        TH32CS_SNAPMODULE32,
    };

    let Ok(snapshot) =
        (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) })
    else {
        return None;
    };
    let mut found = None;
    let mut entry = MODULEENTRY32W {
        dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
        ..Default::default()
    };
    let mut walk = unsafe { Module32FirstW(snapshot, &mut entry) };
    while walk.is_ok() {
        let len = entry
            .szModule
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(entry.szModule.len());
        let module = String::from_utf16_lossy(&entry.szModule[..len]);
        if module.eq_ignore_ascii_case("graphics-hook64.dll")
            || module.eq_ignore_ascii_case("graphics-hook32.dll")
        {
            let len = entry
                .szExePath
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExePath.len());
            found = Some(PathBuf::from(String::from_utf16_lossy(
                &entry.szExePath[..len],
            )));
            break;
        }
        entry = MODULEENTRY32W {
            dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
            ..Default::default()
        };
        walk = unsafe { Module32NextW(snapshot, &mut entry) };
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    /// OBS 33.0.1 `plugins/win-capture/graphics-hook/obs-vulkan64.json`, as
    /// shipped.
    const OBS_MANIFEST: &str = r#"{
    "file_format_version": "1.1.2",
    "layer": {
        "name": "VK_LAYER_OBS_HOOK",
        "type": "GLOBAL",
        "library_path": ".\\graphics-hook64.dll",
        "api_version": "1.3.216",
        "implementation_version": "1",
        "description": "Open Broadcaster Software hook",
        "functions": {
            "vkNegotiateLoaderLayerInterfaceVersion": "OBS_Negotiate"
        },
        "disable_environment": {
            "DISABLE_VULKAN_OBS_CAPTURE": "1"
        }
    }
}"#;

    const STAGED_V1: &str = r"C:\u\AppData\Local\RalphMeet\capture-hook\obs-33.0.1-c37f4412";
    const STAGED_V2: &str = r"C:\u\AppData\Local\RalphMeet\capture-hook\obs-33.1.0-aabbccdd";

    fn staged(dir: &str, json: &str) -> String {
        format!(r"{dir}\{json}")
    }

    fn reg(path: &str, enabled: bool) -> Registered {
        Registered {
            path: path.to_string(),
            enabled,
        }
    }

    #[test]
    fn implicit_layers_subkey_is_the_khronos_spec_path() {
        // The Vulkan loader reads exactly this subkey; a typo silently disables
        // all Vulkan capture, so pin it.
        assert_eq!(
            IMPLICIT_LAYERS_SUBKEY,
            r"SOFTWARE\Khronos\Vulkan\ImplicitLayers"
        );
    }

    #[test]
    fn manifest_names_match_the_staged_manifests() {
        let names: Vec<_> = LAYERS.iter().map(|l| l.manifest).collect();
        assert_eq!(names, ["obs-vulkan64.json", "obs-vulkan32.json"]);
        // The layer name `is_own_registration` checks is the one the staged
        // manifest declares.
        let bundled = include_str!("../../resources/obs-capture/obs-vulkan64.json");
        assert!(bundled.contains(OWN_LAYER_NAME));
        assert_eq!(OWN_LAYER_NAME, "VK_LAYER_RALPH_MEET_HOOK");
    }

    #[test]
    fn stale_install_and_dev_registrations_are_ours() {
        // Seen on two machines: every past install and dev build folder.
        for path in [
            r"C:\Users\u\AppData\Local\RalphMeet\app-3.3.0\obs-capture\obs-vulkan64.json",
            r"C:\Users\u\AppData\Local\RalphMeet\app-3.7.0\obs-capture\obs-vulkan32.json",
            r"C:\Users\u\AppData\Local\RalphMeet\obs-capture\obs-vulkan64.json",
            r"F:\dev\ralph-meet\desktop\src-tauri\target\debug\obs-capture\obs-vulkan64.json",
            r"F:\dev\ralph-meet\desktop\src-tauri\target\profiling\OBS-CAPTURE\OBS-VULKAN32.JSON",
            r"C:\Users\u\AppData\Local\RalphMeet\capture-hook\obs-33.0.1-c37f4412\obs-vulkan64.json",
            r"F:\Temp\capture-hook\obs-32.1.2-12345678\obs-vulkan32.json",
        ] {
            assert!(is_own_registration(path, None), "{path}");
        }
    }

    #[test]
    fn obs_and_other_layers_are_never_ours() {
        for path in [
            r"C:\ProgramData\obs-studio-hook\obs-vulkan64.json",
            r"C:\Program Files\obs-studio\data\obs-plugins\win-capture\obs-vulkan64.json",
            r"C:\Program Files (x86)\Steam\SteamOverlayVulkanLayer64.json",
            r"C:\x\obs-capture\other-layer.json",
            r"C:\x\capture-hook\obs-vulkan64.json",
            r"C:\x\elsewhere\obs-33.0.1-c37f4412\obs-vulkan64.json",
        ] {
            assert!(!is_own_registration(path, None), "{path}");
        }
    }

    #[test]
    fn an_existing_manifest_must_name_our_layer() {
        let path = r"C:\x\obs-capture\obs-vulkan64.json";
        assert!(is_own_registration(
            path,
            Some(r#"{"layer":{"name":"VK_LAYER_RALPH_MEET_HOOK_64"}}"#)
        ));
        assert!(!is_own_registration(
            path,
            Some(r#"{"layer":{"name":"VK_LAYER_OBS_HOOK"}}"#)
        ));
    }

    // ── wish ────────────────────────────────────────────────────────────────

    #[test]
    fn wish_table() {
        use LayerWish::*;
        // (setting, ours ready, OBS layer usable) → wish
        assert_eq!(wish(false, true, false), Off, "setting off removes ours");
        assert_eq!(wish(false, true, true), Off);
        assert_eq!(wish(true, true, false), Ours);
        assert_eq!(
            wish(true, true, true),
            YieldToObs,
            "a usable OBS layer wins"
        );
        assert_eq!(wish(true, false, true), YieldToObs);
        assert_eq!(wish(true, false, false), Off, "unverified DLL: no layer");
    }

    // ── plan ────────────────────────────────────────────────────────────────

    #[test]
    fn a_fresh_install_registers_both_manifests() {
        let wanted = [
            staged(STAGED_V1, "obs-vulkan64.json"),
            staged(STAGED_V1, "obs-vulkan32.json"),
        ];
        let p = plan(&wanted, &[]);
        assert_eq!(p.set, wanted);
        assert!(p.remove.is_empty());
    }

    #[test]
    fn an_up_to_date_registration_is_left_alone() {
        let wanted = [staged(STAGED_V1, "obs-vulkan64.json")];
        let own = [reg(&wanted[0], true)];
        assert_eq!(plan(&wanted, &own), Plan::default());
    }

    #[test]
    fn a_disabled_registration_is_enabled_again() {
        let wanted = [staged(STAGED_V1, "obs-vulkan64.json")];
        let own = [reg(&wanted[0], false)];
        assert_eq!(plan(&wanted, &own).set, wanted);
    }

    #[test]
    fn an_obs_version_bump_moves_the_registration_and_drops_the_old_one() {
        let old64 = staged(STAGED_V1, "obs-vulkan64.json");
        let old32 = staged(STAGED_V1, "obs-vulkan32.json");
        let new64 = staged(STAGED_V2, "obs-vulkan64.json");
        let new32 = staged(STAGED_V2, "obs-vulkan32.json");
        let p = plan(
            &[new64.clone(), new32.clone()],
            &[reg(&old64, true), reg(&old32, true)],
        );
        assert_eq!(p.set, [new64, new32]);
        assert_eq!(p.remove, [old64, old32]);
    }

    #[test]
    fn the_old_unsigned_layer_is_removed_whatever_is_wanted() {
        let unsigned = r"C:\u\AppData\Local\RalphMeet\app-3.7.0\obs-capture\obs-vulkan64.json";
        let keep = staged(STAGED_V1, "obs-vulkan64.json");
        let p = plan(
            std::slice::from_ref(&keep),
            &[reg(unsigned, true), reg(&keep, true)],
        );
        assert_eq!(p.remove, [unsigned]);
        assert!(p.set.is_empty());
    }

    #[test]
    fn turning_the_setting_off_removes_every_own_registration() {
        let own = [
            reg(&staged(STAGED_V1, "obs-vulkan64.json"), true),
            reg(&staged(STAGED_V1, "obs-vulkan32.json"), true),
        ];
        let p = plan(&[], &own);
        assert!(p.set.is_empty());
        assert_eq!(p.remove.len(), 2);
    }

    #[test]
    fn registry_paths_compare_case_insensitively() {
        let wanted = [staged(STAGED_V1, "obs-vulkan64.json")];
        let own = [reg(&wanted[0].to_ascii_uppercase(), true)];
        assert_eq!(plan(&wanted, &own), Plan::default());
    }

    #[test]
    fn a_path_cleanup_could_not_find_again_is_never_registered() {
        // e.g. a RALPH_CAPTURE_HOOK_DIR override whose parent is not
        // `capture-hook`: it would leak on uninstall.
        let p = plan(
            &[r"D:\anywhere\obs-33.0.1-c37f4412\obs-vulkan64.json".into()],
            &[],
        );
        assert!(p.set.is_empty());
    }

    // ── OBS coexistence ─────────────────────────────────────────────────────

    #[test]
    fn the_obs_manifest_parses_to_its_layer_and_dll() {
        let layers = parse_manifest(OBS_MANIFEST);
        assert_eq!(
            layers,
            [ManifestLayer {
                name: OBS_LAYER_NAME.into(),
                library_path: r".\graphics-hook64.dll".into(),
            }]
        );
        let lib = resolve_library(
            Path::new(r"C:\ProgramData\obs-studio-hook\obs-vulkan64.json"),
            &layers[0].library_path,
        )
        .unwrap();
        assert_eq!(
            lib,
            Path::new(r"C:\ProgramData\obs-studio-hook\.\graphics-hook64.dll")
        );
        assert_eq!(library_bitness(&lib), Some(Bitness::X64));
    }

    #[test]
    fn our_staged_manifest_uses_a_different_layer_name_than_obs() {
        let bundled = include_str!("../../resources/obs-capture/obs-vulkan64.json");
        let ours = parse_manifest(bundled);
        assert!(ours[0].name.starts_with(OWN_LAYER_NAME));
        assert_ne!(ours[0].name, OBS_LAYER_NAME);
    }

    fn candidate(bitness: Option<Bitness>, usable: bool) -> ObsCandidate {
        ObsCandidate { bitness, usable }
    }

    #[test]
    fn an_obs_layer_serves_the_loader_of_its_own_bitness() {
        // Elevated OBS: HKLM has one manifest per view.
        let only64 = [candidate(Some(Bitness::X64), true)];
        assert!(obs_serves(Bitness::X64, &only64));
        assert!(!obs_serves(Bitness::X86, &only64));
        assert!(!obs_serves(Bitness::X64, &[]), "no OBS layer registered");
    }

    #[test]
    fn the_loader_keeps_only_the_first_obs_layer_of_the_shared_name() {
        // Unelevated OBS writes both manifests, same name, to the shared HKCU
        // key. A 32-bit loader sees the 64-bit one first and loses the layer;
        // so we must not yield the 32-bit side to OBS.
        let shared_hkcu = [
            candidate(Some(Bitness::X64), true),
            candidate(Some(Bitness::X86), true),
        ];
        assert!(obs_serves(Bitness::X64, &shared_hkcu));
        assert!(!obs_serves(Bitness::X86, &shared_hkcu));
        // The other order is the mirror image.
        let flipped = [shared_hkcu[1], shared_hkcu[0]];
        assert!(obs_serves(Bitness::X86, &flipped));
        assert!(!obs_serves(Bitness::X64, &flipped));
    }

    #[test]
    fn an_unusable_first_obs_layer_serves_nobody() {
        // The survivor of the dedupe decides, even if a later copy is fine.
        let broken_first = [
            candidate(Some(Bitness::X64), false),
            candidate(Some(Bitness::X64), true),
        ];
        assert!(!obs_serves(Bitness::X64, &broken_first));
        assert!(!obs_serves(Bitness::X64, &[candidate(None, true)]));
    }

    #[test]
    fn manifests_with_a_layers_array_and_garbage_are_handled() {
        let many = r#"{"layers":[{"name":"A","library_path":"a.dll"},{"name":"B","library_path":".\\b.dll"}]}"#;
        let names: Vec<_> = parse_manifest(many).into_iter().map(|l| l.name).collect();
        assert_eq!(names, ["A", "B"]);
        assert!(parse_manifest("not json").is_empty());
        assert!(parse_manifest(r#"{"layer":{"name":"X"}}"#).is_empty());
    }

    #[test]
    fn library_paths_resolve_the_way_the_loader_does() {
        let manifest = Path::new(r"C:\layers\m.json");
        assert_eq!(
            resolve_library(manifest, r"D:\abs\h.dll"),
            Some(PathBuf::from(r"D:\abs\h.dll"))
        );
        assert_eq!(
            resolve_library(manifest, r".\h.dll"),
            Some(PathBuf::from(r"C:\layers\.\h.dll"))
        );
        assert_eq!(resolve_library(manifest, "h.dll"), None, "system search");
    }

    #[test]
    fn library_bitness_follows_obs_dll_names() {
        assert_eq!(
            library_bitness(Path::new(r"C:\x\graphics-hook32.dll")),
            Some(Bitness::X86)
        );
        assert_eq!(
            library_bitness(Path::new(r"C:\x\GRAPHICS-HOOK64.DLL")),
            Some(Bitness::X64)
        );
        assert_eq!(library_bitness(Path::new(r"C:\x\other.dll")), None);
    }

    fn good() -> ObsLayerFacts {
        ObsLayerFacts {
            enabled: true,
            library_exists: true,
            signed_by_obs: true,
            hook_major: Some(1),
        }
    }

    #[test]
    fn a_registered_signed_compatible_obs_layer_is_usable() {
        assert!(obs_layer_usable(&good(), 1));
    }

    #[test]
    fn an_obs_layer_that_cannot_stand_in_is_not_usable() {
        let cases = [
            ObsLayerFacts {
                enabled: false,
                ..good()
            },
            ObsLayerFacts {
                library_exists: false,
                ..good()
            },
            ObsLayerFacts {
                signed_by_obs: false,
                ..good()
            },
            ObsLayerFacts {
                hook_major: Some(2),
                ..good()
            },
            ObsLayerFacts {
                hook_major: None,
                ..good()
            },
        ];
        for facts in cases {
            assert!(!obs_layer_usable(&facts, 1));
        }
    }

    // ── Real registry, throwaway key ────────────────────────────────────────

    /// A unique key under HKCU that the test owns and deletes.
    struct ScratchKey {
        subkey: String,
    }

    impl ScratchKey {
        fn new(tag: &str) -> Self {
            Self {
                subkey: format!(
                    r"Software\RalphMeetTest\vulkan_layer_{tag}_{}\ImplicitLayers",
                    std::process::id()
                ),
            }
        }

        fn location(&self) -> KeyLocation<'_> {
            KeyLocation {
                root: HKEY_CURRENT_USER,
                subkey: &self.subkey,
                view: KEY_WOW64_64KEY,
            }
        }

        fn put(&self, path: &str, data: u32) {
            let key = self
                .location()
                .open(KEY_WRITE | KEY_QUERY_VALUE, true)
                .unwrap()
                .unwrap();
            let name = HSTRING::from(path);
            let status = unsafe {
                RegSetValueExW(
                    key,
                    PCWSTR(name.as_ptr()),
                    Some(0),
                    REG_DWORD,
                    Some(&data.to_ne_bytes()),
                )
            };
            assert_eq!(status, ERROR_SUCCESS);
            unsafe {
                let _ = RegCloseKey(key);
            }
        }

        fn paths(&self) -> Vec<String> {
            let mut p: Vec<_> = self.location().read().into_iter().map(|v| v.path).collect();
            p.sort();
            p
        }
    }

    impl Drop for ScratchKey {
        fn drop(&mut self) {
            use windows::Win32::System::Registry::{RegDeleteKeyW, RegDeleteTreeW};
            // This test's own key, then the shared parent if no other test is
            // using it (RegDeleteKeyW refuses a key that has subkeys).
            let own = self.subkey.rsplit_once('\\').map_or("", |(dir, _)| dir);
            let parent = own.rsplit_once('\\').map_or("", |(dir, _)| dir);
            let (own, parent) = (HSTRING::from(own), HSTRING::from(parent));
            unsafe {
                let _ = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(own.as_ptr()));
                let _ = RegDeleteKeyW(HKEY_CURRENT_USER, PCWSTR(parent.as_ptr()));
            }
        }
    }

    const OBS_FOREIGN: &str = r"C:\ProgramData\obs-studio-hook\obs-vulkan64.json";

    #[test]
    fn apply_registers_then_moves_to_a_new_version_and_keeps_foreign_layers() {
        let scratch = ScratchKey::new("move");
        scratch.put(OBS_FOREIGN, 0);
        let v1 = [
            staged(STAGED_V1, "obs-vulkan64.json"),
            staged(STAGED_V1, "obs-vulkan32.json"),
        ];
        let v2 = [
            staged(STAGED_V2, "obs-vulkan64.json"),
            staged(STAGED_V2, "obs-vulkan32.json"),
        ];

        assert_eq!(apply(&scratch.location(), &v1), (2, 0));
        let mut expected: Vec<_> = v1
            .iter()
            .cloned()
            .chain([OBS_FOREIGN.to_string()])
            .collect();
        expected.sort();
        assert_eq!(scratch.paths(), expected);
        // Idempotent.
        assert_eq!(apply(&scratch.location(), &v1), (0, 0));

        // A version bump swaps the entries; OBS's stays.
        assert_eq!(apply(&scratch.location(), &v2), (2, 2));
        let mut expected: Vec<_> = v2
            .iter()
            .cloned()
            .chain([OBS_FOREIGN.to_string()])
            .collect();
        expected.sort();
        assert_eq!(scratch.paths(), expected);
    }

    #[test]
    fn apply_with_nothing_wanted_removes_ours_and_only_ours() {
        let scratch = ScratchKey::new("off");
        scratch.put(OBS_FOREIGN, 0);
        scratch.put(&staged(STAGED_V1, "obs-vulkan64.json"), 0);
        scratch.put(
            r"C:\u\AppData\Local\RalphMeet\app-3.7.0\obs-capture\obs-vulkan32.json",
            0,
        );

        assert_eq!(apply(&scratch.location(), &[]), (0, 2));
        assert_eq!(scratch.paths(), [OBS_FOREIGN]);
    }

    #[test]
    fn apply_enables_a_registration_someone_disabled() {
        let scratch = ScratchKey::new("disabled");
        let manifest = staged(STAGED_V1, "obs-vulkan64.json");
        scratch.put(&manifest, 1);
        assert!(!scratch.location().read()[0].enabled);

        assert_eq!(
            apply(&scratch.location(), std::slice::from_ref(&manifest)),
            (1, 0)
        );
        let values = scratch.location().read();
        assert_eq!(values.len(), 1);
        assert!(values[0].enabled);
    }

    #[test]
    fn apply_on_a_missing_key_is_a_no_op_when_nothing_is_wanted() {
        let scratch = ScratchKey::new("missing");
        assert_eq!(apply(&scratch.location(), &[]), (0, 0));
        assert!(scratch.paths().is_empty());
    }

    #[test]
    fn file_version_reads_a_system_dll() {
        let kernel32 = Path::new(r"C:\Windows\System32\kernel32.dll");
        let version = file_version(kernel32).expect("kernel32 has a version resource");
        assert!(version[2] > 0, "{version:?}");
        assert_eq!(file_version(Path::new(r"C:\no\such.dll")), None);
    }

    /// Runs against the fetched files when they are present
    /// (`desktop/scripts/fetch-obs-signed-hook.ps1`): the pinned DLL reports a
    /// hook major version equal to the lock's, which is what the coexistence
    /// check compares.
    #[test]
    fn the_pinned_hook_reports_the_locked_major_version() {
        let dll = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(r"resources\obs-capture\obs-signed\graphics-hook64.dll");
        if !dll.is_file() {
            eprintln!("skipped: {} not fetched", dll.display());
            return;
        }
        let version = file_version(&dll).expect("hook has a version resource");
        let locked = &signed_hook::lock().hook_ver;
        assert!(
            locked.starts_with(&format!("{}.", version[0])),
            "{version:?} vs {locked}"
        );
    }
}
