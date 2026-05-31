//! Property-based test for Private_Namespace IPC object-name privacy and
//! disjointness from the OBS `CaptureHook_*` namespace.
//!
//! Feature: owned-game-capture-hook, Property 1: Every IPC object name is
//! private and disjoint from the OBS namespace
//!
//! Validates: Requirements 2.1, 2.2, 2.3, 3.1
//!
//! The names under test are produced by the real `Host_IPC_Reader` name
//! constructors in `app_lib::game_capture::obs_ipc`:
//!   - the per-target builder `target_object_name(base, pid)` over every
//!     Private_Namespace base constant (the five capture events
//!     restart/stop/hook-ready/exit/initialize, the keepalive mutex, both
//!     texture-access mutexes, the `hook_info` mapping, the named pipe), and
//!   - the shtex builder `shtex_mapping_name(root_window, map_id)` for the
//!     `SHMEM_TEXTURE` mapping, plus
//!   - the (non-PID-suffixed) duplicate-injection guard constant
//!     `DUP_GUARD_MUTEX`.
//!
//! For every object kind in that complete set and every per-target key (any
//! PID, and for the shtex mapping any root-window value and `map_id`), the
//! constructed name MUST (1) begin with the single fixed non-empty
//! `PRIVATE_NS` prefix, (2) NOT begin with the OBS `CaptureHook_` prefix, and
//! (3) NOT equal the OBS name built for the same object kind and per-target
//! key. Disjointness is asserted by independently constructing the equivalent
//! OBS `CaptureHook_*` name for the same kind+key and asserting inequality.
//!
//! Because the only visible change from upstream OBS is the object-name prefix
//! while the per-target key (PID, root-window, `map_id`) is identical, equality
//! could only fail to be ruled out if the prefixes were not disjoint — which is
//! exactly the invariant Requirement 2.1 fixes (`PRIVATE_NS` is non-empty and
//! does not start with `CaptureHook_`).
//!
//! NOTE: This is an integration-test crate, so the constructors must be
//! reachable as `app_lib::game_capture::obs_ipc::*` — that module is declared
//! `pub mod obs_ipc` behind `#[cfg(feature = "game-capture-hook")]` (on top of
//! `native-screen-share`) in `game_capture/mod.rs`. Run with:
//!   cargo test --features game-capture-hook --test prop_obs_ipc_names

#![cfg(feature = "game-capture-hook")]

use app_lib::game_capture::obs_ipc::{
    is_private_namespace, shtex_mapping_name, target_object_name, DUP_GUARD_MUTEX,
    EVENT_CAPTURE_RESTART, EVENT_CAPTURE_STOP, EVENT_HOOK_EXIT, EVENT_HOOK_INIT, EVENT_HOOK_READY,
    MUTEX_TEXTURE1, MUTEX_TEXTURE2, OBS_NS, PIPE_NAME, PRIVATE_NS, SHMEM_HOOK_INFO,
    WINDOW_HOOK_KEEPALIVE,
};
use proptest::prelude::*;

/// A per-target IPC object kind: one whose name is `base + <pid>`. Each variant
/// carries both the project's Private_Namespace base constant (the value the
/// host actually uses) and the upstream OBS base literal for the SAME object,
/// so the test compares like-for-like keyed names. The OBS literals are the
/// real OBS 32.1.2 `graphics-hook-info.h` macro values (`CaptureHook_<suffix>`).
#[derive(Clone, Copy, Debug)]
enum PerTargetKind {
    Restart,
    Stop,
    HookReady,
    Exit,
    Initialize,
    KeepAlive,
    TextureMutex1,
    TextureMutex2,
    HookInfo,
    Pipe,
}

impl PerTargetKind {
    /// The complete set of per-target kinds (used to drive an exhaustive
    /// strategy so every object kind is covered, not merely sampled).
    const ALL: [PerTargetKind; 10] = [
        PerTargetKind::Restart,
        PerTargetKind::Stop,
        PerTargetKind::HookReady,
        PerTargetKind::Exit,
        PerTargetKind::Initialize,
        PerTargetKind::KeepAlive,
        PerTargetKind::TextureMutex1,
        PerTargetKind::TextureMutex2,
        PerTargetKind::HookInfo,
        PerTargetKind::Pipe,
    ];

