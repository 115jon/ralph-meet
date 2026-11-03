//! Executables to keep off the hook, published by the Yap web app.
//!
//! A game that refuses the OBS-signed hook (an anti-cheat that blocks the
//! injection, usually) can be added to `/desktop/capture-policy.json` without
//! shipping a new desktop build. The list is add-only: it is checked after the
//! built-in blocklist, can never remove or override an entry there, and has no
//! field that turns injection on. A bad fetch or a bad file keeps the previous
//! list.
//!
//! The file is fetched once, shortly after startup and off the share path, then
//! every 24 hours, and cached in the app data folder so the list applies
//! offline too.

use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Duration;

use serde::Deserialize;

use crate::game_capture::blocklist::ProcessIdentity;

/// The Yap web app, which serves the policy file from `public/desktop/`.
const YAP_WEB_ORIGIN: &str = "https://yap.115jon.com";
const POLICY_PATH: &str = "/desktop/capture-policy.json";
/// Cached copy of the last good file, under the app data folder.
const CACHE_FILE: &str = "capture-policy.json";

/// Keeps the fetch off the startup path.
const FIRST_FETCH_DELAY: Duration = Duration::from_secs(15);
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const REFRESH_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

const SUPPORTED_VERSION: u32 = 1;
const MAX_ENTRIES: usize = 500;
const MAX_EXE_NAME_LEN: usize = 128;
const MAX_BODY_BYTES: usize = 256 * 1024;

/// The remote entries in force. Empty until the cache or a fetch supplies one.
static REMOTE_BLOCKLIST: RwLock<Vec<ProcessIdentity>> = RwLock::new(Vec::new());

#[derive(Deserialize)]
struct PolicyFile {
    version: u32,
    blocklist: Vec<PolicyEntry>,
}

/// Other fields (`note`, for people reading the file) are ignored.
#[derive(Deserialize)]
struct PolicyEntry {
    exe: String,
}

/// A bare file name ending in `.exe`, 1 to 128 characters.
fn validate_exe_name(exe: &str) -> Result<(), String> {
    if exe.is_empty() || exe.chars().count() > MAX_EXE_NAME_LEN {
        return Err(format!(
            "exe name must be 1-{MAX_EXE_NAME_LEN} characters: {exe:?}"
        ));
    }
    if exe.contains(['/', '\\']) {
        return Err(format!("exe name must not contain a path: {exe:?}"));
    }
    if !exe.to_ascii_lowercase().ends_with(".exe") {
        return Err(format!("exe name must end in .exe: {exe:?}"));
    }
    Ok(())
}

/// The blocklist in a policy file. Any invalid entry rejects the whole file.
fn parse_policy(raw: &[u8]) -> Result<Vec<ProcessIdentity>, String> {
    let file: PolicyFile = serde_json::from_slice(raw).map_err(|err| err.to_string())?;
    if file.version != SUPPORTED_VERSION {
        return Err(format!("unsupported policy version {}", file.version));
    }
    if file.blocklist.len() > MAX_ENTRIES {
        return Err(format!(
            "{} blocklist entries (at most {MAX_ENTRIES})",
            file.blocklist.len()
        ));
    }
    file.blocklist
        .into_iter()
        .map(|entry| {
            validate_exe_name(&entry.exe)?;
            Ok(ProcessIdentity::new(entry.exe))
        })
        .collect()
}

/// Replace `list` with the file's blocklist; on an error it is left as it was.
fn apply(list: &RwLock<Vec<ProcessIdentity>>, raw: &[u8]) -> Result<usize, String> {
    let entries = parse_policy(raw)?;
    let count = entries.len();
    *list.write().unwrap_or_else(|p| p.into_inner()) = entries;
    Ok(count)
}

/// Whether the remote list blocks `exe` (matched like the built-in one: by
/// file name, case-insensitively).
pub fn blocks(exe: &str) -> bool {
    REMOTE_BLOCKLIST
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .iter()
        .any(|id| id.matches(exe))
}

fn cache_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        crate::windows_app_data_root().map(|dir| dir.join(CACHE_FILE))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Temp file plus rename, like the other app data files.
fn write_cache(raw: &[u8]) -> Result<(), String> {
    let Some(path) = cache_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(|err| err.to_string())?;
    std::fs::rename(&tmp, path).map_err(|err| err.to_string())
}

fn load_cache() {
    let Some(path) = cache_path() else {
        return;
    };
    let Ok(raw) = std::fs::read(&path) else {
        return;
    };
    match apply(&REMOTE_BLOCKLIST, &raw) {
        Ok(count) => log::info!("[CapturePolicy] {count} blocked executables from the cache"),
        Err(err) => log::warn!(
            "[CapturePolicy] ignoring the cached policy {}: {err}",
            path.display()
        ),
    }
}

async fn fetch() -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .https_only(true)
        .user_agent(concat!("Yap-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(format!("{YAP_WEB_ORIGIN}{POLICY_PATH}"))
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|err| err.to_string())?;
    let body = response.bytes().await.map_err(|err| err.to_string())?;
    if body.len() > MAX_BODY_BYTES {
        return Err(format!("policy file is {} bytes", body.len()));
    }
    Ok(body.to_vec())
}

fn refresh() {
    let fetched = tauri::async_runtime::block_on(fetch())
        .and_then(|raw| apply(&REMOTE_BLOCKLIST, &raw).map(|count| (raw, count)));
    match fetched {
        Ok((raw, count)) => {
            log::info!("[CapturePolicy] {count} blocked executables from {POLICY_PATH}");
            if let Err(err) = write_cache(&raw) {
                log::warn!("[CapturePolicy] could not cache the policy: {err}");
            }
        }
        Err(err) => log::warn!("[CapturePolicy] keeping the previous list: {err}"),
    }
}

