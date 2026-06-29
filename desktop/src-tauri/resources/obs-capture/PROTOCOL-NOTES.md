# OBS 32.1.2 game-capture IPC — verified protocol notes

These notes record the **verified** OBS Studio 32.1.2 `win-capture` protocol the
host (`src/game_capture/obs_ipc.rs`, `inject.rs`) implements, reconciled against
upstream source so the "(verify against pinned OBS source)" tags are resolved.

Sources (tag `32.1.2`, commit `fb4d98b`):
- `shared/obs-hook-config/graphics-hook-info.h` — structs + object names.
- `shared/obs-hook-config/hook-helpers.h` — `create/open_event/_mutex` + `_plus_id`.
- `plugins/win-capture/graphics-hook/graphics-hook.c` — injected DLL init/handshake.
- `plugins/win-capture/graphics-hook/d3d11-capture.cpp` — shtex creation/copy.
- `plugins/win-capture/game-capture.c` — host orchestration.
- `plugins/win-capture/load-graphics-offsets.c` + `get-graphics-offsets/*` — offsets.
- `plugins/win-capture/inject-helper/inject-helper.c` — `argc==4`, exit codes.

## Object names (suffixed by the target PROCESS ID, e.g. `...12345`)

| Macro | Name | Creator | Notes |
| --- | --- | --- | --- |
| `EVENT_CAPTURE_RESTART` | `CaptureHook_Restart` | DLL | DLL sets it when ready; host may set to re-signal |
| `EVENT_CAPTURE_STOP` | `CaptureHook_Stop` | DLL | host→hook stop |
| `EVENT_HOOK_READY` | `CaptureHook_HookReady` | DLL | hook→host, **per init/resize** (not per frame) |
| `EVENT_HOOK_EXIT` | `CaptureHook_Exit` | DLL | hook→host exit |
| `EVENT_HOOK_INIT` | `CaptureHook_Initialize` | DLL | host sets it to release the DLL capture loop |
| `WINDOW_HOOK_KEEPALIVE` | `CaptureHook_KeepAlive` | host (DLL opens) | mutex; hook self-ejects if it disappears |
| `MUTEX_TEXTURE1/2` | `CaptureHook_TextureMutex1/2` | DLL | shared-texture access mutexes |
| `SHMEM_HOOK_INFO` | `CaptureHook_HookInfo` | DLL | 648-byte `hook_info` mapping |
| `SHMEM_TEXTURE` | `CaptureHook_Texture_<root-hwnd>_<map_id>` | DLL | shtex data (4-byte `tex_handle`) |
| pipe | `CaptureHook_Pipe<pid>` | host (`ipc_pipe_server`) | DLL → host log text only |

NOTE: in OBS the host **creates** the keepalive mutex and the DLL creates
everything else in `DllMain`. Our host opens what the DLL created and holds the
keepalive open for the channel's lifetime.

## `struct hook_info` — 648 bytes (`static_assert`), `#pragma pack(push, 8)`

Field offsets the host reads/writes are pinned in `obs_ipc.rs` (`OFF_*`,
`GOFF_*`). The host **writes** `offsets.dxgi.{present,resize,present1}`,
`offsets.dxgi2.release`, `frame_interval`, `force_shmem=0`, `allow_srgb_alias=1`.
The DLL **writes** `type`, `window`, `format`, `cx`, `cy`, `map_id`, `map_size`,
`hook_ver_*` in `capture_init_shtex`.

`shtex_data { uint32_t tex_handle; }` — a **legacy** DXGI shared handle
(`IDXGIResource::GetSharedHandle`), so 32-bit, opened with
`ID3D11Device::OpenSharedResource`.

### Fork extension: `frame_count` (present-accurate delivery)

Stock OBS gives the host **no per-present signal** — `HookReady` fires only on
init/resize, and the DLL keeps copying each present into the *same* shared
texture in between. So a host that samples on a wall clock either re-encodes
duplicate frames (game below the clock) or misses the true cadence.

This fork adds a single field to publish the real present rate. The original
`uint32_t reserved[126]` tail is split into:

```
uint32_t        frame_count;   // abs offset 144 (was reserved[0])
volatile ...                   // DLL: ++ once per captured present (shtex copy)
uint32_t        reserved[125]; // abs offset 148.. (unchanged tail)
```

