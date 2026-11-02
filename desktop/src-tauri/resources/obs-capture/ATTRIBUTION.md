# Game capture — Attribution

The `game-capture-hook` feature ships **OBS Studio's game-capture files**, from
the OBS Project (<https://obsproject.com>), **unmodified and as signed by the OBS
Project**, under the GNU General Public License, version 2 (GPLv2). Ralph Meet
is not affiliated with or endorsed by the OBS Project.

## Shipped files (`obs-signed/`)

| File | Upstream | License |
| --- | --- | --- |
| `graphics-hook64.dll`, `graphics-hook32.dll` | OBS `plugins/win-capture/graphics-hook` | GPLv2 |
| `inject-helper64.exe`, `inject-helper32.exe` | OBS `plugins/win-capture/inject-helper` | GPLv2 |
| `get-graphics-offsets64.exe`, `get-graphics-offsets32.exe` | OBS `plugins/win-capture/get-graphics-offsets` | GPLv2 |

- **Release:** OBS Studio **33.0.1** (tag `33.0.1`, commit `65c320b`), taken
  from the official release asset `OBS-Studio-33.0.1-Windows-x64.zip`
  (`core/win-capture/data/`).
- **Pinned by:** `desktop/packaging/obs-signed-hook.lock.json` in the Ralph Meet
  repository: the release asset's SHA-256, each file's SHA-256, file version, and
  Authenticode signer (OBS Project, LLC) and certificate thumbprint. The app
  checks the hash and the signature again before every use.
- **Modifications:** none. The files are distributed byte-for-byte as released
  and are never re-signed.
- **Statically linked into `graphics-hook`:** Microsoft Detours (MIT License),
  commit `e4bfd6b03e50de46b47abfbd1e46b384f0c5f833`, as built by obs-deps
  `2026-10-23`.
- **License:** GNU General Public License, version 2: full text in
  `LICENSE-GPLv2.txt` in this directory.

The Ralph Meet app runs these files as separate programs (the inject helper and
the offsets helper) and talks to the hook DLL over OBS's documented
shared-memory protocol; it does not link them. The Vulkan layer manifest the app
writes next to its staged copy names its own layer, not OBS's.

## Corresponding source

See `SOURCE-OFFER.md` in this directory.

> **Note:** `desktop/THIRD_PARTY_LICENSES.md` records the same component at the
> project level; this file ships next to the binaries it describes.
