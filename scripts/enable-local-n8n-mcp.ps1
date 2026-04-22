param(
	[switch]$Quiet
)

. (Join-Path $PSScriptRoot 'local-n8n-common.ps1')

$sql = @"
INSERT INTO settings (key, value, "loadOnStartup")
VALUES ('mcp.access.enabled', 'true', true)
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, "loadOnStartup" = EXCLUDED."loadOnStartup";
"@

Invoke-LocalPostgresSql -Sql $sql | Out-Null

if (-not $Quiet) {
	Write-Host 'Enabled instance MCP access in the local n8n database.'
}
