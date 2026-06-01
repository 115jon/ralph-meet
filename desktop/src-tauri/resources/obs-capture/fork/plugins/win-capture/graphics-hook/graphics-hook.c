#include <windows.h>
#include <psapi.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdarg.h>
#include "graphics-hook.h"
#ifdef OBS_LEGACY
#include "../graphics-hook-ver.h"
#include "../../libobs/util/windows/obfuscate.h"
#else
#include <graphics-hook-ver.h>
#include <util/windows/obfuscate.h>
#endif

#define DEBUG_OUTPUT

#ifdef DEBUG_OUTPUT
#define DbgOut(x) OutputDebugStringA(x)
#else
#define DbgOut(x)
#endif

/* ──────────────────────────────────────────────────────────────────────────
 * Self-contained DLL file diagnostics (independent of the host IPC pipe).
 *
 * The OBS `hlog` path only works once the host pipe is connected, which only
 * happens after a present hook installs — so a hook that never installs (e.g.
 * a swapchain conflict with a coexisting Discord/OBS hook) is completely
 * silent. This logger writes directly to a per-PID file under the app's log
 * dir so the host-side agent can read exactly what the injected DLL did, with
 * zero dependency on the pipe, the keepalive, or hook success.
 *
 * Path: %LOCALAPPDATA%\dev.jontitor.ralph-meet\logs\graphics-hook-<pid>.log
 * Best-effort and crash-safe: each line opens, appends, and closes the file.
 * ────────────────────────────────────────────────────────────────────────── */
