<#
.SYNOPSIS
    Stages the desktop installer payload from desktop/packaging/payload-manifest.json
    and packs it into desktop/installer/Assets/payload.rmpk.

.DESCRIPTION
    The manifest is the single list of what ships. This script resolves every
    entry against its source directory, fails loudly if anything is missing,
    copies the result into a clean stage directory, then runs
    desktop/packaging/PayloadPacker to produce the LZMA-compressed RMPK payload
    that the installer embeds. Both build-installer.ps1 and the desktop-release
    workflow call it. See docs/desktop/packaging.md.

.PARAMETER CefDir
    CEF runtime directory. Defaults to $env:CEF_PATH.

.PARAMETER ReleaseDir
    Cargo release output. Defaults to desktop/src-tauri/target/release.

.PARAMETER LauncherDir
    Root launcher stub release output. Defaults to desktop/launcher/target/release.

.PARAMETER ResourcesDir
    Defaults to desktop/src-tauri/resources.

.PARAMETER StageDir
    Where files are staged. Defaults to a temp directory, removed afterwards
    unless -KeepStage is given.

.PARAMETER OutputPath
    Packed payload. Defaults to desktop/installer/Assets/payload.rmpk.

.PARAMETER PackerArgs
    Extra arguments appended to `PayloadPacker pack`.

.PARAMETER NoPack
    Stage and validate only; skip the packer.

.PARAMETER Dotnet
    dotnet executable used to build the packer. Defaults to the Scoop SDK when
    present, otherwise `dotnet` from PATH.

.EXAMPLE
    .\stage-payload.ps1 -CefDir D:\cef
#>
param(
    [string]$CefDir = $env:CEF_PATH,
    [string]$ReleaseDir,
    [string]$LauncherDir,
    [string]$ResourcesDir,
    [string]$StageDir,
    [string]$OutputPath,
    [string]$Manifest,
    [string]$Dotnet,
    # Extra arguments for `PayloadPacker pack` (for example --block-mb 4 in tests).
    [string[]]$PackerArgs = @(),
    [switch]$NoPack,
    [switch]$KeepStage
)

$ErrorActionPreference = "Stop"

$desktopDir = Split-Path -Parent $PSScriptRoot
if (-not $ReleaseDir) { $ReleaseDir = Join-Path $desktopDir "src-tauri\target\release" }
if (-not $LauncherDir) { $LauncherDir = Join-Path $desktopDir "launcher\target\release" }
if (-not $ResourcesDir) { $ResourcesDir = Join-Path $desktopDir "src-tauri\resources" }
if (-not $Manifest) { $Manifest = Join-Path $desktopDir "packaging\payload-manifest.json" }
if (-not $OutputPath) { $OutputPath = Join-Path $desktopDir "installer\Assets\payload.rmpk" }
if (-not $Dotnet) {
    $scoopDotnet = Join-Path $env:USERPROFILE "scoop\apps\dotnet-sdk\current\dotnet.exe"
    $Dotnet = if (Test-Path -LiteralPath $scoopDotnet) { $scoopDotnet } else { "dotnet" }
}

$sourceDirs = @{ cef = $CefDir; release = $ReleaseDir; launcher = $LauncherDir; resources = $ResourcesDir }
foreach ($name in $sourceDirs.Keys) {
    if (-not $sourceDirs[$name] -or -not (Test-Path -LiteralPath $sourceDirs[$name] -PathType Container)) {
        throw "Payload source '$name' directory not found: '$($sourceDirs[$name])'"
    }
}

$spec = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
if ($spec.version -ne 1) { throw "Unsupported payload manifest version: $($spec.version)" }

# Resolve every entry to (source file, destination relative path) first so all
# problems are reported together.
$plan = New-Object System.Collections.Generic.List[object]
$problems = New-Object System.Collections.Generic.List[string]
foreach ($entry in $spec.entries) {
    $base = $sourceDirs[$entry.source]
    if (-not $base) { $problems.Add("Unknown source '$($entry.source)' for '$($entry.from)'"); continue }
    $to = if ($entry.to) { $entry.to } else { $entry.from }
    $src = Join-Path $base $entry.from

    switch ($entry.type) {
        "file" {
            if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
                $problems.Add("Missing file [$($entry.source)] $src")
            } else {
                $plan.Add([pscustomobject]@{ Source = $src; Dest = $to })
            }
        }
        "directory" {
            if (-not (Test-Path -LiteralPath $src -PathType Container)) {
                $problems.Add("Missing directory [$($entry.source)] $src")
                continue
            }
            $srcRoot = (Resolve-Path -LiteralPath $src).Path.TrimEnd('\')
            $found = @(Get-ChildItem -LiteralPath $src -File -Recurse)
            if ($found.Count -eq 0) { $problems.Add("Empty directory [$($entry.source)] $src"); continue }
            foreach ($file in $found) {
                $rel = $file.FullName.Substring($srcRoot.Length).TrimStart('\')
                $plan.Add([pscustomobject]@{ Source = $file.FullName; Dest = (Join-Path $to $rel) })
            }
        }
        default { $problems.Add("Unknown entry type '$($entry.type)' for '$($entry.from)'") }
    }
}

$duplicates = $plan | Group-Object { $_.Dest.ToLowerInvariant() } | Where-Object Count -gt 1
foreach ($dup in $duplicates) { $problems.Add("Duplicate payload destination: $($dup.Name)") }

if ($problems.Count -gt 0) {
    throw "Payload manifest cannot be satisfied:`n  - $($problems -join "`n  - ")"
}

$ownStage = -not $StageDir
if ($ownStage) { $StageDir = Join-Path ([System.IO.Path]::GetTempPath()) "RalphMeetStage" }
if (Test-Path -LiteralPath $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

Write-Host "==> Staging $($plan.Count) payload files into $StageDir" -ForegroundColor Yellow
foreach ($item in $plan) {
    $dest = Join-Path $StageDir $item.Dest
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $item.Source -Destination $dest -Force
}

try {
    if ($NoPack) {
        Write-Host "==> -NoPack: staged and validated only." -ForegroundColor Green
        return
    }

    $packerProject = Join-Path $desktopDir "packaging\PayloadPacker\PayloadPacker.csproj"
    Write-Host "==> Building PayloadPacker..." -ForegroundColor Yellow
    & $Dotnet build $packerProject -c Release --nologo -v quiet
    if ($LASTEXITCODE -ne 0) { throw "PayloadPacker build failed with exit code $LASTEXITCODE" }
    $packer = Join-Path (Split-Path -Parent $packerProject) "bin\Release\net48\PayloadPacker.exe"

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
    if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }

    Write-Host "==> Packing payload to $OutputPath ..." -ForegroundColor Yellow
    & $packer pack $StageDir $OutputPath @PackerArgs
    if ($LASTEXITCODE -ne 0) { throw "PayloadPacker pack failed with exit code $LASTEXITCODE" }

    # Decode everything back and compare with the stage before the installer embeds it.
    & $packer verify $OutputPath $StageDir
    if ($LASTEXITCODE -ne 0) { throw "Packed payload failed verification (exit code $LASTEXITCODE)" }

    Write-Host "==> Payload ready: $OutputPath ($([math]::Round((Get-Item -LiteralPath $OutputPath).Length / 1MB, 1)) MB)" -ForegroundColor Green
} finally {
    if ($ownStage -and -not $KeepStage -and (Test-Path -LiteralPath $StageDir)) {
        Remove-Item -LiteralPath $StageDir -Recurse -Force
    }
}
