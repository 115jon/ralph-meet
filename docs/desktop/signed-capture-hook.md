# OBS-signed capture hook

Status: proposal, not implemented. Researched 2026-11-01 against `main` at `e3880f50`, OBS Studio 30.2.3, 31.1.2,
32.1.2 and 33.0.1 (latest, released 2026-10-29), and the 3.7.0 install on a second Windows 11 machine.

This document answers one question: could the native share drive the graphics hook that OBS Studio ships, signed by
the OBS Project, instead of the hook we build from source? It then proposes how to do that without losing what the
fork provides. It builds on [native-share.md](native-share.md) and [packaging.md](packaging.md), and on PR #129
(fallback reason for a hook that never delivers, anti-cheat marker detection), which it does not repeat.

## Summary

- **Protocol: yes.** The wire protocol has not changed from OBS 30.2.3 to 33.0.1: same kernel object names, same
  648-byte `hook_info`, same `inject-helper` argv, same `get-graphics-offsets` output. Our host already speaks it,
  and already has fallbacks for everything the stock DLL does not publish. The host needs a "stock profile":
  the `CaptureHook_` prefix instead of `RalphCaptureHook_`, a longer first-frame window, and reuse of a hook that is
  already loaded. The only hard incompatibility is the hard-coded `RalphCaptureHook_` vs `CaptureHook_` object-name
  prefix. The DLL needs no change. It must not be changed: any byte change voids the signature.
- **Building from source was not required to get frames.** The repo first shipped prebuilt, unmodified OBS
  binaries (see `resources/obs-capture/fork/README.md`, "replaces the prior model"). The fork exists for quality:
  present-accurate frame delivery, zero-copy encoder input, clean unload, a fix for DX11 games that also load
  `d3d9.dll`, and diagnostics. The stock DLL loses all of those (table below).
- **Signed does not mean allowed.** OBS's own compatibility table marks Easy Anti-Cheat (tested on Fortnite and
  THE FINALS) as 🟡 for every hook certificate since OBS 31.0. An updated EAC module accepts the new certificates,
  but each game developer must adopt it. Whether Fortnite accepts the current OBS hook is unknown until it is
  tested. BattlEye, Vanguard (31.1+), FACEIT (31.1+), EA AC and others are listed as working. VAC blocks all
  injection in CS2 unless the game is launched untrusted.
