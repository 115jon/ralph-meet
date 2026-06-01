# ─────────────────────────────────────────────────────────────────────────────
# Forked_Hook_DLL + Owned_Injector — self-contained build wiring (Task 1.2)
# owned-game-capture-hook spec, Requirements 1.2, 1.4, 1.5, 1.6, 1.7, 12.1, 12.2
# ─────────────────────────────────────────────────────────────────────────────
#
# This is a STANDALONE CMake project that compiles the vendored OBS `win-capture`
# fork (pinned OBS 32.1.2, tag `32.1.2`, commit `fb4d98b`, with the
# `RalphCaptureHook_` Private_Namespace rename already applied to the sources)
# into the project-owned capture artifacts:
#
#   * graphics-hook   -> graphics-hook64.dll / graphics-hook32.dll  (Forked_Hook_DLL)
#   * inject-helper   -> inject-helper64.exe / inject-helper32.exe  (Owned_Injector)
#   * get-graphics-offsets -> get-graphics-offsets64.exe / ...32.exe (offsets helper)
#
# Why a top-level project instead of the vendored per-component CMakeLists.txt:
# those files are written for the OBS monorepo build (`set_target_properties_obs`,
# `OBS::obfuscate` via `add_subdirectory(libobs)`, the parent `win-capture`
# target, `find_package(Detours)`), none of which exist outside OBS. They are
# kept verbatim for audit / re-vendoring. THIS file wires the same sources into
# the same outputs without the OBS build system, so the fork builds inside the
# project's CEF Tauri toolchain (Requirement 12.1).
#
# Bitness (Requirement 1.2 — exactly one 64-bit + one 32-bit of each artifact):
# this project builds ONE architecture per configure. The PowerShell driver
# `desktop/scripts/build-capture-fork.ps1` invokes it twice (`-A x64` and
# `-A Win32`) and copies the per-arch outputs to the resource directory. The
# output NAME encodes the bitness (…64 / …32) exactly as
# `src/game_capture/inject.rs` and the `build.rs` packaging guard expect.
#
# Microsoft Detours (Requirement: the win-capture hook depends on it): resolved
# in priority order — a prebuilt tree via -DDETOURS_ROOT, an installed package
# via find_package(Detours), else fetched + compiled from source (see
# cmake/detours.cmake). The two helper EXEs do NOT depend on Detours, so they
# build even when Detours cannot be resolved.
#
# Vulkan hook (Requirement 1.3 — Vulkan is a gated backend, DX11 enabled first):
# the Vulkan present interception compiles ONLY when a Vulkan SDK is found. When
# absent, the DLL still builds with DX8/9/10/11/12 + OpenGL interception, which
# covers the DX11-first validation path. This matches upstream's
# `if(TARGET Vulkan::Vulkan)` gate.

cmake_minimum_required(VERSION 3.28...3.30)

project(ralph_capture_fork LANGUAGES C CXX)

# Static CRT (/MT[d]) so the injected DLL and the helper EXEs carry no runtime
# DLL dependency into an arbitrary target process — matches the upstream
# `MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"`.
cmake_policy(SET CMP0091 NEW)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

if(NOT WIN32)
  message(FATAL_ERROR "The Forked_Hook_DLL / Owned_Injector are Windows-only (Requirement 13.1).")
endif()

if(NOT MSVC)
  message(FATAL_ERROR "The fork build requires MSVC (the project's CEF Tauri toolchain).")
endif()

# ── Resolve the per-arch output suffix (…64 / …32) ───────────────────────────
# Prefer the Visual Studio platform name; fall back to pointer size. ARM64 is
# treated as a 64-bit artifact bucket to mirror `inject.rs::Bitness` (any 64-bit
# native arch uses the 64-bit artifacts).
if(DEFINED CMAKE_VS_PLATFORM_NAME AND CMAKE_VS_PLATFORM_NAME)
  set(_FORK_PLATFORM "${CMAKE_VS_PLATFORM_NAME}")
elseif(DEFINED CMAKE_GENERATOR_PLATFORM AND CMAKE_GENERATOR_PLATFORM)
  set(_FORK_PLATFORM "${CMAKE_GENERATOR_PLATFORM}")
