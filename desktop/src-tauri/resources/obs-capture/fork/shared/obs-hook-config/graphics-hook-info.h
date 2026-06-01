#pragma once

#include <assert.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>

#include "hook-helpers.h"

/*
 * === ralph-meet fork modification (owned-game-capture-hook, task 1.1) =======
 *
 * The ONLY change from upstream OBS 32.1.2 in this header is the object-name
 * string prefix below: every IPC object name's leading "CaptureHook_" is
 * renamed to the project's Private_Namespace prefix "RalphCaptureHook_" so the
 * Forked_Hook_DLL never shares a kernel-object name with a stock OBS install
 * hooking the same target process (Requirements 2.1, 2.2). The macro names and
 * the per-object name suffixes (Restart/Stop/HookReady/Exit/Initialize/
 * KeepAlive/TextureMutex1/TextureMutex2/HookInfo/Texture/Pipe) are UNCHANGED,
 * so the host's per-target name builder (format!("{base}{pid}")) resolves the
 * exact objects this DLL creates.
 *
 * This prefix MUST stay byte-for-byte in sync with the host constant
 * PRIVATE_NS in desktop/src-tauri/src/game_capture/obs_ipc.rs
 * ("RalphCaptureHook_"). If you change it in one place, change it in both.
 *
 * Everything below the name macros (the "#pragma pack(push, 8)" structs,
 * struct hook_info and its static_assert(sizeof == 648), shtex_data,
 * shmem_data, graphics_offsets, and create_hook_info) is kept byte-for-byte
 * identical to OBS 32.1.2 (Requirement 2.2 ABI clause): the fork changes only
 * the name strings, never the wire layout.
 * =========================================================================== */

#define EVENT_CAPTURE_RESTART L"RalphCaptureHook_Restart"
#define EVENT_CAPTURE_STOP L"RalphCaptureHook_Stop"

#define EVENT_HOOK_READY L"RalphCaptureHook_HookReady"
#define EVENT_HOOK_EXIT L"RalphCaptureHook_Exit"

#define EVENT_HOOK_INIT L"RalphCaptureHook_Initialize"

#define WINDOW_HOOK_KEEPALIVE L"RalphCaptureHook_KeepAlive"

#define MUTEX_TEXTURE1 L"RalphCaptureHook_TextureMutex1"
#define MUTEX_TEXTURE2 L"RalphCaptureHook_TextureMutex2"

#define SHMEM_HOOK_INFO L"RalphCaptureHook_HookInfo"
#define SHMEM_TEXTURE L"RalphCaptureHook_Texture"

#define PIPE_NAME "RalphCaptureHook_Pipe"

#pragma pack(push, 8)

struct d3d8_offsets {
	uint32_t present;
};

struct d3d9_offsets {
	uint32_t present;
	uint32_t present_ex;
	uint32_t present_swap;
	uint32_t d3d9_clsoff;
	uint32_t is_d3d9ex_clsoff;
};

struct d3d12_offsets {
	uint32_t execute_command_lists;
};

struct dxgi_offsets {
	uint32_t present;
	uint32_t resize;

	uint32_t present1;
};

struct dxgi_offsets2 {
	uint32_t release;
};

struct ddraw_offsets {
	uint32_t surface_create;
	uint32_t surface_restore;
	uint32_t surface_release;
	uint32_t surface_unlock;
	uint32_t surface_blt;
	uint32_t surface_flip;
	uint32_t surface_set_palette;
	uint32_t palette_set_entries;
};

struct shmem_data {
	volatile int last_tex;
	uint32_t tex1_offset;
	uint32_t tex2_offset;
};

struct shtex_data {
	uint32_t tex_handle;
};

enum capture_type {
	CAPTURE_TYPE_MEMORY,
	CAPTURE_TYPE_TEXTURE,
};

/* The actually-hooked graphics API, reported by the fork DLL in
 * `hook_info.hooked_api` so the host can label the TRUE backend (no guessing
 * from loaded modules). Values are a stable ABI shared with the host
 * (game_capture/obs_ipc.rs HookedApi). Keep in sync. */