- **Performance: modest gain over WGC, and less than our fork.** The hook saves roughly one compositor frame of
  latency, works with legacy exclusive fullscreen, and does not depend on DWM. The stock DLL gives no new-frame
  signal, so delivery is paced on a timer, and it costs one extra full-frame GPU copy per frame on our device
  (no `BIND_RENDER_TARGET`). For 720p30–1080p60 shares, WGC is adequate. On joi2 it captured Fortnite with no
  drops, though at about 49 fps against a negotiated 30, because nothing paces WGC (see
  [Performance](#performance)).
- **Recommendation:** keep the fork for unprotected games. Add the OBS-signed hook as a second, separate flavor
  used **only** for anti-cheat-protected targets, **opt-in**, bundled as a pinned and verified copy. Never inject
  the self-built DLL into a protected game. WGC stays the default for protected games until a title is verified.
  Phases and estimates are at the end (about 2–3 weeks in total).

## What happened with Fortnite on 3.7.0

From `%LOCALAPPDATA%\RalphMeet\logs` on joi2 (RTX 5070 Ti Laptop + Intel iGPU, Windows 11 26200):

```
[inject] resolved graphics offsets for pid 30220 (X64): dxgi.present=0x19000 ... (dxgi_hookable=true)
[inject] inject-helper mode=safe spawned asynchronously
safe inject observed unrelated graphics-hook pid 28420 while targeting pid 30220; ignoring it ...
capture_mode=hook reason=none ... injection=Success
no first frame within 1500ms of Initialize - hook never delivered; falling back
```

The fork DLL writes `graphics-hook-<pid>.log` from `DllMain`, before anything else. There is a log for pid 28420,
which is consistent with `inject-helper` loading the DLL into itself to resolve the hook procedure for
`SetWindowsHookEx` (in safe mode `inject_library_safe_obf` calls `LoadLibraryW(dll)` in the helper to get
`dummy_debug_proc`, `shared/obs-inject-library/inject-library.c`, so `DllMain` runs once in the helper). That log ends
with "keepalive released before Initialize". There is **no log for pid 30220**,
so the DLL never loaded into Fortnite. "Success" only meant that the helper process started. The installed
`graphics-hook64.dll` and `inject-helper64.exe` are `NotSigned` (`Get-AuthenticodeSignature`, file version
1.8.7.0). Easy Anti-Cheat blocking an unsigned module is the expected outcome. PR #129 now detects the EAC folder and
skips injection.

## Fork vs. upstream

`fork/` against the OBS 32.1.2 tag, line endings ignored:

| Fork change                                                                         | Purpose                                                                | What the host gets from the stock DLL instead                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RalphCaptureHook_` prefix for every object, the pipe, the dup-guard mutex          | never share objects with OBS or another OBS-hook host in the same game | `CaptureHook_` names, shared with OBS (see coexistence)                                                                                                                                      |
| `hook_info.frame_count` (offset 144), bumped once per captured present              | forward exactly one frame per real present                             | stays 0. After 750 ms the host falls back to "paced reuse" at `frame_interval` (`obs_ipc.rs`), which re-encodes duplicates and can judder                                                    |
| `hook_info.hooked_api` (148)                                                        | truthful backend label                                                 | stays 0. The label falls back to the module-based guess                                                                                                                                      |
| unload state + Vulkan live counts (152–160), `unhook_*`, `FreeLibraryAndExitThread` | the hook leaves the game when the share stops                          | the DLL stays loaded until the game exits (hooks idle). This is how OBS behaves                                                                                                              |
| D3D11 shared texture adds `BIND_RENDER_TARGET`                                      | the VideoProcessor binds the shared surface directly                   | `SHADER_RESOURCE` only. The host takes the existing "[VP] normalizing hook surface" path, one same-device full-frame `CopyResource` per frame                                                |
| install D3D/GL hooks, commit on the first present that actually fires               | DX11 games that load `d3d9.dll` (e.g. Deadlock)                        | stock commits on the first hook that _installs_ (D3D9 first) and re-attempts every 4 s (`capture_loop`, `n % 100`), so DXGI can hook up to ~4 s late. Our 1.5 s watchdog would give up first |
| wait for Initialize _or_ Stop, abort if keepalive drops                             | no thread parked forever                                               | waits `INFINITE` on Initialize                                                                                                                                                               |
| early diagnostics pipe, per-PID log file                                            | diagnose a hook that never installs                                    | none until a present hook installs                                                                                                                                                           |
| Vulkan layer renamed `VK_LAYER_RALPH_MEET_HOOK`                                     | no clash with OBS's layer                                              | `VK_LAYER_OBS_HOOK` in OBS's JSON                                                                                                                                                            |

`allow_srgb_alias=0` is a host write, not a fork change. The stock DLL honors it and creates a typed UNORM texture.

## Protocol compatibility

|                                          | 30.2.3                            | 31.1.2                           | 32.1.2 (fork base) | 33.0.1                                            |
| ---------------------------------------- | --------------------------------- | -------------------------------- | ------------------ | ------------------------------------------------- |
| `HOOK_VER`                               | 1.8.3                             | 1.8.7                            | 1.8.7              | 1.8.8                                             |
| object names / `hook_info` layout        | identical                         | identical                        | identical          | identical                                         |
| `graphics-hook` logic                    | three crash fixes missing (below) | same as 33 apart from formatting | same               | reference                                         |
| `inject-helper` / `get-graphics-offsets` | same argv / INI                   | same                             | same               | adds safe DLL search (`SetDefaultDllDirectories`) |

The `graphics-hook-info.h` diffs between these tags are formatting only. 33.0.1 differs from 32.1.2 only in
`HOOK_VER_PATCH`. The `graphics-hook` changes since 30.2.3 are `343ae6015` (Vulkan DirectDisplay crash),
`0b87f533b` / `4652daf74` (null derefs) and `dfe615146` (segfault in `data.free()`). The rest is formatting.
OBS's host only refuses a DLL whose `hook_ver_major` is greater than its own (`game-capture.c`).

Checked directly, beyond the tag diffs above:

- The `hook_info` struct and names in `graphics-hook-info.h` are byte-identical (ignoring formatting) from OBS 27.0.0
  through 33.0.1, with only `HOOK_VER_PATCH` moving. The header was compared at 27.0.0, 28.0.0, 32.1.2 and 33.0.1; the
  releases in between are inferred, not each diffed. The ABI has been stable for about five years.
- `diff -r` of the vendored fork against `obs-studio@32.1.2` (`fb4d98b`): `inject-helper/`, `get-graphics-offsets/` and
  `shared/obs-inject-library/` are identical, so our own helpers already behave as OBS's. All fork changes are in
  `graphics-hook/` (about 850 changed lines, 380 in `graphics-hook.c`) and `graphics-hook-info.h`.
- The official 32.1.2 `graphics-hook64.dll` exports `OBS_Negotiate` and `dummy_debug_proc`, and its UTF-16 strings are
  exactly the stock names (`CaptureHook_HookInfo%lu`, `CaptureHook_Texture_%llu_%u`, `graphics_hook_dup_mutex`, …).
- The official `get-graphics-offsets64.exe`, run on this machine, prints the INI layout our parser takes. Its
  DXGI/D3D9 offsets match what our helper resolved on joi2 (`present=0x19000 resize=0x36c30 release=0x335a0
present1=0x194a0 d3d9.present=0x61c40`).

What our host must change to drive the stock files unmodified:

1. **Namespace per flavor.** `PRIVATE_NS` becomes a per-session profile: `RalphCaptureHook_` for the fork,
   `CaptureHook_` for the stock DLL. `is_private_namespace` and the foreign-hook probe follow the profile.
2. **Attach to a resident hook.** The stock DLL never unloads, and its dup-guard stops a second copy from
   initializing. A second share of the same game must not inject again. It opens `CaptureHook_Restart<pid>` and
   signals it, as `game-capture.c` does (`attempt_existing_hook`). The same path lets us read from a hook that OBS
   already placed.
3. **First-frame window.** With `wgc_preroll`, allow at least 6 s for the stock profile (the 4 s re-attempt plus
   hooking and the first present). The viewer already sees WGC frames, so a longer probe costs nothing visible.
   The stock hook commits to D3D9 when it installs, then re-runs `attempt_hook` every 4 s (`capture_loop`,
   `n % 100`), so a DX11/12 game that also loads `d3d9.dll` can take 4–5 s to deliver its first frame.
4. **Capabilities, not assumptions.** Treat `frame_count`, `hooked_api` and the unload words as optional (already
   true for the first two). Skip the unload wait for the stock profile.
5. **Version gate.** Before injecting: the PE `FileVersion` must be `1.8.x.0`. After load: `hook_ver_major == 1`.
   Record `hook_ver_minor/patch` in status.
6. **Use OBS's `inject-helper` and `get-graphics-offsets` from the same release** as the DLL. That is the
   combination vendors test, and their DLL search hardening is already built in. Our argv already matches.

The VideoProcessor input still needs `BIND_RENDER_TARGET`, so the extra copy stays. A pixel-shader BGRA→NV12
converter that samples an SRV removes it (OBS converts this way). That is optional and helps both flavors.

## Signatures

Inspected from the official GitHub release zips with `signtool verify /pa /all /v`:

| Release | Path in zip                                             | Primary signature                                                                                                        | Nested signature                                                                                           |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 33.0.1  | `core/win-capture/data/graphics-hook{32,64}.dll`        | OBS Project, LLC, RSA (DigiCert Trusted G4 RSA4096), SHA1 `7EB9F24F6991F189D0EDBC807A14246C82F03A06`, expires 2028-01-15 | OBS Project, LLC, ECC (DigiCert G5 CS ECC), `178EB178111547B52B3821A278653EEDC3E5B1F7`, expires 2027-01-27 |
| 33.0.1  | `inject-helper*.exe`, `get-graphics-offsets*.exe`       | OBS Project, LLC, ECC `178EB178…` (the general release cert)                                                             | —                                                                                                          |
| 30.2.3  | `data/obs-plugins/win-capture/graphics-hook{32,64}.dll` | Hugh Bailey, RSA, `4C400F6B3A5E3C72C3F80D3EF296C26713E14303`, expired 2024-08-15, timestamped                            | OBS Project, LLC, ECC (DigiCert Global G3), `EC0614E3D9455AA731992287C6F7E44A5288C232`                     |

OBS signs the hook DLLs in a separate CI step with a dedicated key, `game-capture-release-sign-hsm`
(`.github/actions/windows-signing/action.yaml`, "Sign Game Capture with RSA cert"). Everything else is signed with
the release key. The hook certificate is managed apart from the rest of OBS.

The hook binaries are byte-identical across patch releases (zip CRCs: 32.1.0 = 32.1.2, and the hook source did not
change between those tags) and change at each minor (32.2.2 and 33.0.1 differ from 32.1.x and from each other).
Any vendor allowlist that keys on hash or version therefore moves with OBS minors.

33.0.1 SHA-256: `graphics-hook64.dll c37f4412…5021c2`, `graphics-hook32.dll 91da13c2…282d85`. The full values belong in
the lock file (below).

The zip layout moved in OBS 33 (`data/obs-plugins/win-capture/` → `core/win-capture/data/`). Anything that reads
an installed OBS must handle both.

## Anti-cheat

What is documented:

- OBS KB "Capture Hook Certificate Update" (2025-06-03) has a table per anti-cheat and certificate generation:
  EAC ✅ old / ✅ 30.2 dual / 🟡 31.0 / 🟡 31.1+ ("an updated EAC module is available, but game developers must
  manually switch"), BattlEye ✅ through 31.0, Vanguard ❌ 31.0 / ✅ 31.1+, FACEIT ❌ 31.0 / ✅ 31.1+, VAC CS2 🟡
  (`-allow_third_party_software`), ACE, miHoYo, EA AC ✅. Vendors "specifically exempt the current certificate".
  The allowlisting is by certificate, at least for some vendors.
- The allowlist has been build-specific at times: an OBS 19.0.3 hotfix that changed the game-capture files was
  blocked until the anti-cheat updated, and downgrading to 19.0.2 fixed it
  ([OBS forum, "Black Screen - 19.0.3"](https://obsproject.com/forum/threads/black-screen-19-0-3.70638)). Assume
  signer plus a known hash or version, and expect a lag after each OBS minor.
- OBS forum posts report a hook update dropping out of an allowlist. A moderator declined to sign a third-party
  build because it would undermine trust between OBS and the anti-cheat vendors. A modified hook would need its own
  signature and its own vendor allowlisting.
- The "anti-cheat compatibility hook" option (on by default) is `SetWindowsHookEx` injection. Our host already uses
  it (`InjectionMode::Safe`). OBS skips it for AppContainer targets.
- OBS's `compatibility.json` lists titles where game capture cannot work (Roblox, Destiny 2, Chromium games) or
  needs admin (Marvel Rivals, Genshin, Wuthering Waves, CoD, …). It ships in the zip and is usable as data.

What is not documented anywhere found: whether any vendor accepts the OBS-signed DLL when a process other than
`obs64.exe` injects it, and whether the vendor inspects the injector. No vendor statement covers third-party apps.
Discord, for comparison, ships its own `DiscordHook64.dll` signed by Discord Inc. (seen on this machine), which
suggests it negotiated its own allowlisting. A third-party Rust host that drives OBS's signed hook,
[hzqst/obs-rs](https://github.com/hzqst/obs-rs), claims to be "whitelisted by all anti-cheats". That claim is
unverified, and the 19.0.3 incident above shows it is not universally true.

Whether Fortnite loads the OBS-signed hook when we inject it is therefore **unknown**. The alt run of this research
asserted that "OBS's signed hook does load in Fortnite", but that is a statement about `obs64.exe` as the host, not
evidence for our host. It is not relied on here.

**Account risk, stated plainly.** Loading a non-allowlisted module into a protected game can get the game refused
or the player kicked ("untrusted module"). An account flag cannot be ruled out. With the OBS-signed DLL the module
is one the vendor exempts for OBS, but the use is not one the vendor has blessed. Nothing here should ship
default-on for protected games. Testing belongs on accounts the user is willing to lose.

**An existing risk to fix regardless.** The app registers its unsigned DLL as a global implicit Vulkan layer
(`vulkan_layer.rs`, HKCU). The registration happens at app start (`lib.rs`, `vulkan_layer::ensure_registered`, "register at startup — before
any Vulkan game launches"), not when a share begins. So from the moment the app runs, every Vulkan process loads our
unsigned DLL at `vkCreateInstance`, including protected games with a Vulkan renderer, whether or not anything is
being shared. The registrations also pile up: joi2 has entries for app-3.3.0, 3.5.0, 3.5.1 and 3.7.0, and this
development machine has about 50 (every past `app-*` folder plus `target/debug|release|profiling`). Most point at
folders that no longer exist.

## Licensing and naming

- The OBS binaries are GPL-2.0-only, the same as the fork today. We would ship them unmodified as separate
  programs next to our GPL-3.0-or-later app (aggregation, no linking). This is cleaner than today, where we ship our
  own modified build.
- Corresponding source: OBS publishes `OBS-Studio-<ver>-Sources.tar.gz` on the same GitHub release, and Detours
  comes from `obsproject/obs-deps`. GPLv2 §3 is met most simply by mirroring that tarball and the matching obs-deps
  source next to our installer on our own release ("equivalent access from the same place"). Ship
  `LICENSE-GPLv2.txt` and an attribution/source note next to the files, as the packaging guard already requires for
  the fork.
- Trademark: OBS's published IP policy (forum) asks third-party tools not to identify themselves with "OBS", not to
  use the logo, and not to imply affiliation. File names stay as OBS ships them (they are the signed bytes). UI copy
  and docs say what it is ("game capture uses the OBS Studio capture hook, by the OBS Project") without suggesting
  endorsement. Our own Vulkan layer JSON keeps our layer name and does not reuse "Open Broadcaster Software hook".
- Courtesy and risk: telling the OBS Project before shipping is cheap. If third-party use made vendors narrow their
  allowlists, OBS users would be harmed too.

## Performance

|                             | Fork hook (today)                                                    | OBS-signed hook (stock profile)                                                                 | WGC (today)                                                                                                    |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| cost inside the game        | one GPU `CopyResource` per present, capped at `frame_interval`       | same                                                                                            | none in-process. DWM composes the window. Whether capture keeps the game out of independent flip is unverified |
| cost on our device          | VP blt (BGRA→NV12 + scale)                                           | VP blt + one full-frame copy (no `BIND_RENDER_TARGET`)                                          | VP blt                                                                                                         |
| new-frame signal            | `frame_count`, one encode per real present                           | none, timer-paced. Duplicates when the game is below target fps, possible judder at equal rates | per composed frame                                                                                             |
| latency                     | frame ready right after the game's Present                           | same                                                                                            | about one compositor frame later                                                                               |
| legacy exclusive fullscreen | yes                                                                  | yes                                                                                             | no (black or no frames)                                                                                        |
| border / cursor             | none / game-drawn only                                               | same                                                                                            | border off (`SetIsBorderRequired(false)`), cursor optional                                                     |
| hybrid GPU                  | game and our device must share an adapter (`cross_adapter` fallback) | same                                                                                            | any adapter                                                                                                    |
| anti-cheat                  | blocked (unsigned)                                                   | per vendor and certificate generation                                                           | not affected                                                                                                   |
| leaves the game on stop     | yes                                                                  | no, stays loaded until the game exits                                                           | n/a                                                                                                            |

Measured, from the joi2 log of the Fortnite attempt (2560×1440 → 1280×720, negotiated 30 fps):

- The WGC pre-roll had `captured == encoded` and 0 drops over the window. That is true, and it says only that nothing
  was lost between capture and encode. It does not say the rate was 30.
- The `captured` counter went 45 → 971 over 18.8 s, about **49 fps**. A 30 fps share over the same time would be
  about 560 frames. So WGC delivered and the encoder encoded about 1.6× the negotiated rate, which spreads the
  bitrate thinner and spends GPU on frames the receiver may not need.
- Cause, by inspection: `wgc_capture.rs` does not set `MinUpdateInterval` (no occurrence in `desktop/src-tauri/src`),
  and nothing paces the WGC callback to the share's fps. WGC's default cadence is throttled to roughly 50–60 fps
  ([robmikh/Win32CaptureSample#82](https://github.com/robmikh/Win32CaptureSample/issues/82)), which fits 49. The
  hook paths do cap at `frame_interval`.
- Encoder counters during that pre-roll: `gpu_us=476` (fused VP blt, EWMA), `gpu_max_us=3640`, `enc_us=132`. The
  pipeline after capture is not the bottleneck.

The 49 fps figure comes from one log on one machine; it was not re-measured for this document. No log on either machine
contains a successful hook session, so there is no hook-vs-WGC measurement. The table's latency and pacing claims
follow from the pipelines and are not measured. Phase 0b measures them.

Independent WGC follow-up, not part of the hook design: set `MinUpdateInterval` to `1/fps` on Windows 11 24H2+
(build 26100+), or pace in the frame callback, so a 30 fps share stops encoding about 49 fps. Pacing also makes any
later hook-vs-WGC comparison fair.

Verdict: the stock hook is worth having only where WGC is the alternative and the game allows it. That means
protected titles, legacy fullscreen, and latency-sensitive viewers. It is not a replacement for the fork on
unprotected games. Upstreaming a present counter to OBS would close most of the gap (phase 4).

## Design

### Two flavors, one host

`HookFlavor::Own` (the fork, as today) and `HookFlavor::ObsSigned` (unmodified OBS release files). A flavor bundles:
artifact set, object-name prefix, capability flags (`frame_count`, `hooked_api`, `self_unload`, `bind_rt`),
first-frame window, and expected signer. `ObsIpcChannel` takes the flavor at `start`. Nothing else in the session
changes.

### Selection policy

Evaluated before any injection. The first match wins.

| Target                                                                                      | Hook                                                                                | Notes                                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| monitor source, AppContainer process, `compatibility.json` "cannot be captured"             | none → WGC                                                                          | the host has no AppContainer object namespace today                              |
| CS2 / VAC titles without the untrusted launch flag                                          | none → WGC                                                                          | VAC blocks injection                                                             |
| protected (PR #129 markers, plus the configured blocklist) and the user has not opted in    | none → WGC, reason `blocklisted`                                                    | default                                                                          |
| protected and opted in, vendor/generation not marked ❌ in the bundled policy table         | `ObsSigned`, safe inject                                                            | never `Own`                                                                      |
| unprotected, and OBS or another stock host already has `CaptureHook_` objects in the target | `Own`                                                                               | `RalphCaptureHook_` names do not collide, so the fork coexists with OBS          |
| protected, and OBS or another stock host already has `CaptureHook_` objects in the target   | none → WGC by default; attach to the resident hook only behind an experimental flag | phase 3. Never inject `ObsSigned` over it: two hosts would drive one `hook_info` |
| unprotected                                                                                 | `Own`                                                                               | best pacing and zero-copy. `ObsSigned` if the fork files are missing             |

Under the hook-exclusive policy the WGC outcomes become "unavailable", as today.

At most one injection attempt per protected target per app session. A block is remembered per exe and app version, so
the host never retry-loops against an anti-cheat driver.

The opt-in is a desktop setting ("Use the OBS-signed capture hook in anti-cheat protected games"). Its
description states the account risk in one sentence. It is off by default. A curated per-title list
(`verified: true` after a test on a throwaway account) can later enable it for specific games.

### Artifacts

- **Bundled, pinned copy** (recommended): the six files, about 1.1 MB, under `obs-capture/obs-signed/` in the
  payload. Download-on-demand adds a network dependency and a second verification path, and saves almost nothing.
- **Lock file** `desktop/packaging/obs-signed-hook.lock.json`: OBS version, tag commit, release asset name and
  SHA-256, and per file the in-zip path, SHA-256, PE `FileVersion`, and expected signer thumbprints (primary and
  nested). Also the `HOOK_VER` the host was tested against.
- **Never re-sign or touch the bytes.** The future Authenticode step for our own binaries must exclude
  `obs-capture/obs-signed/**`. `stage-payload.ps1` checks staged hashes against the lock. RMPK/LZMA is lossless.
- **Reusing a local OBS install** (`HKLM\SOFTWARE\OBS Studio`, Steam, or `C:\ProgramData\obs-studio-hook`, which
  OBS populates and which exists on this machine with a signed 1.8.7.0 copy, origin not determined): deferred. It
  only helps users who have OBS, it moves with OBS's update cadence, and `ProgramData\obs-studio-hook` is OBS's
  folder to manage. Revisit only if a vendor ends up allowlisting a newer generation than we ship.
- **More than one generation** (say 30.2.3 for EAC titles still on the old module): possible, since the protocol
  is identical. It ships code missing three crash fixes and a certificate that expired in 2024. Do it only if
  testing shows a title that accepts only the old certificate.

### Runtime location and the Vulkan layer

- On first use, copy the verified set to `%LOCALAPPDATA%\RalphMeet\capture-hook\obs-<ver>-<sha8>\`, outside the
  `app-<ver>` folders. The stock DLL stays loaded in games until they exit, so a file locked inside `app-<old>`
  would block cleanup. A content-addressed folder is shared by all app versions.
- Register one Vulkan layer manifest at one stable path (our layer name, pointing at the signed DLL), and delete
  every `ImplicitLayers` value pointing into `RalphMeet\app-*\obs-capture\` or a `target\…\obs-capture\`. The
  installer and the updater do the same cleanup. If OBS's own `VK_LAYER_OBS_HOOK` is registered, the second copy
  fails its dup-guard in `DllMain`, the loader skips it, and the first copy serves us (same protocol, same names).
- Never register the unsigned fork DLL as a global layer. Fork Vulkan capture would need an explicit opt-in, or
  should stay off.

### Verification at use

Before every injection: open the DLL with `FILE_SHARE_READ` only (no write or delete sharing), check SHA-256 against
the lock, run `WinVerifyTrust` (also `/all`, so the nested signature is checked), compare signer thumbprints, then
pass the path to the helper and keep the handle until the helper exits. That closes the swap window. Any mismatch
gives `hook_artifact_unverified` and WGC.

### Fallback reasons and status

New `FallbackReason` values, alongside #129's `hook_no_first_frame`:

- `hook_artifact_unverified`: hash, signature or version check failed.
- `hook_version_unsupported`: `hook_ver_major != 1`.
- `hook_not_loaded`: helper reported success, but `CaptureHook_HookInfo<pid>` never appeared within the window. This
  is the Fortnite case, distinct from "loaded but no frame".
- `hook_opt_in_required`: protected target, `ObsSigned` available, setting off. Lets the UI explain why.

`Capture_Status` gains `hook_flavor` (`own | obs-signed | attached`), `hook_version` (e.g. `1.8.8`), `obs_version`
(e.g. `33.0.1`) and `pacing` (`present | timer`). The streaming stats panel shows `Hook · OBS 33.0.1 · timer` or
`WGC · hook_not_loaded`.

### Updating to a new OBS release

1. A scheduled CI job compares the newest OBS release tag with the lock. On a change, it downloads the Windows zip,
   verifies the asset digest from the GitHub API, extracts the six files, and runs `signtool verify /pa /all`.
2. It fetches `graphics-hook-info.h`, `graphics-hook-ver.h`, `inject-helper.c` and `get-graphics-offsets.c` at
   the new tag and fails if the object names, the `hook_info` size or offsets, the argv, or the INI keys differ
   from the host's constants (a small parser in a test). Changed signer thumbprints are not a failure. They are
   flagged loudly: a certificate change is exactly when anti-cheat compatibility moves (OBS's ECC certificate
   expires 2027-01-27).
3. It opens a PR that bumps the lock and the mirrored source. Before merge: manual smoke on DX11, DX12, Vulkan and
   GL, plus the OBS KB table re-read for the new certificate generation.

### CI

- `desktop-validation.yml`: lock verification (hashes, signatures, thumbprints, versions) on the bundled files.
  The packaging guard extends `REQUIRED_MATERIALS` with the signed set and its license/source notes.
- Unit tests: profile name tables (`CaptureHook_` vs `RalphCaptureHook_`), the selection matrix (pure, like
  `prop_fallback_reason`), capability fallbacks, the version gate.
- `stage-payload.ps1`: staged bytes of `obs-signed/**` equal the lock.

## Risks

- Account action in protected games (above). Mitigation: opt-in, per-title verification, never the unsigned DLL.
- Vendor or OBS reaction to third-party use of the OBS hook: allowlists could narrow. Mitigation: talk to the OBS
  Project first, keep the use narrow.
- Sharing `CaptureHook_` objects: the stock profile has no coexistence with OBS capturing the same game. Both hosts
  would drive one hook, and either can stop it (`Stop` event) or change `frame_interval`. Mitigation: the selection
  policy above (never inject `ObsSigned` over a resident OBS hook), and treat an external stop as
  `hook_stopped_mid_session` and stay on WGC. Do not fight it with restart.
- The stock DLL stays loaded until the game exits, so updates must not try to delete it (handled by the shared
  folder).
- Worse pacing than the fork on the signed path (timer delivery, extra copy).
- OBS release churn: the protocol has been stable for over two years, but a future `HOOK_VER` major bump or name
  change would fail CI rather than ship.
- 32-bit games need the 32-bit set: same treatment, same lock.

## Phases and effort

| Phase                 | Work                                                                                                                                                                                                                                                                                                                                                                                                           | Estimate  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0a. Safety now        | No new capability. Register the Vulkan layer only while a share is active (or point it at the signed copy once phase 2 lands), and remove stale per-version `ImplicitLayers` values at app start and in the installer/updater. Anti-cheat titles stay on WGC (#129)                                                                                                                                            | 0.5–1 day |
| 0b. Evidence          | Throwaway host build with the stock profile against OBS 33.0.1 files: unprotected DX11/DX12/Vulkan game, then one protected title on an account the user accepts to risk (user's decision). PresentMon for present mode and frame time with and without WGC. `NativeShareDiag` for all three modes. Glass-to-glass latency with an on-screen timer                                                             | 1–2 days  |
| 1. Host stock profile | flavor/profile in `obs_ipc.rs`/`inject.rs`, attach-to-resident, first-frame window, version gate, `hook_not_loaded` detection                                                                                                                                                                                                                                                                                  | 3–5 days  |
| 2. Artifacts          | lock file, CI fetch/verify, payload manifest entries, shared runtime folder, Vulkan layer cleanup and single registration, source mirror, THIRD_PARTY_LICENSES                                                                                                                                                                                                                                                 | 3–4 days  |
| 3. Policy and UI      | selection matrix, opt-in setting (Rust-owned settings), status fields, panel copy, experimental attach-to-OBS                                                                                                                                                                                                                                                                                                  | 2–3 days  |
| 4. Optional           | SRV shader converter (drops the extra copy for both flavors), propose a present counter in `reserved[]` upstream to OBS, per-title verified list, old-generation set if testing demands it, and the long-term clean path: sign the fork under our own identity and ask EAC and BattlEye to allowlist it (`CODE_SIGNING_POLICY.md` excludes modified upstream artifacts today and would need a scope expansion) | open      |

Order relative to the desktop plan: after #129 merges, and independent of C4 (web desktop-host interface). Phase 2
touches the payload manifest from #112 and the installer, so it goes through the same packaging review.

## Sources

- OBS KB, [Capture Hook Certificate Update](https://obsproject.com/kb/capture-hook-certificate-update) (anti-cheat × certificate table).
- OBS KB, [Game Capture Source](https://obsproject.com/kb/game-capture-source) (anti-cheat compatibility hook option, memory capture).
- OBS forum, [Can I get a signed build of graphics-hook32.dll](https://obsproject.com/forum/threads/can-i-get-a-signed-build-of-graphics-hook32-dll.74181).
- OBS forum, [anti-cheat compatibility hooking](https://obsproject.com/forum/threads/obs-0-62b-test-1.13284/page-2) (`SetWindowsHookEx`).
- OBS forum, [Forum resource and IP policy](https://obsproject.com/forum/threads/forum-resource-and-ip-policy.178569/) (naming and logo).
- OBS forum, [I was able to capture VALORANT gameplay with 31.0.3](https://obsproject.com/forum/threads/i-was-able-to-capture-valorant-gameplay-with-the-latest-obs-31-0-3.185315) (Vanguard and the 31.0 certificate).
- OBS forum, [Black Screen - 19.0.3](https://obsproject.com/forum/threads/black-screen-19-0-3.70638) (a build-specific anti-cheat allowlist).
- [hzqst/obs-rs](https://github.com/hzqst/obs-rs) (a third-party host for OBS's signed hook; its allowlist claim is unverified).
- Microsoft Learn, [`GraphicsCaptureSession.MinUpdateInterval`](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.minupdateinterval) (26100+), and
  WGC cadence report [robmikh/Win32CaptureSample#82](https://github.com/robmikh/Win32CaptureSample/issues/82).
- Release assets `OBS-Studio-{32.1.0,32.1.2,32.2.2}-Windows-x64.zip`: zip central-directory CRCs for the
  patch/minor identity of the hook binaries.
- `obsproject/obs-studio` at tags `27.0.0`, `28.0.0` (header only), `30.2.3`, `31.1.2`, `32.1.2` (`fb4d98b`) and `33.0.1` (`65c320b`),
  plus `shared/obs-inject-library/inject-library.c`:
  `shared/obs-hook-config/*`, `plugins/win-capture/{game-capture.c,game-capture-file-init.c,graphics-hook/*,inject-helper/*,get-graphics-offsets/*,data/compatibility.json}`,
  `.github/actions/windows-signing/*`.
- GitHub release assets `OBS-Studio-33.0.1-Windows-x64.zip` and `OBS-Studio-30.2.3-Windows.zip` (signatures and hashes above).
- joi2 `%LOCALAPPDATA%\RalphMeet\logs\desktop_2026-11-01_05-46-58.log` and `graphics-hook-28420.log` (read-only).
