<#
.SYNOPSIS
    Builds and installs the Ralph Meet desktop app in a production-like mode
    against the deployed backend without launching it.

.DESCRIPTION
    Mirrors the environment setup used by build-installer.ps1 and silently
    installs the freshly-built custom bootstrapper into the real default
    install target (%LOCALAPPDATA%\<ProductName>). The installed executable
    is deliberately not launched by this script so the build command remains
    finite; launch it separately after the script exits.

    This gives us a local install that is much closer to a real production install:
    - deployed frontend build
    - release Rust build
    - packaged Tauri layout
    - full CEF payload next to the executable

    Capture configuration mirrors the installed production app:
      (no switches)   Hook compiled in + ENABLED, WGC fallback allowed
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
    $env:VITE_RALPH_CAPTURE_POLICY = "wgc-enabled"
    $hookState = "DISABLED (WGC only)"
    $capturePolicy = "wgc-enabled"
} elseif ($Wgc) {
    $cargoFeatures = "cef,native-screen-share,game-capture-hook"
    $env:RALPH_GAME_CAPTURE_HOOK = "1"
    $env:RALPH_CAPTURE_POLICY = "wgc-enabled"
    $env:VITE_RALPH_CAPTURE_POLICY = "wgc-enabled"
    $hookState = "ENABLED (game-capture-hook feature + RALPH_GAME_CAPTURE_HOOK=1)"
    $capturePolicy = "wgc-enabled"
} else {
    $cargoFeatures = "cef,native-screen-share,game-capture-hook"
    $env:RALPH_GAME_CAPTURE_HOOK = "1"
    $env:RALPH_CAPTURE_POLICY = "wgc-enabled"
    $env:VITE_RALPH_CAPTURE_POLICY = "wgc-enabled"
    $hookState = "ENABLED (game-capture-hook feature + RALPH_GAME_CAPTURE_HOOK=1)"
    $capturePolicy = "wgc-enabled"
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

# What ships is defined once in packaging\payload-manifest.json.
Write-Host "==> Staging and packing payload..." -ForegroundColor Yellow
& (Join-Path $scriptDir "stage-payload.ps1") -CefDir $env:CEF_PATH -ReleaseDir $releaseDir -Dotnet "$env:USERPROFILE\scoop\apps\dotnet-sdk\current\dotnet.exe"

Write-Host "==> Compiling WPF Bootstrapper..." -ForegroundColor Yellow
$installerProjDir = Join-Path $desktopDir "installer"
$workspaceInstallerPath = Join-Path $installerProjDir "bin\Release\net48\RalphMeetSetup.exe"
Get-CimInstance Win32_Process -Filter "Name = 'RalphMeetSetup.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $workspaceInstallerPath } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Set-Location $installerProjDir
$tauriConfigPath = Join-Path $srcTauri "tauri.conf.json"
$conf = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$productName = $conf.productName
$installerVersion = $conf.version
$publisher = $conf.bundle.publisher
$installerDisplayName = $conf.app.windows[0].title
& "$env:USERPROFILE\scoop\apps\dotnet-sdk\current\dotnet.exe" build -c Release -p:Version=$installerVersion -p:InformationalVersion=$installerVersion -p:Company="$publisher" -p:Product="$installerDisplayName Setup"
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

$expectedDir = Join-Path $env:LOCALAPPDATA $productName
$installerLogDir = Join-Path $env:APPDATA "$productName\logs\installer"
$currentStatePath = Join-Path $expectedDir "current.json"
$rootLauncherPath = Join-Path $expectedDir "Update.exe"

# The installer can't overwrite a running instance — stop it first so we don't
# hit a locked-exe failure (the same lock that blocks rebuilds).
Get-Process -Name "RalphMeet" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ralph-meet-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'Update.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq (Join-Path $expectedDir "Update.exe") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "==> Running Custom Installer RalphMeetSetup.exe (/S /NoLaunch) ..." -ForegroundColor Yellow
Write-Host "==> Installer logs   : $installerLogDir" -ForegroundColor Cyan
$installerProc = Start-Process -FilePath $installer -ArgumentList "/S", "/NoLaunch" -PassThru -Wait
if ($installerProc.ExitCode -ne 0) {
    Write-Error "Installer failed with exit code $($installerProc.ExitCode). Check installer logs under: $installerLogDir"
    exit $installerProc.ExitCode
}

$installedState = $null
if (-not (Test-Path $currentStatePath)) {
    Write-Error "Installed state file not found: $currentStatePath"
    exit 1
}

try {
    $installedState = Get-Content -LiteralPath $currentStatePath -Raw | ConvertFrom-Json
} catch {
    Write-Error "Installed state file is invalid: $currentStatePath"
    exit 1
}

if (-not $installedState.currentVersion) {
    Write-Error "Installed state did not include currentVersion: $currentStatePath"
    exit 1
}

$installDir = Join-Path $expectedDir ("app-" + $installedState.currentVersion)
$installedExe = Join-Path $installDir "RalphMeet.exe"
if (-not (Test-Path $installedExe)) {
    Write-Error "Installed desktop executable not found: $installedExe"
    exit 1
}

if (-not (Test-Path $rootLauncherPath)) {
    Write-Error "Installed root launcher not found: $rootLauncherPath"
    exit 1
}

Write-Host "==> Installation complete. The target app was not launched." -ForegroundColor Green
Write-Host "==> Root launcher    : $rootLauncherPath" -ForegroundColor Cyan
Write-Host "==> Active version   : $($installedState.currentVersion)" -ForegroundColor Cyan
Write-Host "==> Active app dir   : $installDir" -ForegroundColor Cyan
Write-Host "==> Active exe       : $installedExe" -ForegroundColor Cyan

exit $LASTEXITCODE