void ralph_dbg_log(const char *fmt, ...)
{
	char path[MAX_PATH];
	const DWORD n = GetEnvironmentVariableA("LOCALAPPDATA", path, MAX_PATH);
	if (n == 0 || n >= MAX_PATH)
		return;

	char full[MAX_PATH];
	const int len = _snprintf_s(full, sizeof(full), _TRUNCATE,
				    "%s\\dev.jontitor.ralph-meet\\logs\\graphics-hook-%lu.log", path,
				    GetCurrentProcessId());
	if (len < 0)
		return;

	HANDLE f = CreateFileA(full, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
			       OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
	if (f == INVALID_HANDLE_VALUE)
		return;

	char line[1024];
	SYSTEMTIME st;
	GetLocalTime(&st);
	int off = _snprintf_s(line, sizeof(line), _TRUNCATE, "[%02d:%02d:%02d.%03d][pid %lu] ",
			      st.wHour, st.wMinute, st.wSecond, st.wMilliseconds, GetCurrentProcessId());
	if (off < 0)
		off = 0;

	va_list args;
	va_start(args, fmt);
	int body = _vsnprintf_s(line + off, sizeof(line) - off, _TRUNCATE, fmt, args);
	va_end(args);
	if (body < 0)
		body = 0;
	int total = off + body;
	if (total > (int)sizeof(line) - 2)
		total = (int)sizeof(line) - 2;
	line[total++] = '\n';

	DWORD written = 0;
	SetFilePointer(f, 0, NULL, FILE_END);
	WriteFile(f, line, (DWORD)total, &written, NULL);
	CloseHandle(f);
}

struct thread_data {
	CRITICAL_SECTION mutexes[NUM_BUFFERS];
	CRITICAL_SECTION data_mutex;
	void *volatile cur_data;
	uint8_t *shmem_textures[2];
	HANDLE copy_thread;
	HANDLE copy_event;
	HANDLE stop_event;
	volatile int cur_tex;
	unsigned int pitch;
	unsigned int cy;
	volatile bool locked_textures[NUM_BUFFERS];
};

ipc_pipe_client_t pipe = {0};
HANDLE signal_restart = NULL;
HANDLE signal_stop = NULL;
HANDLE signal_ready = NULL;
HANDLE signal_exit = NULL;
static HANDLE signal_init = NULL;
HANDLE tex_mutexes[2] = {NULL, NULL};
static HANDLE filemap_hook_info = NULL;

static HINSTANCE dll_inst = NULL;
static volatile bool stop_loop = false;
static HANDLE dup_hook_mutex = NULL;
static HANDLE capture_thread = NULL;
char system_path[MAX_PATH] = {0};
char process_name[MAX_PATH] = {0};
wchar_t keepalive_name[64] = {0};
HWND dummy_window = NULL;

static unsigned int shmem_id_counter = 0;
static void *shmem_info = NULL;
static HANDLE shmem_file_handle = 0;

static struct thread_data thread_data = {0};

volatile bool active = false;
struct hook_info *global_hook_info = NULL;

static inline void wait_for_dll_main_finish(HANDLE thread_handle)
{
	if (thread_handle) {
		WaitForSingleObject(thread_handle, 100);
		CloseHandle(thread_handle);
	}
}

bool init_pipe(void)
{
	char new_name[64];
	snprintf(new_name, sizeof(new_name), "%s%lu", PIPE_NAME, GetCurrentProcessId());

	const bool success = ipc_pipe_client_open(&pipe, new_name);
	if (!success) {
		DbgOut("[OBS] Failed to open pipe\n");
	}

	return success;
}

static HANDLE init_event(const wchar_t *name, DWORD pid)
{
	HANDLE handle = create_event_plus_id(name, pid);
	if (!handle)
		hlog("Failed to get event '%s': %lu", name, GetLastError());
	return handle;
}

static HANDLE init_mutex(const wchar_t *name, DWORD pid)
{
	HANDLE handle = create_mutex_plus_id(name, pid);
	if (!handle)
		hlog("Failed to open mutex '%s': %lu", name, GetLastError());
	return handle;
}

static inline bool init_signals(void)
{
	DWORD pid = GetCurrentProcessId();

	signal_restart = init_event(EVENT_CAPTURE_RESTART, pid);
	if (!signal_restart) {
		return false;
	}

	signal_stop = init_event(EVENT_CAPTURE_STOP, pid);
	if (!signal_stop) {
		return false;
	}

	signal_ready = init_event(EVENT_HOOK_READY, pid);
	if (!signal_ready) {
		return false;
	}

	signal_exit = init_event(EVENT_HOOK_EXIT, pid);
	if (!signal_exit) {
		return false;
	}

	signal_init = init_event(EVENT_HOOK_INIT, pid);
	if (!signal_init) {
		return false;
	}

	return true;
}

static inline bool init_mutexes(void)
{
	DWORD pid = GetCurrentProcessId();

	tex_mutexes[0] = init_mutex(MUTEX_TEXTURE1, pid);
	if (!tex_mutexes[0]) {
		return false;
	}

	tex_mutexes[1] = init_mutex(MUTEX_TEXTURE2, pid);
	if (!tex_mutexes[1]) {
		return false;
	}

	return true;
}

static inline bool init_system_path(void)
{
	UINT ret = GetSystemDirectoryA(system_path, MAX_PATH);
	if (!ret) {
		hlog("Failed to get windows system path: %lu", GetLastError());
		return false;
	}

	return true;
}

static inline void log_current_process(void)
{
	DWORD len = GetModuleBaseNameA(GetCurrentProcess(), NULL, process_name, MAX_PATH);
	if (len > 0) {
		process_name[len] = 0;
		hlog("graphics-hook.dll loaded against process: %s", process_name);
	} else {
		hlog("graphics-hook.dll loaded");
	}

	hlog("(half life scientist) everything..  seems to be in order");
}

static inline bool init_hook_info(void)
{
	filemap_hook_info = create_hook_info(GetCurrentProcessId());
	if (!filemap_hook_info) {
		hlog("Failed to create hook info file mapping: %lu", GetLastError());
		return false;
	}

	global_hook_info = MapViewOfFile(filemap_hook_info, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(struct hook_info));
	if (!global_hook_info) {
		hlog("Failed to map the hook info file mapping: %lu", GetLastError());
		return false;
	}

	return true;
}

#define DEF_FLAGS (WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS)

static DWORD WINAPI dummy_window_thread(LPVOID *unused)
{
	static const wchar_t dummy_window_class[] = L"temp_d3d_window_4039785";
	WNDCLASSW wc;
	MSG msg;

	memset(&wc, 0, sizeof(wc));
	wc.style = CS_OWNDC;
	wc.hInstance = dll_inst;
	wc.lpfnWndProc = (WNDPROC)DefWindowProc;
	wc.lpszClassName = dummy_window_class;

	if (!RegisterClass(&wc)) {
		hlog("Failed to create temp D3D window class: %lu", GetLastError());
		return 0;
	}

	dummy_window = CreateWindowExW(0, dummy_window_class, L"Temp Window", DEF_FLAGS, 0, 0, 1, 1, NULL, NULL,
				       dll_inst, NULL);
	if (!dummy_window) {
		hlog("Failed to create temp D3D window: %lu", GetLastError());
		return 0;
	}

	while (GetMessage(&msg, NULL, 0, 0)) {
		TranslateMessage(&msg);
		DispatchMessage(&msg);
	}

	(void)unused;
	return 0;
}

static inline void init_dummy_window_thread(void)
{
	HANDLE thread = CreateThread(NULL, 0, dummy_window_thread, NULL, 0, NULL);
	if (!thread) {
		hlog("Failed to create temp D3D window thread: %lu", GetLastError());
		return;
	}

	CloseHandle(thread);
}

static inline bool init_hook(HANDLE thread_handle)
{
	wait_for_dll_main_finish(thread_handle);

	_snwprintf(keepalive_name, sizeof(keepalive_name) / sizeof(wchar_t), L"%s%lu", WINDOW_HOOK_KEEPALIVE,
		   GetCurrentProcessId());

	init_dummy_window_thread();
	log_current_process();

	SetEvent(signal_restart);
	return true;
}

static inline void close_handle(HANDLE *handle)
{
	if (*handle) {
		CloseHandle(*handle);
		*handle = NULL;
	}
}

static void free_hook(void)
{
	if (filemap_hook_info) {
		CloseHandle(filemap_hook_info);
		filemap_hook_info = NULL;
	}
	if (global_hook_info) {
		UnmapViewOfFile(global_hook_info);
		global_hook_info = NULL;
	}

	close_handle(&tex_mutexes[1]);
	close_handle(&tex_mutexes[0]);
	close_handle(&signal_exit);
	close_handle(&signal_ready);
	close_handle(&signal_stop);
	close_handle(&signal_restart);
	close_handle(&dup_hook_mutex);
	ipc_pipe_client_free(&pipe);
}

static inline bool d3d8_hookable(void)
{
	return !!global_hook_info->offsets.d3d8.present;
}

static inline bool ddraw_hookable(void)
{
	return !!global_hook_info->offsets.ddraw.surface_create && !!global_hook_info->offsets.ddraw.surface_restore &&
	       !!global_hook_info->offsets.ddraw.surface_release && !!global_hook_info->offsets.ddraw.surface_unlock &&
	       !!global_hook_info->offsets.ddraw.surface_blt && !!global_hook_info->offsets.ddraw.surface_flip &&
	       !!global_hook_info->offsets.ddraw.surface_set_palette &&
	       !!global_hook_info->offsets.ddraw.palette_set_entries;
}

static inline bool d3d9_hookable(void)
{
	return !!global_hook_info->offsets.d3d9.present && !!global_hook_info->offsets.d3d9.present_ex &&
	       !!global_hook_info->offsets.d3d9.present_swap;
}

static inline bool dxgi_hookable(void)
{
	return !!global_hook_info->offsets.dxgi.present && !!global_hook_info->offsets.dxgi.resize;
}

static inline bool attempt_hook(void)
{
	//static bool ddraw_hooked = false;
	static bool d3d8_hooked = false;
	static bool d3d9_hooked = false;
	static bool d3d12_hooked = false;
	static bool dxgi_hooked = false;
	static bool gl_hooked = false;

	/* ── Capture model: commit on a REAL present, not on install ────────────
	 *
	 * A process presents through exactly ONE graphics API, but for D3D/GL we
	 * cannot know which from install alone: `d3d9_hookable()`/`dxgi_hookable()`
	 * etc. only check that the GLOBAL vtable offsets were resolved (they are
	 * non-zero for EVERY session regardless of the game), and `hook_d3d9()`
	 * "succeeds" merely because d3d9.dll is loaded — which it is, incidentally,
	 * in many DXGI games (e.g. Source 2 / Deadlock). Committing on the first
	 * hook that INSTALLS therefore picked D3D9 for a DX11 game and captured
	 * nothing. The authoritative signal is which present callback actually
	 * FIRES: each backend sets `active` (and records `hooked_api`) only when it
	 * captures a real present. So here we INSTALL the candidate hooks and let
	 * the real present decide; `active` (checked below + each iteration) is the
	 * commit.
	 *
	 * Vulkan is the one exception that is authoritative at install: it is an
	 * implicit layer, and `hook_vulkan()` only succeeds once the loader has
	 * already routed the app through our layer (`vulkan_seen`, set at the
	 * game's vkCreateInstance). So a Vulkan hook means the app IS using Vulkan
	 * — commit immediately and never install the D3D/GL siblings. */
	if (active)
		return true;

#ifdef COMPILE_VULKAN_HOOK
	static bool vulkan_hooked = false;
	if (!vulkan_hooked) {
		vulkan_hooked = hook_vulkan();
		if (vulkan_hooked) {
			if (global_hook_info)
				global_hook_info->hooked_api = RALPH_HOOKED_API_VULKAN;
			ralph_dbg_log("attempt_hook: committed to VULKAN (vulkan_seen) — "
				      "no other backend will be hooked");
			return true;
		}
	}
#endif //COMPILE_VULKAN_HOOK

	/* Install the D3D/GL candidate hooks (once each). We do NOT return/commit
	 * on a successful INSTALL for these — only a real present (which flips
	 * `active`, caught at the top next iteration) commits, and each backend's
	 * capture path records the truthful `hooked_api`. DXGI is installed before
	 * D3D9 so the modern path is in place first, but correctness does not depend
	 * on order: whichever the game actually calls is the one that captures. */
#ifdef COMPILE_D3D12_HOOK
	if (!d3d12_hooked) {
		d3d12_hooked = hook_d3d12();
	}
#endif

	if (!dxgi_hooked) {
		if (!dxgi_hookable()) {
			DbgOut("[OBS] no DXGI hook address found!\n");
			dxgi_hooked = true;
		} else {
			dxgi_hooked = hook_dxgi();
		}
	}

	if (!d3d9_hooked) {
		if (!d3d9_hookable()) {
			DbgOut("[OBS] no D3D9 hook address found!\n");
			d3d9_hooked = true;
		} else {
			d3d9_hooked = hook_d3d9();
		}
	}

	if (!gl_hooked) {
		gl_hooked = hook_gl();
	}

	if (!d3d8_hooked) {
		if (!d3d8_hookable()) {
			d3d8_hooked = true;
		} else {
			d3d8_hooked = hook_d3d8();
		}
	}

	/*if (!ddraw_hooked) {
		if (!ddraw_hookable()) {
			ddraw_hooked = true;
		} else {
			ddraw_hooked = hook_ddraw();
			if (ddraw_hooked) {
				return true;
			}
		}
	}*/

#if HOOK_VERBOSE_LOGGING
	DbgOut("[OBS] Attempt hook: D3D8=");
	DbgOut(d3d8_hooked ? "1" : "0");
	DbgOut(", D3D9=");
	DbgOut(d3d9_hooked ? "1" : "0");
	DbgOut(", D3D12=");
	DbgOut(d3d12_hooked ? "1" : "0");
	DbgOut(", DXGI=");
	DbgOut(dxgi_hooked ? "1" : "0");
	DbgOut(", GL=");
	DbgOut(gl_hooked ? "1" : "0");
#if COMPILE_VULKAN_HOOK
	DbgOut(", VK=");
	DbgOut(vulkan_hooked ? "1" : "0");
#endif
	DbgOut("\n");
#endif

	/* Hooks are installed; whether any will capture depends on the game
	 * actually presenting through one. Return `active` so a present that
	 * already fired commits immediately; otherwise keep the install loop alive
	 * (the capture_loop re-arm re-checks `active`). */
	return active;
}

static inline void capture_loop(void)
{
	ralph_dbg_log("capture_loop: waiting for host Initialize signal...");
	WaitForSingleObject(signal_init, INFINITE);
	ralph_dbg_log("capture_loop: Initialize received; capture_alive=%d, dxgi_hookable=%d",
		      (int)capture_alive(), (int)dxgi_hookable());

	/* Open the host diagnostics pipe EARLY — before any graphics API is
	 * hooked — so the hook-attempt diagnostics below (and every `hlog` in
	 * the per-API setup) reach the host's desktop.log even when no present
	 * hook ever installs. OBS normally only opens this pipe from
	 * `capture_should_init` (post-hook), which leaves a "why did the hook
	 * never install?" failure completely silent. The keepalive must be live
	 * (host holds it) for the pipe to be meaningful; if the open fails here
	 * it is retried later by `capture_should_init`. */
	if (capture_alive() && !ipc_pipe_client_valid(&pipe)) {
		const bool opened = init_pipe();
		ralph_dbg_log("capture_loop: early init_pipe() -> %d", (int)opened);
		if (opened)
			hlog("capture_loop: diagnostics pipe opened (pre-hook); "
			     "beginning hook attempts");
	}

	/* Spin until a graphics API present is intercepted. Emit a periodic
	 * status so a never-installing hook is diagnosable from the host log
	 * (e.g. a competing/foreign present hook, or a game that never presents
	 * on the hooked swapchain). The first few attempts are logged densely,
	 * then throttled to once every ~4s to avoid log spam. */
	{
		size_t attempts = 0;
		while (!attempt_hook()) {
			attempts++;
			if (attempts <= 3 || attempts % 100 == 0) {
				hlog("capture_loop: no graphics API hooked yet "
				     "(attempt %zu; dxgi_hookable=%d). Waiting for the "
				     "target to present on a hookable swapchain.",
				     attempts, (int)dxgi_hookable());
				ralph_dbg_log("capture_loop: no graphics API hooked yet (attempt %zu; "
					      "dxgi_hookable=%d, capture_alive=%d)",
					      attempts, (int)dxgi_hookable(), (int)capture_alive());
			}
			Sleep(40);
			if (stop_loop) {
				ralph_dbg_log("capture_loop: stop_loop set while waiting for a hook; "
					      "exiting after %zu attempt(s).", attempts);
				return;
			}
		}
		hlog("capture_loop: a graphics API present hook is active after "
		     "%zu attempt(s); awaiting frames.", attempts);
		ralph_dbg_log("capture_loop: a graphics API present hook is ACTIVE after %zu "
			      "attempt(s); awaiting frames.", attempts);
	}

	for (size_t n = 0; !stop_loop; n++) {
		/* this causes it to check every 4 seconds, but still with
		 * a small sleep interval in case the thread needs to stop */
		if (n % 100 == 0)
			attempt_hook();
		Sleep(40);
	}
	ralph_dbg_log("capture_loop: stop_loop set; exiting capture loop.");
}

static DWORD WINAPI main_capture_thread(HANDLE thread_handle)
{
	if (!init_hook(thread_handle)) {
		DbgOut("[OBS] Failed to init hook\n");
		free_hook();
		return 0;
	}

	capture_loop();
	return 0;
}

static inline void hlogv(const char *format, va_list args)
{
	char message[1024] = "";
	int num = _vsprintf_p(message, 1024, format, args);
	if (num > 0) {
		if (!ipc_pipe_client_write(&pipe, message, (size_t)num + 1)) {
			ipc_pipe_client_free(&pipe);
		}
		DbgOut("[OBS] ");
		DbgOut(message);
		DbgOut("\n");
	}
}

void hlog(const char *format, ...)
{
	va_list args;

	va_start(args, format);
	hlogv(format, args);
	va_end(args);
}

void hlog_hr(const char *text, HRESULT hr)
{
	LPSTR buffer = NULL;

	FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_IGNORE_INSERTS,
		       NULL, hr, MAKELANGID(LANG_ENGLISH, SUBLANG_ENGLISH_US), (LPSTR)&buffer, 0, NULL);

	if (buffer) {
		hlog("%s (0x%08lX): %s", text, hr, buffer);
		LocalFree(buffer);
	} else {
		hlog("%s (0x%08lX)", text, hr);
	}
}

