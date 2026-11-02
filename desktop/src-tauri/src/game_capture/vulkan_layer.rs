//! Implicit-Vulkan-layer registration for the hook DLL's Vulkan present
//! interception.
//!
//! # Why this exists
//!
//! Unlike DX8/9/10/11/12 and OpenGL — which the injected `graphics-hook` DLL
//! intercepts by Detours-patching the present function inside the target — a
//! Vulkan present **cannot** be hooked that way. OBS's `vulkan-capture.c`
//! instead ships as an **implicit Vulkan layer**: it exports `OBS_Negotiate`,
//! and the Vulkan loader calls that entry point at `vkCreateInstance` time *only
//! if* the layer's JSON manifest is registered under
//! `HKEY_*\SOFTWARE\Khronos\Vulkan\ImplicitLayers`. Without that registry value
//! the loader never loads our DLL into a Vulkan app, `OBS_Negotiate` is never
//! called, and the Vulkan hook never captures.
//!
//! # Scope + lifetime
//!
//! An implicit layer is loaded into **every** Vulkan process started while it
//! is registered, including anti-cheat-protected games, whether or not
//! anything is being shared. The app used to register at startup and never
//! unregister, so every Vulkan process loaded the hook DLL from the moment the
//! app ran, and every past install or build folder left a registration behind.
//!
//! Registration is now held by a [`LayerLease`] for the duration of a hook
//! share and removed when the last lease drops. At startup,
//! [`remove_registrations`] deletes every registration this app has ever
//! written (the current build's, older `app-<ver>` folders', dev `target\`
//! folders'), which also recovers from a crash that skipped the unregister.
//!
//! The loader only reads the registry at `vkCreateInstance`, so a Vulkan game
//! loads the layer only if it starts while a hook share is active. A Vulkan
//! game that was already running stays on WGC (see
//! [`process_has_hook_module`]).

#![cfg(all(feature = "game-capture-hook", windows))]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegEnumValueW, RegOpenKeyExW, RegSetValueExW,
    HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_WOW64_32KEY, KEY_WOW64_64KEY, KEY_WRITE,
    REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SAM_FLAGS,
};

/// The Khronos implicit-layer registry subkey (per the Vulkan loader spec). The
/// loader enumerates each REG_DWORD value here as a manifest path; a value of
/// `0` enables the layer, non-zero disables it.
const IMPLICIT_LAYERS_SUBKEY: &str = r"SOFTWARE\Khronos\Vulkan\ImplicitLayers";

/// The bundled 64-bit Vulkan layer manifest (ships next to the binary in the
/// `obs-capture/` dir, alongside `graphics-hook64.dll` it references).
const LAYER_JSON_64: &str = "obs-vulkan64.json";
/// The bundled 32-bit Vulkan layer manifest.
const LAYER_JSON_32: &str = "obs-vulkan32.json";
/// The layer name our manifests declare. OBS's own manifests (for example
/// `C:\ProgramData\obs-studio-hook\obs-vulkan64.json`) declare
/// `VK_LAYER_OBS_HOOK` and are never touched.
const OWN_LAYER_NAME: &str = "VK_LAYER_RALPH_MEET_HOOK";
/// The folder our manifests ship in, next to the binary.
const OWN_ARTIFACT_DIR: &str = "obs-capture";

/// Both registry views, each with the manifest its loader bitness reads.
const VIEWS: [(&str, &str, REG_SAM_FLAGS); 2] = [
    (LAYER_JSON_64, "graphics-hook64.dll", KEY_WOW64_64KEY),
    (LAYER_JSON_32, "graphics-hook32.dll", KEY_WOW64_32KEY),
];

