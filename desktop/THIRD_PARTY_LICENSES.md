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

---

## Owned_Capture_Component (forked OBS Studio `win-capture`) — GPLv2

The `game-capture-hook` Cargo feature ships the **Owned_Capture_Component**: a
project-owned game-capture payload (Forked_Hook_DLL) and injector
(Owned_Injector) **built from the source of** OBS Studio's `win-capture`
plugin. ralph-meet has been relicensed to be **GPLv2-compatible** so it may
build and link from OBS `win-capture` sources; the resulting fork is
distributed under GPLv2 with its complete corresponding source made available
(Requirement 11.1–11.3).

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

ralph-meet is relicensed to be **GPLv2-compatible** for the purpose of building
and linking from OBS `win-capture` sources. The Forked_Hook_DLL is injected
into the **target game's process** (never into the desktop binary) and the
Owned_Injector runs as a **standalone child process**; the host interacts with
them over the shared-texture IPC protocol. The precise relicensing mechanics and
the full set of files the GPLv2 obligation reaches are flagged in the
`owned-game-capture-hook` requirements (Assumptions and Risks) as needing
human/legal confirmation; this record documents the obligations and does not
constitute legal advice.
