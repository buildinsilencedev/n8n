Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-LocalN8nHostRepoRoot {
	return (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
}

function Get-LocalN8nHostProfileDir {
	return Join-Path (Get-LocalN8nHostRepoRoot) 'local\windows-host'
}

function Get-LocalN8nHostDataDir {
	return Join-Path (Get-LocalN8nHostProfileDir) 'data'
}

function Get-LocalN8nHostLogsDir {
	return Join-Path (Get-LocalN8nHostProfileDir) 'logs'
}

function Get-LocalN8nHostEnvExampleFile {
	return Join-Path (Get-LocalN8nHostProfileDir) '.env.example'
}

function Get-LocalN8nHostEnvFile {
	return Join-Path (Get-LocalN8nHostProfileDir) '.env'
}

function Get-LocalN8nHostPidFile {
	return Join-Path (Get-LocalN8nHostProfileDir) 'n8n.pid'
}

function Get-LocalN8nHostStdoutLog {
	return Join-Path (Get-LocalN8nHostLogsDir) 'n8n.stdout.log'
}

function Get-LocalN8nHostStderrLog {
	return Join-Path (Get-LocalN8nHostLogsDir) 'n8n.stderr.log'
}

function Get-LocalN8nHostBinDir {
	return Join-Path (Get-LocalN8nHostRepoRoot) 'scripts\bin'
}

function Get-LocalN8nHostCloudflaredDir {
	return Join-Path (Get-LocalN8nHostProfileDir) 'cloudflared'
}

function Get-LocalN8nHostCloudflaredExampleConfig {
	return Join-Path (Get-LocalN8nHostCloudflaredDir) 'config.example.yml'
}

function Get-LocalN8nHostCloudflaredConfig {
	return Join-Path (Get-LocalN8nHostCloudflaredDir) 'config.yml'
}

function Get-LocalN8nHostCloudflaredPidFile {
	return Join-Path (Get-LocalN8nHostProfileDir) 'cloudflared.pid'
}

function Get-LocalN8nHostCloudflaredLog {
	return Join-Path (Get-LocalN8nHostLogsDir) 'cloudflared.log'
}

function Get-LocalN8nHostCloudflaredErrorLog {
	return Join-Path (Get-LocalN8nHostLogsDir) 'cloudflared.stderr.log'
}

function Get-LocalN8nHostCloudflaredExe {
	$candidates = @(@(
		(Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
		(Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
		(Join-Path $env:LOCALAPPDATA 'Programs\cloudflared\cloudflared.exe')
	) | Where-Object { $_ -and (Test-Path $_) })

	if ($candidates.Count -gt 0) {
		return $candidates[0]
	}

	$command = Get-Command cloudflared -ErrorAction SilentlyContinue
	if ($command) {
		return $command.Source
	}

	throw 'cloudflared.exe was not found. Install Cloudflare.cloudflared first.'
}

function Get-LocalN8nHostCloudflaredCredentialsDir {
	return Join-Path $HOME '.cloudflared'
}

function Get-LocalN8nHostCloudflaredOriginCert {
	return Join-Path (Get-LocalN8nHostCloudflaredCredentialsDir) 'cert.pem'
}

function Get-RandomHostSecret {
	return [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
}

function Read-LocalN8nHostEnvFile {
	param([string]$Path = (Get-LocalN8nHostEnvFile))

	$values = @{}
	foreach ($line in Get-Content $Path) {
		if ([string]::IsNullOrWhiteSpace($line) -or $line.Trim().StartsWith('#')) {
			continue
		}

		$key, $value = $line -split '=', 2
		$values[$key.Trim()] = $value.Trim()
	}

	return $values
}

function Ensure-LocalN8nHostEnvFile {
	$envFile = Get-LocalN8nHostEnvFile
	if (Test-Path $envFile) {
		return $envFile
	}

	$dataDir = Get-LocalN8nHostDataDir
	$dbFile = Join-Path $dataDir 'database.sqlite'
	New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

	$content = Get-Content (Get-LocalN8nHostEnvExampleFile) -Raw
	$content = $content.Replace('__N8N_USER_FOLDER__', $dataDir.Replace('\', '/'))
	$content = $content.Replace('__DB_SQLITE_DATABASE__', $dbFile.Replace('\', '/'))
	$content = $content.Replace('__GENERATE_N8N_ENCRYPTION_KEY__', (Get-RandomHostSecret))
	Set-Content -Path $envFile -Value $content -NoNewline

	return $envFile
}

function Add-LocalN8nHostBinDirToPath {
	$binDir = Get-LocalN8nHostBinDir
	if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $binDir })) {
		$env:PATH = "$binDir;$env:PATH"
	}
}

function Set-LocalN8nHostPublicBaseUrl {
	param([Parameter(Mandatory = $true)][string]$Hostname)

	$envFile = Ensure-LocalN8nHostEnvFile
	$updatedLines = foreach ($line in Get-Content $envFile) {
		if ($line -match '^N8N_EDITOR_BASE_URL=') {
			"N8N_EDITOR_BASE_URL=https://$Hostname"
			continue
		}

		if ($line -match '^WEBHOOK_URL=') {
			"WEBHOOK_URL=https://$Hostname/"
			continue
		}

		$line
	}

	Set-Content -Path $envFile -Value $updatedLines
}

function Invoke-LocalN8nHostPnpm {
	param(
		[Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
		[string[]]$Arguments
	)

	Add-LocalN8nHostBinDirToPath
	& (Join-Path (Get-LocalN8nHostBinDir) 'pnpm.cmd') @Arguments
	if ($LASTEXITCODE -ne 0) {
		throw "pnpm failed with exit code $LASTEXITCODE"
	}
}

function Wait-ForLocalN8nHostReadiness {
	param([int]$TimeoutSeconds = 240)

	$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
	while ((Get-Date) -lt $deadline) {
		try {
			$response = Invoke-WebRequest -Uri 'http://localhost:5678/healthz/readiness' -UseBasicParsing -TimeoutSec 10
			if ($response.StatusCode -eq 200) {
				return
			}
		} catch {
			Start-Sleep -Seconds 3
		}
	}

	throw 'n8n did not become ready in time.'
}

function Get-LocalN8nHostProcess {
	$pidFile = Get-LocalN8nHostPidFile
	if (-not (Test-Path $pidFile)) {
		return $null
	}

	$processId = Get-Content $pidFile -Raw
	if (-not $processId) {
		return $null
	}

	try {
		return Get-Process -Id ([int]$processId) -ErrorAction Stop
	} catch {
		Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
		return $null
	}
}

function Get-LocalN8nHostCloudflaredProcess {
	$pidFile = Get-LocalN8nHostCloudflaredPidFile
	if (-not (Test-Path $pidFile)) {
		return $null
	}

	$processId = Get-Content $pidFile -Raw
	if (-not $processId) {
		return $null
	}

	try {
		return Get-Process -Id ([int]$processId) -ErrorAction Stop
	} catch {
		Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
		return $null
	}
}
