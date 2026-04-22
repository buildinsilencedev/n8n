param()

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

$process = Get-LocalN8nHostCloudflaredProcess
if (-not $process) {
	Write-Host 'Cloudflare tunnel is not running.'
	exit 0
}

Stop-Process -Id $process.Id -Force
Remove-Item (Get-LocalN8nHostCloudflaredPidFile) -Force -ErrorAction SilentlyContinue
Write-Host 'Stopped the Cloudflare tunnel.'
