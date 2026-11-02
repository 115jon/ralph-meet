//! The OBS-signed capture hook: the pinned file set, runtime verification, and
//! staging to a stable folder.
//!
//! The app injects OBS Studio's own `graphics-hook{64,32}.dll`, run through
//! OBS's own `inject-helper` and `get-graphics-offsets`, unmodified and signed
//! by the OBS Project. The exact files are pinned in
//! `desktop/packaging/obs-signed-hook.lock.json`, embedded here. Before every
//! injection each file is opened without write or delete sharing, its SHA-256
//! is checked against the lock, and its Authenticode signature and signer are
//! checked with `WinVerifyTrust`. The handles stay open until the helper has
//! exited, so the files cannot be swapped between the check and the use.
//!
//! The stock DLL stays loaded in a game until the game exits. To keep a locked
//! DLL out of the versioned `app-<ver>` folders (which the updater deletes),
//! the verified set is copied once to a content-addressed folder shared by all
//! app versions: `%LOCALAPPDATA%\RalphMeet\capture-hook\obs-<ver>-<sha8>\`.
//! `RALPH_CAPTURE_HOOK_DIR` overrides the parent folder (development builds).
//!
//! Never modify or re-sign these files: a changed byte voids the signature that
//! anti-cheat vendors allowlist.

#![cfg(all(feature = "game-capture-hook", windows))]

use std::fs::File;
use std::io::Read;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use sha2::{Digest, Sha256};

use crate::game_capture::inject::Bitness;

const LOCK_JSON: &str = include_str!("../../../packaging/obs-signed-hook.lock.json");

/// The folder, next to the binary, that the installer ships the set in.
pub const BUNDLED_SUBDIR: &str = r"obs-capture\obs-signed";

/// `FILE_SHARE_READ`: others may read (and the loader may map the image), but
/// nobody may write, rename, or delete the file while we hold it.
const FILE_SHARE_READ: u32 = 0x1;

#[derive(Debug, serde::Deserialize)]
pub struct Lock {
    pub obs_version: String,
    pub hook_ver: String,
    pub signer_subject: String,
    pub files: Vec<LockedFile>,
}

#[derive(Debug, serde::Deserialize)]
pub struct LockedFile {
    pub name: String,
    pub sha256: String,
    pub signer_thumbprint: String,
}

/// The embedded lock. Parsed once; a malformed lock is a build defect caught
/// by the unit tests.
pub fn lock() -> &'static Lock {
    static LOCK: OnceLock<Lock> = OnceLock::new();
    LOCK.get_or_init(|| serde_json::from_str(LOCK_JSON).expect("obs-signed-hook.lock.json"))
}

impl Lock {
    fn file(&self, name: &str) -> Option<&LockedFile> {
        self.files
            .iter()
            .find(|f| f.name.eq_ignore_ascii_case(name))
    }

    /// `obs-<ver>-<first 8 hex of graphics-hook64.dll>`: a new OBS minor (new
    /// hook bytes) gets a new folder, so a DLL still loaded in a running game
    /// never blocks staging the next one.
    pub fn staged_dir_name(&self) -> String {
        let sha8 = self
            .file("graphics-hook64.dll")
            .map(|f| f.sha256.get(..8).unwrap_or(&f.sha256).to_string())
            .unwrap_or_default();
        format!("obs-{}-{}", self.obs_version, sha8)
    }
}

/// The three files one injection needs, for one target bitness.
pub fn file_names(bitness: Bitness) -> [&'static str; 3] {
    match bitness {
        Bitness::X64 => [
            "graphics-hook64.dll",
            "inject-helper64.exe",
            "get-graphics-offsets64.exe",
        ],
        Bitness::X86 => [
            "graphics-hook32.dll",
            "inject-helper32.exe",
            "get-graphics-offsets32.exe",
        ],
    }
}

/// A file's signer, read from its verified Authenticode signature.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signer {
    pub subject: String,
    pub thumbprint: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Pure check of one file's measured facts against its lock entry.
