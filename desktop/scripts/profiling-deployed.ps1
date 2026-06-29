<#
.SYNOPSIS
    Builds and runs Ralph Meet in profiling mode (release opts + debug symbols).

.DESCRIPTION
    Identical to prod-deployed.ps1 EXCEPT it builds with --profile profiling
    instead of the default release profile.  This keeps full release-level
    optimisations (opt-level=3) while retaining PDB/DWARF symbols so that
    samply / WPA can resolve function names in flame graphs.

    Build sequence:
      1. pnpm run build:vite:deployed   (same frontend as prod)
      2. cargo tauri build --profile profiling --no-bundle
      3. Sync CEF payload alongside the binary
      4. Silently install the profiling build via the custom bootstrapper
      5. Launch the installed executable

    Run with:
      .\scripts\profiling-deployed.ps1
      .\scripts\profiling-deployed.ps1 -Wgc
      .\scripts\profiling-deployed.ps1 -NoHook
#>
param(
    [switch]$NoHook,
    [switch]$Wgc
)

$ErrorActionPreference = "Stop"

if ($NoHook -and $Wgc) {
    Write-Host "ERROR: -NoHook and -Wgc are mutually exclusive." -ForegroundColor Red
    exit 1
}

function Sync-CefPayload {
    param(
        [Parameter(Mandatory = $true)] [string]$SourceDir,
        [Parameter(Mandatory = $true)] [string]$TargetDir
    )

    $cefFiles = @(
        "libcef.dll", "chrome_elf.dll", "icudtl.dat",
        "v8_context_snapshot.bin", "chrome_100_percent.pak",
        "chrome_200_percent.pak", "resources.pak",
        "d3dcompiler_47.dll", "dxil.dll", "dxcompiler.dll",
        "libEGL.dll", "libGLESv2.dll", "vk_swiftshader.dll",
        "vk_swiftshader_icd.json", "vulkan-1.dll",
        "bootstrap.exe", "bootstrapc.exe"
    )

    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    foreach ($file in $cefFiles) {
        Copy-Item -LiteralPath (Join-Path $SourceDir $file) `
                  -Destination  (Join-Path $TargetDir $file) -Force
    }

    $srcLocales = Join-Path $SourceDir "locales"
    $dstLocales = Join-Path $TargetDir "locales"
    New-Item -ItemType Directory -Force -Path $dstLocales | Out-Null
    Get-ChildItem -Path $srcLocales -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dstLocales $_.Name) -Force
    }
}

# ── Paths ─────────────────────────────────────────────────────────────────────
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$desktopDir = $scriptDir | Split-Path -Parent
$srcTauri   = Join-Path $desktopDir "src-tauri"

$rustBin = Join-Path $env:USERPROFILE "scoop\apps\rustup\current\.cargo\bin"
$cefPath = Join-Path $env:USERPROFILE ".local\share\cef"

$env:PATH        = "$rustBin;$env:PATH;$cefPath"
$env:RUSTUP_HOME = Join-Path $env:USERPROFILE "scoop\persist\rustup\.rustup"
$env:CARGO_HOME  = Join-Path $env:USERPROFILE "scoop\persist\rustup\.cargo"
$env:CEF_PATH    = $cefPath

if (-not (Test-Path (Join-Path $env:CEF_PATH "libcef.dll"))) {
    Write-Error "libcef.dll not found in CEF_PATH: $env:CEF_PATH"
    exit 1
}

# ── Feature / hook config (mirrors prod-deployed.ps1) ────────────────────────
if ($NoHook) {
    $cargoFeatures = "cef,native-screen-share"
    Remove-Item Env:\RALPH_GAME_CAPTURE_HOOK -ErrorAction SilentlyContinue
    $env:RALPH_CAPTURE_POLICY = "wgc-enabled"
    $hookState     = "DISABLED (WGC only)"
    $capturePolicy = "wgc-enabled"
} elseif ($Wgc) {
    $cargoFeatures = "cef,native-screen-share,game-capture-hook"
    $env:RALPH_GAME_CAPTURE_HOOK  = "1"
    $env:RALPH_CAPTURE_POLICY     = "wgc-enabled"
    $hookState     = "ENABLED (game-capture-hook + RALPH_GAME_CAPTURE_HOOK=1)"
    $capturePolicy = "wgc-enabled"
} else {
    $cargoFeatures = "cef,native-screen-share,game-capture-hook"
    $env:RALPH_GAME_CAPTURE_HOOK  = "1"
    $env:RALPH_CAPTURE_POLICY     = "hook-exclusive"
    $hookState     = "ENABLED (game-capture-hook + RALPH_GAME_CAPTURE_HOOK=1)"
    $capturePolicy = "hook-exclusive"
}

Write-Host "==> Profiling build" -ForegroundColor Magenta
Write-Host "==> CEF runtime    : $env:CEF_PATH"   -ForegroundColor Cyan
Write-Host "==> Cargo home     : $env:CARGO_HOME" -ForegroundColor Cyan
Write-Host "==> Game hook      : $hookState"       -ForegroundColor Cyan
Write-Host "==> Capture policy : $capturePolicy"   -ForegroundColor Cyan
Write-Host "==> Cargo profile  : profiling (release opts + debug symbols)" -ForegroundColor Magenta
Write-Host "==> Cargo features : $cargoFeatures"   -ForegroundColor Cyan
Write-Host ""

Set-Location $desktopDir

# ── 1. Frontend ───────────────────────────────────────────────────────────────
Write-Host "==> Building frontend (deployed mode)..." -ForegroundColor Yellow
pnpm run build:vite:deployed
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Skip the tauri before-build command (mirrors prod-deployed.ps1)
$skipBeforeBuildConfigPath = Join-Path $srcTauri "target\skip-before-build.json"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skipBeforeBuildConfigPath) | Out-Null
Set-Content -LiteralPath $skipBeforeBuildConfigPath -Value '{"build":{"beforeBuildCommand":""}}' -NoNewline

# ── 2. Rust binary with debug symbols via release profile ─────────────────────
# cargo tauri build only supports --debug (unoptimised) or release (default).
# We keep the standard release path but override the debug-info knob via
# CARGO_PROFILE_RELEASE_DEBUG=2 so the binary gets full PDB/DWARF symbols
# (identical to [profile.release] debug=true) without touching Cargo.toml.
# The deployed config is passed via --config so the correct frontendDist URL
# (the real backend, not localhost:1420) is baked into the binary.
Write-Host "==> Building release+symbols executable (CARGO_PROFILE_RELEASE_DEBUG=2)..." -ForegroundColor Yellow
$env:CARGO_PROFILE_RELEASE_DEBUG  = "2"   # full debug info in release binary
$env:CARGO_PROFILE_RELEASE_STRIP  = "none" # don't strip symbols post-link

cargo tauri build `
    --config src-tauri/tauri.deployed.conf.json `
    --config $skipBeforeBuildConfigPath `
    --features $cargoFeatures `
    --no-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$releaseDir  = Join-Path $srcTauri "target\release"
$pdbPath     = Join-Path $releaseDir "ralph_meet_desktop.pdb"

Sync-CefPayload -SourceDir $env:CEF_PATH -TargetDir $releaseDir

# ── 3. Package the custom bootstrapper and install it ────────────────────────
Write-Host "==> Staging files for Custom WPF Bootstrapper..." -ForegroundColor Yellow
$stageDir = Join-Path $srcTauri "target\release\installer_stage"
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

$conf = Get-Content -LiteralPath (Join-Path $srcTauri "tauri.conf.json") -Raw | ConvertFrom-Json
$productName = $conf.productName
$manufacturer = $conf.bundle.publisher
$installerVersion = $conf.version
$expectedDir = Join-Path $env:LOCALAPPDATA $productName
$installerDisplayName = $conf.app.windows[0].title

Write-Host "==> Compiling WPF Bootstrapper..." -ForegroundColor Yellow
$installerProjDir = Join-Path $desktopDir "installer"
$workspaceInstallerPath = Join-Path $installerProjDir "bin\Release\net48\RalphMeetSetup.exe"
Get-CimInstance Win32_Process -Filter "Name = 'RalphMeetSetup.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $workspaceInstallerPath } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Set-Location $installerProjDir
& "$env:USERPROFILE\scoop\apps\dotnet-sdk\current\dotnet.exe" build -c Release -p:Version=$installerVersion -p:InformationalVersion=$installerVersion -p:Company="$manufacturer" -p:Product="$installerDisplayName Setup"
if ($LASTEXITCODE -ne 0) {
    Write-Error "WPF Bootstrapper build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}
Set-Location $desktopDir

$installer = $workspaceInstallerPath
if (-not (Test-Path $installer)) {
    Write-Error "Installer RalphMeetSetup.exe not found under $installerProjDir\bin\Release\net48"
    exit 1
}

Get-Process -Name "RalphMeet" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ralph-meet-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'Update.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq (Join-Path $expectedDir "Update.exe") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "==> Installing to $expectedDir ..." -ForegroundColor Yellow
$installerProc = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru -Wait
if ($installerProc.ExitCode -ne 0) {
    Write-Error "Installer failed: exit code $($installerProc.ExitCode)"
    exit $installerProc.ExitCode
}

$installDir = $expectedDir
$manuKey = "HKCU:\Software\$manufacturer\$productName"
try {
    $recorded = (Get-Item -LiteralPath $manuKey -ErrorAction Stop).GetValue('')
    if ($recorded) { $installDir = $recorded }
} catch { }

$installedExe = Join-Path $installDir "RalphMeet.exe"
if (-not (Test-Path $installedExe)) {
    Write-Error "Installed exe not found: $installedExe"
    exit 1
}

# Copy the PDB next to the installed exe so samply resolves symbols without
# needing a symbol server.  The PDB is 300MB but only needed for profiling.
Write-Host "==> Copying PDB to install dir for samply symbol resolution..." -ForegroundColor Yellow
if (Test-Path $pdbPath) {
    Copy-Item $pdbPath (Join-Path $installDir "ralph_meet_desktop.pdb") -Force
    $pdbMB = [math]::Round((Get-Item $pdbPath).Length / 1MB, 0)
    Write-Host "    PDB copied ($pdbMB MB)" -ForegroundColor Green
} else {
    Write-Host "    WARNING: PDB not found at $pdbPath - stacks will be addresses only" -ForegroundColor Red
}

Write-Host ""
Write-Host "==> Profiling build installed to: $installDir" -ForegroundColor Green
Write-Host "    Binary has full debug symbols (CARGO_PROFILE_RELEASE_DEBUG=2)" -ForegroundColor Green
Write-Host ""
Write-Host "    After the app is streaming, run this in an ELEVATED shell:" -ForegroundColor Magenta
Write-Host "      `$env:PATH = 'C:\Program Files (x86)\Windows Kits\10\Windows Performance Toolkit;' + `$env:PATH" -ForegroundColor Magenta
Write-Host "      `$pid = (Get-Process RalphMeet | Sort-Object CPU -Desc | Select -First 1).Id" -ForegroundColor Magenta
Write-Host "      samply record --pid `$pid --duration 30" -ForegroundColor Magenta
Write-Host ""

& $installedExe

exit $LASTEXITCODE

