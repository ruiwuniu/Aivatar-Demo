$ErrorActionPreference = "Stop"

$pluginRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")

if ([string]::IsNullOrWhiteSpace($currentUserPath)) {
  $entries = @()
} else {
  $entries = $currentUserPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

$alreadyConfigured = $entries | Where-Object {
  try {
    (Resolve-Path $_ -ErrorAction Stop).Path -ieq $pluginRoot
  } catch {
    $_.TrimEnd("\") -ieq $pluginRoot.TrimEnd("\")
  }
}

if ($alreadyConfigured) {
  Write-Host "Aivatar command directory is already in your user PATH:"
  Write-Host "  $pluginRoot"
  Write-Host ""
  Write-Host "Open a new terminal, then run:"
  Write-Host "  aivatar-connect"
  Write-Host "  aivatar-disconnect"
  exit 0
}

$newUserPath = if ($entries.Count -eq 0) {
  $pluginRoot
} else {
  ($entries + $pluginRoot) -join ";"
}

[Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")

Write-Host "Added Aivatar command directory to your user PATH:"
Write-Host "  $pluginRoot"
Write-Host ""
Write-Host "Open a new terminal, then run:"
Write-Host "  aivatar-connect"
Write-Host "  aivatar-disconnect"
