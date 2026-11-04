//! Which hook build a share injects, decided before any injection. Pure.
//!
//! The default is OBS Studio's own signed hook for every eligible window:
//! unprotected games, and games protected by a user-mode anti-cheat (Easy
//! Anti-Cheat, BattlEye), which allow the OBS-signed hook for OBS and other
//! streaming apps. Kernel anti-cheats (Vanguard, FACEIT) and VAC are on the
//! executable blocklist and never reach this decision. Our unsigned fork is
//! used only when a developer asks for it, and never in a protected game.
//!
//! It also keeps a small persisted record of executables whose hook attempt
//! ended without a single frame, so an anti-cheat or driver that refuses the
//! hook is not retried on every share (see [`SkipStore`]).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::game_capture::obs_ipc::HookFlavor;
use crate::game_capture::FallbackReason;

/// Facts about one target, resolved by the session from the live system.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FlavorInputs {
    /// An Easy Anti-Cheat or BattlEye install marker sits beside the game.
    pub protected: bool,
    /// Another host (OBS Studio, for instance) is driving a stock hook in the
    /// target right now (`CaptureHook_KeepAlive<pid>` exists).
    pub other_host_active: bool,
    /// `RALPH_CAPTURE_HOOK_FLAVOR=own` (development only).
    pub own_requested: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlavorChoice {
    Use(HookFlavor),
    Skip(FallbackReason),
}

/// First match wins:
///
/// 1. Protected, or the fork was not requested: the OBS-signed hook. Never the
///    fork in a protected game. If another host is driving a stock hook in the
///    target, skip: two hosts would fight over one `hook_info`.
/// 2. Otherwise (unprotected, fork requested): the fork. Its private object
///    names do not collide with OBS's, so it may coexist with OBS.
///
/// Executables the hook already failed on are skipped before this, by
/// [`learned_skip`].
pub fn choose_flavor(inp: &FlavorInputs) -> FlavorChoice {
    if inp.protected || !inp.own_requested {
        if inp.other_host_active {
            return FlavorChoice::Skip(FallbackReason::HookInUse);
        }
        return FlavorChoice::Use(HookFlavor::ObsSigned);
    }
    FlavorChoice::Use(HookFlavor::Own)
}

/// `RALPH_CAPTURE_HOOK_FLAVOR=own` asks for the unsigned fork build (dev only).
pub fn own_flavor_requested() -> bool {
    std::env::var("RALPH_CAPTURE_HOOK_FLAVOR")
        .map(|v| v.trim().eq_ignore_ascii_case("own"))
        .unwrap_or(false)
}

/// File the learned skips live in, under the app data folder (`%APPDATA%\Yap`).
const SKIP_STORE_FILE: &str = "capture-hook-skips.json";
/// Entries kept; the oldest failure is dropped first.
const SKIP_STORE_MAX_ENTRIES: usize = 200;
/// A failure older than this is forgotten, so a fixed driver or anti-cheat gets
/// another chance: 30 days for an anti-cheat game, 7 for any other, where two
/// misses are more likely bad luck (a minimized or paused game).
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
fn skip_expiry_ms(protected: bool) -> u64 {
    if protected {
        30 * DAY_MS
    } else {
        7 * DAY_MS
    }
}

/// What identifies one build of an executable: a game update changes the size
/// or the write time, and with it the verdict.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExeStamp {
    pub size: u64,
    /// Last-write time, milliseconds since the Unix epoch.
    pub mtime_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkipEntry {
    size: u64,
    mtime_ms: u64,
    /// Attempts in a row that ended without a frame.
    failures: u32,
    last_failure_ms: u64,
}

impl SkipEntry {
    fn matches(&self, stamp: ExeStamp) -> bool {
        self.size == stamp.size && self.mtime_ms == stamp.mtime_ms
    }
}

