<#
.SYNOPSIS
    Builds the Ralph Meet desktop installer (.exe) targeting the deployed backend.

.DESCRIPTION
    Sets up the Rust/Cargo toolchain (Scoop layout), CEF path, and then runs
    `cargo tauri build` inside desktop/src-tauri to produce the desktop payload
    and compile the custom WPF bootstrapper installer.

    IMPORTANT: Uses `cargo tauri` (the locally-installed fork CLI) rather than
    `pnpm exec tauri` because only the fork CLI knows how to automatically bundle
    the CEF runtime files (libcef.dll, icudtl.dat, pak files, locales, etc.).
    The upstream @tauri-apps/cli does NOT have CEF bundling support.

    Output:  desktop\installer\bin\Release\net48\RalphMeetSetup.exe

.EXAMPLE
    .\scripts\build-installer.ps1
    .\scripts\build-installer.ps1 -Release    # same — alias for clarity
#>
param(
    [switch]$Release
)

$ErrorActionPreference = "Stop"

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

    Write-Host "==> Syncing CEF runtime into release directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

    foreach ($file in $cefFiles) {
        $src = Join-Path $SourceDir $file
        if (-not (Test-Path $src)) {
            Write-Error "Required CEF file missing: $src"
            exit 1
        }

        Copy-Item -LiteralPath $src -Destination (Join-Path $TargetDir $file) -Force
    }

    $srcLocales = Join-Path $SourceDir "locales"
    $dstLocales = Join-Path $TargetDir "locales"
    if (-not (Test-Path $srcLocales)) {
        Write-Error "Required CEF locales directory missing: $srcLocales"
        exit 1
    }

    New-Item -ItemType Directory -Force -Path $dstLocales | Out-Null
    Get-ChildItem -Path $srcLocales -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dstLocales $_.Name) -Force
    }
}

# ── Resolve paths relative to this script's location ───────────────────────
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$desktopDir  = $scriptDir | Split-Path -Parent   # desktop/

# ── Toolchain env (matches dev run command) ─────────────────────────────────
$env:PATH       = "$env:USERPROFILE\scoop\apps\rustup\current\.cargo\bin;$env:PATH;$env:USERPROFILE\.local\share\cef"
$env:RUSTUP_HOME = "$env:USERPROFILE\scoop\persist\rustup\.rustup"
$env:CARGO_HOME  = "$env:USERPROFILE\scoop\persist\rustup\.cargo"
$env:CEF_PATH    = "$env:USERPROFILE\.local\share\cef"

# ── Verify CEF is present ───────────────────────────────────────────────────
if (-not (Test-Path "$env:CEF_PATH\libcef.dll")) {
    Write-Error "libcef.dll not found in CEF_PATH: $env:CEF_PATH`nPlease install the CEF runtime first."
    exit 1
}

Write-Host "==> CEF runtime : $env:CEF_PATH" -ForegroundColor Cyan
Write-Host "==> Cargo home  : $env:CARGO_HOME" -ForegroundColor Cyan
Write-Host "==> Rust bin    : $(& rustup show active-toolchain 2>$null)" -ForegroundColor Cyan

# Build with the game-capture hook compiled in, but package with WGC fallback
# enabled so anti-cheat/protected games that block injection still share via WGC.
$cargoFeatures = "cef,native-screen-share,game-capture-hook"
$env:RALPH_GAME_CAPTURE_HOOK = "1"
$env:RALPH_CAPTURE_POLICY = "wgc-enabled"
$env:VITE_RALPH_CAPTURE_POLICY = "wgc-enabled"

Write-Host "==> Game hook   : ENABLED (game-capture-hook feature + RALPH_GAME_CAPTURE_HOOK=1)" -ForegroundColor Cyan
Write-Host "==> Capture policy : wgc-enabled" -ForegroundColor Cyan
Write-Host "==> Cargo features : $cargoFeatures" -ForegroundColor Cyan
Write-Host ""

# ── Run the build from desktop/ ─────────────────────────────────────────────
Set-Location $desktopDir

Write-Host "==> Building frontend (deployed mode) + desktop payload..." -ForegroundColor Yellow

if ([string]::IsNullOrWhiteSpace($env:CI)) {
    # `pnpm` aborts destructive module-dir cleanup without a TTY unless CI mode
    # is explicit. Mirror GitHub Actions so local scripted builds stay reliable.
    $env:CI = "true"
}

# Build frontend with deployed API target
pnpm run build:vite:deployed

