<#
.SYNOPSIS
    Builds the Ralph Meet Android app against the production backend.

.DESCRIPTION
    Configures the Android SDK from the current environment or the Scoop
    android-clt installation, then runs the Tauri Android production build with
    the deployed Ralph Meet origin compiled into the mobile bundle.

.PARAMETER ApiBaseUrl
    Production API origin to compile into the Android app.

.PARAMETER PublicWebUrl
    Public web origin used for links opened outside the app.
#>
param(
    [string]$ApiBaseUrl = "https://meet.115jon.site",
    [string]$PublicWebUrl = "https://meet.115jon.site"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$mobileDir = $scriptDir | Split-Path -Parent

$sdkCandidates = @(
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    (Join-Path $env:USERPROFILE "scoop\apps\android-clt\current"),
    (Join-Path $env:LOCALAPPDATA "Android\Sdk")
)
$sdkRoot = @(
    $sdkCandidates | Where-Object {
        $_ -and (Test-Path -LiteralPath (Join-Path $_ "platform-tools\adb.exe"))
    }
)[0]

if (-not $sdkRoot) {
    throw "Android SDK not found. Install android-clt with Scoop or set ANDROID_HOME."
}

$sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path -LiteralPath $sdkManager)) {
    throw "Android command-line tools not found under $sdkRoot."
}

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

if (-not $env:JAVA_HOME) {
    $scoopJava = Join-Path $env:USERPROFILE "scoop\apps\openjdk21\current"
    if (Test-Path -LiteralPath $scoopJava) {
        $env:JAVA_HOME = $scoopJava
    }
}

$ndkDirectories = @(
    Get-ChildItem -LiteralPath (Join-Path $sdkRoot "ndk") -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name
)
if ($ndkDirectories.Count -gt 0) {
    $env:NDK_HOME = $ndkDirectories[-1].FullName
}

$env:VITE_API_BASE_URL = $ApiBaseUrl
$env:VITE_PUBLIC_WEB_URL = $PublicWebUrl

Write-Host "==> Android SDK : $sdkRoot" -ForegroundColor Cyan
Write-Host "==> Mobile API  : $ApiBaseUrl" -ForegroundColor Cyan
Write-Host "==> Public Web  : $PublicWebUrl" -ForegroundColor Cyan
Write-Host "==> Building production Android app..." -ForegroundColor Yellow

$exitCode = 0
Push-Location $mobileDir
try {
    & pnpm tauri android build
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $exitCode
