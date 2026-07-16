<#
.SYNOPSIS
    Runs the Ralph Meet Android app on one connected physical device.

.DESCRIPTION
    Configures the Android SDK from the current environment or the Scoop
    android-clt installation, checks for exactly one authorized ADB device,
    starts the local Ralph Meet Workers/Vite backend, forwards the frontend and
    backend ports through ADB, and runs Tauri in the foreground. Local simulated
    bindings are used by default.

    Tauri selects physical devices automatically when exactly one device is
    connected. Passing the wireless ADB address as the Tauri device argument
    makes this Tauri version look for an emulator, so this script deliberately
    does not pass a positional device argument.

.PARAMETER HostAddress
    Optional host address for the frontend dev server. If omitted, Tauri uses
    its detected public network address.

.PARAMETER ApiBaseUrl
    API origin compiled into the mobile dev bundle. The default uses ADB reverse
    so Android localhost:5173 resolves to this machine's local dev backend.

.PARAMETER SkipBackend
    Do not start the root backend dev server. Useful if another terminal is
    already running it.

.PARAMETER RemoteBindings
    Explicitly use the mobile-dev remote D1/KV/R2 bindings. Requires
    -ConfirmRemoteBindings because local Worker code can modify those resources.

.PARAMETER ConfirmRemoteBindings
    Explicitly confirms that this run may execute local code against the
    configured remote resources.

.PARAMETER LocalBindings
    Compatibility no-op. Local bindings are already the default.

.EXAMPLE
    .\scripts\dev-android.ps1
    .\scripts\dev-android.ps1 -HostAddress 10.0.0.218
#>
param(
    [string]$HostAddress,
    [string]$ApiBaseUrl = "http://localhost:5173",
    [switch]$SkipBackend,
    [switch]$RemoteBindings,
    [switch]$ConfirmRemoteBindings,
    [switch]$LocalBindings
)

$ErrorActionPreference = "Stop"

if ($RemoteBindings -and $LocalBindings) {
    throw "Choose either -RemoteBindings or -LocalBindings, not both."
}

if ($RemoteBindings -and -not $ConfirmRemoteBindings) {
    throw "-RemoteBindings targets configured remote D1/KV/R2 resources. Re-run with -ConfirmRemoteBindings only after verifying the resource configuration."
}

