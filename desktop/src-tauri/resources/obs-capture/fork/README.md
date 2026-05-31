# Forked_Hook_DLL source — vendored OBS `win-capture` (Private_Namespace fork)

This directory holds the **vendored, owned source** the project builds its
`Forked_Hook_DLL` (and `Owned_Injector` helpers) from, per the
`owned-game-capture-hook` spec. It replaces the prior model of shipping a
prebuilt, unmodified OBS `graphics-hook` binary (Requirement 1.1): the payload
is now built from these sources under the project's control (GPLv2).

> **GPLv2.** These sources are OBS Studio's `win-capture` plugin and the shared
> code it links, licensed under the GNU General Public License v2.0. See
> `../LICENSE-GPLv2.txt` and `../ATTRIBUTION.md`. The build artifacts produced
> from this tree are likewise GPLv2.

## Pinned upstream provenance

The tree is vendored verbatim from OBS Studio at a single pinned point. Any
upgrade is a deliberate, re-verified change (re-check object names + the
`hook_info` ABI against the new tag).

| Field | Value |
| --- | --- |
| Upstream | <https://github.com/obsproject/obs-studio> |
| Tag | `32.1.2` |
| Annotated tag object | `c17423ce05899ecb93f678601b3feaa8a469b180` |
| Commit (peeled `^{}`) | `fb4d98bf88fae5fc85cb11fc57f7c5e309282194` |

This matches the OBS version the host IPC reader (`src/game_capture/obs_ipc.rs`)
and `PROTOCOL-NOTES.md` are pinned and verified against (32.1.2, `fb4d98b`).

## Layout

The tree preserves the **upstream repo-relative paths** so every `#include
"../…"` and every `${CMAKE_SOURCE_DIR}/shared/…` reference resolves exactly as
it does upstream (no edits to includes were needed):

```
fork/
  CMakeLists.txt                       # self-contained build wiring (task 1.2) →
                                       #   graphics-hook / inject-helper /
                                       #   get-graphics-offsets, 64- and 32-bit
  cmake/detours.cmake                  # Microsoft Detours resolution
                                       #   (-DDETOURS_ROOT / find_package / fetch)
  plugins/win-capture/                 # the win-capture plugin (graphics-hook,
                                       #   inject-helper, get-graphics-offsets, …)
  shared/obs-hook-config/              # graphics-hook-info.h (object names + ABI),
                                       #   hook-helpers.h, graphics-hook-ver.h
  shared/obs-d3d8-api/                 # d3d8 API headers the offsets/hook use
  shared/obs-inject-library/           # inject-library used by inject-helper
  shared/ipc-util/                     # ipc-util pipe used by the hook
  libobs/util/c99defs.h                # OBS C99/MSVC support header (pulled in
                                       #   relatively by obfuscate.h)
  libobs/util/windows/                 # obfuscate.* and Win32 helpers the hook links
```

Vendored as source only — no compiled `.dll`/`.exe`/`.pdb`/`.lib` are committed
here. The build wiring that compiles this tree into the 64-bit and 32-bit
artifacts is `fork/CMakeLists.txt` (a standalone CMake project that does not
depend on the OBS monorepo build system) plus the driver
`desktop/scripts/build-capture-fork.ps1`. The original per-component OBS
`CMakeLists.txt` files are kept verbatim under each subdirectory for audit and
re-vendoring, but they require the OBS build system and are NOT used by the
standalone build.

### Building

From `desktop/` with the MSVC / CEF build environment active:

```powershell
.\scripts\build-capture-fork.ps1 -FetchDetours          # both bitnesses
.\scripts\build-capture-fork.ps1 -Arch x64 -DetoursRoot C:\deps\Detours
```

This produces `graphics-hook{64,32}.dll`, `inject-helper{64,32}.exe`, and
`get-graphics-offsets{64,32}.exe` and copies them into the parent
`resources/obs-capture/` directory under the names the host injector
(`src/game_capture/inject.rs`) and the `build.rs` packaging guard expect. See
`../README.md` → *How to build / refresh the artifacts* for the Detours/Vulkan
prerequisites and options.

## The single modification from upstream: Private_Namespace object names