/// Resolve the directory that holds the bundled capture artifacts
/// (`obs-capture/` next to the running executable), mirroring how
/// [`crate::game_capture::inject::ObsArtifacts`] discovers the DLLs/helpers.
fn obs_capture_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.join(OWN_ARTIFACT_DIR);
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// The absolute path to a layer manifest if it exists next to the binary.
fn layer_manifest_path(file: &str) -> Option<PathBuf> {
    let path = obs_capture_dir()?.join(file);
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

/// Whether a manifest's `library_path` resolves to a DLL that exists, so we
/// don't register a manifest whose DLL is missing (which would make the Vulkan
/// loader log a load failure in every Vulkan app). The bundled manifests use a
/// relative `".\\graphics-hook<bits>.dll"`, resolved against the manifest dir.
fn manifest_dll_present(manifest: &Path, dll_name: &str) -> bool {
    manifest
        .parent()
        .map(|dir| dir.join(dll_name).is_file())
        .unwrap_or(false)
}

/// Whether a registered manifest path is one this app wrote: an
/// `obs-vulkan{64,32}.json` inside an `obs-capture` folder. That is the layout
/// of every install (`RalphMeet\app-<ver>\obs-capture\`) and every dev build
/// (`target\<profile>\obs-capture\`). OBS's own manifests live in
/// `obs-studio-hook` or OBS's install folder and never match.
///
/// `manifest_text` is the manifest's contents when it still exists. A manifest
/// that exists must also declare [`OWN_LAYER_NAME`], so a third party that
/// happened to use the same folder name is left alone. A missing manifest is
/// judged by its path alone (that is the stale case being cleaned up).
fn is_own_registration(path: &str, manifest_text: Option<&str>) -> bool {
    let path = Path::new(path);
    let file_matches = path.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
        n.eq_ignore_ascii_case(LAYER_JSON_64) || n.eq_ignore_ascii_case(LAYER_JSON_32)
    });
    let dir_matches = path
        .parent()
        .and_then(|d| d.file_name())
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case(OWN_ARTIFACT_DIR));
    if !(file_matches && dir_matches) {
        return false;
    }
    match manifest_text {
        Some(text) => text.contains(OWN_LAYER_NAME),
        None => true,
    }
}

/// Open the per-user `ImplicitLayers` key for one bitness view.
fn open_implicit_layers_key(view: REG_SAM_FLAGS, create: bool) -> Result<Option<HKEY>, String> {
    let subkey = HSTRING::from(IMPLICIT_LAYERS_SUBKEY);
    let mut key = HKEY::default();
    // SAFETY: valid HKCU root + a well-formed subkey; phkresult is a live local.
    let status = unsafe {
        if create {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                Some(0),
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE | KEY_QUERY_VALUE | view,
                None,
                &mut key,
                None,
            )
        } else {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                Some(0),
                KEY_WRITE | KEY_QUERY_VALUE | view,
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

/// Register one manifest path under the given registry view, value data `0`
/// (enabled). Idempotent: rewriting the same value is a no-op for the loader.
fn register_one(manifest: &Path, view: REG_SAM_FLAGS) -> Result<(), String> {
    let key = open_implicit_layers_key(view, true)?.ok_or("ImplicitLayers key missing")?;
    let value_name = HSTRING::from(manifest.as_os_str());
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
    unsafe {
        let _ = RegCloseKey(key);
    }
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("RegSetValueExW failed: {}", status.0))
    }
}

