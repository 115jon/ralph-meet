<#
.SYNOPSIS
    Runs the Ralph Meet desktop app in dev mode against the deployed backend.

.DESCRIPTION
    Mirrors the environment setup used by build-installer.ps1 so local dev runs
    use the same Rust/Cargo and CEF runtime paths as the packaged desktop app.

    Capture configuration is driven by two mutually-exclusive switches that
    resolve into a launch configuration (Game_Capture_Hook state + Capture_Policy):

        (no switches)   Hook compiled in + ENABLED, RALPH_CAPTURE_POLICY=hook-exclusive.
                        The zero-copy hook is the only capture path; a broken hook
                        fails explicitly instead of silently falling back to WGC.

        -Wgc            Hook compiled in + ENABLED, RALPH_CAPTURE_POLICY=wgc-enabled.
                        Opt back into the WGC fallback: the session falls back to
                        WGC_Capture when the hook is unavailable or fails.

        -NoHook         Hook DISABLED (built without the `game-capture-hook`
                        feature), WGC_Capture as the only capture path.

    -NoHook and -Wgc are mutually exclusive. Passing both prints an error and
    exits without launching the desktop app.

    The hook is doubly gated at runtime — the `game-capture-hook` Cargo feature
    must be compiled in AND RALPH_GAME_CAPTURE_HOOK must be truthy (see
    src-tauri/src/native_share.rs::hook_feature_enabled).

.PARAMETER NoHook
    Disable the Game_Capture_Hook: build without the `game-capture-hook` feature
    and leave RALPH_GAME_CAPTURE_HOOK unset (pure WGC capture). Mutually
    exclusive with -Wgc.

.PARAMETER Wgc
    Keep the Game_Capture_Hook enabled but opt back into the WGC fallback by
    setting RALPH_CAPTURE_POLICY=wgc-enabled. Mutually exclusive with -NoHook.

.EXAMPLE
    .\scripts\dev-deployed.ps1            # hook enabled, hook-exclusive (default)
    .\scripts\dev-deployed.ps1 -Wgc       # hook enabled, WGC fallback allowed
    .\scripts\dev-deployed.ps1 -NoHook    # WGC only, hook disabled
#>
param(
    [switch]$NoHook,
    [switch]$Wgc
)

$ErrorActionPreference = "Stop"

