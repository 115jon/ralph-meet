<#
.SYNOPSIS
    Example/scenario tests for scripts/dev-deployed.ps1 (owned-game-capture-hook task 8.2).

.DESCRIPTION
    Exercises the dev-script switch table and the mutually-exclusive switch
    handling (Requirements 6.1-6.5) by running the REAL dev-deployed.ps1 in a
    child PowerShell process and observing its behaviour as a black box.

    Avoiding the long-running dev server:
      The script ends every launching branch with `pnpm run <devScript>`, which
      would normally start `tauri dev` (a long-running process). These tests put
      a fake `pnpm.cmd` first on PATH (inside the rust-bin directory the script
      prepends). The fake pnpm records its arguments and the capture-relevant
      environment variables, then exits 0 WITHOUT launching tauri. A fake
      `rustup.cmd` and a dummy `libcef.dll` are placed in a sandboxed
      USERPROFILE so the script's CEF guard and pre-launch echo run unchanged.
      No `tauri dev` / dev server is ever started.

    Framework: Pester 3.4.0 (Windows PowerShell 5.1). Run with:
      powershell -NoProfile -Command "Invoke-Pester -Path '<this file>' -PassThru"
#>

$script:DevScriptPath = (Resolve-Path (Join-Path $PSScriptRoot '..\dev-deployed.ps1')).Path

# Runs dev-deployed.ps1 in a hermetic child process. Returns a result object
# capturing the exit code, console output, whether pnpm (the launch) was
# reached, and the resolved devScript / Capture_Policy / hook env the script
# handed to the launch.
function Invoke-DevScript {
    param([string[]] $ScriptArgs = @())

    $sandbox = Join-Path $env:TEMP ("devdep-test-" + [guid]::NewGuid().ToString('N'))
    $binDir  = Join-Path $sandbox 'scoop\apps\rustup\current\.cargo\bin'
    $cefDir  = Join-Path $sandbox '.local\share\cef'
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    New-Item -ItemType Directory -Path $cefDir -Force | Out-Null

    # Dummy CEF runtime so the script's `Test-Path libcef.dll` guard passes.
    Set-Content -Path (Join-Path $cefDir 'libcef.dll') -Value 'stub' -Encoding ASCII

    $record = Join-Path $sandbox 'pnpm-invocation.txt'

    # Fake pnpm: record args + the capture-relevant env, then exit 0 WITHOUT
    # launching tauri. This is what keeps the long-running dev server from ever
    # starting. `if defined` distinguishes an unset var from an empty one.
    $pnpmCmd = @"
@echo off
> "$record" echo ARGS=%*
if defined RALPH_CAPTURE_POLICY (>> "$record" echo POLICY=%RALPH_CAPTURE_POLICY%) else (>> "$record" echo POLICY=__UNSET__)
if defined RALPH_GAME_CAPTURE_HOOK (>> "$record" echo HOOK=%RALPH_GAME_CAPTURE_HOOK%) else (>> "$record" echo HOOK=__UNSET__)
exit /b 0
"@
    Set-Content -Path (Join-Path $binDir 'pnpm.cmd') -Value $pnpmCmd -Encoding ASCII

    # Fake rustup so the pre-launch echo's `rustup show active-toolchain` does
    # not throw under $ErrorActionPreference = 'Stop'.
    Set-Content -Path (Join-Path $binDir 'rustup.cmd') -Value "@echo off`r`necho stub-toolchain`r`nexit /b 0" -Encoding ASCII

    $savedUserProfile = $env:USERPROFILE
    $env:USERPROFILE = $sandbox
    try {
        $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script:DevScriptPath) + $ScriptArgs
        $output = & powershell.exe @argList 2>&1
        $exit = $LASTEXITCODE
    } finally {
        $env:USERPROFILE = $savedUserProfile
    }

    $joined = ($output | Out-String)
    $invoked = Test-Path $record
    $devScript = $null; $policy = $null; $hook = $null
    if ($invoked) {
        foreach ($line in (Get-Content $record)) {
            if     ($line -match '^ARGS=run\s+(.+)$') { $devScript = $Matches[1].Trim() }
            elseif ($line -match '^POLICY=(.*)$')     { $policy    = $Matches[1].Trim() }
            elseif ($line -match '^HOOK=(.*)$')       { $hook      = $Matches[1].Trim() }
        }
    }

    Remove-Item -Recurse -Force $sandbox -ErrorAction SilentlyContinue

    return [PSCustomObject]@{
        ExitCode    = $exit
        Output      = $joined
        PnpmInvoked = [bool]$invoked
        DevScript   = $devScript
        Policy      = $policy
        Hook        = $hook
    }
}

