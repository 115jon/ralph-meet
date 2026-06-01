//! Implicit-Vulkan-layer registration for the Forked_Hook_DLL's Vulkan present
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
//! called, `vulkan_seen` stays false, and `hook_vulkan()` returns false forever
//! (the symptom seen in the field: `initialize_signaled_no_hookready`, 0 frames
//! for a Vulkan game).
//!
//! # What this module does
//!
//! It registers the bundled `obs-vulkan{64,32}.json` manifests (which point at
//! the matching `graphics-hook{64,32}.dll`) under the **current user's**
//! `ImplicitLayers` key, value = the absolute manifest path, data = `0`
//! (DWORD; the Vulkan loader treats `0` as "enabled"). Per-user `HKCU` avoids
//! requiring elevation. Registration is **idempotent** and best-effort —
//! failure to register only means Vulkan games fall back to WGC / unavailable,
//! exactly as before, never a crash.
//!
//! # Scope + lifetime (matches OBS)
//!
//! An implicit layer, once registered, is offered to **every** Vulkan process
//! on the system, but our layer is inert unless OBS-style capture objects exist
//! for that PID — so an idle registration costs a process a no-op layer load.
//! Crucially, the loader only consults the registry at `vkCreateInstance`, so a
//! game must be **launched after** registration for the layer to attach; this
//! is why we register at app startup (and again, idempotently, when a capture
//! session starts) rather than only at injection time.

#![cfg(all(feature = "game-capture-hook", windows))]

use std::path::{Path, PathBuf};

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_WOW64_32KEY, KEY_WOW64_64KEY, KEY_WRITE, REG_DWORD,
    REG_OPTION_NON_VOLATILE, REG_SAM_FLAGS,
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

/// Resolve the directory that holds the bundled capture artifacts
/// (`obs-capture/` next to the running executable), mirroring how
/// [`crate::game_capture::inject::ObsArtifacts`] discovers the DLLs/helpers.
fn obs_capture_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.join("obs-capture");
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

/// Open-or-create the per-user `ImplicitLayers` key for the given bitness view
/// (`KEY_WOW64_64KEY` / `KEY_WOW64_32KEY` so the 32- and 64-bit loaders each see
/// their manifest). Returns the open key on success.
fn open_implicit_layers_key(view: REG_SAM_FLAGS) -> Result<HKEY, String> {
    let subkey = HSTRING::from(IMPLICIT_LAYERS_SUBKEY);
    let mut key = HKEY::default();
    // SAFETY: valid HKCU root + a well-formed subkey; phkresult is a live local.
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE | view,
            None,
            &mut key,
            None,
        )
    };
    if status == ERROR_SUCCESS {
        Ok(key)
    } else {
        Err(format!("RegCreateKeyExW failed: {}", status.0))
    }
}

/// Register one manifest path under the given registry view, value data `0`
/// (enabled). Idempotent: rewriting the same value is a no-op for the loader.
fn register_one(manifest: &Path, view: REG_SAM_FLAGS) -> Result<(), String> {
    let key = open_implicit_layers_key(view)?;
    let value_name = HSTRING::from(manifest.as_os_str());
    let enabled: u32 = 0;
    // SAFETY: `key` is a live handle from open_implicit_layers_key; the data
    // slice lives for the duration of the call.
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

/// Remove one manifest path from the given registry view. `ERROR_FILE_NOT_FOUND`
/// (the value was never present) counts as success.
fn unregister_one(manifest: &Path, view: REG_SAM_FLAGS) -> Result<(), String> {
    let subkey = HSTRING::from(IMPLICIT_LAYERS_SUBKEY);
    let mut key = HKEY::default();
    let open = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            KEY_WRITE | view,
            &mut key,
        )
    };
    if open == ERROR_FILE_NOT_FOUND {
        return Ok(()); // the key never existed → nothing registered
    }
    if open != ERROR_SUCCESS {
        return Err(format!("RegOpenKeyExW failed: {}", open.0));
    }
    let value_name = HSTRING::from(manifest.as_os_str());
    let status = unsafe { RegDeleteValueW(key, PCWSTR(value_name.as_ptr())) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(format!("RegDeleteValueW failed: {}", status.0))
    }
}

/// Ensure the bundled Vulkan implicit-layer manifests are registered with the
/// Vulkan loader for the current user, so a Vulkan game launched afterward loads
/// our `graphics-hook` layer and the present interception can attach.
///
/// Idempotent and best-effort: each (manifest, registry-view) pair is registered
/// independently; a missing manifest/DLL or a registry error for one is logged
/// and skipped without failing the others. Registers the 64-bit manifest in the
/// 64-bit registry view and the 32-bit manifest in the 32-bit view, matching the
/// bitness the respective Vulkan loader reads.
///
/// Returns the number of manifests successfully registered (0 if none could be).
pub fn ensure_registered() -> usize {
    let mut registered = 0usize;

    for (json, dll, view) in [
        (LAYER_JSON_64, "graphics-hook64.dll", KEY_WOW64_64KEY),
        (LAYER_JSON_32, "graphics-hook32.dll", KEY_WOW64_32KEY),
    ] {
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
                    "[VulkanLayer] registered implicit layer {} (HKCU\\{}\\{})",
                    manifest.display(),
                    IMPLICIT_LAYERS_SUBKEY,
                    json,
                );
            }
            Err(e) => log::warn!(
                "[VulkanLayer] failed to register implicit layer {}: {e}",
                manifest.display()
            ),
        }
    }

    if registered == 0 {
        log::info!(
            "[VulkanLayer] no Vulkan implicit-layer manifests registered; Vulkan \
             games will fall back (DX/GL capture is unaffected)"
        );
    }
    registered
}

/// Remove the bundled Vulkan implicit-layer registrations for the current user.
/// Best-effort; intended for an uninstall/cleanup path. Returns the number of
/// manifests successfully removed (or already absent).
pub fn ensure_unregistered() -> usize {
    let mut removed = 0usize;
    for (json, view) in [
        (LAYER_JSON_64, KEY_WOW64_64KEY),
        (LAYER_JSON_32, KEY_WOW64_32KEY),
    ] {
        // Build the path even if the file is gone, so we can still delete a
        // stale registry value pointing at a removed manifest.
        let manifest = obs_capture_dir()
            .map(|d| d.join(json))
            .unwrap_or_else(|| PathBuf::from(json));
        match unregister_one(&manifest, view) {
            Ok(()) => removed += 1,
            Err(e) => log::warn!(
                "[VulkanLayer] failed to unregister implicit layer {}: {e}",
                manifest.display()
            ),
        }
    }
    removed
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
}
