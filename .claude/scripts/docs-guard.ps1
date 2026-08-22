# docs-guard — keeps project .md where CLAUDE.md says it belongs.
#
# The rule it enforces is about DOCUMENTATION PLACEMENT, not about the .md
# extension: agents must not scatter notes, plans and reports across the tree.
# Fleet config under .claude/ (agent definitions, skills, memory) is machine
# configuration that happens to be markdown - it structurally cannot live in
# docs/, so it is allowed. A guard with no legal exit gets tunnelled through
# Bash instead of obeyed (WO12 lane tasks-format-skill did exactly that), so
# every denial below names where the file SHOULD go.
#
# Exit 0 = allow, exit 2 = block (stderr goes back to the model).
# Fails OPEN on anything unexpected: a broken guard must not wedge the session.

# Flip to $true to require confirmation before an agent rewrites a skill or an
# agent definition. Those are a trust surface - later sessions execute them.
# Default $false because /ultracode runs unattended and would stall on a prompt.
$AskOnFleetConfig = $false

try {
  $raw = [Console]::In.ReadToEnd()
  if (-not $raw) { exit 0 }
  $j = $raw | ConvertFrom-Json
} catch { exit 0 }

$repo = $j.cwd
if (-not $repo) { exit 0 }
$repo = [System.IO.Path]::GetFullPath($repo).Replace([char]92, '/').TrimEnd('/')