else()
  set(_FORK_PLATFORM "")
endif()

if(_FORK_PLATFORM STREQUAL "Win32" OR _FORK_PLATFORM STREQUAL "x86")
  set(FORK_BITS 32)
elseif(_FORK_PLATFORM STREQUAL "x64" OR _FORK_PLATFORM STREQUAL "ARM64")
  set(FORK_BITS 64)
elseif(CMAKE_SIZEOF_VOID_P EQUAL 4)
  set(FORK_BITS 32)
else()
  set(FORK_BITS 64)
endif()

message(STATUS "ralph-capture-fork: building ${FORK_BITS}-bit artifacts (platform='${_FORK_PLATFORM}')")

# ── Vendored source roots (paths preserved from upstream repo layout) ────────
set(FORK_ROOT        "${CMAKE_CURRENT_SOURCE_DIR}")
set(WINCAP_DIR       "${FORK_ROOT}/plugins/win-capture")
set(HOOK_CONFIG_DIR  "${FORK_ROOT}/shared/obs-hook-config")
set(D3D8_API_DIR     "${FORK_ROOT}/shared/obs-d3d8-api")
set(IPC_UTIL_DIR     "${FORK_ROOT}/shared/ipc-util")
set(INJECT_LIB_DIR   "${FORK_ROOT}/shared/obs-inject-library")
set(LIBOBS_DIR       "${FORK_ROOT}/libobs")

# obfuscate.* and the ipc-util pipe are header/INTERFACE libs upstream; compiled
# directly into the consuming targets here.
set(OBFUSCATE_SRC    "${LIBOBS_DIR}/util/windows/obfuscate.c")
set(IPC_PIPE_SRC     "${IPC_UTIL_DIR}/ipc-util/pipe-windows.c")

# Common Win32 definitions matching the upstream win-capture build.
add_compile_definitions(
  UNICODE
  _UNICODE
  WIN32_LEAN_AND_MEAN
  _CRT_SECURE_NO_WARNINGS
)

# =============================================================================
# Owned_Injector: inject-helper<bits>.exe (Requirement 1.7 cross-bitness inject)
# =============================================================================
add_executable(inject-helper
  "${WINCAP_DIR}/inject-helper/inject-helper.c"
  "${INJECT_LIB_DIR}/inject-library.c"
  "${OBFUSCATE_SRC}"
)
target_include_directories(inject-helper PRIVATE
  "${LIBOBS_DIR}"        # <util/windows/obfuscate.h>
  "${INJECT_LIB_DIR}"    # <inject-library.h>
)
set_target_properties(inject-helper PROPERTIES
  OUTPUT_NAME "inject-helper${FORK_BITS}"
)

# =============================================================================
# get-graphics-offsets<bits>.exe — resolves graphics-API vtable offsets
# =============================================================================
add_executable(get-graphics-offsets
  "${WINCAP_DIR}/get-graphics-offsets/d3d8-offsets.cpp"
  "${WINCAP_DIR}/get-graphics-offsets/d3d9-offsets.cpp"
  "${WINCAP_DIR}/get-graphics-offsets/dxgi-offsets.cpp"
  "${WINCAP_DIR}/get-graphics-offsets/get-graphics-offsets.c"
)
target_include_directories(get-graphics-offsets PRIVATE
  "${HOOK_CONFIG_DIR}"   # <graphics-hook-info.h>
  "${D3D8_API_DIR}"      # <d3d8.h> (vendored — not in the modern Windows SDK)
)
target_link_libraries(get-graphics-offsets PRIVATE d3d9 dxgi d3d11)
set_target_properties(get-graphics-offsets PROPERTIES
  OUTPUT_NAME "get-graphics-offsets${FORK_BITS}"
)

# =============================================================================
# Forked_Hook_DLL: graphics-hook<bits>.dll (Requirements 1.4, 1.5, 1.6)
# Requires Microsoft Detours. Vulkan interception is gated on a found SDK.
# =============================================================================
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/detours.cmake")

