# Third-Party Licenses — Ralph Meet Desktop

This file is the project-level third-party attribution and license record for
the `ralph-meet-desktop` application. It records reused/derived third-party
components that ship **alongside** the desktop binary and the licenses they are
distributed under, satisfying the dependency/attribution-record requirement
(Requirement 11.5) for the `owned-game-capture-hook` feature.

> Scope: this record covers components that are **bundled with / shipped
> alongside** the desktop app and have attribution obligations beyond the normal
> Cargo/npm dependency graphs. Ordinary permissively-licensed Rust crate and npm
> package dependencies are tracked by their respective lockfiles
> (`src-tauri/Cargo.lock`, the workspace `pnpm-lock.yaml`) and are not duplicated
> here.

Included upstream binaries must not be described as Ralph Meet-signed merely
because they are packaged by the installer.

---

## Owned_Capture_Component (forked OBS Studio `win-capture`) — GPLv2

The `game-capture-hook` Cargo feature ships the **Owned_Capture_Component**: a
separately licensed game-capture payload (Forked_Hook_DLL) and injector
(Owned_Injector) **built from the source of** OBS Studio's `win-capture`
plugin. The component is distributed under GPL-2.0-only with its complete
corresponding source made available. Ralph Meet-owned host code communicates
with this component through its documented IPC boundary.

### Components (name, upstream version, license) — Requirement 11.5

| Component name | Files | Built from (upstream basis) | Pinned upstream identifier | License |
| --- | --- | --- | --- | --- |
| Forked_Hook_DLL — graphics-hook payload | `graphics-hook64.dll`, `graphics-hook32.dll` | OBS `plugins/win-capture/graphics-hook` (+ `shared/obs-hook-config/`) | OBS Studio **32.1.2** — tag `32.1.2`, commit `fb4d98b` | GPLv2 |
| Owned_Injector — inject helper | `inject-helper64.exe`, `inject-helper32.exe` | OBS `plugins/win-capture/inject-helper` | OBS Studio **32.1.2** — tag `32.1.2`, commit `fb4d98b` | GPLv2 |
| Owned_Injector — graphics-offsets helper | `get-graphics-offsets64.exe`, `get-graphics-offsets32.exe` | OBS `plugins/win-capture/get-graphics-offsets` | OBS Studio **32.1.2** — tag `32.1.2`, commit `fb4d98b` | GPLv2 |

- **Upstream project:** OBS Studio (`obs-studio`), the OBS Project.
- **Upstream source:** <https://github.com/obsproject/obs-studio>
- **Component path upstream:** `plugins/win-capture/` (`graphics-hook`,
  `inject-helper`, `get-graphics-offsets`) and `shared/obs-hook-config/`.
- **Pinned upstream identifier:** **OBS Studio 32.1.2** — tag `32.1.2`,
  commit `fb4d98b`. This matches the pin recorded in
  `src-tauri/resources/obs-capture/ATTRIBUTION.md`. Re-pinning is a deliberate,
  re-verified step (the `hook_info` layout / event names must be re-checked in
  `src-tauri/src/game_capture/obs_ipc.rs`).
- **License:** GNU General Public License, version 2 (GPLv2). The full,
  verbatim license text ships with the component at
  [`src-tauri/resources/obs-capture/LICENSE-GPLv2.txt`](src-tauri/resources/obs-capture/LICENSE-GPLv2.txt).
- **In-bundle attribution:** the per-bundle attribution that ships *inside* the
  Owned_Capture_Component is
  [`src-tauri/resources/obs-capture/ATTRIBUTION.md`](src-tauri/resources/obs-capture/ATTRIBUTION.md);
  see also
  [`src-tauri/resources/obs-capture/README.md`](src-tauri/resources/obs-capture/README.md)
  for how the artifacts are built/obtained and pinned.

### Modifications from upstream

The Forked_Hook_DLL's single intended behavioral change from upstream OBS
`win-capture` is a **private IPC object namespace** (the `RalphCaptureHook_`
prefix replacing OBS's `CaptureHook_` across all IPC object names), so the fork
never shares IPC objects with a stock OBS install capturing the same game. The
shared-memory struct (`hook_info` / `SHMEM_TEXTURE`) layouts are unchanged.

### Corresponding source / written offer (GPLv2 §3)

The complete corresponding source for the Forked_Hook_DLL and the
Owned_Injector (the OBS Studio `win-capture` sources at tag `32.1.2`,
commit `fb4d98b`, plus the project's `RalphCaptureHook_` namespace modifications
and build wiring) is available from
<https://github.com/obsproject/obs-studio/releases/tag/32.1.2> and
<https://github.com/obsproject/obs-studio>, and via the ralph-meet project
repository for the fork modifications. The in-bundle written offer (valid at
least three years, per GPLv2 §3) ships at
[`src-tauri/resources/obs-capture/SOURCE-OFFER.md`](src-tauri/resources/obs-capture/SOURCE-OFFER.md).

### License posture (linkage)

Ralph Meet-owned host code is GPL-3.0-or-later. The Forked_Hook_DLL is injected
into the **target game's process** (never into the desktop binary) and the
Owned_Injector runs as a **standalone child process**; the host interacts with
them over the shared-texture IPC protocol. The capture component remains
GPL-2.0-only. This record documents the distribution boundary and does not
constitute legal advice.

## CEF/Chromium runtime — upstream included component

The desktop release also includes a custom CEF/Chromium runtime obtained from
the locked release archive referenced by
`desktop/src-tauri/cef-runtime.lock.json`. The runtime includes native PE files,
CEF resources, and locale packs. It is not Ralph Meet-owned source and is not an
initial direct-signing candidate.

CEF redistribution notices, archive identity, build flags, and the exact payload
hash must accompany each release. The runtime remains included unsigned unless
its provenance and signing scope are separately accepted by SignPath Foundation.