fn check_against_lock(
    lock: &Lock,
    entry: &LockedFile,
    sha256: &str,
    signer: &Signer,
) -> Result<(), String> {
    if !sha256.eq_ignore_ascii_case(&entry.sha256) {
        return Err(format!(
            "{}: SHA-256 {sha256} does not match the lock ({})",
            entry.name, entry.sha256
        ));
    }
    if signer.subject != lock.signer_subject {
        return Err(format!(
            "{}: signed by '{}', expected '{}'",
            entry.name, signer.subject, lock.signer_subject
        ));
    }
    if !signer
        .thumbprint
        .eq_ignore_ascii_case(&entry.signer_thumbprint)
    {
        return Err(format!(
            "{}: signer thumbprint {} does not match the lock ({})",
            entry.name, signer.thumbprint, entry.signer_thumbprint
        ));
    }
    Ok(())
}

/// `WinVerifyTrust` (Authenticode policy, no UI, no network revocation fetch)
/// on an open file, then the primary signer's subject and SHA-1 thumbprint.
pub fn verify_signature(path: &Path, file: &File) -> Result<Signer, String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::Security::Cryptography::{
        CertGetCertificateContextProperty, CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE,
        CERT_SHA1_HASH_PROP_ID,
    };
    use windows::Win32::Security::WinTrust::{
        WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain,
        WTHelperProvDataFromStateData, WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2,
        WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL,
        WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY,
        WTD_UI_NONE,
    };

    let wide_path = HSTRING::from(path.as_os_str());
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(wide_path.as_ptr()),
        hFile: HANDLE(file.as_raw_handle()),
        pgKnownSubject: std::ptr::null_mut(),
    };
    let mut data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &mut file_info,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: `data` and everything it points at outlive both calls.
    let status = unsafe {
        WinVerifyTrust(
            HWND(-1isize as *mut _),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast(),
        )
    };

    let signer = (|| {
        if status != 0 {
            return Err(format!(
                "Authenticode verification failed ({:#010x})",
                status as u32
            ));
        }
        // SAFETY: valid state data from the successful verify above; the
        // returned pointers stay valid until WTD_STATEACTION_CLOSE.
        unsafe {
            let prov = WTHelperProvDataFromStateData(data.hWVTStateData);
            if prov.is_null() {
                return Err("no provider data".into());
            }
            let sgnr = WTHelperGetProvSignerFromChain(prov, 0, false, 0);
            if sgnr.is_null() {
                return Err("no signer".into());
            }
            let cert = WTHelperGetProvCertFromChain(sgnr, 0);
            if cert.is_null() || (*cert).pCert.is_null() {
                return Err("no signer certificate".into());
            }
            let context = (*cert).pCert;
            let mut name = [0u16; 256];
            let len = CertGetNameStringW(
                context,
                CERT_NAME_SIMPLE_DISPLAY_TYPE,
                0,
                None,
                Some(&mut name),
            ) as usize;
            let subject = String::from_utf16_lossy(&name[..len.saturating_sub(1)]);
            let mut hash = [0u8; 20];
            let mut hash_len = hash.len() as u32;
            CertGetCertificateContextProperty(
                context,
                CERT_SHA1_HASH_PROP_ID,
                Some(hash.as_mut_ptr().cast()),
                &mut hash_len,
            )
            .map_err(|e| format!("certificate thumbprint: {e}"))?;
            let thumbprint = hash[..hash_len as usize]
                .iter()
                .map(|b| format!("{b:02X}"))
                .collect();
            Ok(Signer {
                subject,
                thumbprint,
            })
        }
    })();

    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: closes the state opened above.
    unsafe {
        WinVerifyTrust(
            HWND(-1isize as *mut _),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast(),
        );
    }
    signer
}

/// Open `path` with read-only sharing and read it whole.
fn open_locked(path: &Path) -> Result<(File, Vec<u8>), String> {
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok((file, bytes))
}

/// Verified, open handles to the files one injection uses. Keep it alive until
/// the inject helper has exited.
#[derive(Debug)]
pub struct VerifiedSet {
    pub dir: PathBuf,
    _handles: Vec<File>,
}