/// Executables whose hook attempt ended without a frame, by lowercase path.
/// Pure: the clock and the executable's metadata are passed in, and
/// [`load_store`] / [`save_store`] do the file IO.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkipStore {
    entries: BTreeMap<String, SkipEntry>,
}

/// Failures in a row before the hook is skipped: one for an Easy Anti-Cheat or
/// BattlEye game (the host never retries those in a loop), two otherwise, so a
/// single transient failure does not cost a game its fast path.
fn skip_threshold(protected: bool) -> u32 {
    if protected {
        1
    } else {
        2
    }
}

impl SkipStore {
    /// Whether the hook should not be tried on `key` (see [`key`]): the record
    /// is for this build of the executable, is newer than [`skip_expiry_ms`], and has
    /// reached the failure threshold.
    pub fn should_skip(&self, key: &str, stamp: ExeStamp, now_ms: u64, protected: bool) -> bool {
        self.entries.get(key).is_some_and(|entry| {
            entry.matches(stamp)
                && now_ms.saturating_sub(entry.last_failure_ms) < skip_expiry_ms(protected)
                && entry.failures >= skip_threshold(protected)
        })
    }

    /// Count one more attempt without a frame. A different build of the
    /// executable starts over at one. Over the cap, the oldest failures go.
    pub fn record_failure(&mut self, key: &str, stamp: ExeStamp, now_ms: u64) {
        let failures = self
            .entries
            .get(key)
            .filter(|entry| entry.matches(stamp))
            .map_or(1, |entry| entry.failures.saturating_add(1));
        self.entries.insert(
            key.to_string(),
            SkipEntry {
                size: stamp.size,
                mtime_ms: stamp.mtime_ms,
                failures,
                last_failure_ms: now_ms,
            },
        );
        while self.entries.len() > SKIP_STORE_MAX_ENTRIES {
            let oldest = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_failure_ms)
                .map(|(key, _)| key.clone());
            match oldest {
                Some(oldest) => self.entries.remove(&oldest),
                None => break,
            };
        }
    }

    /// Forget `key` (the hook delivered a frame). Whether there was an entry.
    pub fn clear(&mut self, key: &str) -> bool {
        self.entries.remove(key).is_some()
    }
}

/// The store file's contents; anything unreadable is an empty store.
fn parse_store(raw: &[u8]) -> SkipStore {
    serde_json::from_slice(raw).unwrap_or_default()
}

fn load_store(path: &Path) -> SkipStore {
    std::fs::read(path)
        .map(|raw| parse_store(&raw))
        .unwrap_or_default()
}

/// Temp file plus rename, so a crash never leaves a half-written store.
fn save_store(path: &Path, store: &SkipStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(store).map_err(|err| err.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, raw).map_err(|err| err.to_string())?;
    std::fs::rename(&tmp, path).map_err(|err| err.to_string())
}

/// `%APPDATA%\Yap\capture-hook-skips.json`, through the same app data root as
/// the rest of the app (so `APPDATA` overrides in dev and smoke builds apply).
fn skip_store_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        crate::windows_app_data_root().map(|dir| dir.join(SKIP_STORE_FILE))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// The store for this run, read from disk on first use.
static STORE: Mutex<Option<SkipStore>> = Mutex::new(None);

fn with_store<T>(f: impl FnOnce(&mut SkipStore, Option<&Path>) -> T) -> T {
    let path = skip_store_path();
    let mut guard = STORE.lock().unwrap_or_else(|p| p.into_inner());
    let store = guard.get_or_insert_with(|| path.as_deref().map(load_store).unwrap_or_default());
    f(store, path.as_deref())
}

fn persist(store: &SkipStore, path: Option<&Path>) {
    if let Some(path) = path {
        if let Err(err) = save_store(path, store) {
            log::warn!("[HookPolicy] could not save {}: {err}", path.display());
        }
    }
}

fn key(exe: &str) -> String {
    exe.trim().to_ascii_lowercase()
}

