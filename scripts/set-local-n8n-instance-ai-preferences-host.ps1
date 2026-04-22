param(
	[Parameter(Mandatory = $true)]
	[string]$CredentialName,
	[string]$CredentialType = 'openRouterApi',
	[string]$ModelName = 'x-ai/grok-4.1-fast',
	[string]$UserEmail
)

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

$envFile = Ensure-LocalN8nHostEnvFile
$arguments = @(
	'.\scripts\local-n8n-sqlite.mjs',
	'--command', 'set-instance-ai-defaults',
	'--env-file', $envFile,
	'--credential-name', $CredentialName,
	'--credential-type', $CredentialType,
	'--model-name', $ModelName
)

if ($UserEmail) {
	$arguments += @('--user-email', $UserEmail)
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
	throw 'Failed to set instance AI defaults in the local SQLite database.'
}

Write-Host "Set instance AI defaults to credential '$CredentialName' with model '$ModelName'."