# Absolute-or-relative -> repo-relative, forward slashes, .. resolved.
# Returns $null when the path lies outside this repo (scratchpad, other repos):
# the CLAUDE.md rule governs THIS tree only, so those are none of our business.
function Get-RepoRelative([string]$path) {
  if (-not $path) { return $null }
  try {
    if (-not [System.IO.Path]::IsPathRooted($path)) {
      $path = Join-Path $repo $path
    }
    $full = [System.IO.Path]::GetFullPath($path).Replace([char]92, '/')
  } catch { return $null }
  if ($full -eq $repo) { return $null }
  if (-not $full.StartsWith("$repo/", [StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $full.Substring($repo.Length + 1)
}

# $null = not our business. '' = allowed. Anything else = the denial reason.
function Test-MarkdownTarget([string]$rel) {
  if ($rel -notmatch '(?i)\.md$') { return $null }

  # docs/_archive/ is history: files get there via `git mv` only, never a write.
  if ($rel -match '(?i)^docs/_archive/') {
    return "docs/_archive/ is frozen history. Move files in with 'git mv' instead of writing them, and never edit one in place."
  }
  if ($rel -match '(?i)^docs/') { return '' }

  # Only these two .md files belong at the repo root - and only at the root.
  if ($rel -match '(?i)^(CLAUDE|README)\.md$') { return '' }

  # Fleet infrastructure. Not documentation; it cannot live in docs/.
  if ($rel -match '(?i)^\.claude/(agents|skills|agent-memory|commands|scripts)/') { return '' }

  # Bundled app resources (WO15 Block 4): built-in skills the app ships and
  # materialises into a user project's .claude/skills/ on Compile. Product data,
  # not documentation - it structurally cannot live in docs/.
  if ($rel -match '(?i)^src/resources/skills/[^/]+/SKILL\.md$') { return '' }
  if ($rel -match '(?i)^\.claude/') {
    return "Unrecognised .md under .claude/. Fleet markdown belongs in .claude/agents/, .claude/skills/<name>/, .claude/agent-memory/<agent>/ or .claude/commands/."
  }

  # Generated files (WO15 D-9). Both are produced by scripts/truth.mjs from a
  # source that IS hand-editable, so these denials name the source and the
  # command - a hand edit here is not misplaced documentation, it is a change
  # that the next `npm run truth:write` silently reverts. Note the root
  # allow-list above stays CLAUDE/README only: the script writes AGENTS.md
  # through Node's fs, which this hook never sees. That is the design.
  if ($rel -match '(?i)^AGENTS\.md$') {
    return "AGENTS.md is generated from CLAUDE.md by scripts/truth.mjs. Edit CLAUDE.md, then run 'npm run truth:write'."
  }
  if ($rel -match '(?i)^\.agents/skills/') {
    return ".agents/skills/ mirrors .claude/skills/ and is written by scripts/truth.mjs. Edit the .claude/skills/ copy, then run 'npm run truth:write'."
  }

  return "Project .md must live in docs/ (design/, testing/, tasks/, fleet/). Only CLAUDE.md and README.md sit at the repo root; fleet config goes under .claude/. Scratch notes belong in the session scratchpad, outside the repo - not here."
}

$tool = $j.tool_name

if ($tool -eq 'Edit' -or $tool -eq 'Write' -or $tool -eq 'NotebookEdit') {
  $rel = Get-RepoRelative $j.tool_input.file_path
  if (-not $rel) { exit 0 }
  $verdict = Test-MarkdownTarget $rel
  if ($null -eq $verdict -or $verdict -eq '') {
    if ($AskOnFleetConfig -and $rel -match '(?i)^\.claude/(agents|skills)/') {
      @{ hookSpecificOutput = @{
          hookEventName        = 'PreToolUse'
          permissionDecision   = 'ask'
          permissionDecisionReason = "$rel is fleet config that later sessions execute - confirm this rewrite."
        } } | ConvertTo-Json -Depth 5 -Compress
    }
    exit 0
  }
  [Console]::Error.WriteLine("Blocked ($rel): $verdict")
  exit 2
}

# --- Bash: catch writes tunnelled around the Edit/Write matcher --------------
# Conservative by design. A guard that fires on `grep foo docs/x.md` gets
# switched off within a day, so this blocks only unambiguous write syntax and
# accepts false negatives (a heredoc'd python script writing .md is invisible
# here - that is a behaviour problem, not a hook problem).
if ($tool -eq 'Bash') {
  $cmd = $j.tool_input.command
  if (-not $cmd -or $cmd -notmatch '(?i)\.md') { exit 0 }
  # git is version control, not doc scattering - and `git mv` INTO docs/_archive/
  # is the sanctioned archive procedure.
  if ($cmd -match '(?i)(^|[;&|]\s*)git\s') { exit 0 }

  $targets = @()
  # redirection: > file.md / >> file.md   (also covers `cat <<EOF > file.md`)
  $targets += [regex]::Matches($cmd, '(?i)>>?\s*["'']?([^\s"''<>|;&]+\.md)') |
              ForEach-Object { $_.Groups[1].Value }
  # tee / sed -i / cp / mv / touch / Set-Content / Out-File
  $targets += [regex]::Matches($cmd, '(?i)(?:^|[;&|]\s*|\|\s*)(?:tee(?:\s+-a)?|touch|Set-Content|Out-File)\s+(?:-\S+\s+)*["'']?([^\s"''<>|;&]+\.md)') |
              ForEach-Object { $_.Groups[1].Value }
  $targets += [regex]::Matches($cmd, '(?i)sed\s+(?:-\S+\s+)*-i(?:\.\S+)?\s.*?["'']?([^\s"''<>|;&]+\.md)') |
              ForEach-Object { $_.Groups[1].Value }
  $targets += [regex]::Matches($cmd, '(?i)(?:^|[;&|]\s*)(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+["'']?([^\s"''<>|;&]+\.md)') |
              ForEach-Object { $_.Groups[1].Value }

  foreach ($t in ($targets | Sort-Object -Unique)) {
    $rel = Get-RepoRelative $t
    if (-not $rel) { continue }
    $verdict = Test-MarkdownTarget $rel
    if ($verdict) {
      [Console]::Error.WriteLine("Blocked ($rel): $verdict Do not route this write through Bash to avoid the guard - use Write/Edit on a permitted path, or say the constraint is wrong.")
      exit 2
    }
  }
}

exit 0