if ($RemoteBindings) {
    $env:CLOUDFLARE_ENV = "mobile-dev"
}
else {
    Remove-Item Env:CLOUDFLARE_ENV -ErrorAction SilentlyContinue
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$mobileDir = $scriptDir | Split-Path -Parent
$repoRoot = $mobileDir | Split-Path -Parent
$pnpmExecutable = (Get-Command pnpm.exe -ErrorAction Stop).Source

function Test-TcpPort {
    param(
        [string]$HostName,
        [int]$Port
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $result = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(500)) {
            return $false
        }
        $client.EndConnect($result)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForTcpPort {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPort -HostName $HostName -Port $Port) {
            return
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Timed out waiting for $HostName`:$Port."
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-RepoDevServerOnPort {
    param(
        [string]$HostName,
        [int]$Port
    )

    $listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)[0]
    if (-not $listener) {
        return
    }

    $repoPattern = [regex]::Escape($repoRoot)
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $ownerCommand = "$($owner.CommandLine)"
    if (-not $owner -or $ownerCommand -notmatch $repoPattern -or $ownerCommand -notmatch "vite") {
        throw "Port $Port is already used by a non-Ralph Meet process (PID $($listener.OwningProcess)). Stop it manually or pass -SkipBackend."
    }

    $rootProcessId = [int]$owner.ProcessId
    $current = $owner
    while ($current.ParentProcessId) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)" -ErrorAction SilentlyContinue
        if (-not $parent) {
            break
        }

        $parentCommand = "$($parent.CommandLine)"
        if ($parentCommand -notmatch $repoPattern -or $parentCommand -notmatch "dev|vite|pnpm") {
            break
        }

        $rootProcessId = [int]$parent.ProcessId
        $current = $parent
    }

    Write-Host "==> Backend     : stopping stale repo dev server PID $rootProcessId on port $Port" -ForegroundColor Yellow
    Stop-ProcessTree -ProcessId $rootProcessId

    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-TcpPort -HostName $HostName -Port $Port)) {
            return
        }
        Start-Sleep -Milliseconds 250
    }

    throw "Timed out waiting for stale backend port $Port to be released."
}

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

$adb = Join-Path $sdkRoot "platform-tools\adb.exe"
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

$deviceLines = @(& $adb devices | Where-Object { $_ -match "^\S+\s+device$" })
if ($deviceLines.Count -eq 0) {
    & $adb devices -l
    throw "No authorized Android device found. Pair the phone and enable Wireless debugging."
}
if ($deviceLines.Count -gt 1) {
    & $adb devices -l
    throw "Multiple Android devices found. Disconnect stale ADB entries so exactly one remains."
}

$device = ($deviceLines[0] -split "\s+")[0]
$model = (& $adb -s $device shell getprop ro.product.model).Trim()
$resolvedApiBaseUrl = $ApiBaseUrl.TrimEnd("/")
$apiUri = [Uri]$resolvedApiBaseUrl
$backendPort = $apiUri.Port
Write-Host "==> Android SDK : $sdkRoot" -ForegroundColor Cyan
Write-Host "==> Device      : $device" -ForegroundColor Cyan
Write-Host "==> Model       : $model" -ForegroundColor Cyan

& $adb -s $device reverse tcp:1420 tcp:1420
if ($LASTEXITCODE -ne 0) {
    throw "Could not forward port 1420 to the Android device."
}

$backendProcess = $null
$ownsBackend = $false
$backendStdoutLog = $null
$backendStderrLog = $null
if (-not $SkipBackend) {
    if ($RemoteBindings) {
        Write-Host "==> Bindings    : remote D1/KV/R2 via mobile-dev (local Worker code)" -ForegroundColor Yellow
    }
    else {
        Write-Host "==> Bindings    : local simulated D1/KV/R2" -ForegroundColor Cyan
    }

    if ($apiUri.Host -eq "localhost") {
        if (Test-TcpPort -HostName "localhost" -Port $backendPort) {
            Stop-RepoDevServerOnPort -HostName "localhost" -Port $backendPort
        }

        $logDirectory = Join-Path $mobileDir "logs"
        if (-not (Test-Path -LiteralPath $logDirectory)) {
            New-Item -ItemType Directory -Path $logDirectory | Out-Null
        }
        $logStamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backendStdoutLog = Join-Path $logDirectory "backend-$logStamp.out.log"
        $backendStderrLog = Join-Path $logDirectory "backend-$logStamp.err.log"
        Write-Host "==> Backend     : starting local dev server on $resolvedApiBaseUrl" -ForegroundColor Cyan
        $backendProcess = Start-Process `
            -FilePath $pnpmExecutable `
            -ArgumentList @("--dir", $repoRoot, "dev", "--", "--port", $backendPort) `
            -WorkingDirectory $repoRoot `
            -RedirectStandardOutput $backendStdoutLog `
            -RedirectStandardError $backendStderrLog `
            -PassThru `
            -WindowStyle Hidden
        $ownsBackend = $true
        Write-Host "==> Backend log : $backendStdoutLog" -ForegroundColor DarkGray
        Write-Host "==> Backend err : $backendStderrLog" -ForegroundColor DarkGray
        Wait-ForTcpPort -HostName "localhost" -Port $backendPort -TimeoutSeconds 90
        Start-Sleep -Seconds 1
        if ($backendProcess.HasExited) {
            throw "Backend exited during startup. See $backendStdoutLog and $backendStderrLog."
        }
    }
}

if ($apiUri.Host -eq "localhost") {
    & $adb -s $device reverse "tcp:$backendPort" "tcp:$backendPort"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not forward backend port $backendPort to the Android device."
    }
}

$tauriArgs = @("tauri", "android", "dev")
if (-not [string]::IsNullOrWhiteSpace($HostAddress)) {
    $tauriArgs += @("--host", $HostAddress)
} else {
    # ADB reverse maps the phone's localhost to this machine's localhost.
    $tauriArgs += @("--host", "127.0.0.1")
}

Write-Host "==> Starting Tauri Android dev mode in the foreground..." -ForegroundColor Yellow
Write-Host "==> Mobile API  : $ApiBaseUrl" -ForegroundColor Cyan
Write-Host "    Press Ctrl+C to stop the dev server." -ForegroundColor DarkGray

$exitCode = 0
Push-Location $mobileDir
try {
    $env:VITE_API_BASE_URL = $resolvedApiBaseUrl
    & pnpm @tauriArgs
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
    & $adb -s $device reverse --remove tcp:1420 2>$null
    if ($apiUri.Host -eq "localhost") {
        & $adb -s $device reverse --remove "tcp:$backendPort" 2>$null
    }
    if ($ownsBackend -and $backendProcess) {
        Write-Host "==> Stopping local backend dev server..." -ForegroundColor Yellow
        Stop-ProcessTree -ProcessId $backendProcess.Id
    }
}

exit $exitCode