The only change from the pinned upstream is the **IPC object-name string
prefix** (Requirements 2.1, 2.2). Every kernel-object name's leading
`CaptureHook_` is renamed to the project's fixed, non-empty Private_Namespace
prefix **`RalphCaptureHook_`**, so the `Forked_Hook_DLL` never shares an object
name with a stock OBS install hooking the same target process.

This prefix is kept **byte-for-byte in sync** with the host constant
`PRIVATE_NS` in `desktop/src-tauri/src/game_capture/obs_ipc.rs`. Change one and
you must change the other.

### Renamed names (all in one auditable place each)

`shared/obs-hook-config/graphics-hook-info.h` — the compiled-in object-name
`#define`s:

| Macro | Upstream | Fork |
| --- | --- | --- |
| `EVENT_CAPTURE_RESTART` | `CaptureHook_Restart` | `RalphCaptureHook_Restart` |
| `EVENT_CAPTURE_STOP` | `CaptureHook_Stop` | `RalphCaptureHook_Stop` |
| `EVENT_HOOK_READY` | `CaptureHook_HookReady` | `RalphCaptureHook_HookReady` |
| `EVENT_HOOK_EXIT` | `CaptureHook_Exit` | `RalphCaptureHook_Exit` |
| `EVENT_HOOK_INIT` | `CaptureHook_Initialize` | `RalphCaptureHook_Initialize` |
| `WINDOW_HOOK_KEEPALIVE` | `CaptureHook_KeepAlive` | `RalphCaptureHook_KeepAlive` |
| `MUTEX_TEXTURE1` | `CaptureHook_TextureMutex1` | `RalphCaptureHook_TextureMutex1` |
| `MUTEX_TEXTURE2` | `CaptureHook_TextureMutex2` | `RalphCaptureHook_TextureMutex2` |
| `SHMEM_HOOK_INFO` | `CaptureHook_HookInfo` | `RalphCaptureHook_HookInfo` |
| `SHMEM_TEXTURE` | `CaptureHook_Texture` | `RalphCaptureHook_Texture` |
| `PIPE_NAME` | `CaptureHook_Pipe` | `RalphCaptureHook_Pipe` |

`plugins/win-capture/graphics-hook/graphics-hook.c` — the internal
duplicate-injection guard mutex (`HOOK_NAME`):

| Symbol | Upstream | Fork |
| --- | --- | --- |
| `HOOK_NAME` (dup-guard) | `graphics_hook_dup_mutex` | `RalphCaptureHook_dup_mutex` |

Only the **name string literals** changed. The macro identifiers, the per-object
PID/handle suffixing logic, and all surrounding code are untouched.

### ABI kept byte-for-byte identical (Requirement 2.2)

Everything in `graphics-hook-info.h` from `#pragma pack(push, 8)` onward — the
`graphics_offsets` structs, `struct hook_info` and its
`static_assert(sizeof(struct hook_info) == 648, …)`, `shtex_data`, `shmem_data`,
and `create_hook_info` — is **identical** to OBS 32.1.2. The fork changes only
the object-name strings, never the wire layout, so the host's pinned `hook_info`
offsets and the `SHMEM_TEXTURE` mapping format remain correct.

## How to re-vendor / upgrade

1. Check out the desired OBS tag (e.g. `git clone --branch <tag>
   https://github.com/obsproject/obs-studio`).
2. Copy `plugins/win-capture`, `shared/obs-hook-config`, `shared/obs-d3d8-api`,
   `shared/obs-inject-library`, `shared/ipc-util`, `libobs/util/windows`, and
   `libobs/util/c99defs.h` into this `fork/` tree at the same repo-relative
   paths. (`c99defs.h` is included relatively by `obfuscate.h` as
   `../c99defs.h`, so it must sit one level above `libobs/util/windows/`.)
3. Re-apply the Private_Namespace rename (the table above) in
   `graphics-hook-info.h` and the `HOOK_NAME` dup-guard in `graphics-hook.c`.
4. Re-verify the `hook_info` ABI and object names against
   `src/game_capture/obs_ipc.rs` + `../PROTOCOL-NOTES.md`, and update the pinned
   tag/commit in this file and `../ATTRIBUTION.md`.
5. Rebuild both bitnesses with `desktop/scripts/build-capture-fork.ps1` and
   confirm the six artifacts land in `../` (the parent `obs-capture/` dir).