`sizeof(struct hook_info)` stays **648** (the `static_assert` still holds), so
the ABI is preserved — stock OBS only ever zeroed this region. The DLL bumps
`frame_count` in `hook_info_signal_frame()` (graphics-hook.h) from each
backend's shtex capture path (`d3d11`/`d3d10`/`d3d9`/`d3d12`/`gl`/`vk`
`*_shtex_capture`), on the game's render thread, right after a successful copy.

Host side: `obs_ipc.rs` reads it at `OFF_FRAME_COUNT` (144) and forwards a frame
**only when it advances** — delivery tracks the game's true present rate with no
duplicate re-encodes. `frame_interval` still caps the DLL's copy rate at the
negotiated encode fps (so a 240fps game doesn't burn GPU copying unused frames).
A 4-byte aligned load/store is atomic on x86/x64 and the host only needs the
monotonic "did it advance?" signal (wrap is harmless — it compares for
inequality). A DLL that does **not** publish the counter (older/stock) leaves it
at 0; the host detects the never-advancing counter after a short grace window
and falls back to paced reuse delivery at `frame_interval`, so it still streams.

## Host handshake (implemented in `ObsIpcChannel`)

1. Open keepalive mutex; open texture mutexes (presence = "DLL loaded"; absent ⇒
   ERROR_FILE_NOT_FOUND ⇒ retry).
2. Open + map `CaptureHook_HookInfo<pid>` (RW); **write DXGI offsets** (from
   `get-graphics-offsets<bits>.exe`, parsed by `parse_graphics_offsets`) +
   `frame_interval` + options.
3. Open events; `SetEvent(Initialize)` to release the DLL `capture_loop`.
4. On `HookReady`: read `hook_info.{type,window,format,cx,cy,map_id}`, open
   `CaptureHook_Texture_<window>_<map_id>`, read `tex_handle`, `OpenSharedResource`,
   and baseline `frame_count`.
5. Forward a frame only when `hook_info.frame_count` advances (present-accurate;
   HookReady is per init/resize only).

## inject-helper argv / exit codes

`inject-helper.exe <dll_path> <use_safe_inject> <id>` (`argc==4`). We pass
`use_safe_inject=0` + PID. Exit: `0` success, `-3` OpenProcess denied
(anti-cheat → Blocked), other negatives → Failed.

## Remaining work to reach live frames (honest status)

Implemented & compiling: artifact bundling, offsets exe run + parse, the full
handshake, hook_info population, shtex resolve + sample, retain-at-most-one,
fallback wiring, status reporting.

### RESOLVED on hardware (2026-05-30): the zero-frame root cause

Live testing against DX11 (Deadlock, 720p30) reached `capture_mode=hook` and
`feeding encoder from the zero-copy hook`, but `received=0` and the watchdog
tripped after ~2s (`initialize_signaled_no_hookready`). Root cause, confirmed
against pinned OBS 32.1.2 source:

- **The host must CREATE the keepalive mutex, not open it.** The injected DLL
  gates **all** capture initialization on `capture_alive()`
  (`graphics-hook.h`: `OpenMutexW(CaptureHook_KeepAlive<pid>)`), reached via
  `capture_should_init()`. In OBS the **host** creates this mutex
  (`game-capture.c::init_keepalive` → `CreateMutexW(NULL, false, name)`); the
  DLL only opens it. Our host was calling `open_mutex(WINDOW_HOOK_KEEPALIVE)`,
  which always failed (nothing had created it), so `capture_alive()` stayed
  false, `capture_init_shtex` never ran, and `HookReady` never fired. Fixed:
  `obs_ipc.rs::create_keepalive_mutex` now `CreateMutexW`s it at channel start
  and holds it open for the channel lifetime (released on `stop`, letting the
  hook self-eject via `capture_should_stop`). Regression test:
  `host_creates_keepalive_mutex_so_dll_capture_alive_succeeds`.

### Hardening applied alongside the fix

- **shtex mapping name uses the GA_ROOT ancestor.** The DLL names the mapping
  from `GetAncestor(OutputWindow, GA_ROOT)` (`graphics-hook.c::init_shared_info`)
  but writes the **raw** OutputWindow into `hook_info.window`. The host now
  tries the `GetAncestor(.., GA_ROOT)` name first, then the raw-window name —
  mirroring OBS's own dual attempt (`game-capture.c::init_capture_data`).
- **Texture mutexes are shmem-only.** Verified the shtex (zero-copy) path does a
  plain `CopyResource` with **no** texture mutex; the named `TextureMutex1/2` are
  used only by the shmem (CPU) copy path. The host's `acquire_texture_lock` is
  therefore uncontended on the shtex path (benign; never the blocker).

### Verified-correct (no change needed)

- `hook_info` 648-byte layout + every field offset — matches
  `shared/obs-hook-config/graphics-hook-info.h` exactly (`static_assert == 648`).
- The offsets-exe INI keys/format — matches `get-graphics-offsets.c` (note OBS
  prints `release` under `[dxgi]`; our parser routes it to `dxgi2.release`).
- Legacy `OpenSharedResource` for the 32-bit `GetSharedHandle()` handle — correct
  (`d3d11-capture.cpp::create_d3d11_tex` uses `IDXGIResource::GetSharedHandle`).

### Still NOT validated on hardware (needs a re-test run)

- That the keepalive fix actually yields `received>0` / sustained frames against
  a live DX11 game (the fix is correct against source; awaiting a capture run).
- DX12 / Vulkan / OpenGL live paths.
- No-tearing on the shtex path under high fps.

Run `pnpm run dev:deployed:script` (hook on by default) against a windowed DX11
game and read `%LOCALAPPDATA%\RalphMeet\logs\desktop.log` —
`[ObsIpcChannel]` / `[inject]` lines report each step and any mismatch.

## Zero-overhead pipeline audit (2026-05-31)

Full game-present → WebRTC path, audited end to end for copies / latency:

1. **DLL backbuffer → shared texture** (`d3d11_shtex_capture`): one GPU
   `CopyResource` per real present. This IS the capture; unavoidable. The shared
   texture is created with `BIND_SHADER_RESOURCE | BIND_RENDER_TARGET` and a
   **typed UNORM** format (host writes `allow_srgb_alias=0`) so the host's
   VideoProcessor binds it directly — no host-side normalize copy.
2. **DLL → host new-frame signal**: `hook_info.frame_count` (fork field) bumped
   once per captured present. Host forwards only when it advances → present-
   accurate, no duplicate re-encodes.
3. **Host open**: `OpenSharedResource` runs **once per handle** (cached in
   `GameCaptureHook.current`); the handle is stable between resizes, so steady-
   state frames hand the encoder a COM `clone()` (AddRef, same VRAM) — no per-
   frame kernel/GPU open, strictly zero-copy.
4. **Host → encoder**: `CapturedFrame` borrows the texture (no copy); a per-frame
   release token enforces retain-at-most-one.
5. **Encoder convert**: ONE fused `VideoProcessorBlt` (BGRA→NV12 + downscale)
   into a pre-allocated NV12 ring slot — no intermediate BGRA copy. Bounded by a
   scoped completion query (no per-frame `Flush`).
6. **Encoder submit**: the NV12 slot is wrapped as a DXGI surface buffer and
   `ProcessInput` to the hardware MFT (NVENC) — GPU-resident, no readback.
7. **Output → WebRTC**: the compressed H.264 bitstream is copied out of the MFT
   sample into a `Vec<u8>` and sent to the track. This is the only CPU copy and
   is of compressed data (tens of KB); unavoidable for `write_sample`.

Net: exactly one capture copy (the DLL's, inherent) + one GPU convert/scale +
one compressed-output copy. No CPU readback of pixels anywhere on the hook path.

### Seamless quality switching (in place, no restart)

`update_native_screen_quality` reconfigures the LIVE encoder via a control
channel into the encoder thread: it rebuilds the VideoProcessor **output** (the
downscale target) and resets the MFT output type (frame size/rate) + bitrate at
a frame boundary, emitting a fresh keyframe. The capture source (hook surface or
WGC), the WebRTC peer connection, and the track are all untouched — no re-
injection, no new capture, no SDP renegotiation. The source side of the VP is
unchanged (the game's native frame), so a quality switch adds no extra copy.
