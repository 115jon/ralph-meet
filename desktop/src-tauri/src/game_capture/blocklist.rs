//! Anti-cheat safety gate — `Process_Blocklist` / `Process_Allowlist` matching.
//!
//! This module hosts the pure safety decision that runs *before* any injection
//! is ever attempted, so an anti-cheat-protected title is never injected
//! (Requirement 10.1, 10.2) and an operator-configured allowlist is enforced
//! (Requirement 10.3).
//!
//! The decision is GPU-/OS-independent and total: every input resolves to a
//! [`SafetyDecision`], so it can be exhaustively property-tested without
//! hardware, a live game, or any anti-cheat software (Property 10).
//!
//! # Matching
//!
//! Identities are matched against a target's executable **name**,
//! case-insensitively. Matching is robust to a full path being passed for the
//! target: only the final path component (after any `/` or `\` separator) is
//! compared. The blocklist takes precedence over the allowlist — a target that
//! somehow appears on both is denied — because skipping a protected title is
//! always the safe choice (Requirement 10.2).

use crate::game_capture::{FallbackReason, SafetyDecision};

/// One identity in the `Process_Blocklist` / `Process_Allowlist`.
///
/// Matched against a target's executable name (case-insensitive). The design
/// leaves the door open to also match signer/path at implementation time; for
/// now the executable name is the single, simple key, which keeps the decision
/// pure and exhaustively testable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessIdentity {
    /// The executable name to match, e.g. `"EasyAntiCheat.exe"`. Compared
    /// case-insensitively against the final path component of the target.
    pub exe_name: String,
}

impl ProcessIdentity {
    /// Construct an identity from anything string-like.
    pub fn new(exe_name: impl Into<String>) -> Self {
        Self {
            exe_name: exe_name.into(),
        }
    }

    /// Whether this identity matches the given target executable.
    ///
    /// The comparison is case-insensitive and considers only the final path
    /// component of both sides, so `"C:\\Games\\Foo\\valorant.exe"` matches an
    /// identity of `"VALORANT.exe"`.
    pub fn matches(&self, target_exe: &str) -> bool {
        normalize_exe(&self.exe_name) == normalize_exe(target_exe)
    }
}

/// Normalize an executable name for comparison: take the final path component
/// (handling both `/` and `\` separators), trim surrounding whitespace, and
/// lowercase it. This is intentionally allocation-light and total — an empty or
/// separator-only input normalizes to an empty string.
fn normalize_exe(name: &str) -> String {
    let trimmed = name.trim();
    let base = trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .trim();
    base.to_ascii_lowercase()
}

/// Executables that are always blocklisted because they belong to, or are
/// protected by, a kernel/user-mode anti-cheat that can ban users or crash a
/// hooked game (Requirement 10.1).
///
/// Seeded with the three major anti-cheats in use today:
/// - **Easy Anti-Cheat (EAC / EOS)** — the service and protected-launch shims.
/// - **BattlEye** — the `BEService` / `BEClient` service and client executables.
/// - **Riot Vanguard** — the `vgc` / `vgtray` components and VALORANT itself.
///
/// This is the *data* behind [`default_blocklist`]; keeping it as a flat slice
/// makes the set trivial to grow as new protected titles are identified.
const DEFAULT_BLOCKLIST_EXECUTABLES: &[&str] = &[
    // ── Easy Anti-Cheat (EAC) ────────────────────────────────────────────
    "EasyAntiCheat.exe",
    "EasyAntiCheat_EOS.exe",
    "easyanticheat_x64.exe",
    // EAC's protected-launch shim that spawns the real game under EAC.
    "start_protected_game.exe",
    // ── BattlEye ──────────────────────────────────────────────────────────
    "BEService.exe",
    "BEService_x64.exe",
    "BEClient.exe",
    "BEClient_x64.exe",
    // ── Riot Vanguard ───────────────────────────────────────────────────--
    "vgc.exe",
    "vgtray.exe",
    "valorant.exe",
    "VALORANT-Win64-Shipping.exe",
];

/// The default `Process_Blocklist` of anti-cheat-protected executables for
/// which hook injection is never attempted (Requirement 10.1).
///
/// Data-driven from [`DEFAULT_BLOCKLIST_EXECUTABLES`] so the set can grow
/// without touching the decision logic. Returned as an owned `Vec` so callers
/// can extend it at runtime (e.g. from user configuration) before handing it to
/// [`safety_decision`].
pub fn default_blocklist() -> Vec<ProcessIdentity> {
    DEFAULT_BLOCKLIST_EXECUTABLES
        .iter()
        .map(|name| ProcessIdentity::new(*name))
        .collect()
}

