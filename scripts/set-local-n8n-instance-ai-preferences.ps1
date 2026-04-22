param(
	[Parameter(Mandatory = $true)]
	[string]$CredentialName,
	[string]$CredentialType = 'openRouterApi',
	[string]$ModelName = 'x-ai/grok-4.1-fast',
	[string]$UserEmail
)

. (Join-Path $PSScriptRoot 'local-n8n-common.ps1')

$escapedUserEmail = Escape-SqlLiteral $UserEmail
$escapedCredentialName = Escape-SqlLiteral $CredentialName
$escapedCredentialType = Escape-SqlLiteral $CredentialType
$escapedModelName = Escape-SqlLiteral $ModelName

$ownerSelector = if ($UserEmail) {
	"SELECT id FROM `"user`" WHERE email = '$escapedUserEmail' ORDER BY `"createdAt`" ASC LIMIT 1"
} else {
	'SELECT id FROM "user" ORDER BY "createdAt" ASC LIMIT 1'
}

$credentialSelector = @"
SELECT id
FROM credentials_entity
WHERE name = '$escapedCredentialName'
  AND type = '$escapedCredentialType'
ORDER BY "createdAt" ASC
LIMIT 1
"@

$sql = @"
WITH selected_user AS (
	$ownerSelector
),
selected_credential AS (
	$credentialSelector
)
INSERT INTO settings (key, value, "loadOnStartup")
SELECT
	'instanceAi.preferences.' || selected_user.id,
	json_build_object(
		'credentialId', selected_credential.id,
		'modelName', '$escapedModelName'
	)::text,
	true
FROM selected_user
CROSS JOIN selected_credential
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, "loadOnStartup" = EXCLUDED."loadOnStartup";
"@

Invoke-LocalPostgresSql -Sql $sql | Out-Null
Write-Host "Set instance AI defaults to credential '$CredentialName' with model '$ModelName'."
