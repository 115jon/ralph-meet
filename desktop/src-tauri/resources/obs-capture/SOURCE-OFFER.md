# Game capture — Source Availability & Written Offer (GPLv2 §3)

This file covers the GPLv2 source obligation for the OBS Studio game-capture
files shipped under `obs-signed/` (`graphics-hook64.dll`, `graphics-hook32.dll`,
`inject-helper64.exe`, `inject-helper32.exe`, `get-graphics-offsets64.exe`,
`get-graphics-offsets32.exe`). They are OBS Studio 33.0.1 release binaries,
unmodified, licensed under the GNU General Public License, version 2 (full text
in `LICENSE-GPLv2.txt`).

## Complete corresponding source

The complete corresponding source is attached to **every Ralph Meet desktop
release** on the project's GitHub releases page
(<https://github.com/115jon/yap/releases>), next to the installer:

1. `OBS-Studio-33.0.1-Sources.tar.gz`: the OBS Project's own source archive for
   the release the binaries come from (tag `33.0.1`, commit `65c320b`).
   Relevant paths: `plugins/win-capture/` (`graphics-hook`, `inject-helper`,
   `get-graphics-offsets`), `shared/obs-hook-config/`, `shared/ipc-util/`,
   `shared/obs-inject-library/`.
2. `Detours-e4bfd6b03e50de46b47abfbd1e46b384f0c5f833.tar.gz`: Microsoft Detours
   (MIT), statically linked into `graphics-hook`, at the commit obs-deps pins.
3. `obs-deps-2026-10-23.tar.gz`: the obs-deps build scripts for the prebuilt
   dependencies OBS 33.0.1 was built with.

Their SHA-256 values are recorded in `desktop/packaging/obs-signed-hook.lock.json`
in the Ralph Meet repository. The same archives are also published by their
authors: <https://github.com/obsproject/obs-studio/releases/tag/33.0.1>,
<https://github.com/microsoft/Detours>, <https://github.com/obsproject/obs-deps>.

## Written offer

For any recipient who receives these files in binary form, the distributor
hereby makes the following written offer, **valid for at least three (3) years
from the date of distribution**:

> Upon request, and for a charge no more than the cost of physically performing
> source distribution, the distributor will provide a complete machine-readable
> copy of the complete corresponding source code for the GPLv2-licensed OBS
> Studio game-capture files described above, under the terms of the GNU General
> Public License, version 2.

To exercise this offer, or to obtain the corresponding source directly, contact
the Ralph Meet maintainer at <115jon@proton.me> or through the project's public
repository.
