$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
Set-Location $j.cwd
"Recent commits:"
git log --oneline -8

# BUGS.md is a pipe table with a Status column - it has never contained a single
# "- [ ]" checklist line, so the previous counter matched nothing and reported 0
# at every session start while 13 rows sat open. Count table rows whose Status
# cell is not "done" instead. Header and separator rows are excluded by shape.
$rows = @(Get-Content 'docs/tasks/BUGS.md' |
  Where-Object { $_ -match '^\|' -and $_ -notmatch '^\|\s*-{3,}' -and $_ -notmatch '^\|\s*Name\s*\|' })
$open = @($rows | Where-Object { ($_ -split '\|')[2].Trim() -ne 'done' })
"Open bugs in docs/tasks/BUGS.md: " + $open.Count
