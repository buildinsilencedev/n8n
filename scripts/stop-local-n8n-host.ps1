. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

$process = Get-LocalN8nHostProcess
if ($process) {
	Stop-Process -Id $process.Id -Force
}

Remove-Item (Get-LocalN8nHostPidFile) -Force -ErrorAction SilentlyContinue
Write-Host 'Stopped the local n8n host process.'
