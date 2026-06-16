<#
.SYNOPSIS
  A/B frame-pacing capture for diagnosing game FPS drops while screen sharing.

.DESCRIPTION
  Captures per-present telemetry for the GAME process using Intel PresentMon
  (v2 metrics). Run it TWICE with the game running at an uncapped frame rate:

    1) .\presentmon-capture.ps1 -Label control    # Ralph Meet NOT running at all
    2) .\presentmon-capture.ps1 -Label baseline   # Ralph Meet open but NOT sharing
    3) .\presentmon-capture.ps1 -Label shared     # Ralph Meet sharing the game

  Three tiers decompose the FPS cost:
    control -> baseline : cost of the app merely being open (CEF, GPU process)
    baseline -> shared  : cost of the capture + encode pipeline

  The critical signal is the PresentMode column: if it changes from
  "Hardware: Independent Flip" (baseline) to a "Composed:" mode (shared),
  the FPS drop is present-mode demotion (DWM compositing), NOT encoder
  GPU contention. The analyzer (presentmon-analyze.py) diffs the two CSVs.

.NOTES
  PresentMon needs elevation; this script self-elevates via PresentMon's
  own --restart_as_admin (UAC prompt). Output goes to %TEMP%.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('control', 'baseline', 'shared')]
    [string]$Label,

    # Game process exe name (e.g. "cs2.exe") OR omit to auto-detect the
    # foreground fullscreen app that is NOT ralph-meet / explorer / this shell.
    [string]$Game = '',

    [int]$Seconds = 25
)

$ErrorActionPreference = 'Stop'

$PresentMon = "C:\Users\jon\scoop\apps\rtss\7.3.7\Plugins\Client\PresentMonDataProvider\PresentMon-2.3.1-x64.exe"
if (-not (Test-Path $PresentMon)) {
    $found = Get-ChildItem "$env:USERPROFILE\scoop\apps" -Recurse -Filter "PresentMon-2*.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch "DLSS" } | Select-Object -First 1
    if ($found) { $PresentMon = $found.FullName }
    else { throw "PresentMon-2.x not found. Install Intel PresentMon or RTSS." }
}
Write-Host "PresentMon: $PresentMon" -ForegroundColor DarkGray

# --- Resolve the game process name ---
function Resolve-GameName {
    param([string]$Explicit)
    if ($Explicit) { return ($Explicit -replace '\.exe$', '') + '.exe' }

    $exclude = @('ralph-meet-desktop', 'explorer', 'powershell', 'pwsh', 'cmd',
        'WindowsTerminal', 'devenv', 'Code', 'SearchHost', 'dwm', 'PresentMon-2.3.1-x64')
    $sig = @'
using System;
using System.Runtime.InteropServices;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
    if (-not ([System.Management.Automation.PSTypeName]'FgWin').Type) {
        Add-Type -TypeDefinition $sig
    }
    $h = [FgWin]::GetForegroundWindow()
    $fgpid = 0; [FgWin]::GetWindowThreadProcessId($h, [ref]$fgpid) | Out-Null
    $p = Get-Process -Id $fgpid -ErrorAction SilentlyContinue
    if ($p -and ($exclude -notcontains $p.ProcessName)) {
        Write-Host "Auto-detected foreground game: $($p.ProcessName).exe (pid $fgpid)" -ForegroundColor Green
        return "$($p.ProcessName).exe"
    }
    throw "Could not auto-detect the game. Re-run with -Game <exe>. Foreground was: $($p.ProcessName)"
}

$gameExe = Resolve-GameName -Explicit $Game

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$out = Join-Path $env:TEMP "pm_${Label}_${ts}.csv"

Write-Host ""
Write-Host "==> Capturing '$gameExe' for $Seconds s  [$Label]" -ForegroundColor Cyan
Write-Host "    Output: $out" -ForegroundColor DarkGray
Write-Host "    Game must be foreground and running at its UNCAPPED frame rate." -ForegroundColor Yellow
if ($Label -eq 'shared') {
    Write-Host "    >>> Ralph Meet MUST be actively sharing this game now." -ForegroundColor Yellow
}
if ($Label -eq 'baseline') {
    Write-Host "    >>> Ralph Meet must be OPEN but NOT sharing (capture loop stopped)." -ForegroundColor Yellow
}
if ($Label -eq 'control') {
    Write-Host "    >>> Ralph Meet must be FULLY CLOSED (no ralph-meet-desktop processes)." -ForegroundColor Yellow
    $running = Get-Process -Name "ralph-meet-desktop" -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "    WARNING: $($running.Count) ralph-meet-desktop process(es) still running - close the app first." -ForegroundColor Red
    }
}
Write-Host ""
Start-Sleep -Seconds 3

# PresentMon needs elevation; --restart_as_admin triggers a UAC prompt and the
# elevated copy writes the CSV. --track_gpu_video separates the encode-engine
# GPU work (our NVENC) from the game's 3D-engine work so we can attribute time.
& $PresentMon `
    --process_name $gameExe `
    --output_file $out `
    --timed $Seconds `
    --terminate_after_timed `
    --stop_existing_session `
    --v2_metrics `
    --track_gpu_video `
    --no_console_stats `
    --restart_as_admin

$deadline = (Get-Date).AddSeconds($Seconds + 20)
while (-not (Test-Path $out) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
# CSV may still be flushing after it appears; wait for the size to settle.
if (Test-Path $out) {
    $prev = -1; $stable = 0
    while ($stable -lt 3 -and (Get-Date) -lt $deadline) {
        $sz = (Get-Item $out).Length
        if ($sz -eq $prev) { $stable++ } else { $stable = 0; $prev = $sz }
        Start-Sleep -Milliseconds 400
    }
}

if (Test-Path $out) {
    $rows = (Get-Content $out | Measure-Object -Line).Lines - 1
    Write-Host ""
    Write-Host "==> Saved $out ($rows present rows)" -ForegroundColor Green
    Write-Host "    Header:" -ForegroundColor DarkGray
    Get-Content $out -TotalCount 1
    Write-Host ""
    Write-Host "Run the OTHER label, then analyze:" -ForegroundColor Cyan
    Write-Host "  python `"$PSScriptRoot\presentmon-analyze.py`"" -ForegroundColor White
}
else {
    Write-Host "ERROR: CSV not produced. Approve the UAC prompt if it appeared, then retry." -ForegroundColor Red
    exit 1
}