if(TARGET Detours::Detours)
  add_library(graphics-hook MODULE
    "${WINCAP_DIR}/graphics-hook/d3d10-capture.cpp"
    "${WINCAP_DIR}/graphics-hook/d3d11-capture.cpp"
    "${WINCAP_DIR}/graphics-hook/d3d12-capture.cpp"
    "${WINCAP_DIR}/graphics-hook/d3d8-capture.cpp"
    "${WINCAP_DIR}/graphics-hook/d3d9-capture.cpp"
    "${WINCAP_DIR}/graphics-hook/dxgi-capture.cpp"
    "${WINCAP_DIR}/graphics-hook/gl-capture.c"
    "${WINCAP_DIR}/graphics-hook/graphics-hook.c"
    "${WINCAP_DIR}/graphics-hook/graphics-hook.rc"
    "${IPC_PIPE_SRC}"
    "${OBFUSCATE_SRC}"
  )
  target_include_directories(graphics-hook PRIVATE
    "${HOOK_CONFIG_DIR}"   # <graphics-hook-info.h>, <graphics-hook-ver.h>, hook-helpers.h
    "${IPC_UTIL_DIR}"      # <ipc-util/pipe.h>
    "${LIBOBS_DIR}"        # <util/windows/obfuscate.h>
    "${D3D8_API_DIR}"      # <d3d8.h>
  )

  # D3D12 interception on (matches upstream `COMPILE_D3D12_HOOK`). A bare define
  # becomes `=1` under MSVC, so `#if COMPILE_D3D12_HOOK` evaluates true.
  target_compile_definitions(graphics-hook PRIVATE COMPILE_D3D12_HOOK)

  # Force-include <stdlib.h> so `_countof` (used in graphics-hook-info.h) is
  # defined. OBS's own build supplies it through its shared compiler-flag helper
  # (`set_target_properties_obs`), which this standalone project does not use;
  # this keeps the vendored header pristine (only the namespace differs upstream).
  target_compile_options(graphics-hook PRIVATE /FI"stdlib.h")

  target_link_libraries(graphics-hook PRIVATE Detours::Detours dxguid)

  # Suppress the upstream-known LNK4099 (missing Detours PDB) as upstream does.
  target_link_options(graphics-hook PRIVATE /IGNORE:4099)

  # ── Optional Vulkan present interception (gated backend) ──────────────────
  # The Vulkan hook needs only the Vulkan HEADERS (it never links vulkan-1.lib —
  # it intercepts via the implicit-layer dispatch). `vulkan-headers.cmake`
  # resolves them from an SDK, a headers package, VULKAN_SDK, or an opt-in
  # fetch, and defines VulkanHeaders::VulkanHeaders on success.
  include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/vulkan-headers.cmake")
  if(TARGET VulkanHeaders::VulkanHeaders)
    target_sources(graphics-hook PRIVATE
      "${WINCAP_DIR}/graphics-hook/vulkan-capture.c"
    )
    target_link_libraries(graphics-hook PRIVATE VulkanHeaders::VulkanHeaders)
    target_compile_definitions(graphics-hook PRIVATE COMPILE_VULKAN_HOOK)
    message(STATUS "ralph-capture-fork: Vulkan headers found — Vulkan interception ENABLED")
  else()
    message(STATUS "ralph-capture-fork: Vulkan headers NOT found — Vulkan interception DISABLED "
                   "(DX8/9/10/11/12 + OpenGL still built; covers the DX11-first path)")
  endif()

  set_target_properties(graphics-hook PROPERTIES
    OUTPUT_NAME "graphics-hook${FORK_BITS}"
    PREFIX ""
  )
else()
  message(WARNING
    "ralph-capture-fork: Microsoft Detours could not be resolved — the "
    "Forked_Hook_DLL (graphics-hook${FORK_BITS}.dll) will NOT be built. The "
    "Owned_Injector helpers (inject-helper${FORK_BITS}.exe, "
    "get-graphics-offsets${FORK_BITS}.exe) build regardless. Provide Detours "
    "via -DDETOURS_ROOT=<dir>, an installed find_package(Detours) package, or "
    "enable the source fetch (see cmake/detours.cmake).")
endif()