    /// The Private_Namespace base constant the `Host_IPC_Reader` uses.
    fn private_base(self) -> &'static str {
        match self {
            PerTargetKind::Restart => EVENT_CAPTURE_RESTART,
            PerTargetKind::Stop => EVENT_CAPTURE_STOP,
            PerTargetKind::HookReady => EVENT_HOOK_READY,
            PerTargetKind::Exit => EVENT_HOOK_EXIT,
            PerTargetKind::Initialize => EVENT_HOOK_INIT,
            PerTargetKind::KeepAlive => WINDOW_HOOK_KEEPALIVE,
            PerTargetKind::TextureMutex1 => MUTEX_TEXTURE1,
            PerTargetKind::TextureMutex2 => MUTEX_TEXTURE2,
            PerTargetKind::HookInfo => SHMEM_HOOK_INFO,
            PerTargetKind::Pipe => PIPE_NAME,
        }
    }

    /// The upstream OBS base literal for the same object kind. Independent of
    /// the project constants so the disjointness check cannot be tautological.
    fn obs_base(self) -> &'static str {
        match self {
            PerTargetKind::Restart => "CaptureHook_Restart",
            PerTargetKind::Stop => "CaptureHook_Stop",
            PerTargetKind::HookReady => "CaptureHook_HookReady",
            PerTargetKind::Exit => "CaptureHook_Exit",
            PerTargetKind::Initialize => "CaptureHook_Initialize",
            PerTargetKind::KeepAlive => "CaptureHook_KeepAlive",
            PerTargetKind::TextureMutex1 => "CaptureHook_TextureMutex1",
            PerTargetKind::TextureMutex2 => "CaptureHook_TextureMutex2",
            PerTargetKind::HookInfo => "CaptureHook_HookInfo",
            PerTargetKind::Pipe => "CaptureHook_Pipe",
        }
    }
}

/// One IPC object instance to check: a per-target object keyed by PID, the
/// shtex mapping keyed by `(root_window, map_id)`, or the (non-PID-suffixed)
/// duplicate-injection guard. This covers the COMPLETE object set Property 1
/// enumerates.
#[derive(Clone, Debug)]
enum IpcObject {
    PerTarget { kind: PerTargetKind, pid: u32 },
    Shtex { root_window: u64, map_id: u32 },
    DupGuard,
}

impl IpcObject {
    /// The name the `Host_IPC_Reader` constructs for this object (real code).
    fn private_name(&self) -> String {
        match *self {
            IpcObject::PerTarget { kind, pid } => target_object_name(kind.private_base(), pid),
            IpcObject::Shtex { root_window, map_id } => shtex_mapping_name(root_window, map_id),
            IpcObject::DupGuard => DUP_GUARD_MUTEX.to_string(),
        }
    }

    /// The equivalent upstream OBS name for the SAME object kind and per-target
    /// key — built independently of the project constants. The shtex format
    /// mirrors `graphics-hook.c::init_shared_info` (`SHMEM_TEXTURE
    /// "_%PRIu64_%u"`); the dup-guard literal is OBS's `graphics_hook_dup_mutex`.
    fn obs_name(&self) -> String {
        match *self {
            IpcObject::PerTarget { kind, pid } => target_object_name(kind.obs_base(), pid),
            IpcObject::Shtex { root_window, map_id } => {
                format!("CaptureHook_Texture_{root_window}_{map_id}")
            }
            IpcObject::DupGuard => "graphics_hook_dup_mutex".to_string(),
        }
    }
}

/// Full-range `u32` PID with the extremes (`0`, `u32::MAX`) over-sampled so the
/// per-target name is exercised at its key boundaries, not only mid-range.
fn pid_strategy() -> impl Strategy<Value = u32> {
    prop_oneof![
        1 => Just(0u32),
        1 => Just(u32::MAX),
        8 => any::<u32>(),
    ]
}

/// Full-range `u64` root-window value with the extremes over-sampled.
fn root_window_strategy() -> impl Strategy<Value = u64> {
    prop_oneof![
        1 => Just(0u64),
        1 => Just(u64::MAX),
        8 => any::<u64>(),
    ]
}

/// Full-range `u32` `map_id` with the extremes over-sampled.
fn map_id_strategy() -> impl Strategy<Value = u32> {
    prop_oneof![
        1 => Just(0u32),
        1 => Just(u32::MAX),
        8 => any::<u32>(),
    ]
}

/// Strategy over the COMPLETE IPC object set: every per-target kind keyed by an
/// arbitrary PID, the shtex mapping keyed by arbitrary `(root_window, map_id)`,
/// and the duplicate-injection guard.
fn ipc_object_strategy() -> impl Strategy<Value = IpcObject> {
    let per_target = (
        prop::sample::select(PerTargetKind::ALL.to_vec()),
        pid_strategy(),
    )
        .prop_map(|(kind, pid)| IpcObject::PerTarget { kind, pid });

    let shtex = (root_window_strategy(), map_id_strategy())
        .prop_map(|(root_window, map_id)| IpcObject::Shtex { root_window, map_id });

    prop_oneof![
        // Per-target objects are the bulk of the namespace, so weight them
        // highest; shtex and the dup-guard are still sampled heavily across
        // 1024 cases.
        10 => per_target,
        4 => shtex,
        1 => Just(IpcObject::DupGuard),
    ]
}

