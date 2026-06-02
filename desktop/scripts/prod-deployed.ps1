<#
.SYNOPSIS
    Builds and runs the Ralph Meet desktop app in a production-like mode
    against the deployed backend.

.DESCRIPTION
    Mirrors the environment setup used by build-installer.ps1, but instead of
    stopping at an installer artifact it silently installs the freshly-built
    NSIS package into a temp directory and launches the installed executable.

    This gives us a local run that is much closer to a real production install:
    - deployed frontend build
    - release Rust build
    - packaged Tauri layout
    - full CEF payload next to the executable

    Capture configuration mirrors dev-deployed.ps1:
      (no switches)   Hook compiled in + ENABLED, hook-exclusive
      -Wgc            Hook compiled in + ENABLED, WGC fallback allowed
      -NoHook         Hook disabled, WGC only

    -NoHook and -Wgc are mutually exclusive.

.PARAMETER NoHook
    Disable the Game_Capture_Hook entirely and run WGC-only.

.PARAMETER Wgc
    Keep the hook enabled but allow WGC fallback.

.EXAMPLE
    .\scripts\prod-deployed.ps1
    .\scripts\prod-deployed.ps1 -Wgc
    .\scripts\prod-deployed.ps1 -NoHook
#>
param(
    [switch]$NoHook,
    [switch]$Wgc
)

$ErrorActionPreference = "Stop"

if ($NoHook -and $Wgc) {
    Write-Host "ERROR: -NoHook and -Wgc are mutually exclusive." -ForegroundColor Red
    Write-Host "       -NoHook disables the hook (WGC only); -Wgc keeps the hook enabled" -ForegroundColor Red
    Write-Host "       with the WGC fallback allowed. Pass at most one. Not launching." -ForegroundColor Red
    exit 1
}

function Sync-CefPayload {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDir,
        [Parameter(Mandatory = $true)]
        [string]$TargetDir
    )

    $cefFiles = @(
        "libcef.dll",
        "chrome_elf.dll",
        "icudtl.dat",
        "v8_context_snapshot.bin",
        "chrome_100_percent.pak",
        "chrome_200_percent.pak",
        "resources.pak",
        "d3dcompiler_47.dll",
        "dxil.dll",
        "dxcompiler.dll",
        "libEGL.dll",
        "libGLESv2.dll",
        "vk_swiftshader.dll",
        "vk_swiftshader_icd.json",
        "vulkan-1.dll",
        "bootstrap.exe",
        "bootstrapc.exe"
    )

    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    foreach ($file in $cefFiles) {
        Copy-Item -LiteralPath (Join-Path $SourceDir $file) -Destination (Join-Path $TargetDir $file) -Force
    }

    $srcLocales = Join-Path $SourceDir "locales"
    $dstLocales = Join-Path $TargetDir "locales"
    New-Item -ItemType Directory -Force -Path $dstLocales | Out-Null
    Get-ChildItem -Path $srcLocales -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dstLocales $_.Name) -Force
    }
}


$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$desktopDir = $scriptDir | Split-Path -Parent
$srcTauri = Join-Path $desktopDir "src-tauri"

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

if ($NoHook) {
    $cargoFeatures = "cef,native-screen-share"
    Remove-Item Env:\RALPH_GAME_CAPTURE_HOOK -ErrorAction SilentlyContinue
    $env:RALPH_CAPTURE_POLICY = "wgc-enabled"
    $hookState = "DISABLED (WGC only)"
    $capturePolicy = "wgc-enabled"
} elseif ($Wgc) {
    $cargoFeatures = "cef,native-screen-share,game-capture-hook"
    $env:RALPH_GAME_CAPTURE_HOOK = "1"
    $env:RALPH_CAPTURE_POLICY = "wgc-enabled"
    $hookState = "ENABLED (game-capture-hook feature + RALPH_GAME_CAPTURE_HOOK=1)"
    $capturePolicy = "wgc-enabled"
} else {
    $cargoFeatures = "cef,native-screen-share,game-capture-hook"
    $env:RALPH_GAME_CAPTURE_HOOK = "1"
    $env:RALPH_CAPTURE_POLICY = "hook-exclusive"
    $hookState = "ENABLED (game-capture-hook feature + RALPH_GAME_CAPTURE_HOOK=1)"
    $capturePolicy = "hook-exclusive"
}

Write-Host "==> Prod PID       : $PID" -ForegroundColor Cyan
Write-Host "==> CEF runtime    : $env:CEF_PATH" -ForegroundColor Cyan
Write-Host "==> Cargo home     : $env:CARGO_HOME" -ForegroundColor Cyan
Write-Host "==> Rust bin       : $(& rustup show active-toolchain 2>$null)" -ForegroundColor Cyan
Write-Host "==> Game hook      : $hookState" -ForegroundColor Cyan
Write-Host "==> Capture policy : $capturePolicy" -ForegroundColor Cyan
Write-Host "==> Frontend mode  : bundled deployed frontendDist" -ForegroundColor Cyan
Write-Host "==> Cargo profile  : release" -ForegroundColor Cyan
Write-Host "==> Cargo features : $cargoFeatures" -ForegroundColor Cyan
Write-Host ""

Set-Location $desktopDir

Write-Host "==> Building frontend (deployed mode)..." -ForegroundColor Yellow
pnpm run build:vite:deployed
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$skipBeforeBuildConfigPath = Join-Path $srcTauri "target\skip-before-build.json"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skipBeforeBuildConfigPath) | Out-Null
Set-Content -LiteralPath $skipBeforeBuildConfigPath -Value '{"build":{"beforeBuildCommand":""}}' -NoNewline

Write-Host "==> Building release executable (deployed config)..." -ForegroundColor Yellow
cargo tauri build --config src-tauri/tauri.deployed.conf.json --config $skipBeforeBuildConfigPath --features $cargoFeatures --no-bundle
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$releaseDir = Join-Path $srcTauri "target\release"
Sync-CefPayload -SourceDir $env:CEF_PATH -TargetDir $releaseDir

Write-Host "==> Packaging NSIS installer..." -ForegroundColor Yellow
cargo tauri bundle --config src-tauri/tauri.deployed.conf.json --features $cargoFeatures --bundles nsis --no-sign
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$nsisDir = Join-Path $srcTauri "target\release\bundle\nsis"
$installer = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $installer) {
    Write-Error "Installer not found under $nsisDir"
    exit 1
}

$installDir = Join-Path $env:TEMP "ralph-prod-installed"
Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

Write-Host "==> Installing packaged app into $installDir ..." -ForegroundColor Yellow
$installerArgs = "/S /D=$installDir"
$installerProc = Start-Process -FilePath $installer.FullName -ArgumentList $installerArgs -PassThru -Wait
if ($installerProc.ExitCode -ne 0) {
    Write-Error "Installer failed with exit code $($installerProc.ExitCode)"
    exit $installerProc.ExitCode
}

$installedExe = Join-Path $installDir "ralph-meet-desktop.exe"
if (-not (Test-Path $installedExe)) {
    Write-Error "Installed desktop executable not found: $installedExe"
    exit 1
}

Write-Host "==> Launching installed production app..." -ForegroundColor Green
& $installedExe

exit $LASTEXITCODE
