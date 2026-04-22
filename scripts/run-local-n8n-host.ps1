Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

$envFile = Ensure-LocalN8nHostEnvFile
$envValues = Read-LocalN8nHostEnvFile $envFile
Add-LocalN8nHostBinDirToPath

foreach ($entry in $envValues.GetEnumerator()) {
	[System.Environment]::SetEnvironmentVariable($entry.Key, $entry.Value)
}

Set-Location (Get-LocalN8nHostRepoRoot)
& (Join-Path (Get-LocalN8nHostBinDir) 'pnpm.cmd') start
