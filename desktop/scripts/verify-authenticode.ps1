<#
.SYNOPSIS
    Fails unless every given file carries a valid, timestamped Authenticode
    signature from the expected signer.

.DESCRIPTION
    Runs `signtool verify /pa /all` (default Authenticode policy, every
    signature) on each file, then checks the signer's common name and that the
    signature has an RFC 3161 timestamp, so it stays valid after the
    short-lived Artifact Signing certificate expires. The desktop-release
    workflow calls it after Azure Artifact Signing. See CODE_SIGNING_POLICY.md.

.PARAMETER Path
    Files to verify.

.PARAMETER ExpectedSigner
    Required signer common name (for example "Jonathan Martinez").

.EXAMPLE
    .\verify-authenticode.ps1 -ExpectedSigner "Jonathan Martinez" -Path .\YapSetup.exe
#>
param(
    [Parameter(Mandatory)][string[]]$Path,
    [Parameter(Mandatory)][string]$ExpectedSigner
)

$ErrorActionPreference = "Stop"

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
    Select-Object -First 1
if (-not $signtool) { throw "signtool.exe not found under the Windows 10 SDK" }

$problems = New-Object System.Collections.Generic.List[string]
foreach ($file in $Path) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $problems.Add("${file}: missing"); continue }

    & $signtool.FullName verify /pa /all $file | Out-Host
    if ($LASTEXITCODE -ne 0) { $problems.Add("${file}: signtool verify /pa failed (exit $LASTEXITCODE)"); continue }

    $sig = Get-AuthenticodeSignature -FilePath $file
    $cn = $sig.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($cn -ne $ExpectedSigner) { $problems.Add("${file}: signer '$cn', expected '$ExpectedSigner'") }
    if ($null -eq $sig.TimeStamperCertificate) { $problems.Add("${file}: signature has no timestamp") }
    Write-Host "==> $file signed by '$cn', timestamped by '$($sig.TimeStamperCertificate.Subject)'"
}

if ($problems.Count -gt 0) {
    throw "Authenticode verification failed:`n  - $($problems -join "`n  - ")"
}
Write-Host "==> $($Path.Count) file(s) verified" -ForegroundColor Green