static inline uint64_t get_clockfreq(void)
{
	static bool have_clockfreq = false;
	static LARGE_INTEGER clock_freq;

	if (!have_clockfreq) {
		QueryPerformanceFrequency(&clock_freq);
		have_clockfreq = true;
	}

	return clock_freq.QuadPart;
}

uint64_t os_gettime_ns(void)
{
	LARGE_INTEGER current_time;
	double time_val;

	QueryPerformanceCounter(&current_time);
	time_val = (double)current_time.QuadPart;
	time_val *= 1000000000.0;
	time_val /= (double)get_clockfreq();

	return (uint64_t)time_val;
}

static inline int try_lock_shmem_tex(int id)
{
	int next = id == 0 ? 1 : 0;
	DWORD wait_result = WAIT_FAILED;

	wait_result = WaitForSingleObject(tex_mutexes[id], 0);
	if (wait_result == WAIT_OBJECT_0 || wait_result == WAIT_ABANDONED) {
		return id;
	}

	wait_result = WaitForSingleObject(tex_mutexes[next], 0);
	if (wait_result == WAIT_OBJECT_0 || wait_result == WAIT_ABANDONED) {
		return next;
	}

	return -1;
}

static inline void unlock_shmem_tex(int id)
{
	if (id != -1) {
		ReleaseMutex(tex_mutexes[id]);
	}
}

