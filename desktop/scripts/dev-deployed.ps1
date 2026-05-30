<#
.SYNOPSIS
    Runs the Ralph Meet desktop app in dev mode against the deployed backend.

.DESCRIPTION
    Mirrors the environment setup used by build-installer.ps1 so local dev runs
    use the same Rust/Cargo and CEF runtime paths as the packaged desktop app.

.EXAMPLE
    .\scripts\dev-deployed.ps1
#>
param()

$ErrorActionPreference = "Stop"

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

Write-Host "==> Dev PID     : $PID" -ForegroundColor Cyan
Write-Host "==> CEF runtime : $env:CEF_PATH" -ForegroundColor Cyan
Write-Host "==> Cargo home  : $env:CARGO_HOME" -ForegroundColor Cyan
Write-Host "==> Rust bin    : $(& rustup show active-toolchain 2>$null)" -ForegroundColor Cyan
Write-Host "==> Starting desktop dev app against deployed backend..." -ForegroundColor Yellow
Write-Host ""

Set-Location $desktopDir
pnpm run dev:deployed

exit $LASTEXITCODE
