param()

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

$configPath = Get-LocalN8nHostCloudflaredConfig
if (-not (Test-Path $configPath)) {
	throw "Cloudflare config not found at $configPath. Run configure-local-n8n-cloudflared-host.ps1 first."
}

$existingProcess = Get-LocalN8nHostCloudflaredProcess
if ($existingProcess) {
	Write-Host 'Cloudflare tunnel is already running.'
	exit 0
}

New-Item -ItemType Directory -Force -Path (Get-LocalN8nHostLogsDir) | Out-Null
$cloudflaredExe = Get-LocalN8nHostCloudflaredExe
$logFile = Get-LocalN8nHostCloudflaredLog
$errorLog = Get-LocalN8nHostCloudflaredErrorLog
$process = Start-Process -FilePath $cloudflaredExe `
	-ArgumentList @('tunnel', '--config', $configPath, 'run') `
	-WorkingDirectory (Get-LocalN8nHostRepoRoot) `
	-WindowStyle Hidden `
	-PassThru `
	-RedirectStandardOutput $logFile `
	-RedirectStandardError $errorLog

Set-Content -Path (Get-LocalN8nHostCloudflaredPidFile) -Value $process.Id -NoNewline
Write-Host "Cloudflare tunnel started in the background. Logs: $logFile and $errorLog"