static inline bool init_shared_info(size_t size, HWND window)
{
	wchar_t name[64];
	HWND top = GetAncestor(window, GA_ROOT);

	swprintf(name, 64, SHMEM_TEXTURE "_%" PRIu64 "_%u", (uint64_t)(uintptr_t)top, ++shmem_id_counter);

	shmem_file_handle = CreateFileMappingW(INVALID_HANDLE_VALUE, NULL, PAGE_READWRITE, 0, (DWORD)size, name);
	if (!shmem_file_handle) {
		hlog("init_shared_info: Failed to create shared memory: %d", GetLastError());
		return false;
	}

	shmem_info = MapViewOfFile(shmem_file_handle, FILE_MAP_ALL_ACCESS, 0, 0, size);
	if (!shmem_info) {
		hlog("init_shared_info: Failed to map shared memory: %d", GetLastError());
		return false;
	}

	return true;
}

bool capture_init_shtex(struct shtex_data **data, HWND window, uint32_t cx, uint32_t cy, uint32_t format, bool flip,
			uintptr_t handle)
{
	if (!init_shared_info(sizeof(struct shtex_data), window)) {
		hlog("capture_init_shtex: Failed to initialize memory");
		return false;
	}

	*data = shmem_info;
	(*data)->tex_handle = (uint32_t)handle;

	global_hook_info->hook_ver_major = HOOK_VER_MAJOR;
	global_hook_info->hook_ver_minor = HOOK_VER_MINOR;
	global_hook_info->window = (uint32_t)(uintptr_t)window;
	global_hook_info->type = CAPTURE_TYPE_TEXTURE;
	global_hook_info->format = format;
	global_hook_info->flip = flip;
	global_hook_info->map_id = shmem_id_counter;
	global_hook_info->map_size = sizeof(struct shtex_data);
	global_hook_info->cx = cx;
	global_hook_info->cy = cy;
	global_hook_info->UNUSED_base_cx = cx;
	global_hook_info->UNUSED_base_cy = cy;

	if (!SetEvent(signal_ready)) {
		hlog("capture_init_shtex: Failed to signal ready: %d", GetLastError());
		return false;
	}

	active = true;
	return true;
}