/// The pure anti-cheat safety decision: may we attempt injection into
/// `target_exe`? (Requirement 10.2, 10.3.)
///
/// The rule, in order:
/// 1. **Blocklisted** — if the target matches any entry in `blocklist`, return
///    [`SafetyDecision::Deny`]`(`[`FallbackReason::Blocklisted`]`)`. The
///    blocklist is checked first so a protected title is never injected even if
///    it also appears on the allowlist (Requirement 10.2).
/// 2. **Not allowlisted** — if `allowlist` is non-empty and the target matches
///    none of its entries, return [`SafetyDecision::Deny`]`(`
///    [`FallbackReason::NotAllowlisted`]`)` (Requirement 10.3).
/// 3. Otherwise — return [`SafetyDecision::Allow`]. An **empty** allowlist means
///    "allowlist not configured", i.e. allow any not-blocklisted target.
///
/// This function performs no I/O and is total over all inputs, so it is the
/// target of Property 10 and runs in CI without hardware.
///
/// Validates: Requirements 10.1, 10.2, 10.3.
pub fn safety_decision(
    target_exe: &str,
    blocklist: &[ProcessIdentity],
    allowlist: &[ProcessIdentity],
) -> SafetyDecision {
    // (1) The blocklist always wins — skipping a protected title is the safe
    //     choice, and this also makes the blocklist override a later reported
    //     injection success (Req 10.2, 10.6).
    if blocklist.iter().any(|id| id.matches(target_exe)) {
        return SafetyDecision::Deny(FallbackReason::Blocklisted);
    }

    // (2) A configured (non-empty) allowlist restricts injection to its members
    //     only (Req 10.3). An empty allowlist is "not configured" and allows
    //     any not-blocklisted target.
    if !allowlist.is_empty() && !allowlist.iter().any(|id| id.matches(target_exe)) {
        return SafetyDecision::Deny(FallbackReason::NotAllowlisted);
    }

    // (3) Not blocklisted, and either the allowlist is unconfigured or matched.
    SafetyDecision::Allow
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_path_and_lowercases() {
        assert_eq!(normalize_exe("VALORANT.exe"), "valorant.exe");
        assert_eq!(normalize_exe(r"C:\Games\Foo\valorant.exe"), "valorant.exe");
        assert_eq!(normalize_exe("/usr/local/bin/Game.EXE"), "game.exe");
        assert_eq!(normalize_exe("  BEService.exe  "), "beservice.exe");
        assert_eq!(normalize_exe(""), "");
    }

    #[test]
    fn identity_matches_case_insensitively() {
        let id = ProcessIdentity::new("EasyAntiCheat.exe");
        assert!(id.matches("easyanticheat.exe"));
        assert!(id.matches("EASYANTICHEAT.EXE"));
        assert!(id.matches(r"D:\steam\EasyAntiCheat.exe"));
        assert!(!id.matches("notepad.exe"));
    }

    #[test]
    fn default_blocklist_is_non_empty_and_covers_three_anti_cheats() {
        let blocklist = default_blocklist();
        assert!(!blocklist.is_empty());

        let has = |needle: &str| blocklist.iter().any(|id| id.matches(needle));
        // EAC
        assert!(has("EasyAntiCheat.exe"));
        // BattlEye
        assert!(has("BEService.exe"));
        // Riot Vanguard
        assert!(has("vgc.exe"));
        assert!(has("valorant.exe"));
    }

    #[test]
    fn blocklisted_target_is_denied() {
        let blocklist = default_blocklist();
        let decision = safety_decision("EasyAntiCheat.exe", &blocklist, &[]);
        assert_eq!(decision, SafetyDecision::Deny(FallbackReason::Blocklisted));
    }

    #[test]
    fn blocklist_match_is_case_insensitive_and_path_robust() {
        let blocklist = default_blocklist();
        let decision = safety_decision(r"C:\Riot Games\VALORANT\live\VALORANT.exe", &blocklist, &[]);
        assert_eq!(decision, SafetyDecision::Deny(FallbackReason::Blocklisted));
    }

    #[test]
    fn empty_allowlist_allows_any_non_blocklisted_target() {
        let blocklist = default_blocklist();
        let decision = safety_decision("my_game.exe", &blocklist, &[]);
        assert_eq!(decision, SafetyDecision::Allow);
    }

    #[test]
    fn non_empty_allowlist_denies_unlisted_target() {
        let allowlist = vec![ProcessIdentity::new("approved_game.exe")];
        let decision = safety_decision("other_game.exe", &[], &allowlist);
        assert_eq!(decision, SafetyDecision::Deny(FallbackReason::NotAllowlisted));
    }

    #[test]
    fn non_empty_allowlist_allows_listed_target() {
        let allowlist = vec![ProcessIdentity::new("approved_game.exe")];
        let decision = safety_decision("APPROVED_GAME.EXE", &[], &allowlist);
        assert_eq!(decision, SafetyDecision::Allow);
    }

    #[test]
    fn blocklist_takes_precedence_over_allowlist() {
        // A target on both lists is denied as blocklisted — safety first.
        let blocklist = vec![ProcessIdentity::new("game.exe")];
        let allowlist = vec![ProcessIdentity::new("game.exe")];
        let decision = safety_decision("game.exe", &blocklist, &allowlist);
        assert_eq!(decision, SafetyDecision::Deny(FallbackReason::Blocklisted));
    }
}
