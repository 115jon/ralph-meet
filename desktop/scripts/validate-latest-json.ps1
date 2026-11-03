<#
.SYNOPSIS
    Checks the updater manifest (latest.json) before the release is published.

.DESCRIPTION
    Existing installs auto-update from latest.json, so a bad one strands users.
    Fails (throws) unless:
      - version equals tauri.conf.json's version and the release tag (v<version>)
      - the windows-x86_64 url ends with /releases/download/<tag>/YapSetup.exe
      - pub_date is a UTC timestamp (yyyy-MM-ddTHH:mm:ssZ)
      - signature is base64 of a minisign signature made by the key in
        tauri.conf.json plugins.updater.pubkey (compared by minisign key id)
    The signature itself is not cryptographically verified here: the Tauri CLI
    has no `signer verify` command.
#>
param(
    [Parameter(Mandatory = $true)][string]$LatestJson,
    [Parameter(Mandatory = $true)][string]$TauriConf,
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$Repo
)

$ErrorActionPreference = "Stop"

# A minisign key or signature line is base64 of: 2-byte algorithm, 8-byte key id, then key/signature bytes.
function Get-MinisignKeyId([string]$Base64Line) {
    $bytes = [Convert]::FromBase64String($Base64Line.Trim())
    if ($bytes.Length -lt 10) { throw "minisign data is too short" }
    return ($bytes[2..9] | ForEach-Object { $_.ToString("x2") }) -join ""
}

# The decoded updater pubkey/signature are minisign files: comment line, base64 line, ...
function Get-MinisignDataLine([string]$Base64File) {
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Base64File.Trim()))
    $lines = $text -split "\r?\n" | Where-Object { $_ -and -not $_.StartsWith("untrusted comment:") -and -not $_.StartsWith("trusted comment:") }
    if (-not $lines) { throw "no minisign data line found" }
    return @($lines)[0]
}

$errors = New-Object System.Collections.Generic.List[string]
$latestText = Get-Content -LiteralPath $LatestJson -Raw
$latest = $latestText | ConvertFrom-Json
# ConvertFrom-Json turns ISO timestamps into DateTime, so read pub_date from the raw text.
$pubDate = if ($latestText -match '"pub_date"\s*:\s*"([^"]*)"') { $Matches[1] } else { "" }
$conf = Get-Content -LiteralPath $TauriConf -Raw | ConvertFrom-Json

if ($latest.version -ne $conf.version) { $errors.Add("version '$($latest.version)' != tauri.conf.json version '$($conf.version)'") }
if ($Tag -ne "v$($conf.version)") { $errors.Add("release tag '$Tag' != v$($conf.version)") }
if ($pubDate -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') { $errors.Add("pub_date '$pubDate' is not yyyy-MM-ddTHH:mm:ssZ") }

$platform = $latest.platforms."windows-x86_64"
if (-not $platform) {
    $errors.Add("platforms.windows-x86_64 is missing")
} else {
    $expectedUrl = "https://github.com/$Repo/releases/download/$Tag/YapSetup.exe"
    if ($platform.url -ne $expectedUrl) { $errors.Add("url '$($platform.url)' != '$expectedUrl'") }

    if ([string]::IsNullOrWhiteSpace($platform.signature)) {
        $errors.Add("signature is empty")
    } else {
        try {
            $sigKey = Get-MinisignKeyId (Get-MinisignDataLine $platform.signature)
            $pubKey = Get-MinisignKeyId (Get-MinisignDataLine $conf.plugins.updater.pubkey)
            if ($sigKey -ne $pubKey) { $errors.Add("signature key id $sigKey != updater pubkey key id $pubKey") }
        } catch {
            $errors.Add("signature or pubkey is not valid minisign base64: $($_.Exception.Message)")
        }
    }
}

if ($errors.Count -gt 0) {
    throw "latest.json validation failed:`n  - $($errors -join "`n  - ")"
}
Write-Host "==> latest.json OK: version $($latest.version), tag $Tag, signature matches the updater pubkey id."
