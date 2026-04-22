param(
	[switch]$WithTunnel
)

. (Join-Path $PSScriptRoot 'local-n8n-common.ps1')

Ensure-LocalEnvFile | Out-Null

& (Join-Path $PSScriptRoot 'start-local-n8n.ps1') -Build -WithTunnel:$WithTunnel
& (Join-Path $PSScriptRoot 'install-local-n8n-shortcut.ps1') | Out-Null

Write-Host ''
Write-Host 'Next steps:'
Write-Host '1. Complete the owner setup in the browser.'
Write-Host '2. Create an OpenRouter credential named OpenRouter.'
Write-Host '3. Run scripts\set-local-n8n-instance-ai-preferences.ps1 -CredentialName OpenRouter'
Write-Host '4. Use the desktop shortcut named n8n Local for daily launch.'
