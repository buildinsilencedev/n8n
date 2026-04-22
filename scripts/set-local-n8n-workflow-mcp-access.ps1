param(
	[string]$WorkflowId,
	[string]$WorkflowName,
	[bool]$Enabled = $true
)

. (Join-Path $PSScriptRoot 'local-n8n-common.ps1')

if (-not $WorkflowId -and -not $WorkflowName) {
	throw 'Provide either -WorkflowId or -WorkflowName.'
}

$escapedWorkflowId = Escape-SqlLiteral $WorkflowId
$escapedWorkflowName = Escape-SqlLiteral $WorkflowName

$whereClause = if ($WorkflowId) {
	"id = '$escapedWorkflowId'"
} else {
	"name = '$escapedWorkflowName'"
}

$jsonValue = if ($Enabled) { 'true' } else { 'false' }

$sql = @"
UPDATE workflow_entity
SET settings = COALESCE(settings, '{}'::jsonb) || '{"availableInMCP": $jsonValue}'::jsonb
WHERE $whereClause;
"@

Invoke-LocalPostgresSql -Sql $sql | Out-Null
Write-Host "Updated workflow MCP visibility to $Enabled."
