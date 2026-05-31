//! Unit test for the seeded anti-cheat `Process_Blocklist` contents.
//!
//! Validates: Requirements 10.1
//!   - 10.1: the Native_Share_Pipeline maintains a Process_Blocklist of
//!           Anti_Cheat-protected process identities for which hook injection is
//!           never attempted.
//!
//! This asserts that `default_blocklist()` ships seeded with at least one
//! representative executable from each of the three major anti-cheats in use
//! today — Easy Anti-Cheat (EAC), BattlEye, and Riot Vanguard — so the safety
//! gate denies those titles out of the box. Presence is asserted through the
//! public API (`default_blocklist()` + `ProcessIdentity::matches`) using
//! case-insensitive matching, so the test pins the *behavioural contract* (a
//! given anti-cheat executable is covered) rather than the exact string
//! spelling of any single seed entry.
//!
//! The decision logic is pure and GPU-/OS-independent, so this runs in CI
//! without hardware, a live game, or any anti-cheat software.
//!
//! NOTE: This is an integration-test crate, so the `blocklist` module must be
//! reachable as `app_lib::game_capture::blocklist` (it is declared
//! `pub mod blocklist` behind `#[cfg(feature = "game-capture-hook")]` in
//! `game_capture/mod.rs`). Run with:
//!   cargo test --features game-capture-hook --test blocklist_defaults

#![cfg(feature = "game-capture-hook")]

use app_lib::game_capture::blocklist::{default_blocklist, ProcessIdentity};

/// Case-insensitive presence check through the public API: does any seeded
/// identity match the given executable name?
fn blocklist_covers(blocklist: &[ProcessIdentity], exe: &str) -> bool {
    blocklist.iter().any(|id| id.matches(exe))
}

/// The seeded blocklist must be non-empty — an empty default would silently
/// disable the anti-cheat safety gate (Req 10.1).
#[test]
fn default_blocklist_is_non_empty() {
    let blocklist = default_blocklist();
    assert!(
        !blocklist.is_empty(),
        "the default Process_Blocklist must seed at least one anti-cheat title (Req 10.1)"
    );
}

/// EAC: the Easy Anti-Cheat service executable must be covered (Req 10.1).
#[test]
fn default_blocklist_covers_easy_anti_cheat() {
    let blocklist = default_blocklist();
    assert!(
        blocklist_covers(&blocklist, "EasyAntiCheat.exe"),
        "default blocklist must cover Easy Anti-Cheat (EasyAntiCheat.exe) (Req 10.1)"
    );
}

/// BattlEye: the BattlEye service executable must be covered (Req 10.1).
#[test]
fn default_blocklist_covers_battleye() {
    let blocklist = default_blocklist();
    assert!(
        blocklist_covers(&blocklist, "BEService.exe"),
        "default blocklist must cover BattlEye (BEService.exe) (Req 10.1)"
    );
}

/// Riot Vanguard: both the Vanguard component (`vgc.exe`) and the protected
/// title it guards (`valorant.exe`) must be covered (Req 10.1).
#[test]
fn default_blocklist_covers_riot_vanguard() {
    let blocklist = default_blocklist();
    assert!(
        blocklist_covers(&blocklist, "vgc.exe"),
        "default blocklist must cover the Riot Vanguard component (vgc.exe) (Req 10.1)"
    );
    assert!(
        blocklist_covers(&blocklist, "valorant.exe"),
        "default blocklist must cover the Vanguard-protected title (valorant.exe) (Req 10.1)"
    );
}

/// The seed covers all three anti-cheats together, and matching is
/// case-insensitive and path-robust — proving the gate works regardless of how
/// the target executable name is reported by the OS (Req 10.1).
#[test]
fn default_blocklist_covers_all_three_anti_cheats_case_insensitively() {
    let blocklist = default_blocklist();

    // Mixed case + full paths, the way an OS-reported target might arrive.
    let eac = blocklist_covers(&blocklist, r"D:\Steam\steamapps\common\Game\EASYANTICHEAT.EXE");
    let battleye = blocklist_covers(&blocklist, r"C:\Program Files\BattlEye\beservice.exe");
    let vanguard = blocklist_covers(&blocklist, r"C:\Riot Games\VALORANT\live\VALORANT.exe");

    assert!(eac, "EAC must be covered case-insensitively / by full path (Req 10.1)");
    assert!(
        battleye,
        "BattlEye must be covered case-insensitively / by full path (Req 10.1)"
    );
    assert!(
        vanguard,
        "Riot Vanguard must be covered case-insensitively / by full path (Req 10.1)"
    );
}