static DWORD CALLBACK copy_thread(LPVOID unused)
{
	uint32_t pitch = thread_data.pitch;
	uint32_t cy = thread_data.cy;
	HANDLE events[2] = {NULL, NULL};
	int shmem_id = 0;

	if (!duplicate_handle(&events[0], thread_data.copy_event)) {
		hlog_hr("copy_thread: Failed to duplicate copy event: %d", GetLastError());
		return 0;
	}

	if (!duplicate_handle(&events[1], thread_data.stop_event)) {
		hlog_hr("copy_thread: Failed to duplicate stop event: %d", GetLastError());
		goto finish;
	}

	for (;;) {
		int copy_tex;
		void *cur_data;

		DWORD ret = WaitForMultipleObjects(2, events, false, INFINITE);
		if (ret != WAIT_OBJECT_0) {
			break;
		}

		EnterCriticalSection(&thread_data.data_mutex);
		copy_tex = thread_data.cur_tex;
		cur_data = thread_data.cur_data;
		LeaveCriticalSection(&thread_data.data_mutex);

		if (copy_tex < NUM_BUFFERS && !!cur_data) {
			EnterCriticalSection(&thread_data.mutexes[copy_tex]);

			int lock_id = try_lock_shmem_tex(shmem_id);
			if (lock_id != -1) {
				memcpy(thread_data.shmem_textures[lock_id], cur_data, (size_t)pitch * (size_t)cy);

				unlock_shmem_tex(lock_id);
				((struct shmem_data *)shmem_info)->last_tex = lock_id;

				shmem_id = lock_id == 0 ? 1 : 0;
			}

			LeaveCriticalSection(&thread_data.mutexes[copy_tex]);
		}
	}

finish:
	for (size_t i = 0; i < 2; i++) {
		if (events[i]) {
			CloseHandle(events[i]);
		}
	}

	(void)unused;
	return 0;
}

