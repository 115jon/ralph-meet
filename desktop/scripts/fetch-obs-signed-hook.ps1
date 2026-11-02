<#
.SYNOPSIS
    Fetch and verify the pinned, OBS-signed game-capture files.

.DESCRIPTION
    Reads desktop/packaging/obs-signed-hook.lock.json, downloads the official
    OBS Studio Windows release zip from the obsproject GitHub release (unless the
    files are already in place and valid), checks the zip's SHA-256, extracts the
    six capture files unmodified, and checks each one against the lock: SHA-256,
    a valid Authenticode signature, the signer subject and certificate
    thumbprint, and the PE file version.

    Any mismatch fails the script. Never modify or re-sign these files: any byte
    change voids the OBS Project signature that anti-cheat vendors allowlist.

    With -SourcesDir it also downloads the corresponding GPL-2.0 source archives
    named in the lock (OBS sources, Detours, obs-deps) and checks their SHA-256,
    for attaching to a desktop release.

.PARAMETER Destination
    Where the six files go. Default: desktop/src-tauri/resources/obs-capture/obs-signed.

.PARAMETER CacheDir
    Where the release zip is cached between runs. Default: $env:TEMP\ralph-obs-signed-hook.

.PARAMETER ZipPath
    Use this already-downloaded release zip instead of downloading it.

.PARAMETER SourcesDir
    Also download the source archives into this directory.
#>
[CmdletBinding()]
param(
    [string] $Destination,
    [string] $CacheDir = (Join-Path $env:TEMP 'ralph-obs-signed-hook'),
    [string] $ZipPath,
    [string] $SourcesDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktopDir = Split-Path -Parent $PSScriptRoot
$lockPath = Join-Path $desktopDir 'packaging/obs-signed-hook.lock.json'
$lock = Get-Content -Raw -Path $lockPath | ConvertFrom-Json
if (-not $Destination) {
    $Destination = Join-Path $desktopDir 'src-tauri/resources/obs-capture/obs-signed'
}

function Get-Sha256([string] $Path) {
    (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-Download([string] $Url, [string] $OutFile, [string] $Sha256) {
    if ((Test-Path $OutFile) -and (Get-Sha256 $OutFile) -eq $Sha256) {
        return
    }
    $parent = Split-Path -Parent $OutFile
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $partial = "$OutFile.partial"
    Write-Host "==> Downloading $Url"
    & curl.exe --fail --silent --show-error --location --retry 3 --output $partial $Url
    if ($LASTEXITCODE -ne 0) { throw "download failed ($LASTEXITCODE): $Url" }
    $actual = Get-Sha256 $partial
    if ($actual -ne $Sha256) {
        Remove-Item -Force $partial
        throw "SHA-256 mismatch for $Url`n  expected $Sha256`n  actual   $actual"
    }
    Move-Item -Force $partial $OutFile
}

# Returns a list of problems; empty means the file matches the lock.
function Test-LockedFile([string] $Path, $Entry) {
    $problems = @()
    if (-not (Test-Path $Path)) { return @("missing") }
    $sha = Get-Sha256 $Path
    if ($sha -ne $Entry.sha256) { $problems += "sha256 $sha, expected $($Entry.sha256)" }
    $sig = Get-AuthenticodeSignature -FilePath $Path
    if ($sig.Status -ne 'Valid') { $problems += "signature status $($sig.Status)" }
    $cert = $sig.SignerCertificate
    if ($null -eq $cert) {
        $problems += "no signer certificate"
    } else {
        $cn = $cert.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
        if ($cn -ne $lock.signer_subject) { $problems += "signer '$cn', expected '$($lock.signer_subject)'" }
        if ($cert.Thumbprint -ne $Entry.signer_thumbprint) {
            $problems += "signer thumbprint $($cert.Thumbprint), expected $($Entry.signer_thumbprint) (a certificate change moves anti-cheat compatibility; re-check the OBS KB before accepting it)"
        }
    }
    $version = (Get-Item $Path).VersionInfo.FileVersion
    if ($null -eq $version) { $version = '' }
    if ($version -ne $Entry.file_version) { $problems += "file version '$version', expected '$($Entry.file_version)'" }
    return $problems
}

function Test-AllInPlace {
    foreach ($entry in $lock.files) {
        if (@(Test-LockedFile (Join-Path $Destination $entry.name) $entry).Count -gt 0) { return $false }
    }
    return $true
}

Write-Host "==> OBS-signed capture hook: OBS $($lock.obs_version) (hook $($lock.hook_ver)) -> $Destination"

if (Test-AllInPlace) {
    Write-Host "==> All $($lock.files.Count) files already in place and verified"
} else {
    if (-not $ZipPath) {
        $ZipPath = Join-Path $CacheDir $lock.release_asset.name
        Get-Download $lock.release_asset.url $ZipPath $lock.release_asset.sha256
    } elseif ((Get-Sha256 $ZipPath) -ne $lock.release_asset.sha256) {
        throw "SHA-256 mismatch for $ZipPath (expected $($lock.release_asset.sha256))"
    }

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $lock.files) {
            $zipEntry = $zip.GetEntry($entry.zip_path)
            if ($null -eq $zipEntry) { throw "$($entry.zip_path) is not in $($lock.release_asset.name)" }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($zipEntry, (Join-Path $Destination $entry.name), $true)
        }
    } finally {
        $zip.Dispose()
    }
}

$failed = $false
foreach ($entry in $lock.files) {
    $problems = @(Test-LockedFile (Join-Path $Destination $entry.name) $entry)
    if ($problems.Count -gt 0) {
        $failed = $true
        Write-Host "FAIL $($entry.name): $($problems -join '; ')" -ForegroundColor Red
    } else {
        Write-Host "  ok $($entry.name)  $($entry.sha256.Substring(0, 12))  $($lock.signer_subject) $($entry.signer_thumbprint.Substring(0, 8))"
    }
}
if ($failed) { throw "OBS-signed capture files do not match $lockPath" }

if ($SourcesDir) {
    foreach ($source in $lock.sources) {
        Get-Download $source.url (Join-Path $SourcesDir $source.name) $source.sha256
        Write-Host "  ok source $($source.name)"
    }
}
