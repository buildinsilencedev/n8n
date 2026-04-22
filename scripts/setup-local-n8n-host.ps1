param([switch]$NoStart)

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

Ensure-LocalN8nHostEnvFile | Out-Null
Add-LocalN8nHostBinDirToPath

Set-Location (Get-LocalN8nHostRepoRoot)
node .\scripts\ensure-workspace-bin-placeholders.mjs

$env:CI = '1'
Invoke-LocalN8nHostPnpm install --frozen-lockfile
Invoke-LocalN8nHostPnpm build --summarize

& (Join-Path $PSScriptRoot 'install-local-n8n-shortcut.ps1') -TargetScript (Join-Path $PSScriptRoot 'start-local-n8n-host.ps1') | Out-Null

if (-not $NoStart) {
	& (Join-Path $PSScriptRoot 'start-local-n8n-host.ps1') -NoBrowser
}

Write-Host ''
Write-Host 'Next steps:'
Write-Host '1. Complete the owner setup in the browser.'
Write-Host '2. Create an OpenRouter credential named OpenRouter.'
Write-Host '3. Run scripts\set-local-n8n-instance-ai-preferences-host.ps1 -CredentialName OpenRouter'
Write-Host '4. Use the desktop shortcut named n8n Local for daily launch.'