/// Every value name under `key`.
fn value_names(key: HKEY) -> Vec<String> {
    let mut names = Vec::new();
    let mut index = 0u32;
    loop {
        // Manifest paths are well under 32k UTF-16 units (the registry limit
        // for a value name is 16,383 characters).
        let mut buf = vec![0u16; 16_384];
        let mut len = buf.len() as u32;
        // SAFETY: `buf`/`len` describe a live buffer; no data is requested.
        let status = unsafe {
            RegEnumValueW(
                key,
                index,
                Some(PWSTR(buf.as_mut_ptr())),
                &mut len,
                None,
                None,
                None,
                None,
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == ERROR_SUCCESS || status == ERROR_MORE_DATA {
            names.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
        index += 1;
        if index > 10_000 {
            break;
        }
    }
    names
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

/// Register the bundled Vulkan implicit-layer manifests for the current user,
/// so a Vulkan game launched afterward loads the hook layer. Prefer a
/// [`LayerLease`], which also removes the registration again.
///
/// Best-effort: each (manifest, registry-view) pair is registered
/// independently; a missing manifest/DLL or a registry error for one is logged
/// and skipped. Returns the number of manifests registered.
fn ensure_registered() -> usize {
    let mut registered = 0usize;

    for (json, dll, view) in VIEWS {
        let Some(manifest) = layer_manifest_path(json) else {
            log::debug!(
                "[VulkanLayer] manifest {json} not found next to the binary; \
                 skipping registration (Vulkan capture unavailable for that bitness)"
            );
            continue;
        };
        if !manifest_dll_present(&manifest, dll) {
            log::warn!(
                "[VulkanLayer] manifest {json} present but its {dll} is missing; \
                 not registering (would make the Vulkan loader log a load failure)"
            );
            continue;
        }
        match register_one(&manifest, view) {
            Ok(()) => {
                registered += 1;
                log::info!(
                    "[VulkanLayer] registered implicit layer {} (HKCU\\{})",
                    manifest.display(),
                    IMPLICIT_LAYERS_SUBKEY,
                );
            }
            Err(e) => log::warn!(
                "[VulkanLayer] failed to register implicit layer {}: {e}",
                manifest.display()
            ),
        }
    }
    registered
}

/// Remove every implicit-layer registration this app has written, in both
/// registry views: the running build's, older install folders', and dev build
/// folders' (see [`is_own_registration`]). Registrations by OBS or anyone else
/// are kept. Returns the number of values removed.
pub fn remove_registrations() -> usize {
    let mut removed = 0usize;
    let mut kept_foreign = 0usize;
    for (_, _, view) in VIEWS {
        let key = match open_implicit_layers_key(view, false) {
            Ok(Some(key)) => key,
            Ok(None) => continue,
            Err(e) => {
                log::warn!("[VulkanLayer] cannot open ImplicitLayers for cleanup: {e}");
                continue;
            }
        };
        for name in value_names(key) {
            let text = std::fs::read_to_string(&name).ok();
            if !is_own_registration(&name, text.as_deref()) {
                kept_foreign += 1;
                continue;
            }
            match delete_value(key, &name) {
                Ok(()) => {
                    removed += 1;
                    log::debug!("[VulkanLayer] removed registration {name}");
                }
                Err(e) => log::warn!("[VulkanLayer] could not remove registration {name}: {e}"),
            }
        }
        unsafe {
            let _ = RegCloseKey(key);
        }
    }
    log::info!(
        "[VulkanLayer] removed {removed} implicit-layer registration(s) written by this app; \
         kept {kept_foreign} from other software"
    );
    removed
}

/// How many [`LayerLease`]s are alive.
static LEASES: Mutex<usize> = Mutex::new(0);

/// Keeps the Vulkan layer registered while a hook share runs. The first lease
/// registers the manifests; dropping the last one removes them.
#[derive(Debug)]
pub struct LayerLease(());

impl LayerLease {
    pub fn acquire() -> Self {
        let mut leases = LEASES.lock().unwrap_or_else(|p| p.into_inner());
        if *leases == 0 {
            let registered = ensure_registered();
            log::info!(
                "[VulkanLayer] hook share started: {registered} manifest(s) registered \
                 (Vulkan games launched from now until the share ends load the layer)"
            );
        }
        *leases += 1;
        LayerLease(())
    }
}

impl Drop for LayerLease {
    fn drop(&mut self) {
        let mut leases = LEASES.lock().unwrap_or_else(|p| p.into_inner());
        *leases = leases.saturating_sub(1);
        if *leases == 0 {
            let removed = remove_registrations();
            log::info!("[VulkanLayer] hook share ended: {removed} registration(s) removed");
        }
    }
}

/// Whether the target process has a `graphics-hook{64,32}.dll` loaded, which
/// for a Vulkan game means a capture layer attached at `vkCreateInstance`. A
/// Vulkan target without it cannot be hooked, so injecting would only put a
/// DLL in the game for nothing.
pub fn process_has_hook_module(pid: u32) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W, TH32CS_SNAPMODULE,
        TH32CS_SNAPMODULE32,
    };

    let Ok(snapshot) =
        (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) })
    else {
        return false;
    };
    let mut found = false;
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
            found = true;
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
    fn manifest_names_match_bundled_artifacts() {
        // These must match the JSON shipped by build.rs / the fork.
        assert_eq!(LAYER_JSON_64, "obs-vulkan64.json");
        assert_eq!(LAYER_JSON_32, "obs-vulkan32.json");
        let bundled = include_str!("../../resources/obs-capture/obs-vulkan64.json");
        assert!(bundled.contains(OWN_LAYER_NAME));
    }

    #[test]
    fn manifest_dll_present_checks_sibling_dll() {
        // A manifest in a temp dir with no sibling DLL must report absent.
        let tmp = std::env::temp_dir().join("ralph_vk_layer_test_no_dll");
        let _ = std::fs::create_dir_all(&tmp);
        let manifest = tmp.join("obs-vulkan64.json");
        let _ = std::fs::write(&manifest, b"{}");
        assert!(!manifest_dll_present(&manifest, "graphics-hook64.dll"));
        let _ = std::fs::remove_file(&manifest);
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
        ] {
            assert!(!is_own_registration(path, None), "{path}");
        }
    }

    #[test]
    fn an_existing_manifest_must_name_our_layer() {
        let path = r"C:\x\obs-capture\obs-vulkan64.json";
        assert!(is_own_registration(
            path,
            Some(r#"{"layer":{"name":"VK_LAYER_RALPH_MEET_HOOK"}}"#)
        ));
        assert!(!is_own_registration(
            path,
            Some(r#"{"layer":{"name":"VK_LAYER_OBS_HOOK"}}"#)
        ));
    }
}