/// Verify `names` in `dir` against the lock and keep them open.
pub fn open_verified(dir: &Path, names: &[&str]) -> Result<VerifiedSet, String> {
    let lock = lock();
    let mut handles = Vec::with_capacity(names.len());
    for name in names {
        let entry = lock
            .file(name)
            .ok_or_else(|| format!("{name} is not in the lock"))?;
        let path = dir.join(name);
        let (file, bytes) = open_locked(&path)?;
        let signer = verify_signature(&path, &file).map_err(|e| format!("{name}: {e}"))?;
        check_against_lock(lock, entry, &sha256_hex(&bytes), &signer)?;
        handles.push(file);
    }
    Ok(VerifiedSet {
        dir: dir.to_path_buf(),
        _handles: handles,
    })
}

/// Our Vulkan layer manifest for the staged DLL. Our own layer name, never
/// OBS's: `VK_LAYER_OBS_HOOK` belongs to OBS's own registration.
fn vulkan_manifest(dll: &str) -> String {
    format!(
        r#"{{
    "file_format_version": "1.1.2",
    "layer": {{
        "name": "VK_LAYER_RALPH_MEET_HOOK",
        "type": "GLOBAL",
        "library_path": ".\\{dll}",
        "api_version": "1.3.216",
        "implementation_version": "1",
        "description": "Ralph Meet game capture (OBS Studio capture hook)",
        "functions": {{
            "vkNegotiateLoaderLayerInterfaceVersion": "OBS_Negotiate"
        }},
        "disable_environment": {{
            "DISABLE_VULKAN_RALPH_MEET_CAPTURE": "1"
        }}
    }}
}}
"#
    )
}

/// The parent of the per-version folders.
pub fn stage_root() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("RALPH_CAPTURE_HOOK_DIR") {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os("LOCALAPPDATA").map(|base| {
        PathBuf::from(base)
            .join(crate::APP_DATA_DIRECTORY_NAME)
            .join("capture-hook")
    })
}

/// The bundled set next to the running binary.
pub fn bundled_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.join(BUNDLED_SUBDIR);
    dir.is_dir().then_some(dir)
}

/// Whether a file at `path` already has the locked bytes.
fn has_locked_bytes(path: &Path, entry: &LockedFile) -> bool {
    std::fs::read(path)
        .map(|bytes| sha256_hex(&bytes).eq_ignore_ascii_case(&entry.sha256))
        .unwrap_or(false)
}

/// Copy the verified bundled set to its stable folder (once per version) and
/// write our Vulkan layer manifests beside it. Returns the staged folder.
///
/// A staged file that already has the locked bytes is left alone, which is
/// also what makes this safe while a game still has the DLL loaded.
pub fn ensure_staged() -> Result<PathBuf, String> {
    let lock = lock();
    let bundled = bundled_dir().ok_or("the signed capture hook is not bundled with this build")?;
    let root = stage_root().ok_or("no folder to stage the capture hook in")?;
    let dir = root.join(lock.staged_dir_name());
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    for entry in &lock.files {
        let dest = dir.join(&entry.name);
        if has_locked_bytes(&dest, entry) {
            continue;
        }
        let src = bundled.join(&entry.name);
        let (file, bytes) = open_locked(&src)?;
        let signer = verify_signature(&src, &file).map_err(|e| format!("{}: {e}", entry.name))?;
        check_against_lock(lock, entry, &sha256_hex(&bytes), &signer)?;
        let tmp = dir.join(format!("{}.partial", entry.name));
        std::fs::write(&tmp, &bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &dest).map_err(|e| format!("place {}: {e}", dest.display()))?;
        log::info!("[SignedHook] staged {} to {}", entry.name, dir.display());
    }

    for (json, dll) in [
        ("obs-vulkan64.json", "graphics-hook64.dll"),
        ("obs-vulkan32.json", "graphics-hook32.dll"),
    ] {
        let path = dir.join(json);
        let text = vulkan_manifest(dll);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(&path, text).map_err(|e| format!("write {}: {e}", path.display()))?;
        }
    }
    Ok(dir)
}