void shmem_copy_data(size_t idx, void *volatile data)
{
	EnterCriticalSection(&thread_data.data_mutex);
	thread_data.cur_tex = (int)idx;
	thread_data.cur_data = data;
	thread_data.locked_textures[idx] = true;
	LeaveCriticalSection(&thread_data.data_mutex);

	SetEvent(thread_data.copy_event);
}

bool shmem_texture_data_lock(int idx)
{
	bool locked;

	EnterCriticalSection(&thread_data.data_mutex);
	locked = thread_data.locked_textures[idx];
	LeaveCriticalSection(&thread_data.data_mutex);

	if (locked) {
		EnterCriticalSection(&thread_data.mutexes[idx]);
		return true;
	}

	return false;
}

void shmem_texture_data_unlock(int idx)
{
	EnterCriticalSection(&thread_data.data_mutex);
	thread_data.locked_textures[idx] = false;
	LeaveCriticalSection(&thread_data.data_mutex);

	LeaveCriticalSection(&thread_data.mutexes[idx]);
}

static inline bool init_shmem_thread(uint32_t pitch, uint32_t cy)
{
	struct shmem_data *data = shmem_info;

	thread_data.pitch = pitch;
	thread_data.cy = cy;
	thread_data.shmem_textures[0] = (uint8_t *)data + data->tex1_offset;
	thread_data.shmem_textures[1] = (uint8_t *)data + data->tex2_offset;

	thread_data.copy_event = CreateEvent(NULL, false, false, NULL);
	if (!thread_data.copy_event) {
		hlog("init_shmem_thread: Failed to create copy event: %d", GetLastError());
		return false;
	}

	thread_data.stop_event = CreateEvent(NULL, true, false, NULL);
	if (!thread_data.stop_event) {
		hlog("init_shmem_thread: Failed to create stop event: %d", GetLastError());
		return false;
	}

	for (size_t i = 0; i < NUM_BUFFERS; i++) {
		InitializeCriticalSection(&thread_data.mutexes[i]);
	}

	InitializeCriticalSection(&thread_data.data_mutex);

	thread_data.copy_thread = CreateThread(NULL, 0, copy_thread, NULL, 0, NULL);
	if (!thread_data.copy_thread) {
		hlog("init_shmem_thread: Failed to create thread: %d", GetLastError());
		return false;
	}
	return true;
}

