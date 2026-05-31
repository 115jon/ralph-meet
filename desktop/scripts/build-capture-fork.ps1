<#
.SYNOPSIS
    Builds the project-owned Forked_Hook_DLL + Owned_Injector from the vendored
    OBS `win-capture` fork, for BOTH 64-bit and 32-bit, and places the artifacts
    where the host injector and the build.rs packaging guard expect them.

.DESCRIPTION
    owned-game-capture-hook spec, Task 1.2 (Requirements 1.2, 1.4, 1.5, 1.6,
    1.7, 12.1, 12.2).

    Drives the standalone CMake project at
    `desktop/src-tauri/resources/obs-capture/fork/CMakeLists.txt` once per
    architecture (x64 + Win32) using the MSVC toolchain from the project's CEF
    build environment, then copies the six produced artifacts into
    `desktop/src-tauri/resources/obs-capture/` with the exact names pinned in
    `src/game_capture/inject.rs`:

        graphics-hook64.dll        graphics-hook32.dll          (Forked_Hook_DLL)
        inject-helper64.exe        inject-helper32.exe          (Owned_Injector)
        get-graphics-offsets64.exe get-graphics-offsets32.exe   (offsets helper)

    Microsoft Detours (required by graphics-hook): pass -DetoursRoot <dir> for a
    prebuilt tree, or -FetchDetours to clone+build it from source (needs GitHub
    once). Without either, an installed find_package(Detours) package is used if
    present; if Detours cannot be resolved the two helper EXEs still build and
    the DLL is skipped with a clear warning.

.PARAMETER Arch
    Which architecture(s) to build: x64, x86, or both (default).

.PARAMETER DetoursRoot
    Path to a prebuilt Microsoft Detours tree (…/include/detours.h +
    …/lib.X64/detours.lib + …/lib.X86/detours.lib). Forwarded as -DDETOURS_ROOT.

.PARAMETER FetchDetours
    Fetch + build Microsoft Detours from source (-DFORK_FETCH_DETOURS=ON).

.PARAMETER Config
    MSVC config to build (Release default; Debug supported).

.PARAMETER Clean
    Delete the CMake build trees before configuring.

.EXAMPLE
    .\scripts\build-capture-fork.ps1 -FetchDetours
    .\scripts\build-capture-fork.ps1 -Arch x64 -DetoursRoot C:\deps\Detours
#>
param(
    [ValidateSet("x64", "x86", "both")]
    [string]$Arch = "both",

    [string]$DetoursRoot = "",

    [switch]$FetchDetours,

    [ValidateSet("Release", "Debug")]
    [string]$Config = "Release",

    [switch]$Clean
)

$ErrorActionPreference = "Stop"