if ($LASTEXITCODE -ne 0) {
    Write-Error "Vite build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# Use cargo tauri (fork CLI) for bundling — the upstream @tauri-apps/cli does
# not have CEF bundling support and will produce an installer missing CEF files.
# Clear beforeBuildCommand for the explicit cargo step below because we already
# built the frontend once above. This avoids redundant Vite rebuilds.
$skipBeforeBuildConfigPath = Join-Path $desktopDir "src-tauri\target\skip-before-build.json"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skipBeforeBuildConfigPath) | Out-Null
Set-Content -LiteralPath $skipBeforeBuildConfigPath -Value '{"build":{"beforeBuildCommand":""}}' -NoNewline

Write-Host "==> Building release executable (deployed config)..." -ForegroundColor Yellow
cargo tauri build --config src-tauri/tauri.deployed.conf.json --config $skipBeforeBuildConfigPath --features $cargoFeatures --no-bundle

if ($LASTEXITCODE -ne 0) {
    Write-Error "Release build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

$releaseDir = Join-Path $desktopDir "src-tauri\target\release"
Sync-CefPayload -SourceDir $env:CEF_PATH -TargetDir $releaseDir

Write-Host "==> Staging files for Custom WPF Bootstrapper..." -ForegroundColor Yellow
$stageDir = Join-Path $desktopDir "src-tauri\target\release\installer_stage"
if (Test-Path $stageDir) { Remove-Item -Path $stageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

Copy-Item -LiteralPath (Join-Path $releaseDir "ralph-meet-desktop.exe") -Destination (Join-Path $stageDir "RalphMeet.exe") -Force
Sync-CefPayload -SourceDir $env:CEF_PATH -TargetDir $stageDir

$srcObsCapture = Join-Path $releaseDir "obs-capture"
if (Test-Path $srcObsCapture) {
    Copy-Item -Path $srcObsCapture -Destination $stageDir -Recurse -Force
}

$installerAssetsDir = Join-Path $desktopDir "installer\Assets"
New-Item -ItemType Directory -Force -Path $installerAssetsDir | Out-Null
$payloadZip = Join-Path $installerAssetsDir "payload.zip"
if (Test-Path $payloadZip) { Remove-Item -Path $payloadZip -Force }

Write-Host "==> Zipping payload to $payloadZip ..." -ForegroundColor Yellow
if (Get-Command 7z -ErrorAction SilentlyContinue) {
    & 7z a -tzip -mx=9 $payloadZip "$stageDir\*" | Out-Null
} else {
    Compress-Archive -Path "$stageDir\*" -DestinationPath $payloadZip -Force
}

$tauriConfigPath = Join-Path $desktopDir "src-tauri\tauri.conf.json"
$conf = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$productName = $conf.productName
$installerVersion = $conf.version
$publisher = $conf.bundle.publisher
$installerDisplayName = $conf.app.windows[0].title
$installerLogDir = Join-Path $env:APPDATA "$productName\logs\installer"
$installedRoot = Join-Path $env:LOCALAPPDATA $productName
$installedStatePath = Join-Path $installedRoot "current.json"
$installedRootLauncherPath = Join-Path $installedRoot "Update.exe"

Write-Host "==> Compiling WPF Bootstrapper..." -ForegroundColor Yellow
$installerProjDir = Join-Path $desktopDir "installer"
$workspaceInstallerPath = Join-Path $installerProjDir "bin\Release\net48\RalphMeetSetup.exe"
Get-CimInstance Win32_Process -Filter "Name = 'RalphMeetSetup.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $workspaceInstallerPath } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Set-Location $installerProjDir
& "$env:USERPROFILE\scoop\apps\dotnet-sdk\current\dotnet.exe" build -c Release -p:Version=$installerVersion -p:InformationalVersion=$installerVersion -p:Company="$publisher" -p:Product="$installerDisplayName Setup"
if ($LASTEXITCODE -ne 0) {
    Write-Error "WPF Bootstrapper build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}
Set-Location $desktopDir

$installer = $workspaceInstallerPath
if (Test-Path $installer) {
    Write-Host ""
    Write-Host "==> Installer ready:" -ForegroundColor Green
    Write-Host "    $installer" -ForegroundColor Green
    Write-Host "    Size: $([math]::Round((Get-Item $installer).Length / 1MB, 1)) MB" -ForegroundColor Green
    Write-Host "    Runtime logs: $installerLogDir" -ForegroundColor Green
    Write-Host "    Installed root: $installedRoot" -ForegroundColor Green
    Write-Host "    Root launcher: $installedRootLauncherPath" -ForegroundColor Green
    Write-Host "    State manifest: $installedStatePath" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "==> Build succeeded but installer not found at expected path:" -ForegroundColor Yellow
    Write-Host "    $installer" -ForegroundColor Yellow
}
