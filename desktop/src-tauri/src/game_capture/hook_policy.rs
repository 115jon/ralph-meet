//! Which hook build a share injects, decided before any injection. Pure.
//!
//! The default is OBS Studio's own signed hook for every eligible window:
//! unprotected games, and games protected by a user-mode anti-cheat (Easy
//! Anti-Cheat, BattlEye), which allow the OBS-signed hook for OBS and other
//! streaming apps. Kernel anti-cheats (Vanguard, FACEIT) and VAC are on the
//! executable blocklist and never reach this decision. Our unsigned fork is
//! used only when a developer asks for it, and never in a protected game.

use std::collections::HashSet;
use std::sync::Mutex;

use crate::game_capture::obs_ipc::HookFlavor;
use crate::game_capture::FallbackReason;

/// Facts about one target, resolved by the session from the live system.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FlavorInputs {
    /// An Easy Anti-Cheat or BattlEye install marker sits beside the game.
    pub protected: bool,
    /// A hook attempt on this protected executable already failed this run.
    pub protected_attempt_failed: bool,
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
/// 1. Protected and an attempt already failed this run: skip. The host never
///    retries against an anti-cheat in a loop.
/// 2. Protected, or the fork was not requested: the OBS-signed hook. Never the
///    fork in a protected game. If another host is driving a stock hook in the
///    target, skip: two hosts would fight over one `hook_info`.
/// 3. Otherwise (unprotected, fork requested): the fork. Its private object
///    names do not collide with OBS's, so it may coexist with OBS.
pub fn choose_flavor(inp: &FlavorInputs) -> FlavorChoice {
    if inp.protected && inp.protected_attempt_failed {
        return FlavorChoice::Skip(FallbackReason::HookAttemptSpent);
    }
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

/// Protected executables whose hook attempt failed this run, by normalized
/// path. A failure is remembered until the app restarts.
static FAILED_PROTECTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn key(exe: &str) -> String {
    exe.trim().to_ascii_lowercase()
}

pub fn protected_attempt_failed(exe: &str) -> bool {
    FAILED_PROTECTED
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        .is_some_and(|set| set.contains(&key(exe)))
}

pub fn record_protected_failure(exe: &str) {
    let mut guard = FAILED_PROTECTED.lock().unwrap_or_else(|p| p.into_inner());
    guard.get_or_insert_with(HashSet::new).insert(key(exe));
    log::info!(
        "[HookPolicy] hook attempt on protected {exe} failed; not trying it again until the app \
         restarts"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: FlavorInputs = FlavorInputs {
        protected: false,
        protected_attempt_failed: false,
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

    #[test]
    fn a_protected_game_gets_one_attempt_per_run() {
        let inp = FlavorInputs {
            protected: true,
            protected_attempt_failed: true,
            ..BASE
        };
        assert_eq!(
            choose_flavor(&inp),
            FlavorChoice::Skip(FallbackReason::HookAttemptSpent)
        );
        // An unprotected game is not limited.
        let inp = FlavorInputs {
            protected_attempt_failed: true,
            ..BASE
        };
        assert_eq!(
            choose_flavor(&inp),
            FlavorChoice::Use(HookFlavor::ObsSigned)
        );
    }

    #[test]
    fn failures_are_remembered_by_path_case_insensitively() {
        let exe = r"C:\Games\Remembered\Game-Win64-Shipping.exe";
        assert!(!protected_attempt_failed(exe));
        record_protected_failure(exe);
        assert!(protected_attempt_failed(&exe.to_uppercase()));
    }
}
