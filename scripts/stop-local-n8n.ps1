param(
	[switch]$WithTunnel
)

. (Join-Path $PSScriptRoot 'local-n8n-common.ps1')

Ensure-LocalEnvFile | Out-Null
Ensure-DockerCliAvailable | Out-Null

if ($WithTunnel) {
	Invoke-LocalDockerCompose --profile public down
} else {
	Invoke-LocalDockerCompose down
}

Write-Host 'Stopped the local n8n stack.'