Describe "dev-deployed.ps1 switch table and mutual exclusion" {

    Context "no switches -> hook-exclusive default (Req 6.1, 6.4)" {
        $r = Invoke-DevScript @()

        It "reaches the launch (does not error out)" {
            $r.PnpmInvoked | Should Be $true
            $r.ExitCode | Should Be 0
        }
        It "launches the hook-enabled dev script" {
            $r.DevScript | Should Be 'dev:deployed:hook'
        }
        It "sets Capture_Policy to hook-exclusive" {
            $r.Policy | Should Be 'hook-exclusive'
        }
        It "enables the hook via RALPH_GAME_CAPTURE_HOOK=1" {
            $r.Hook | Should Be '1'
        }
        It "echoes the resolved policy and hook state before launch (Req 6.4)" {
            $r.Output | Should Match 'Capture policy\s*:\s*hook-exclusive'
            $r.Output | Should Match 'Game hook\s*:\s*ENABLED'
        }
    }

    Context "-Wgc only -> hook enabled with WGC fallback (Req 6.2, 6.4)" {
        $r = Invoke-DevScript @('-Wgc')

        It "reaches the launch (does not error out)" {
            $r.PnpmInvoked | Should Be $true
            $r.ExitCode | Should Be 0
        }
        It "launches the hook-enabled dev script" {
            $r.DevScript | Should Be 'dev:deployed:hook'
        }
        It "sets Capture_Policy to wgc-enabled" {
            $r.Policy | Should Be 'wgc-enabled'
        }
        It "enables the hook via RALPH_GAME_CAPTURE_HOOK=1" {
            $r.Hook | Should Be '1'
        }
        It "echoes the resolved policy and hook state before launch (Req 6.4)" {
            $r.Output | Should Match 'Capture policy\s*:\s*wgc-enabled'
            $r.Output | Should Match 'Game hook\s*:\s*ENABLED'
        }
    }

    Context "-NoHook only -> WGC only, hook disabled (Req 6.3, 6.4)" {
        $r = Invoke-DevScript @('-NoHook')

        It "reaches the launch (does not error out)" {
            $r.PnpmInvoked | Should Be $true
            $r.ExitCode | Should Be 0
        }
        It "launches the no-hook dev script" {
            $r.DevScript | Should Be 'dev:deployed'
        }
        It "sets Capture_Policy to wgc-enabled" {
            $r.Policy | Should Be 'wgc-enabled'
        }
        It "leaves RALPH_GAME_CAPTURE_HOOK unset (hook disabled)" {
            $r.Hook | Should Be '__UNSET__'
        }
        It "echoes the resolved policy and disabled hook state before launch (Req 6.4)" {
            $r.Output | Should Match 'Capture policy\s*:\s*wgc-enabled'
            $r.Output | Should Match 'Game hook\s*:\s*DISABLED'
        }
    }

    Context "-NoHook and -Wgc together -> mutually exclusive error/exit (Req 6.5)" {
        $r = Invoke-DevScript @('-NoHook', '-Wgc')

        It "exits with a non-zero status" {
            $r.ExitCode | Should Be 1
        }
        It "never launches the app (pnpm is not reached)" {
            $r.PnpmInvoked | Should Be $false
        }
        It "reports that the two switches are mutually exclusive" {
            $r.Output | Should Match 'mutually exclusive'
        }
        It "states it is not launching" {
            $r.Output | Should Match '[Nn]ot launching'
        }
    }
}