proptest! {
    // Property 1 requires a minimum of 100 iterations; 1024 covers the
    // (kind x key) space — including the over-sampled PID / root-window /
    // map_id extremes — well above the floor.
    #![proptest_config(ProptestConfig::with_cases(1024))]

    /// Feature: owned-game-capture-hook, Property 1: Every IPC object name is
    /// private and disjoint from the OBS namespace.
    ///
    /// For any IPC object kind in the complete set and any per-target key, the
    /// name the `Host_IPC_Reader` constructs (1) begins with the fixed,
    /// non-empty `PRIVATE_NS` prefix, (2) does not begin with the OBS
    /// `CaptureHook_` prefix, and (3) is not equal to the OBS `CaptureHook_*`
    /// name built from the same object kind and per-target key.
    ///
    /// Validates: Requirements 2.1, 2.2, 2.3, 3.1
    #[test]
    fn every_ipc_object_name_is_private_and_disjoint_from_obs(
        object in ipc_object_strategy(),
    ) {
        let private = object.private_name();
        let obs = object.obs_name();

        // (1) Begins with the single fixed, non-empty Private_Namespace prefix
        // (Req 2.1, 2.2). PRIVATE_NS is fixed and non-empty by construction.
        // NOTE: `prop_assert!`/`prop_assert_ne!` expand through `concat!`, which
        // forbids inline format-arg capture, so messages use positional args.
        prop_assert!(!PRIVATE_NS.is_empty(), "PRIVATE_NS must be non-empty");
        prop_assert!(
            private.starts_with(PRIVATE_NS),
            "name {:?} must begin with the Private_Namespace prefix {:?}",
            private,
            PRIVATE_NS
        );

        // (2) Does not begin with the OBS `CaptureHook_` prefix (Req 2.1, 3.1).
        prop_assert!(
            !private.starts_with(OBS_NS),
            "name {:?} must not begin with the OBS prefix {:?}",
            private,
            OBS_NS
        );

        // (1)+(2) combined is exactly the host's disjointness predicate.
        prop_assert!(
            is_private_namespace(&private),
            "is_private_namespace({:?}) must hold for every constructed name",
            private
        );

        // (3) Is not equal to the OBS name for the same object kind + per-target
        // key (Req 2.1, 2.3, 3.1). This is the core coexistence invariant: for
        // the same target the two name sets are disjoint.
        prop_assert_ne!(
            &private,
            &obs,
            "private name {:?} must never equal the OBS name {:?} for the same kind+key",
            private,
            obs
        );

        // The OBS comparison name really is an OBS-namespace name (or OBS's
        // literal dup-guard), confirming the disjointness check is meaningful
        // and not comparing against another private name.
        prop_assert!(
            obs.starts_with(OBS_NS) || obs == "graphics_hook_dup_mutex",
            "the comparison name {:?} must be a genuine OBS name",
            obs
        );
    }
}

/// A focused, non-property check pinning the per-target key boundaries and the
/// shtex/dup-guard shapes with concrete, named values — complements the
/// property with explicit edge cases an audit can read at a glance.
#[test]
fn concrete_names_are_private_and_distinct_from_obs() {
    // Per-target events/mutexes/mappings at PID boundaries.
    for kind in PerTargetKind::ALL {
        for pid in [0u32, 1, 4321, u32::MAX] {
            let private = target_object_name(kind.private_base(), pid);
            let obs = target_object_name(kind.obs_base(), pid);
            assert!(private.starts_with(PRIVATE_NS), "{private} lacks the private prefix");
            assert!(!private.starts_with(OBS_NS), "{private} is an OBS name");
            assert!(is_private_namespace(&private), "{private} not private");
            assert_ne!(private, obs, "{private} collides with OBS {obs}");
        }
    }

    // Shtex mapping at key boundaries.
    for (rw, map) in [(0u64, 0u32), (0x1234, 5), (u64::MAX, u32::MAX)] {
        let private = shtex_mapping_name(rw, map);
        let obs = format!("CaptureHook_Texture_{rw}_{map}");
        assert!(private.starts_with(PRIVATE_NS));
        assert!(!private.starts_with(OBS_NS));
        assert!(is_private_namespace(&private));
        assert_ne!(private, obs);
    }

    // Duplicate-injection guard (not PID-suffixed).
    assert!(DUP_GUARD_MUTEX.starts_with(PRIVATE_NS));
    assert!(!DUP_GUARD_MUTEX.starts_with(OBS_NS));
    assert!(is_private_namespace(DUP_GUARD_MUTEX));
    assert_ne!(DUP_GUARD_MUTEX, "graphics_hook_dup_mutex");
}
