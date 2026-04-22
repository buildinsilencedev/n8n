param(
	[switch]$Build,
	[switch]$WithTunnel,
	[switch]$NoBrowser
)

. (Join-Path $PSScriptRoot 'local-n8n-common.ps1')

Ensure-LocalEnvFile | Out-Null
Ensure-DockerDesktopRunning

$composeArguments = @('up', '-d')
if ($Build) {
	$composeArguments += '--build'
}

if ($WithTunnel) {
	$configPath = Get-LocalN8nCloudflaredConfigFile
	if (-not (Test-Path $configPath)) {
		throw "Cloudflare config not found at $configPath. Copy config.example.yml to config.yml first."
	}
	$composeArguments = @('--profile', 'public') + $composeArguments
}

Invoke-LocalDockerCompose @composeArguments
Wait-ForLocalN8nReadiness

& (Join-Path $PSScriptRoot 'enable-local-n8n-mcp.ps1') -Quiet

if (-not $NoBrowser) {
	Start-Process 'http://localhost:5678' | Out-Null
}

Write-Host 'Local n8n is ready at http://localhost:5678'
