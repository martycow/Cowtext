$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
$p = $j.tool_input.file_path
if (-not $p) { exit 0 }
$rel = ($p -replace '\\','/')
if ($rel -notmatch '\.md$') { exit 0 }
if ((Split-Path $p -Leaf) -in @('CLAUDE.md','README.md')) { exit 0 }

# Agent memory is fleet infrastructure, not project documentation - the docs/ rule
# was never meant to police it. Without this, every agent that saves a memory note
# hits a wall and is nudged into tunnelling the write through Bash (WO03 Lane B).
if ($rel -match '/\.claude/agent-memory/') { exit 0 }

if ($rel -match '/docs/_archive/') {
  [Console]::Error.WriteLine("Blocked: docs/_archive/ is frozen.")
  exit 2
}
if ($rel -notmatch '/docs/') {
  [Console]::Error.WriteLine("Blocked: project .md must live in docs/. Only CLAUDE.md and README.md at root.")
  exit 2
}
exit 0