/// Whether a loaded module at `path` is a validly signed OBS Project capture
/// hook (any OBS version). Used before attaching to a hook that is already
/// resident in a game, which may be OBS's own copy rather than ours.
pub fn is_obs_signed_module(path: &Path) -> Result<Signer, String> {
    let (file, _) = open_locked(path)?;
    let signer = verify_signature(path, &file)?;
    if signer.subject != lock().signer_subject {
        return Err(format!("signed by '{}'", signer.subject));
    }
    Ok(signer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_embedded_lock_parses_and_covers_both_bitnesses() {
        let lock = lock();
        assert_eq!(lock.signer_subject, "OBS Project, LLC");
        assert!(lock.hook_ver.starts_with("1."), "host speaks hook ABI 1.x");
        for bitness in [Bitness::X64, Bitness::X86] {
            for name in file_names(bitness) {
                let entry = lock.file(name).unwrap_or_else(|| panic!("{name} in lock"));
                assert_eq!(entry.sha256.len(), 64, "{name}");
                assert_eq!(entry.signer_thumbprint.len(), 40, "{name}");
            }
        }
    }

    #[test]
    fn the_staged_folder_is_content_addressed() {
        let name = lock().staged_dir_name();
        assert!(name.starts_with(&format!("obs-{}-", lock().obs_version)));
        assert_eq!(name.len(), format!("obs-{}-", lock().obs_version).len() + 8);
    }

    fn entry() -> LockedFile {
        LockedFile {
            name: "graphics-hook64.dll".into(),
            sha256: "ab".repeat(32),
            signer_thumbprint: "CD".repeat(20),
        }
    }

    fn obs_signer() -> Signer {
        Signer {
            subject: lock().signer_subject.clone(),
            thumbprint: "cd".repeat(20),
        }
    }

    #[test]
    fn a_matching_file_passes() {
        assert!(check_against_lock(lock(), &entry(), &"AB".repeat(32), &obs_signer()).is_ok());
    }

    #[test]
    fn a_changed_byte_fails() {
        let err = check_against_lock(lock(), &entry(), &"ac".repeat(32), &obs_signer());
        assert!(err.unwrap_err().contains("SHA-256"));
    }

    #[test]
    fn another_signer_fails() {
        let signer = Signer {
            subject: "Someone Else".into(),
            ..obs_signer()
        };
        let err = check_against_lock(lock(), &entry(), &"ab".repeat(32), &signer);
        assert!(err.unwrap_err().contains("signed by"));
    }

    #[test]
    fn another_obs_certificate_fails() {
        let signer = Signer {
            thumbprint: "EF".repeat(20),
            ..obs_signer()
        };
        let err = check_against_lock(lock(), &entry(), &"ab".repeat(32), &signer);
        assert!(err.unwrap_err().contains("thumbprint"));
    }

    #[test]
    fn the_vulkan_manifest_uses_our_layer_name() {
        let text = vulkan_manifest("graphics-hook64.dll");
        assert!(text.contains("VK_LAYER_RALPH_MEET_HOOK"));
        assert!(!text.contains("VK_LAYER_OBS_HOOK"));
        assert!(text.contains(r#"".\\graphics-hook64.dll""#));
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            parsed["layer"]["functions"]["vkNegotiateLoaderLayerInterfaceVersion"],
            "OBS_Negotiate"
        );
    }

    /// Runs against the fetched files when they are present
    /// (`desktop/scripts/fetch-obs-signed-hook.ps1`).
    #[test]
    fn the_fetched_files_verify_when_present() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(r"resources\obs-capture\obs-signed");
        if !dir.join("graphics-hook64.dll").is_file() {
            eprintln!("skipped: {} not fetched", dir.display());
            return;
        }
        for bitness in [Bitness::X64, Bitness::X86] {
            open_verified(&dir, &file_names(bitness)).expect("fetched files verify");
        }
    }
}