/// Load the cached list now, then fetch a fresh one after a short delay and
/// every 24 hours, all on a background thread.
pub fn spawn_refresh() {
    let spawned = std::thread::Builder::new()
        .name("YapCapturePolicy".into())
        .spawn(|| {
            load_cache();
            std::thread::sleep(FIRST_FETCH_DELAY);
            loop {
                refresh();
                std::thread::sleep(REFRESH_INTERVAL);
            }
        });
    if let Err(err) = spawned {
        log::warn!("[CapturePolicy] could not start the refresh thread: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_capture::blocklist::{default_blocklist, safety_decision};
    use crate::game_capture::{FallbackReason, SafetyDecision};

    fn policy(entries: &str) -> String {
        format!(r#"{{"version":1,"blocklist":[{entries}]}}"#)
    }

    #[test]
    fn the_published_file_parses() {
        let raw = include_str!("../../../../public/desktop/capture-policy.json");
        let list = parse_policy(raw.as_bytes()).unwrap();
        assert!(list
            .iter()
            .any(|id| id.matches("Marvel-Win64-Shipping.exe")));
    }

    #[test]
    fn a_valid_policy_parses_and_ignores_extra_fields() {
        let raw =
            policy(r#"{"exe":"Some-Game.exe","note":"why","enable":true},{"exe":"OTHER.EXE"}"#);
        let list = parse_policy(raw.as_bytes()).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].exe_name, "Some-Game.exe");
        assert_eq!(list[1].exe_name, "OTHER.EXE");
        assert!(parse_policy(policy("").as_bytes()).unwrap().is_empty());
    }

    #[test]
    fn matching_is_case_insensitive() {
        let list = RwLock::new(Vec::new());
        apply(&list, policy(r#"{"exe":"Some-Game.exe"}"#).as_bytes()).unwrap();
        let list = list.read().unwrap();
        assert!(list.iter().any(|id| id.matches("some-game.EXE")));
        assert!(list.iter().any(|id| id.matches(r"D:\Games\SOME-GAME.exe")));
        assert!(!list.iter().any(|id| id.matches("other.exe")));
    }

    #[test]
    fn paths_and_non_exe_names_are_rejected() {
        for exe in [
            r"..\Game.exe",
            "dir/Game.exe",
            r"C:\Game.exe",
            "Game.dll",
            "Game.exe.txt",
            "Game",
            "",
            &format!("{}.exe", "a".repeat(125)),
        ] {
            let raw = policy(&format!(r#"{{"exe":{}}}"#, serde_json::json!(exe)));
            assert!(parse_policy(raw.as_bytes()).is_err(), "accepted {exe:?}");
        }
        // The longest name allowed.
        let longest = format!("{}.exe", "a".repeat(124));
        let raw = policy(&format!(r#"{{"exe":"{longest}"}}"#));
        assert!(parse_policy(raw.as_bytes()).is_ok());
    }

    #[test]
    fn one_bad_entry_rejects_the_whole_file() {
        let raw = policy(r#"{"exe":"Good.exe"},{"exe":"bad.dll"}"#);
        assert!(parse_policy(raw.as_bytes()).is_err());
    }

    #[test]
    fn oversize_lists_are_rejected() {
        let entries = |n: usize| vec![r#"{"exe":"A.exe"}"#; n].join(",");
        assert!(parse_policy(policy(&entries(MAX_ENTRIES)).as_bytes()).is_ok());
        assert!(parse_policy(policy(&entries(MAX_ENTRIES + 1)).as_bytes()).is_err());
    }

    #[test]
    fn other_versions_and_malformed_files_are_rejected() {
        for raw in [
            r#"{"version":2,"blocklist":[]}"#,
            r#"{"version":0,"blocklist":[]}"#,
            r#"{"blocklist":[]}"#,
            r#"{"version":1}"#,
            r#"{"version":1,"blocklist":[{"note":"no exe"}]}"#,
            r#"{"version":1,"blocklist":["Game.exe"]}"#,
            "not json",
            "",
        ] {
            assert!(parse_policy(raw.as_bytes()).is_err(), "accepted {raw:?}");
        }
    }

    #[test]
    fn a_bad_file_keeps_the_previous_list() {
        let list = RwLock::new(Vec::new());
        assert_eq!(
            apply(&list, policy(r#"{"exe":"Kept.exe"}"#).as_bytes()),
            Ok(1)
        );
        assert!(apply(&list, b"not json").is_err());
        assert!(apply(&list, policy(r#"{"exe":"bad.dll"}"#).as_bytes()).is_err());
        let list = list.read().unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].matches("kept.exe"));
    }

    #[test]
    fn the_remote_list_only_adds_to_the_built_in_one() {
        let remote = parse_policy(policy(r#"{"exe":"Remote-Game.exe"}"#).as_bytes()).unwrap();
        let merged: Vec<_> = default_blocklist().into_iter().chain(remote).collect();
        let denied = SafetyDecision::Deny(FallbackReason::Blocklisted);
        // Everything built in stays blocked, and the remote entry joins it.
        for builtin in default_blocklist() {
            assert_eq!(safety_decision(&builtin.exe_name, &merged, &[]), denied);
        }
        assert_eq!(safety_decision("remote-game.exe", &merged, &[]), denied);
        // An empty remote list changes nothing, and nothing else is blocked.
        let merged: Vec<_> = default_blocklist()
            .into_iter()
            .chain(parse_policy(policy("").as_bytes()).unwrap())
            .collect();
        assert_eq!(
            safety_decision("remote-game.exe", &merged, &[]),
            SafetyDecision::Allow
        );
        assert_eq!(
            safety_decision("Marvel-Win64-Shipping.exe", &merged, &[]),
            denied
        );
    }
}
