# log-subagent - one row per SubagentStop, appended to a MACHINE log.
#
# This used to append to docs/fleet/ACTIVITY_LOG.md, where it grew to 2292 rows
# against 198 lines of human log - 92% of the file was hook noise, and every
# session's diff was dominated by it. The rows are machine output, not
# documentation, so they now live outside docs/ entirely.
#
# .log is gitignored, so the noise leaves both the docs tree and every diff.
# Historical rows were moved to this file on 2026-08-24; git history still
# holds the originals inside ACTIVITY_LOG.md.
$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
Set-Location $j.cwd
$files = (git diff --name-only HEAD) -join ', '
if (-not $files) { $files = '-' }
$dir = '.claude/logs'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$line = "| {0} | {1} | {2} |" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $j.agent_type, $files
Add-Content -Path "$dir/subagent-activity.log" -Value $line
exit 0
