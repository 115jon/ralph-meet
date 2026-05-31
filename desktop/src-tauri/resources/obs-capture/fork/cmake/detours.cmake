# ─────────────────────────────────────────────────────────────────────────────
# Microsoft Detours resolution for the Forked_Hook_DLL build (Task 1.2)
# ─────────────────────────────────────────────────────────────────────────────
#
# The OBS `win-capture` graphics-hook intercepts the target process's Present
# (and SwapBuffers / vkQueuePresentKHR) via Microsoft Detours, so the DLL cannot
# link without it. This module resolves Detours and, on success, defines an
# imported target `Detours::Detours` (include dir + the static `detours.lib`).
#
# Resolution order (first that succeeds wins):
#   1. -DDETOURS_ROOT=<dir>            A prebuilt Detours tree (…/include/detours.h
#                                      + …/lib.<arch>/detours.lib or …/lib/detours.lib).
#   2. find_package(Detours CONFIG)    A package config on CMAKE_PREFIX_PATH
#                                      (e.g. vcpkg's `detours`). If it already
#                                      provides Detours::Detours, we reuse it.
#   3. FetchContent (opt-in)           When -DFORK_FETCH_DETOURS=ON, clone the
#                                      pinned Microsoft/Detours tag and build the
#                                      static lib for the current architecture.
#
# Network/offline: steps 1–2 are fully offline. Step 3 needs GitHub once to
# populate the source; thereafter it builds from the local checkout. If none
# resolve, this module leaves Detours::Detours undefined and the top-level
# CMakeLists skips the DLL (the helpers still build).

if(TARGET Detours::Detours)
  return()
endif()

# Map the building architecture to Detours' lib.<arch> convention.
if(DEFINED FORK_BITS AND FORK_BITS EQUAL 32)
  set(_DET_ARCH "X86")
elseif(DEFINED CMAKE_VS_PLATFORM_NAME AND CMAKE_VS_PLATFORM_NAME STREQUAL "ARM64")
  set(_DET_ARCH "ARM64")
else()
  set(_DET_ARCH "X64")
endif()

# ── 1. Prebuilt tree via -DDETOURS_ROOT ──────────────────────────────────────
if(DEFINED DETOURS_ROOT AND DETOURS_ROOT)
  find_path(DETOURS_INCLUDE_DIR
    NAMES detours.h
    PATHS "${DETOURS_ROOT}/include" "${DETOURS_ROOT}"
    NO_DEFAULT_PATH
  )
  find_library(DETOURS_LIBRARY
    NAMES detours
    PATHS
      "${DETOURS_ROOT}/lib.${_DET_ARCH}"
      "${DETOURS_ROOT}/lib/${_DET_ARCH}"
      "${DETOURS_ROOT}/lib"
    NO_DEFAULT_PATH
  )
  if(DETOURS_INCLUDE_DIR AND DETOURS_LIBRARY)
    add_library(Detours::Detours STATIC IMPORTED)
    set_target_properties(Detours::Detours PROPERTIES
      IMPORTED_LOCATION "${DETOURS_LIBRARY}"
      INTERFACE_INCLUDE_DIRECTORIES "${DETOURS_INCLUDE_DIR}"
    )
    message(STATUS "Detours: using prebuilt tree at DETOURS_ROOT='${DETOURS_ROOT}' "
                   "(${DETOURS_LIBRARY})")
    return()
  else()
    message(WARNING "Detours: DETOURS_ROOT='${DETOURS_ROOT}' set but detours.h / "
                    "detours.lib (arch ${_DET_ARCH}) not found under it.")
  endif()
endif()

# ── 2. Installed package via find_package ────────────────────────────────────
find_package(Detours CONFIG QUIET)
if(TARGET Detours::Detours)
  message(STATUS "Detours: resolved via find_package(Detours CONFIG).")
  return()
endif()

# ── 3. FetchContent + build from source (opt-in) ─────────────────────────────
# Detours has no upstream CMake build, so we add a tiny static-lib target over
# its `src/*.cpp`. Pinned to the latest tagged release for reproducibility.
option(FORK_FETCH_DETOURS "Fetch + build Microsoft Detours from source when not otherwise found" OFF)

if(FORK_FETCH_DETOURS)
  include(FetchContent)
  FetchContent_Declare(
    microsoft_detours
    GIT_REPOSITORY "https://github.com/microsoft/Detours.git"
    GIT_TAG        "v4.0.1" # commit e4bfd6b03e50de46b47abfbd1e46b384f0c5f833
    GIT_SHALLOW    TRUE
  )
  FetchContent_MakeAvailable(microsoft_detours)

  set(_DET_SRC_DIR "${microsoft_detours_SOURCE_DIR}/src")
  if(EXISTS "${_DET_SRC_DIR}/detours.cpp")
    # Mirror Detours' own src/Makefile OBJS list exactly. `disasm.cpp` is the
    # online disassembler for the host arch; each `disol*.cpp` #defines a unique
    # DETOURS_*_OFFLINE_LIBRARY macro and re-includes disasm.cpp to emit a
    # distinct per-arch offline disassembler class — separate TUs, no duplicate
    # symbols.
    add_library(detours_static STATIC
      "${_DET_SRC_DIR}/detours.cpp"
      "${_DET_SRC_DIR}/modules.cpp"
      "${_DET_SRC_DIR}/disasm.cpp"
      "${_DET_SRC_DIR}/image.cpp"
      "${_DET_SRC_DIR}/creatwth.cpp"
      "${_DET_SRC_DIR}/disolx86.cpp"
      "${_DET_SRC_DIR}/disolx64.cpp"
      "${_DET_SRC_DIR}/disolia64.cpp"
      "${_DET_SRC_DIR}/disolarm.cpp"
      "${_DET_SRC_DIR}/disolarm64.cpp"
    )
    target_include_directories(detours_static PUBLIC "${_DET_SRC_DIR}")
    # Detours is not warning-clean under MSVC's default levels.
    target_compile_definitions(detours_static PRIVATE WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS)
    target_compile_options(detours_static PRIVATE /W0 /Gy /Gm- /Zl)
    add_library(Detours::Detours ALIAS detours_static)
    message(STATUS "Detours: built from fetched source (${microsoft_detours_SOURCE_DIR}).")
    return()
  else()
    message(WARNING "Detours: fetched tree missing src/detours.cpp at '${_DET_SRC_DIR}'.")
  endif()
endif()

message(STATUS "Detours: NOT resolved. Pass -DDETOURS_ROOT=<dir>, install a "
               "find_package(Detours) package, or configure with "
               "-DFORK_FETCH_DETOURS=ON (needs GitHub once).")