#ifndef ALIGN
#define ALIGN(bytes, align) (((bytes) + ((align)-1)) & ~((align)-1))
#endif

bool capture_init_shmem(struct shmem_data **data, HWND window, uint32_t cx, uint32_t cy, uint32_t pitch,
			uint32_t format, bool flip)
{
	uint32_t tex_size = cy * pitch;
	uint32_t aligned_header = ALIGN(sizeof(struct shmem_data), 32);
	uint32_t aligned_tex = ALIGN(tex_size, 32);
	uint32_t total_size = aligned_header + aligned_tex * 2 + 32;
	uintptr_t align_pos;

	if (!init_shared_info(total_size, window)) {
		hlog("capture_init_shmem: Failed to initialize memory");
		return false;
	}

	*data = shmem_info;

	/* to ensure fast copy rate, align texture data to 256bit addresses */
	align_pos = (uintptr_t)shmem_info;
	align_pos += aligned_header;
	align_pos &= ~(32 - 1);
	align_pos -= (uintptr_t)shmem_info;

	if (align_pos < sizeof(struct shmem_data))
		align_pos += 32;

	(*data)->last_tex = -1;
	(*data)->tex1_offset = (uint32_t)align_pos;
	(*data)->tex2_offset = (*data)->tex1_offset + aligned_tex;

	global_hook_info->hook_ver_major = HOOK_VER_MAJOR;
	global_hook_info->hook_ver_minor = HOOK_VER_MINOR;
	global_hook_info->window = (uint32_t)(uintptr_t)window;
	global_hook_info->type = CAPTURE_TYPE_MEMORY;
	global_hook_info->format = format;
	global_hook_info->flip = flip;
	global_hook_info->map_id = shmem_id_counter;
	global_hook_info->map_size = total_size;
	global_hook_info->pitch = pitch;
	global_hook_info->cx = cx;
	global_hook_info->cy = cy;
	global_hook_info->UNUSED_base_cx = cx;
	global_hook_info->UNUSED_base_cy = cy;

	if (!init_shmem_thread(pitch, cy)) {
		return false;
	}

	if (!SetEvent(signal_ready)) {
		hlog("capture_init_shmem: Failed to signal ready: %d", GetLastError());
		return false;
	}

	active = true;
	return true;
}

static inline void thread_data_free(void)
{
	if (thread_data.copy_thread) {
		DWORD ret;

		SetEvent(thread_data.stop_event);
		ret = WaitForSingleObject(thread_data.copy_thread, 500);
		if (ret != WAIT_OBJECT_0)
			TerminateThread(thread_data.copy_thread, (DWORD)-1);

		CloseHandle(thread_data.copy_thread);
	}
	if (thread_data.stop_event)
		CloseHandle(thread_data.stop_event);
	if (thread_data.copy_event)
		CloseHandle(thread_data.copy_event);
	for (size_t i = 0; i < NUM_BUFFERS; i++)
		DeleteCriticalSection(&thread_data.mutexes[i]);

	DeleteCriticalSection(&thread_data.data_mutex);

	memset(&thread_data, 0, sizeof(thread_data));
}

