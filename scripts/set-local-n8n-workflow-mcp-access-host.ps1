param(
	[string]$WorkflowId,
	[string]$WorkflowName,
	[bool]$Enabled = $true
)

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

if (-not $WorkflowId -and -not $WorkflowName) {
	throw 'Provide either -WorkflowId or -WorkflowName.'
}

$envFile = Ensure-LocalN8nHostEnvFile
$arguments = @(
	'.\scripts\local-n8n-sqlite.mjs',
	'--command', 'set-workflow-mcp-access',
	'--env-file', $envFile,
	'--enabled', $Enabled.ToString().ToLowerInvariant()
)

if ($WorkflowId) {
	$arguments += @('--workflow-id', $WorkflowId)
} else {
	$arguments += @('--workflow-name', $WorkflowName)
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
	throw 'Failed to update workflow MCP visibility in the local SQLite database.'
}

Write-Host "Updated workflow MCP visibility to $Enabled."
