param([switch]$Quiet)

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

$envFile = Ensure-LocalN8nHostEnvFile
node .\scripts\local-n8n-sqlite.mjs --command set-setting --env-file $envFile --key mcp.access.enabled --value true
if ($LASTEXITCODE -ne 0) {
	throw 'Failed to enable MCP access in the local SQLite database.'
}

if (-not $Quiet) {
	Write-Host 'Enabled instance MCP access in the local n8n database.'
}