# ── Switch model (Req 6.1–6.5) ───────────────────────────────────────────
# -NoHook and -Wgc are mutually exclusive. Resolve them into a launch config
# BEFORE doing any environment setup or launching the app so an invalid
# invocation exits without side effects.
#
#   -NoHook | -Wgc | Result
#   --------+------+-------------------------------------------------------
#   absent  | absent | hook enabled, RALPH_CAPTURE_POLICY=hook-exclusive (6.1)
#   absent  | present| hook enabled, RALPH_CAPTURE_POLICY=wgc-enabled    (6.2)
#   present | absent | hook disabled, WGC only                          (6.3)
#   present | present| error, exit without launching                    (6.5)
if ($NoHook -and $Wgc) {
    Write-Host "ERROR: -NoHook and -Wgc are mutually exclusive." -ForegroundColor Red
    Write-Host "       -NoHook disables the hook (WGC only); -Wgc keeps the hook enabled" -ForegroundColor Red
    Write-Host "       with the WGC fallback allowed. Pass at most one. Not launching." -ForegroundColor Red
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$desktopDir = $scriptDir | Split-Path -Parent

$rustBin = Join-Path $env:USERPROFILE "scoop\apps\rustup\current\.cargo\bin"
$cefPath = Join-Path $env:USERPROFILE ".local\share\cef"

$env:PATH = "$rustBin;$env:PATH;$cefPath"
$env:RUSTUP_HOME = Join-Path $env:USERPROFILE "scoop\persist\rustup\.rustup"
$env:CARGO_HOME = Join-Path $env:USERPROFILE "scoop\persist\rustup\.cargo"
$env:CEF_PATH = $cefPath

if (-not (Test-Path (Join-Path $env:CEF_PATH "libcef.dll"))) {
    Write-Error "libcef.dll not found in CEF_PATH: $env:CEF_PATH`nPlease install the CEF runtime first."
    exit 1
}

# ── Resolve the launch configuration ─────────────────────────────────────
# The hook is doubly gated: the `game-capture-hook` Cargo feature must be
# compiled in AND RALPH_GAME_CAPTURE_HOOK must be truthy at runtime. The
# Capture_Policy is resolved by the backend from RALPH_CAPTURE_POLICY.
# The OBS_Capture_Component artifacts must be present under
# src-tauri/resources/obs-capture/ or the build.rs packaging guard will fail.
if ($NoHook) {
    # Req 6.3: hook disabled, WGC only. WGC is the only capture path, so the
    # resolved policy is wgc-enabled.
    $devScript = "dev:deployed"
    Remove-Item Env:\RALPH_GAME_CAPTURE_HOOK -ErrorAction SilentlyContinue
    $env:RALPH_CAPTURE_POLICY = "wgc-enabled"
    $hookState = "DISABLED (WGC only)"
    $capturePolicy = "wgc-enabled"
} elseif ($Wgc) {
    # Req 6.2: hook enabled, WGC fallback allowed.
    $devScript = "dev:deployed:hook"
    $env:RALPH_GAME_CAPTURE_HOOK = "1"
    $env:RALPH_CAPTURE_POLICY = "wgc-enabled"
    $hookState = "ENABLED (game-capture-hook feature + RALPH_GAME_CAPTURE_HOOK=1)"
    $capturePolicy = "wgc-enabled"
} else {
    # Req 6.1: hook enabled, hook-exclusive (no WGC fallback) — the dev default.
    $devScript = "dev:deployed:hook"
    $env:RALPH_GAME_CAPTURE_HOOK = "1"
    $env:RALPH_CAPTURE_POLICY = "hook-exclusive"
    $hookState = "ENABLED (game-capture-hook feature + RALPH_GAME_CAPTURE_HOOK=1)"
    $capturePolicy = "hook-exclusive"
}

# ── Pre-launch echo (Req 6.4) ────────────────────────────────────────────
# Print the resolved Capture_Policy and whether the hook is enabled/disabled
# BEFORE the desktop app process starts.
Write-Host "==> Dev PID        : $PID" -ForegroundColor Cyan
Write-Host "==> CEF runtime    : $env:CEF_PATH" -ForegroundColor Cyan
Write-Host "==> Cargo home     : $env:CARGO_HOME" -ForegroundColor Cyan
Write-Host "==> Rust bin       : $(& rustup show active-toolchain 2>$null)" -ForegroundColor Cyan
Write-Host "==> Game hook      : $hookState" -ForegroundColor Cyan
Write-Host "==> Capture policy : $capturePolicy" -ForegroundColor Cyan

# ── Sync freshly-built capture artifacts next to the dev binary ──────────
# build.rs copies the OBS_Capture_Component artifacts (the Forked_Hook_DLL +
# helpers) from resources/obs-capture into target/<profile>/obs-capture/ so the
# app discovers them next to the binary. But that copy only runs when cargo
# re-runs build.rs AND the destination DLL is not locked — and the injected
# graphics-hook DLL stays loaded (and file-locked) inside the target game for
# the game's whole lifetime. So after rebuilding the fork DLL
# (build-capture-fork.ps1), a stale copy can persist in target/ and get injected
# again, silently defeating the rebuild (e.g. the present-accurate frame_count
# never advancing, or the VP normalize-copy overhead). Proactively refresh the
# copies here so a fresh `dev:deployed` always ships the latest DLL; skip (with a
# clear warning) any artifact still locked by a running game/app so the user
# knows to fully close the target before the new hook can take effect.
$srcTauri = Join-Path $desktopDir "src-tauri"
$artifactSrc = Join-Path $srcTauri "resources\obs-capture"
$artifactNames = @(
    "graphics-hook64.dll", "graphics-hook32.dll",
    "inject-helper64.exe", "inject-helper32.exe",
    "get-graphics-offsets64.exe", "get-graphics-offsets32.exe"
)
$artifactDests = @(
    (Join-Path $srcTauri "target\debug\obs-capture"),
    (Join-Path $srcTauri "target\debug\resources\obs-capture")
)
# Best-effort only: this refresh must NEVER block launching the dev app. Wrap
# the whole block so any unexpected error here is reported and skipped rather
# than aborting under $ErrorActionPreference='Stop'.
try {
    $lockedAny = $false
    foreach ($destDir in $artifactDests) {
        if (-not (Test-Path $destDir)) { continue }
        foreach ($name in $artifactNames) {
            $srcFile = Join-Path $artifactSrc $name
            if (-not (Test-Path $srcFile)) { continue }
            $destFile = Join-Path $destDir $name
            try {
                Copy-Item -LiteralPath $srcFile -Destination $destFile -Force -ErrorAction Stop
            } catch {
                $lockedAny = $true
                Write-Host "==> WARNING: could not refresh $name (locked): $destFile" -ForegroundColor Yellow
            }
        }
    }
    if ($lockedAny) {
        Write-Host "==> A capture artifact is locked by a running process (the injected hook DLL" -ForegroundColor Yellow
        Write-Host "    stays loaded inside the target game for its whole lifetime). FULLY CLOSE the" -ForegroundColor Yellow
        Write-Host "    target game/app and re-run so the freshly-built hook DLL is injected." -ForegroundColor Yellow
    } else {
        Write-Host "==> Capture artifacts: refreshed next to dev binary" -ForegroundColor Cyan
    }
} catch {
    Write-Host "==> WARNING: capture-artifact refresh skipped ($($_.Exception.Message))" -ForegroundColor Yellow
}

Write-Host "==> Starting desktop dev app against deployed backend..." -ForegroundColor Yellow
Write-Host ""

Set-Location $desktopDir
pnpm run $devScript

exit $LASTEXITCODE