# CMake writes warnings (e.g. "Detours not resolved") to stderr. Under
# `$ErrorActionPreference='Stop'` PowerShell would wrap a native command's
# stderr as a terminating error, so native tools are invoked through
# `Invoke-Native`, which relaxes the preference for the call and gates success
# on the process exit code instead.
function Invoke-Native {
    param([Parameter(Mandatory = $true)][string]$Exe, [string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
    } finally {
        $ErrorActionPreference = $prev
    }
    return $LASTEXITCODE
}

# ── Resolve paths relative to this script ────────────────────────────────────
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$desktopDir = Split-Path -Parent $scriptDir
$srcTauri   = Join-Path $desktopDir "src-tauri"
$forkDir    = Join-Path $srcTauri "resources\obs-capture\fork"
$destDir    = Join-Path $srcTauri "resources\obs-capture"

if (-not (Test-Path (Join-Path $forkDir "CMakeLists.txt"))) {
    Write-Error "Fork CMake project not found at $forkDir\CMakeLists.txt"
    exit 1
}

# ── Locate CMake ─────────────────────────────────────────────────────────────
$cmake = Get-Command cmake -ErrorAction SilentlyContinue
if (-not $cmake) {
    Write-Error "cmake not found on PATH. Install CMake (or open a Developer PowerShell) and retry."
    exit 1
}

# Map our arch token to the Visual Studio generator platform + artifact suffix.
$archMap = @{
    "x64" = @{ Platform = "x64";   Bits = "64" }
    "x86" = @{ Platform = "Win32"; Bits = "32" }
}
$targets = if ($Arch -eq "both") { @("x64", "x86") } else { @($Arch) }

# The CMake target names (output names get the bitness suffix inside CMake).
$artifactsByArch = @{
    "x64" = @("graphics-hook64.dll", "inject-helper64.exe", "get-graphics-offsets64.exe")
    "x86" = @("graphics-hook32.dll", "inject-helper32.exe", "get-graphics-offsets32.exe")
}

Write-Host "==> Forked capture build" -ForegroundColor Cyan
Write-Host "    Fork sources : $forkDir"
Write-Host "    Destination  : $destDir"
Write-Host "    Architectures: $($targets -join ', ')   Config: $Config"
if ($DetoursRoot)   { Write-Host "    Detours      : prebuilt @ $DetoursRoot" }
elseif ($FetchDetours) { Write-Host "    Detours      : fetch + build from source" }
else                { Write-Host "    Detours      : find_package only (DLL skipped if absent)" -ForegroundColor Yellow }
Write-Host ""

$copied = @()
$missing = @()

foreach ($t in $targets) {
    $platform = $archMap[$t].Platform
    $buildDir = Join-Path $forkDir "build\$t"

    if ($Clean -and (Test-Path $buildDir)) {
        Write-Host "==> [$t] cleaning $buildDir" -ForegroundColor DarkGray
        Remove-Item -Recurse -Force $buildDir
    }

    # ── Configure ────────────────────────────────────────────────────────────
    $cfgArgs = @(
        "-S", $forkDir,
        "-B", $buildDir,
        "-A", $platform
    )
    if ($DetoursRoot)   { $cfgArgs += "-DDETOURS_ROOT=$DetoursRoot" }
    if ($FetchDetours)  { $cfgArgs += "-DFORK_FETCH_DETOURS=ON" }

    Write-Host "==> [$t] configuring ($platform)..." -ForegroundColor Yellow
    $code = Invoke-Native -Exe $cmake.Source -Arguments $cfgArgs
    if ($code -ne 0) {
        Write-Error "[$t] CMake configure failed (exit $code)."
        exit $code
    }

    # ── Build ──────────────────────────────────────────────────────────────--
    Write-Host "==> [$t] building ($Config)..." -ForegroundColor Yellow
    $code = Invoke-Native -Exe $cmake.Source -Arguments @("--build", $buildDir, "--config", $Config)
    if ($code -ne 0) {
        Write-Error "[$t] CMake build failed (exit $code)."
        exit $code
    }

    # ── Copy artifacts to the resource destination ─────────────────────────--
    # MSVC multi-config generators place outputs under <buildDir>/<Config>/.
    foreach ($name in $artifactsByArch[$t]) {
        $found = Get-ChildItem -Path $buildDir -Recurse -Filter $name -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($found) {
            $dest = Join-Path $destDir $name
            Copy-Item -LiteralPath $found.FullName -Destination $dest -Force
            Write-Host "    copied $name" -ForegroundColor Green
            $copied += $name
        } else {
            # The DLL may be intentionally skipped when Detours is unresolved.
            $missing += $name
            $sev = if ($name -like "graphics-hook*") { "Yellow" } else { "Red" }
            Write-Host "    MISSING $name (not produced by the $t build)" -ForegroundColor $sev
        }
    }
}

Write-Host ""
Write-Host "==> Copied $($copied.Count) artifact(s) to $destDir" -ForegroundColor Cyan
if ($missing.Count -gt 0) {
    Write-Host "==> Missing $($missing.Count): $($missing -join ', ')" -ForegroundColor Yellow
    if ($missing | Where-Object { $_ -like "graphics-hook*" }) {
        Write-Host "    graphics-hook*.dll requires Microsoft Detours. Re-run with" -ForegroundColor Yellow
        Write-Host "    -FetchDetours or -DetoursRoot <prebuilt tree> to produce it." -ForegroundColor Yellow
    }
    # Helper EXEs missing is a hard failure; DLL-only-missing is a soft warning.
    if ($missing | Where-Object { $_ -notlike "graphics-hook*" }) {
        exit 1
    }
}