enum ralph_hooked_api {
	RALPH_HOOKED_API_NONE = 0,
	RALPH_HOOKED_API_DXGI = 1, /* D3D10/11/12 — all present via DXGI */
	RALPH_HOOKED_API_D3D9 = 2,
	RALPH_HOOKED_API_D3D8 = 3,
	RALPH_HOOKED_API_VULKAN = 4,
	RALPH_HOOKED_API_OPENGL = 5,
};

struct graphics_offsets {
	struct d3d8_offsets d3d8;
	struct d3d9_offsets d3d9;
	struct dxgi_offsets dxgi;
	struct ddraw_offsets ddraw;
	struct dxgi_offsets2 dxgi2;
	struct d3d12_offsets d3d12;
};

struct hook_info {
	/* hook version */
	uint32_t hook_ver_major;
	uint32_t hook_ver_minor;

	/* capture info */
	enum capture_type type;
	uint32_t window;
	uint32_t format;
	uint32_t cx;
	uint32_t cy;
	uint32_t UNUSED_base_cx;
	uint32_t UNUSED_base_cy;
	uint32_t pitch;
	uint32_t map_id;
	uint32_t map_size;
	bool flip;

	/* additional options */
	uint64_t frame_interval;
	bool UNUSED_use_scale;
	bool force_shmem;
	bool capture_overlay;
	bool allow_srgb_alias;

	/* hook addresses */
	struct graphics_offsets offsets;

	/* present-accurate frame publish counter (fork extension).
	 *
	 * Incremented by the hook DLL once per successful shared-texture copy
	 * (i.e. once per real game present that is actually captured), on the
	 * game's render thread. The host reads it to forward a frame to the
	 * encoder ONLY when it advances, so delivery tracks the game's true
	 * present rate with no duplicate re-encodes (present-accurate sampling)
	 * instead of polling on a wall clock.
	 *
	 * Carved out of the original `reserved[126]` tail: `reserved` shrinks to
	 * 125 so the struct stays exactly 648 bytes and the OBS ABI is preserved
	 * (stock OBS only ever zeroed this region). `volatile` so the compiler
	 * does not elide/reorder the cross-process store; a 4-byte aligned u32
	 * store/load is atomic on x86/x64, which is all the host's monotonic
	 * "did it advance?" check needs. */
	volatile uint32_t frame_count;

	/* actually-hooked graphics API (fork extension).
	 *
	 * Set by the hook DLL to a `ralph_hooked_api` value the moment it
	 * successfully installs a present interception (`hook_dxgi`/`hook_d3d9`/
	 * `hook_vulkan`/`hook_gl`/d3d8/d3d12), so the HOST can report the TRUE
	 * backend the game uses rather than guessing from loaded modules (a
	 * Vulkan game also loads d3d11.dll, which made the guess wrong). 0 =
	 * not yet hooked. Carved from the same `reserved` tail as `frame_count`
	 * (reserved shrinks 125 -> 124) so the struct stays exactly 648 bytes and
	 * the OBS ABI is preserved. `volatile` for the same cross-process,
	 * 4-byte-atomic store/load reasoning as `frame_count`. */
	volatile uint32_t hooked_api;

	uint32_t reserved[124];
};
static_assert(sizeof(struct hook_info) == 648, "ABI compatibility");

#pragma pack(pop)

#define GC_MAPPING_FLAGS (FILE_MAP_READ | FILE_MAP_WRITE)

static inline HANDLE create_hook_info(DWORD id)
{
	HANDLE handle = NULL;

	wchar_t new_name[64];
	const int len = swprintf(new_name, _countof(new_name), SHMEM_HOOK_INFO L"%lu", id);
	if (len > 0) {
		handle = CreateFileMappingW(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, sizeof(struct hook_info),
					    new_name);
	}

	return handle;
}
