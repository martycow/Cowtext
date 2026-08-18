$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
Set-Location $j.cwd
$files = (git diff --name-only HEAD) -join ', '
if (-not $files) { $files = '-' }
$line = "| {0} | {1} | {2} |" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $j.agent_type, $files
Add-Content -Path 'docs/fleet/ACTIVITY_LOG.md' -Value $line
exit 0