void capture_free(void)
{
	thread_data_free();

	if (shmem_info) {
		UnmapViewOfFile(shmem_info);
		shmem_info = NULL;
	}

	close_handle(&shmem_file_handle);

	SetEvent(signal_restart);
	active = false;
}

/*
 * ralph-meet fork modification (owned-game-capture-hook, task 1.1): the
 * internal duplicate-injection guard mutex is renamed from upstream's
 * "graphics_hook_dup_mutex" to the project's Private_Namespace prefix so this
 * DLL's dup-guard never collides with a stock OBS graphics-hook injected into
 * the same target process -- otherwise whichever DLL loaded second would see the
 * other's guard mutex and self-abort in init_dll(). Prefix kept byte-for-byte
 * in sync with host PRIVATE_NS in game_capture/obs_ipc.rs (Requirements 2.1,
 * 2.2). Only the name string changes; the guard logic is unchanged.
 */
#define HOOK_NAME L"RalphCaptureHook_dup_mutex"

static inline HANDLE open_mutex_plus_id(const wchar_t *name, DWORD id)
{
	wchar_t new_name[64];
	_snwprintf(new_name, 64, L"%s%lu", name, id);
	return open_mutex(new_name);
}

static bool init_dll(void)
{
	DWORD pid = GetCurrentProcessId();
	HANDLE h;

	h = open_mutex_plus_id(HOOK_NAME, pid);
	if (h) {
		CloseHandle(h);
		ralph_dbg_log("init_dll: duplicate hook guard tripped (RalphCaptureHook_dup_mutex "
			      "already exists) — a prior Ralph hook is still resident in this process; "
			      "this DLL instance will NOT hook.");
		return false;
	}

	dup_hook_mutex = create_mutex_plus_id(HOOK_NAME, pid);
	ralph_dbg_log("init_dll: dup guard acquired=%d", (int)!!dup_hook_mutex);
	return !!dup_hook_mutex;
}

BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID unused1)
{
	if (reason == DLL_PROCESS_ATTACH) {
		wchar_t name[MAX_PATH];

		dll_inst = hinst;

		ralph_dbg_log("DllMain: DLL_PROCESS_ATTACH — Ralph graphics-hook loaded; "
			      "running duplicate-guard check.");

		if (!init_dll()) {
			DbgOut("[OBS] Duplicate hook library");
			ralph_dbg_log("DllMain: init_dll() failed — aborting load (no hook installed).");
			return false;
		}

		HANDLE cur_thread;
		bool success = DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(),
					       &cur_thread, SYNCHRONIZE, false, 0);

		if (!success)
			DbgOut("[OBS] Failed to get current thread handle");

		if (!init_signals()) {
			return false;
		}
		if (!init_system_path()) {
			return false;
		}
		if (!init_hook_info()) {
			return false;
		}
		if (!init_mutexes()) {
			return false;
		}

		/* this prevents the library from being automatically unloaded
		 * by the next FreeLibrary call */
		GetModuleFileNameW(hinst, name, MAX_PATH);
		LoadLibraryW(name);

		capture_thread =
			CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)main_capture_thread, (LPVOID)cur_thread, 0, 0);
		if (!capture_thread) {
			CloseHandle(cur_thread);
			return false;
		}

	} else if (reason == DLL_PROCESS_DETACH) {
		if (!dup_hook_mutex) {
			return true;
		}

		if (capture_thread) {
			stop_loop = true;
			WaitForSingleObject(capture_thread, 300);
			CloseHandle(capture_thread);
		}

		free_hook();
	}

	(void)unused1;
	return true;
}

__declspec(dllexport) LRESULT CALLBACK dummy_debug_proc(int code, WPARAM wparam, LPARAM lparam)
{
	static bool hooking = true;
	MSG *msg = (MSG *)lparam;

	if (hooking && msg->message == (WM_USER + 432)) {
		HMODULE user32 = GetModuleHandleW(L"USER32");
		BOOL(WINAPI * unhook_windows_hook_ex)(HHOOK) = NULL;

		unhook_windows_hook_ex = ms_get_obfuscated_func(user32, "VojeleY`bdgxvM`hhDz", 0x7F55F80C9EE3A213ULL);

		if (unhook_windows_hook_ex)
			unhook_windows_hook_ex((HHOOK)msg->lParam);
		hooking = false;
	}

	return CallNextHookEx(0, code, wparam, lparam);
}
