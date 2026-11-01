<#
.SYNOPSIS
    End-to-end check of the payload pipeline with synthetic inputs (no CEF or
    cargo build needed): manifest -> stage-payload.ps1 -> PayloadPacker.

.DESCRIPTION
    Fabricates CEF and release directories that satisfy
    desktop/packaging/payload-manifest.json (checked-in resources are used for
    the GPL documents), then verifies that:
      - staging + packing + decode-and-compare succeeds, and the packed payload
        contains every GPL document under obs-capture\;
      - staging fails loudly when any one manifest file is missing.
    Used by .github/workflows/desktop-validation.yml; runnable locally.
#>
param(
    [string]$Dotnet
)

$ErrorActionPreference = "Stop"
$desktopDir = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $desktopDir "packaging\payload-manifest.json") -Raw | ConvertFrom-Json
$resourcesDir = Join-Path $desktopDir "src-tauri\resources"
$stageScript = Join-Path $PSScriptRoot "stage-payload.ps1"
$extra = @{}
if ($Dotnet) { $extra.Dotnet = $Dotnet }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("RalphMeetPipelineTest_" + [guid]::NewGuid().ToString("N"))
$cef = Join-Path $work "cef"
$release = Join-Path $work "release"
New-Item -ItemType Directory -Force -Path $cef, $release | Out-Null

function New-FakeFile([string]$Path, [int]$Bytes) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    $data = New-Object byte[] $Bytes
    (New-Object System.Random($Path.Length)).NextBytes($data)
    [System.IO.File]::WriteAllBytes($Path, $data)
}

try {
    $roots = @{ cef = $cef; release = $release }
    foreach ($entry in $manifest.entries) {
        if (-not $roots.ContainsKey($entry.source)) { continue }
        $path = Join-Path $roots[$entry.source] $entry.from
        if ($entry.type -eq "directory") {
            New-FakeFile (Join-Path $path "en-US.pak") 2048
            New-FakeFile (Join-Path $path "fr.pak") 2048
        } else {
            # One file is big enough to span several 1 MiB blocks.
            New-FakeFile $path ($(if ($entry.from -eq "libcef.dll") { 3MB + 123 } else { 4096 }))
        }
    }

    $out = Join-Path $work "payload.rmpk"
    & $stageScript -CefDir $cef -ReleaseDir $release -ResourcesDir $resourcesDir -StageDir (Join-Path $work "stage") `
        -OutputPath $out -PackerArgs @("--block-mb", "1") @extra
    if (-not (Test-Path -LiteralPath $out)) { throw "Payload was not produced" }

    $extracted = Join-Path $work "extracted"
    $packer = Join-Path $desktopDir "packaging\PayloadPacker\bin\Release\net48\PayloadPacker.exe"
    & $packer extract $out $extracted
    if ($LASTEXITCODE -ne 0) { throw "extract failed" }
    foreach ($doc in "LICENSE-GPLv2.txt", "ATTRIBUTION.md", "SOURCE-OFFER.md") {
        if (-not (Test-Path -LiteralPath (Join-Path $extracted "obs-capture\$doc"))) {
            throw "Packed payload is missing obs-capture\$doc"
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $extracted "RalphMeet.exe"))) { throw "Packed payload is missing RalphMeet.exe" }

    # Negative case: a missing manifest file must fail staging.
    Remove-Item -LiteralPath (Join-Path $cef "libEGL.dll")
    $failed = $false
    try {
        & $stageScript -CefDir $cef -ReleaseDir $release -ResourcesDir $resourcesDir -StageDir (Join-Path $work "stage2") -NoPack @extra
    } catch {
        $failed = $_.Exception.Message -match "libEGL.dll"
    }
    if (-not $failed) { throw "stage-payload.ps1 did not fail on a missing CEF file" }

    Write-Host "==> Payload pipeline test passed." -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
