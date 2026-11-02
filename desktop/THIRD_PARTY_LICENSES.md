# Third-Party Licenses — Ralph Meet Desktop

This file is the project-level third-party attribution and license record for
the `ralph-meet-desktop` application. It records reused/derived third-party
components that ship **alongside** the desktop binary and the licenses they are
distributed under, satisfying the dependency/attribution-record requirement
(Requirement 11.5) for the `game-capture-hook` feature.

> Scope: this record covers components that are **bundled with / shipped
> alongside** the desktop app and have attribution obligations beyond the normal
> Cargo/npm dependency graphs. Ordinary permissively-licensed Rust crate and npm
> package dependencies are tracked by their respective lockfiles
> (`src-tauri/Cargo.lock`, the workspace `pnpm-lock.yaml`) and are not duplicated
> here.

Included upstream binaries must not be described as Ralph Meet-signed merely
because they are packaged by the installer.

---

## OBS Studio game-capture files (unmodified, OBS-signed) — GPLv2

The `game-capture-hook` Cargo feature ships OBS Studio's own game-capture files,
**unmodified and as signed by the OBS Project** (Authenticode signer "OBS
Project, LLC"), under `obs-capture/obs-signed/`. They are GPL-2.0-only and ship
with their license text, attribution, and a source offer; the corresponding
source is attached to every Ralph Meet desktop release. Ralph Meet is not
affiliated with or endorsed by the OBS Project.

### Components (name, upstream version, license) — Requirement 11.5

| Component               | Files                                                      | Upstream                                       | Release                                                | License              |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------ | -------------------- |
| graphics-hook payload   | `graphics-hook64.dll`, `graphics-hook32.dll`               | OBS `plugins/win-capture/graphics-hook`        | OBS Studio **33.0.1** (tag `33.0.1`, commit `65c320b`) | GPLv2 (Detours: MIT) |
| inject helper           | `inject-helper64.exe`, `inject-helper32.exe`               | OBS `plugins/win-capture/inject-helper`        | OBS Studio **33.0.1**                                  | GPLv2                |
| graphics-offsets helper | `get-graphics-offsets64.exe`, `get-graphics-offsets32.exe` | OBS `plugins/win-capture/get-graphics-offsets` | OBS Studio **33.0.1**                                  | GPLv2                |

- **Source of the bytes:** the official release asset
  `OBS-Studio-33.0.1-Windows-x64.zip` (`core/win-capture/data/`), fetched and
  verified by `desktop/scripts/fetch-obs-signed-hook.ps1` against
  `desktop/packaging/obs-signed-hook.lock.json` (asset SHA-256, per-file
  SHA-256, file version, signer and certificate thumbprint).
- **Modifications:** none. The files are never modified or re-signed; any
  future Authenticode step for Ralph Meet's own binaries must exclude
  `obs-capture/obs-signed/**`. `stage-payload.ps1` checks the staged bytes
  against the lock, and the app re-checks hash and signature before each use.
- **License:** GNU General Public License, version 2. The verbatim text ships
  at [`src-tauri/resources/obs-capture/LICENSE-GPLv2.txt`](src-tauri/resources/obs-capture/LICENSE-GPLv2.txt).
- **In-bundle attribution:**
  [`src-tauri/resources/obs-capture/ATTRIBUTION.md`](src-tauri/resources/obs-capture/ATTRIBUTION.md).

### Corresponding source / written offer (GPLv2 §3)

Each desktop release attaches `OBS-Studio-33.0.1-Sources.tar.gz` (the OBS
Project's own source archive), the Microsoft Detours source at the commit
obs-deps pins, and the obs-deps `2026-10-23` build scripts (release workflow,
"Fetch and verify OBS-signed capture hook and its source"). The in-bundle
written offer ships at
[`src-tauri/resources/obs-capture/SOURCE-OFFER.md`](src-tauri/resources/obs-capture/SOURCE-OFFER.md).

### Development-only fork

`src-tauri/resources/obs-capture/fork/` holds a modified build of the same OBS
32.1.2 sources (private `RalphCaptureHook_` object names, a present counter,
self-unload). It is unsigned, is not shipped by the installer, and is used only
when a developer sets `RALPH_CAPTURE_HOOK_FLAVOR=own` after building it with
`build-capture-fork.ps1`. It is never injected into an anti-cheat-protected
game.

### License posture (linkage)

Ralph Meet-owned host code is GPL-3.0-or-later. The hook DLL is injected into
the **target game's process** (never into the desktop binary), and the inject
and offsets helpers run as **standalone child processes**; the host talks to the
hook over OBS's shared-memory IPC protocol. The OBS files remain GPL-2.0-only.
This record documents the distribution boundary and does not constitute legal
advice.

## CEF/Chromium runtime — upstream included component

The desktop release also includes a custom CEF/Chromium runtime obtained from
the locked release archive referenced by
`desktop/src-tauri/cef-runtime.lock.json`. The runtime includes native PE files,
CEF resources, and locale packs. It is not Ralph Meet-owned source and is not an
initial direct-signing candidate.

CEF redistribution notices, archive identity, build flags, and the exact payload
hash must accompany each release. The runtime remains included unsigned unless
its provenance and signing scope are separately accepted by SignPath Foundation.

## LZMA SDK (C#) — installer payload compression, public domain

The installer payload (`payload.rmpk`) is LZMA-compressed. The C# LZMA
encoder/decoder is vendored unmodified from the **LZMA SDK 26.05** by Igor
Pavlov (`CS/7zip/{Common,Compress/LZ,Compress/LZMA,Compress/RangeCoder}` and
`CS/7zip/ICoder.cs`, from <https://www.7-zip.org/sdk.html>) in
`desktop/packaging/Shared/Lzma/`. It is compiled into both the installer
(decoder) and `desktop/packaging/PayloadPacker` (encoder). The LZMA SDK is
placed in the **public domain** by its author; no license obligations apply, and
this entry records provenance. The container format that wraps it is documented
in [`docs/desktop/packaging.md`](../docs/desktop/packaging.md).

## Installer fonts and glyphs — SIL OFL 1.1 and MIT

The installer window (`desktop/installer`) embeds static, Latin-subset instances of the app's
fonts as WPF resources inside `RalphMeetSetup.exe`: Bricolage Grotesque (Copyright 2022 The
Bricolage Grotesque Project Authors), Geist (Copyright 2024 The Geist Project Authors) and
Martian Mono (Copyright 2020 The Martian Mono Project Authors), all under the **SIL Open Font
License 1.1**. They are cut from the Fontsource packages by
`desktop/scripts/build-installer-fonts.py` and renamed (`RM ...`) as modified versions; each
file keeps its copyright and license notice in its name table, and the full license text is in
`desktop/installer/Assets/Fonts/OFL.txt`. The window's icons are path data from
**Phosphor Icons** (MIT, Copyright Phosphor Icons), the same glyphs the app uses.
