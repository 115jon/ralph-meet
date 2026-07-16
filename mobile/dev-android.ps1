$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "scripts\dev-android.ps1"
& $script @args
exit $LASTEXITCODE
