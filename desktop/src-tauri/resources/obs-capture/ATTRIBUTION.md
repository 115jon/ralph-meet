# Owned_Capture_Component — Attribution

The `game-capture-hook` feature ships the **Owned_Capture_Component**: a
project-owned game-capture payload and injector **built from the source of**
**OBS Studio** (<https://obsproject.com>) under the GNU General Public License,
version 2 (GPLv2).

> **Licensing posture (changed by the `owned-game-capture-hook` spec).** Earlier
> revisions reused OBS as unmodified, prebuilt, separate-process artifacts behind
> a clean license boundary. The project has since **relicensed ralph-meet to be
> GPLv2-compatible** so it may build and link from OBS `win-capture` sources.
> The capture component is therefore an **owned fork built from source** and
> distributed under GPLv2, with the corresponding source made available (see
> `SOURCE-OFFER.md`).

## Owned components (built from OBS `win-capture` sources)

| Component | Files | Upstream basis | License |
| --- | --- | --- | --- |
| Forked_Hook_DLL — graphics-hook payload | `graphics-hook64.dll`, `graphics-hook32.dll` | OBS `plugins/win-capture/graphics-hook` | GPLv2 |
| Owned_Injector — inject helper | `inject-helper64.exe`, `inject-helper32.exe` | OBS `plugins/win-capture/inject-helper` | GPLv2 |
| Owned_Injector — graphics-offsets helper | `get-graphics-offsets64.exe`, `get-graphics-offsets32.exe` | OBS `plugins/win-capture/get-graphics-offsets` | GPLv2 |

- **Upstream project:** OBS Studio (`obs-studio`), the OBS Project.
- **Upstream source:** <https://github.com/obsproject/obs-studio>
- **Component path upstream:** `plugins/win-capture/` (`graphics-hook`,
  `inject-helper`, `get-graphics-offsets`) and the shared hook-config headers
  under `shared/obs-hook-config/`.
- **Pinned upstream identifier:** OBS Studio **32.1.2** — tag `32.1.2`,
  commit `fb4d98b`. The Forked_Hook_DLL is built from the `win-capture` sources
  at this pin; the `hook_info` / `SHMEM_TEXTURE` ABI is kept byte-for-byte
  identical to OBS 32.1.2 and only the IPC object **name strings** are changed
  (see "Modifications" below). Re-pinning to a different OBS version is a
  deliberate, re-verified step (the `hook_info` layout and event names must be
  re-checked).
- **License:** GNU General Public License, version 2 — full verbatim text in
  `LICENSE-GPLv2.txt` in this directory.

## Modifications from upstream

The Forked_Hook_DLL's single intended behavioral change from upstream OBS
`win-capture` is a **private IPC object namespace**: every IPC object name
(the capture events restart/stop/hook-ready/exit/initialize, the keepalive
mutex, the texture-access mutexes, the `hook_info` mapping, the `SHMEM_TEXTURE`
mapping, the named pipe, and the duplicate-injection guard) is renamed from the
OBS `CaptureHook_` prefix to the project's private `RalphCaptureHook_` prefix,
so the fork never shares IPC objects with a stock OBS install capturing the
same game. The shared-memory struct layouts are unchanged.

## Corresponding source / written offer

GPLv2 requires that the complete corresponding source for these binaries be made
available, or accompanied by a written offer valid for at least three years. The
corresponding source — the OBS Studio `win-capture` sources at the pin above plus
the project's `RalphCaptureHook_` namespace modifications and build wiring — and
the written offer are documented in `SOURCE-OFFER.md` in this directory.

> **Note:** The project-wide third-party license record
> (`desktop/THIRD_PARTY_LICENSES.md`) records the same component, pinned upstream
> identifier, and license at the project level (Requirement 11.5); this
> `ATTRIBUTION.md` ships *inside* the Owned_Capture_Component bundle next to the
> GPLv2 text, the source offer, and the binaries it describes (Requirement 11.2).
