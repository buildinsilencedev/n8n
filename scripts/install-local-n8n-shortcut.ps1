param(
	[string]$ShortcutName = 'n8n Local.lnk',
	[string]$TargetScript = (Join-Path $PSScriptRoot 'start-local-n8n.ps1')
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath $ShortcutName
$powerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startScript = $TargetScript
$iconPath = $powerShellExe

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellExe
$shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$startScript`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = $iconPath
$shortcut.Description = 'Start the local n8n workspace profile and open the editor.'
$shortcut.Save()

Write-Host "Created desktop shortcut at $shortcutPath"
