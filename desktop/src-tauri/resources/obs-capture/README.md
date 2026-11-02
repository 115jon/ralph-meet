# Game-capture component

The `game-capture-hook` feature ships **OBS Studio's own game-capture files**,
unmodified and signed by the OBS Project, in `obs-signed/`:
`graphics-hook{64,32}.dll`, `inject-helper{64,32}.exe` and
`get-graphics-offsets{64,32}.exe` from the OBS Studio 33.0.1 release. They are
pinned by `desktop/packaging/obs-signed-hook.lock.json` and fetched (not
committed) by:

```powershell
.\desktop\scripts\fetch-obs-signed-hook.ps1
```

The script downloads the official release zip, checks its SHA-256, extracts the
six files, and checks each file's SHA-256, Authenticode signature, signer
("OBS Project, LLC"), certificate thumbprint and file version against the lock.
The app checks hash and signature again before every injection, then stages the
set to `%LOCALAPPDATA%\RalphMeet\capture-hook\obs-<ver>-<sha8>\` (the stock DLL
stays loaded in a game until it exits). **Never modify or re-sign these files**:
a changed byte voids the signature anti-cheat vendors allowlist. See
`docs/desktop/signed-capture-hook.md`.

## Required materials

The packaging guard in `build.rs` requires these when the feature is enabled:

| File | Role |
| --- | --- |
| `obs-signed/graphics-hook64.dll`, `obs-signed/graphics-hook32.dll` | OBS-signed hook payloads |
| `obs-signed/inject-helper64.exe`, `obs-signed/inject-helper32.exe` | OBS-signed injectors |
| `obs-signed/get-graphics-offsets64.exe`, `obs-signed/get-graphics-offsets32.exe` | OBS-signed offset helpers |
| `LICENSE-GPLv2.txt` | GPLv2 text |
| `ATTRIBUTION.md` | OBS Project attribution and pinned release |
| `SOURCE-OFFER.md` | GPLv2 source availability and written offer |

## Development-only fork

`fork/` is a modified build of OBS 32.1.2's `win-capture` (private
`RalphCaptureHook_` object names, a present counter, self-unload, diagnostics).
It is unsigned and not shipped. To use it locally, build it into this directory
and set `RALPH_CAPTURE_HOOK_FLAVOR=own`; the host never uses it in an
anti-cheat-protected game. The rest of this file describes that build.

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