fn exe_stamp(exe: &str) -> Option<ExeStamp> {
    let meta = std::fs::metadata(exe).ok()?;
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(ExeStamp {
        size: meta.len(),
        mtime_ms: u64::try_from(mtime.as_millis()).ok()?,
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| u64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// Whether an earlier run learned that the hook delivers nothing on this
/// executable. `protected` is the Easy Anti-Cheat / BattlEye marker.
pub fn learned_skip(exe: &str, protected: bool) -> bool {
    let Some(stamp) = exe_stamp(exe) else {
        return false;
    };
    with_store(|store, _| store.should_skip(&key(exe), stamp, now_ms(), protected))
}

/// A hook attempt on `exe` ended without a frame.
pub fn record_hook_failure(exe: &str) {
    let Some(stamp) = exe_stamp(exe) else {
        return;
    };
    with_store(|store, path| {
        store.record_failure(&key(exe), stamp, now_ms());
        persist(store, path);
    });
    log::info!("[HookPolicy] hook attempt on {exe} delivered no frame; remembered");
}

/// The hook delivered a first frame on `exe`: forget any earlier failures.
pub fn record_hook_success(exe: &str) {
    with_store(|store, path| {
        if store.clear(&key(exe)) {
            persist(store, path);
            log::info!("[HookPolicy] hook works on {exe}; cleared its earlier failures");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: FlavorInputs = FlavorInputs {
        protected: false,
        other_host_active: false,
        own_requested: false,
    };

    #[test]
    fn the_signed_hook_is_the_default() {
        assert_eq!(
            choose_flavor(&BASE),
            FlavorChoice::Use(HookFlavor::ObsSigned)
        );
    }

    #[test]
    fn protected_games_get_the_signed_hook_by_default() {
        let inp = FlavorInputs {
            protected: true,
            ..BASE
        };
        assert_eq!(
            choose_flavor(&inp),
            FlavorChoice::Use(HookFlavor::ObsSigned)
        );
    }

    #[test]
    fn the_fork_is_never_used_in_a_protected_game() {
        let inp = FlavorInputs {
            protected: true,
            own_requested: true,
            ..BASE
        };
        assert_eq!(
            choose_flavor(&inp),
            FlavorChoice::Use(HookFlavor::ObsSigned)
        );
    }

    #[test]
    fn the_fork_is_used_only_when_requested() {
        let inp = FlavorInputs {
            own_requested: true,
            ..BASE
        };
        assert_eq!(choose_flavor(&inp), FlavorChoice::Use(HookFlavor::Own));
        // Its private names coexist with a host driving a stock hook.
        let inp = FlavorInputs {
            own_requested: true,
            other_host_active: true,
            ..BASE
        };
        assert_eq!(choose_flavor(&inp), FlavorChoice::Use(HookFlavor::Own));
    }

    #[test]
    fn a_target_another_host_is_capturing_stays_on_wgc() {
        for protected in [false, true] {
            let inp = FlavorInputs {
                protected,
                other_host_active: true,
                ..BASE
            };
            assert_eq!(
                choose_flavor(&inp),
                FlavorChoice::Skip(FallbackReason::HookInUse)
            );
        }
    }

    const EXE: &str = r"c:\games\marvel\game-win64-shipping.exe";
    const STAMP: ExeStamp = ExeStamp {
        size: 1_000,
        mtime_ms: 5_000,
    };

    #[test]
    fn a_protected_game_is_skipped_after_one_failure() {
        let mut store = SkipStore::default();
        assert!(!store.should_skip(EXE, STAMP, DAY_MS, true));
        store.record_failure(EXE, STAMP, DAY_MS);
        assert!(store.should_skip(EXE, STAMP, DAY_MS, true));
    }

    #[test]
    fn any_other_game_is_skipped_after_two_failures() {
        let mut store = SkipStore::default();
        store.record_failure(EXE, STAMP, DAY_MS);
        assert!(!store.should_skip(EXE, STAMP, DAY_MS, false));
        store.record_failure(EXE, STAMP, DAY_MS);
        assert!(store.should_skip(EXE, STAMP, DAY_MS, false));
    }

    #[test]
    fn a_new_build_of_the_executable_starts_over() {
        let mut store = SkipStore::default();
        store.record_failure(EXE, STAMP, DAY_MS);
        let resized = ExeStamp {
            size: STAMP.size + 1,
            ..STAMP
        };
        let touched = ExeStamp {
            mtime_ms: STAMP.mtime_ms + 1,
            ..STAMP
        };
        assert!(!store.should_skip(EXE, resized, DAY_MS, true));
        assert!(!store.should_skip(EXE, touched, DAY_MS, true));
        // A failure on the new build replaces the record instead of adding to it.
        store.record_failure(EXE, resized, DAY_MS);
        assert!(!store.should_skip(EXE, resized, DAY_MS, false));
        assert!(!store.should_skip(EXE, STAMP, DAY_MS, true));
    }

    #[test]
    fn a_failure_is_forgotten_after_thirty_days_or_seven_unprotected() {
        let mut store = SkipStore::default();
        store.record_failure(EXE, STAMP, DAY_MS);
        assert!(store.should_skip(EXE, STAMP, DAY_MS + 30 * DAY_MS - 1, true));
        assert!(!store.should_skip(EXE, STAMP, DAY_MS + 30 * DAY_MS, true));
        store.record_failure(EXE, STAMP, DAY_MS);
        assert!(store.should_skip(EXE, STAMP, DAY_MS + 7 * DAY_MS - 1, false));
        assert!(!store.should_skip(EXE, STAMP, DAY_MS + 7 * DAY_MS, false));
    }

    #[test]
    fn a_working_hook_clears_the_record() {
        let mut store = SkipStore::default();
        store.record_failure(EXE, STAMP, DAY_MS);
        assert!(store.clear(EXE));
        assert!(!store.clear(EXE));
        assert!(!store.should_skip(EXE, STAMP, DAY_MS, true));
    }

    #[test]
    fn the_store_keeps_the_newest_200_failures() {
        let mut store = SkipStore::default();
        for i in 0..SKIP_STORE_MAX_ENTRIES as u64 + 5 {
            store.record_failure(&format!(r"c:\game{i}.exe"), STAMP, DAY_MS + i);
        }
        assert_eq!(store.entries.len(), SKIP_STORE_MAX_ENTRIES);
        assert!(!store.entries.contains_key(r"c:\game0.exe"));
        assert!(!store.entries.contains_key(r"c:\game4.exe"));
        assert!(store.entries.contains_key(r"c:\game5.exe"));
        assert!(store.entries.contains_key(r"c:\game204.exe"));
    }

    #[test]
    fn a_missing_or_corrupt_file_is_an_empty_store() {
        assert_eq!(parse_store(b""), SkipStore::default());
        assert_eq!(parse_store(b"not json {"), SkipStore::default());
        assert_eq!(parse_store(br#"{"entries":[1,2]}"#), SkipStore::default());
        let dir = std::env::temp_dir().join(format!("yap-hook-skips-{}", std::process::id()));
        assert_eq!(load_store(&dir.join("missing.json")), SkipStore::default());
    }

    #[test]
    fn the_store_survives_a_round_trip_through_the_file() {
        let dir = std::env::temp_dir().join(format!("yap-hook-skips-rt-{}", std::process::id()));
        let path = dir.join(SKIP_STORE_FILE);
        let mut store = SkipStore::default();
        store.record_failure(EXE, STAMP, DAY_MS);
        save_store(&path, &store).unwrap();
        assert!(!path.with_extension("json.tmp").exists());
        assert_eq!(load_store(&path), store);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keys_are_lowercase_paths() {
        assert_eq!(key(r"  C:\Games\Game.EXE "), r"c:\games\game.exe");
    }
}
