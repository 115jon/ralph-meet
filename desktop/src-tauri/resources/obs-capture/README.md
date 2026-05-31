# Owned_Capture_Component — project-owned game-capture artifacts (built from OBS `win-capture`)

This directory holds the **Owned_Capture_Component**: the project-owned
game-capture payload (Forked_Hook_DLL) and injector (Owned_Injector) that the
`game-capture-hook` Cargo feature ships alongside the `ralph-meet-desktop`
binary, **built from OBS Studio `win-capture` sources** under the project's
control. See the `owned-game-capture-hook` design — *License & Attribution* —
for the full GPLv2 rationale (Requirements 11.x, 12.x).

> **These binaries are GPLv2.** ralph-meet has been relicensed to be
> GPLv2-compatible so it may build/link from OBS `win-capture` sources. The
> Forked_Hook_DLL's single intended change from upstream is a **private IPC
> object namespace** (`RalphCaptureHook_` instead of OBS's `CaptureHook_`). The
> GPLv2 text (`LICENSE-GPLv2.txt`), attribution (`ATTRIBUTION.md`), and source
> offer (`SOURCE-OFFER.md`) ship with the component. The binary files are
> excluded from git (see the repo `.gitignore`); the GPLv2 text, attribution,
> and source offer ARE committed. A fresh checkout must (re)build/populate the
> binaries before a `game-capture-hook` build will pass the packaging guard.

## Required materials

The packaging guard in `build.rs` requires the following to exist in this
directory when the `game-capture-hook` feature is enabled (Requirement 11.4,
12.3, 12.6):

| File | Role | Built from (OBS `plugins/win-capture/`) |
| --- | --- | --- |
| `graphics-hook64.dll` | 64-bit Forked_Hook_DLL payload | `graphics-hook` (64-bit build) |
| `graphics-hook32.dll` | 32-bit Forked_Hook_DLL payload | `graphics-hook` (32-bit build) |
| `inject-helper64.exe` | 64-bit Owned_Injector | `inject-helper` (64-bit build) |
| `inject-helper32.exe` | 32-bit Owned_Injector | `inject-helper` (32-bit build) |
| `get-graphics-offsets64.exe` | 64-bit graphics-offsets helper | `get-graphics-offsets` (64-bit build) |
| `get-graphics-offsets32.exe` | 32-bit graphics-offsets helper | `get-graphics-offsets` (32-bit build) |
| `LICENSE-GPLv2.txt` | GPLv2 license text for the artifacts above | OBS `COPYING` |
| `ATTRIBUTION.md` | OBS Project attribution + pinned `win-capture` commit/tag | — |
| `SOURCE-OFFER.md` | GPLv2 source-availability + written offer (§3) | — |

The artifact file names are pinned in code as the `GRAPHICS_HOOK64` /
`GRAPHICS_HOOK32` / `INJECT_HELPER64` / `INJECT_HELPER32` /
`GET_GRAPHICS_OFFSETS64` / `GET_GRAPHICS_OFFSETS32` constants in
`src/game_capture/inject.rs`, and mirrored in the `build.rs` packaging guard. If
you change a name here, change it in both places too.

## Pinned upstream identifier

The OBS game-capture IPC protocol (named events, the `hook_info` shared-memory
struct layout, the keyed-mutex sharing mode) changes across OBS releases, so the
fork is pinned to a specific upstream identifier and treated as an **atomic,
version-locked** basis. Any re-pin is a deliberate, re-verified change (re-check
the `hook_info` layout + event names).

> **Pinned upstream identifier:** **OBS Studio 32.1.2** — tag `32.1.2`,
> commit `fb4d98b` (see `ATTRIBUTION.md` and `SOURCE-OFFER.md`).

## How to build / refresh the artifacts

The Forked_Hook_DLL and Owned_Injector are built from the OBS `win-capture`
sources at the pinned identifier with the project's `RalphCaptureHook_`
namespace modifications (CMake/MSVC + Microsoft Detours, 64- and 32-bit). The
build wiring lives in `fork/CMakeLists.txt` (a self-contained CMake project)
and is driven by `desktop/scripts/build-capture-fork.ps1`, which builds both
bitnesses and copies the six artifacts into this directory under the exact
names in the table above.

From `desktop/` (with the CEF build environment / MSVC toolchain on PATH):

```powershell
# Build both 64- and 32-bit, fetching + compiling Microsoft Detours from source
.\scripts\build-capture-fork.ps1 -FetchDetours

# …or point at a prebuilt Detours tree instead of fetching
.\scripts\build-capture-fork.ps1 -DetoursRoot C:\path\to\Detours
```

Microsoft Detours is required by `graphics-hook` (the win-capture hook detours
the target's Present). Supply it one of three ways: `-DetoursRoot <dir>` (a
prebuilt tree), `-FetchDetours` (clone + build Microsoft Detours v4.0.1 from
source — needs GitHub once), or an installed `find_package(Detours)` package on
`CMAKE_PREFIX_PATH`. Without Detours the two helper EXEs still build and the DLL
is skipped with a clear warning. The Vulkan present interception compiles only
when a Vulkan SDK is found (`find_package(Vulkan)`); when absent, the DLL still
builds the DX8/9/10/11/12 + OpenGL interception, which covers the DX11-first
validation path.

To refresh after a re-vendor:

1. Re-apply the Private_Namespace rename (see `fork/README.md`) if the OBS
   version was re-pinned.
2. Run `build-capture-fork.ps1` as above; it places the artifacts here using
   exactly the names in the table above.
3. If you re-pin the OBS version, update the pinned identifier in
   `ATTRIBUTION.md`, `SOURCE-OFFER.md`, **and** `desktop/THIRD_PARTY_LICENSES.md`,
   and re-verify the `hook_info` layout / event names in
   `src/game_capture/obs_ipc.rs`.

## Packaging guard (Requirements 11.4, 12.6)

`build.rs` contains a guard that runs **only** when the `game-capture-hook`
feature is enabled (gated on the `CARGO_FEATURE_GAME_CAPTURE_HOOK` env var Cargo
sets for the feature). When enabled, the guard verifies that every required
artifact plus the GPLv2 license, attribution, and source-offer materials exist
here, and **fails the build** if any is missing — so packaging can never
silently produce a `game-capture-hook` package without the complete
Owned_Capture_Component and its GPLv2 materials.

When the feature is **off** (the default), the guard is inert: the desktop app
builds and runs with WGC capture only (Requirement 12.5).
