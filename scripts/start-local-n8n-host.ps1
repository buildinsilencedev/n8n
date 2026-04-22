param(
	[switch]$Build,
	[switch]$NoBrowser
)

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

Ensure-LocalN8nHostEnvFile | Out-Null
New-Item -ItemType Directory -Force -Path (Get-LocalN8nHostLogsDir) | Out-Null

if ($Build -or -not (Test-Path (Join-Path (Get-LocalN8nHostRepoRoot) 'packages\cli\dist\index.js'))) {
	& (Join-Path $PSScriptRoot 'setup-local-n8n-host.ps1') -NoStart
}

$existingProcess = Get-LocalN8nHostProcess
if (-not $existingProcess) {
	$stdoutLog = Get-LocalN8nHostStdoutLog
	$stderrLog = Get-LocalN8nHostStderrLog
	$process = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') `
		-ArgumentList @('-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (Join-Path $PSScriptRoot 'run-local-n8n-host.ps1')) `
		-WorkingDirectory (Get-LocalN8nHostRepoRoot) `
		-WindowStyle Hidden `
		-PassThru `
		-RedirectStandardOutput $stdoutLog `
		-RedirectStandardError $stderrLog
	Set-Content -Path (Get-LocalN8nHostPidFile) -Value $process.Id -NoNewline
}

Wait-ForLocalN8nHostReadiness
& (Join-Path $PSScriptRoot 'enable-local-n8n-mcp-host.ps1') -Quiet

if (-not $NoBrowser) {
	Start-Process 'http://localhost:5678' | Out-Null
}

Write-Host 'Local n8n is ready at http://localhost:5678'
