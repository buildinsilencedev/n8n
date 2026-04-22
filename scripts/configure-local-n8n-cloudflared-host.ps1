param(
	[Parameter(Mandatory = $true)][string]$TunnelId,
	[Parameter(Mandatory = $true)][string]$Hostname,
	[string]$CredentialsFile = (Join-Path $HOME ".cloudflared\$TunnelId.json")
)

. (Join-Path $PSScriptRoot 'local-n8n-host-common.ps1')

$configPath = Get-LocalN8nHostCloudflaredConfig
New-Item -ItemType Directory -Force -Path (Get-LocalN8nHostCloudflaredDir) | Out-Null

$content = Get-Content (Get-LocalN8nHostCloudflaredExampleConfig) -Raw
$content = $content.Replace('<your-tunnel-uuid>', $TunnelId)
$content = $content.Replace("C:\Users\Shadow\.cloudflared\<your-tunnel-uuid>.json", $CredentialsFile)
$content = $content.Replace('n8n-mcp.example.com', $Hostname)
Set-Content -Path $configPath -Value $content

Set-LocalN8nHostPublicBaseUrl -Hostname $Hostname

Write-Host "Wrote Cloudflare tunnel config to $configPath"
Write-Host "Updated local/windows-host/.env to use https://$Hostname"
