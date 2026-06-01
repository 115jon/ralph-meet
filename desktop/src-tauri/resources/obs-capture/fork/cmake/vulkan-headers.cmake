# ─────────────────────────────────────────────────────────────────────────────
# Vulkan headers resolution for the Forked_Hook_DLL's Vulkan present hook
# ─────────────────────────────────────────────────────────────────────────────
#
# OBS's `vulkan-capture.c` intercepts a target's Vulkan present by acting as an
# implicit Vulkan layer (exported `OBS_Negotiate`, hooked via the loader). It
# uses Vulkan ONLY through its headers (`<vulkan/vulkan.h>`, `<vulkan/vk_layer.h>`,
# `<vulkan/vulkan_win32.h>`) and the loader dispatch tables — it never links
# `vulkan-1.lib`. So the Vulkan hook needs the **headers only**, not a full SDK
# or import library.
#
# This module resolves those headers and, on success, defines an INTERFACE
# target `VulkanHeaders::VulkanHeaders` carrying just the include directory.
# Resolution order (first that succeeds wins):
#   1. -DVULKAN_HEADERS_ROOT=<dir>     A tree containing include/vulkan/vulkan.h
#                                      (e.g. an installed Vulkan SDK or a checkout
#                                      of KhronosGroup/Vulkan-Headers).
#   2. find_package(VulkanHeaders)     The Khronos Vulkan-Headers package config.
#   3. find_package(Vulkan)            A full Vulkan SDK (we take only its
#                                      include dir; the import lib is unused).
#   4. $ENV{VULKAN_SDK}/Include        The SDK env var the LunarG installer sets.
#   5. FetchContent (opt-in)           When -DFORK_FETCH_VULKAN_HEADERS=ON, clone
#                                      the pinned KhronosGroup/Vulkan-Headers tag
#                                      (header-only, Apache-2.0) and use its
#                                      include/ dir. Needs GitHub once.
#
# Steps 1–4 are fully offline. If none resolve, this module leaves
# VulkanHeaders::VulkanHeaders undefined and the top-level CMakeLists builds the
# DLL WITHOUT the Vulkan hook (DX8/9/10/11/12 + OpenGL still covered).

if(TARGET VulkanHeaders::VulkanHeaders)
  return()
endif()

# Helper: given a directory that should contain `vulkan/vulkan.h`, validate it
# and define the INTERFACE target. Returns via the target's existence.
function(_ralph_try_vulkan_include_dir _dir _origin)
  if(_dir AND EXISTS "${_dir}/vulkan/vulkan.h"
         AND EXISTS "${_dir}/vulkan/vk_layer.h"
         AND EXISTS "${_dir}/vulkan/vulkan_win32.h")
    add_library(VulkanHeaders::VulkanHeaders INTERFACE IMPORTED)
    set_target_properties(VulkanHeaders::VulkanHeaders PROPERTIES
      INTERFACE_INCLUDE_DIRECTORIES "${_dir}"
    )
    message(STATUS "Vulkan headers: using ${_origin} (${_dir})")
  endif()
endfunction()

# ── 1. Explicit -DVULKAN_HEADERS_ROOT ────────────────────────────────────────
if(DEFINED VULKAN_HEADERS_ROOT AND VULKAN_HEADERS_ROOT)
  foreach(_cand "${VULKAN_HEADERS_ROOT}/include" "${VULKAN_HEADERS_ROOT}/Include" "${VULKAN_HEADERS_ROOT}")
    if(NOT TARGET VulkanHeaders::VulkanHeaders)
      _ralph_try_vulkan_include_dir("${_cand}" "VULKAN_HEADERS_ROOT")
    endif()
  endforeach()
  if(TARGET VulkanHeaders::VulkanHeaders)
    return()
  endif()
  message(WARNING "Vulkan headers: VULKAN_HEADERS_ROOT='${VULKAN_HEADERS_ROOT}' "
                  "set but vulkan/vulkan.h not found under it.")
endif()

# ── 2. Khronos Vulkan-Headers package config ─────────────────────────────────
find_package(VulkanHeaders CONFIG QUIET)
if(TARGET Vulkan::Headers)
  # Re-expose under our own name so the top-level wiring is package-agnostic.
  add_library(VulkanHeaders::VulkanHeaders INTERFACE IMPORTED)
  target_link_libraries(VulkanHeaders::VulkanHeaders INTERFACE Vulkan::Headers)
  message(STATUS "Vulkan headers: resolved via find_package(VulkanHeaders CONFIG).")
  return()
endif()

# ── 3. Full Vulkan SDK (use only its include dir) ────────────────────────────
find_package(Vulkan QUIET)
if(Vulkan_INCLUDE_DIRS)
  foreach(_cand ${Vulkan_INCLUDE_DIRS})
    if(NOT TARGET VulkanHeaders::VulkanHeaders)
      _ralph_try_vulkan_include_dir("${_cand}" "find_package(Vulkan) include dir")
    endif()
  endforeach()
  if(TARGET VulkanHeaders::VulkanHeaders)
    return()
  endif()
endif()

# ── 4. $ENV{VULKAN_SDK}/Include (LunarG installer layout) ────────────────────
if(DEFINED ENV{VULKAN_SDK} AND NOT "$ENV{VULKAN_SDK}" STREQUAL "")
  _ralph_try_vulkan_include_dir("$ENV{VULKAN_SDK}/Include" "VULKAN_SDK env var")
  if(TARGET VulkanHeaders::VulkanHeaders)
    return()
  endif()
endif()

# ── 5. FetchContent + header-only checkout (opt-in) ──────────────────────────
# Vulkan-Headers is header-only (Apache-2.0). We use its include/ dir directly
# rather than its CMake targets to stay independent of its build wiring. Pinned
# to a tagged release for reproducibility.
option(FORK_FETCH_VULKAN_HEADERS "Fetch KhronosGroup/Vulkan-Headers when no SDK/headers are found" OFF)

if(FORK_FETCH_VULKAN_HEADERS)
  include(FetchContent)
  FetchContent_Declare(
    vulkan_headers
    GIT_REPOSITORY "https://github.com/KhronosGroup/Vulkan-Headers.git"
    GIT_TAG        "v1.3.280" # tagged release; header-only, Apache-2.0
    GIT_SHALLOW    TRUE
  )
  FetchContent_MakeAvailable(vulkan_headers)
  _ralph_try_vulkan_include_dir("${vulkan_headers_SOURCE_DIR}/include" "fetched Vulkan-Headers")
  if(TARGET VulkanHeaders::VulkanHeaders)
    return()
  endif()
  message(WARNING "Vulkan headers: fetched tree missing include/vulkan/vulkan.h "
                  "at '${vulkan_headers_SOURCE_DIR}/include'.")
endif()

message(STATUS "Vulkan headers: NOT resolved. Pass -DVULKAN_HEADERS_ROOT=<dir>, "
               "install the Vulkan SDK / Vulkan-Headers package, or configure with "
               "-DFORK_FETCH_VULKAN_HEADERS=ON (needs GitHub once). "
               "The DLL will build WITHOUT the Vulkan hook.")
