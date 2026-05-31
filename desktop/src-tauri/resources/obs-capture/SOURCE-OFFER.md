# Owned_Capture_Component — Source Availability & Written Offer (GPLv2 §3)

This file satisfies the GPLv2 source-availability obligation (Requirement 11.3)
for the **Owned_Capture_Component** — the project's Forked_Hook_DLL
(`graphics-hook64.dll`, `graphics-hook32.dll`) and Owned_Injector
(`inject-helper64.exe`, `inject-helper32.exe`, `get-graphics-offsets64.exe`,
`get-graphics-offsets32.exe`) shipped alongside the `ralph-meet-desktop` binary.

These binaries are built from the source of **OBS Studio** `win-capture` under
the GNU General Public License, version 2 (full text in `LICENSE-GPLv2.txt`).

## Complete corresponding source

The complete corresponding source for the Owned_Capture_Component is:

1. **Upstream OBS `win-capture` sources** at the pinned identifier:
   - **OBS Studio 32.1.2** — tag `32.1.2`, commit `fb4d98b`.
   - Available from
     <https://github.com/obsproject/obs-studio/releases/tag/32.1.2> and
     <https://github.com/obsproject/obs-studio>.
   - Relevant paths: `plugins/win-capture/` (`graphics-hook`, `inject-helper`,
     `get-graphics-offsets`) and `shared/obs-hook-config/`.

2. **The project's fork modifications and build wiring** — the
   `RalphCaptureHook_` private-namespace changes and the CMake/MSVC + Microsoft
   Detours build configuration used to produce the 64-bit and 32-bit artifacts.
   These are maintained under the project's `desktop/src-tauri/resources/obs-capture/`
   tree and are distributed together with this component.

## Written offer

For any recipient who receives the Owned_Capture_Component in binary form, the
distributor hereby makes the following written offer, **valid for at least three
(3) years from the date of distribution**:

> Upon request, and for a charge no more than the cost of physically performing
> source distribution, the distributor will provide a complete machine-readable
> copy of the complete corresponding source code for the GPLv2-licensed
> Owned_Capture_Component (Forked_Hook_DLL and Owned_Injector), as described
> above, under the terms of the GNU General Public License, version 2.

To exercise this offer, or to obtain the corresponding source directly, contact
the ralph-meet maintainers through the project's public repository.

> **Distribution note:** When the desktop app is distributed online, the
> corresponding source is made available for the full period the binary is
> distributed (via the public repository and the upstream OBS tag above). When
> the app is distributed offline (e.g. an offline installer), this written offer
> MUST accompany the distribution.
