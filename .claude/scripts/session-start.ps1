$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
Set-Location $j.cwd
"Recent commits:"
git log --oneline -8
"Open bugs in docs/tasks/BUGS.md: " + (Select-String -Path 'docs/tasks/BUGS.md' -Pattern '^\s*-\s*\[ \]').Count