Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-LocalN8nRepoRoot {
	$scriptDirectory = Split-Path -Parent $PSScriptRoot
	return (Resolve-Path $scriptDirectory).Path
}

function Get-LocalN8nProfileDir {
	return Join-Path (Get-LocalN8nRepoRoot) 'local\windows'
}

function Get-LocalN8nComposeFile {
	return Join-Path (Get-LocalN8nProfileDir) 'docker-compose.yml'
}

function Get-LocalN8nEnvExampleFile {
	return Join-Path (Get-LocalN8nProfileDir) '.env.example'
}

function Get-LocalN8nEnvFile {
	return Join-Path (Get-LocalN8nProfileDir) '.env'
}

function Get-LocalN8nCloudflaredConfigFile {
	return Join-Path (Get-LocalN8nProfileDir) 'cloudflared\config.yml'
}

function Get-DockerCliPath {
	$command = Get-Command docker -ErrorAction SilentlyContinue
	if ($command) {
		return $command.Source
	}

	$candidates = @(
		'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
	)

	foreach ($candidate in $candidates) {
		if (Test-Path $candidate) {
			return $candidate
		}
	}

	return $null
}

function Get-DockerDesktopExePath {
	$candidates = @(
		'C:\Program Files\Docker\Docker\Docker Desktop.exe'
		(Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\Docker Desktop.exe')
	)

	foreach ($candidate in $candidates) {
		if (Test-Path $candidate) {
			return $candidate
		}
	}

	return $null
}

function Ensure-DockerCliAvailable {
	$dockerCli = Get-DockerCliPath
	if (-not $dockerCli) {
		throw 'Docker CLI was not found. Install Docker Desktop first, then rerun setup.'
	}

	$dockerDirectory = Split-Path -Parent $dockerCli
	if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $dockerDirectory })) {
		$env:PATH = "$dockerDirectory;$env:PATH"
	}

	return $dockerCli
}

function Wait-ForDockerDaemon {
	param(
		[int]$TimeoutSeconds = 120
	)

	$dockerCli = Ensure-DockerCliAvailable
	$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

	while ((Get-Date) -lt $deadline) {
		try {
			& $dockerCli version | Out-Null
			return
		} catch {
			Start-Sleep -Seconds 3
		}
	}

	throw 'Docker Desktop did not become ready in time.'
}

function Ensure-DockerDesktopRunning {
	$dockerCli = Ensure-DockerCliAvailable
	try {
		& $dockerCli version | Out-Null
		return
	} catch {
		$desktopExe = Get-DockerDesktopExePath
		if (-not $desktopExe) {
			throw 'Docker Desktop is not installed. Install it before running the local n8n profile.'
		}

		Start-Process -FilePath $desktopExe | Out-Null
		Wait-ForDockerDaemon
	}
}

function Get-RandomSecret {
	return [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
}

function Escape-SqlLiteral {
	param(
		[AllowNull()]
		[string]$Value
	)

	if ($null -eq $Value) {
		return ''
	}

	return $Value.Replace("'", "''")
}

function Read-EnvFile {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Path
	)

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

function Ensure-LocalEnvFile {
	$envFile = Get-LocalN8nEnvFile
	if (Test-Path $envFile) {
		return $envFile
	}

	$examplePath = Get-LocalN8nEnvExampleFile
	if (-not (Test-Path $examplePath)) {
		throw "Missing env template at $examplePath"
	}

	$content = Get-Content $examplePath -Raw
	$content = $content.Replace('__GENERATE_POSTGRES_PASSWORD__', (Get-RandomSecret))
	$content = $content.Replace('__GENERATE_N8N_ENCRYPTION_KEY__', (Get-RandomSecret))
	Set-Content -Path $envFile -Value $content -NoNewline
	return $envFile
}

function Invoke-LocalDockerCompose {
	param(
		[Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
		[string[]]$ComposeArguments
	)

	$dockerCli = Ensure-DockerCliAvailable
	$composeFile = Get-LocalN8nComposeFile
	$envFile = Ensure-LocalEnvFile

	$arguments = @(
		'compose'
		'-f'
		$composeFile
		'--env-file'
		$envFile
	) + $ComposeArguments

	& $dockerCli @arguments
	if ($LASTEXITCODE -ne 0) {
		throw "docker compose failed with exit code $LASTEXITCODE"
	}
}

function Wait-ForLocalN8nReadiness {
	param(
		[int]$TimeoutSeconds = 240
	)

	$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
	$uri = 'http://localhost:5678/healthz/readiness'

	while ((Get-Date) -lt $deadline) {
		try {
			$response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
			if ($response.StatusCode -eq 200) {
				return
			}
		} catch {
			Start-Sleep -Seconds 5
		}
	}

	throw 'n8n did not become ready in time.'
}

function Invoke-LocalPostgresSql {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Sql
	)

	$envValues = Read-EnvFile (Ensure-LocalEnvFile)
	Invoke-LocalDockerCompose exec -T postgres psql -U $envValues['POSTGRES_USER'] -d $envValues['POSTGRES_DB'] -c $Sql
}
