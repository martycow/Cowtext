$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($j.stop_hook_active) { exit 0 }
Set-Location $j.cwd
$changed = git diff --name-only HEAD
if (-not $changed) { exit 0 }

$fail = @()
if ($changed -match '^src-tauri/') {
    Push-Location src-tauri
    cargo clippy -- -D warnings *> $null
    if ($LASTEXITCODE -ne 0) { $fail += 'cargo clippy' }
    Pop-Location
}
if ($changed -match '^src/') {
    npm run build *> $null; if ($LASTEXITCODE -ne 0) { $fail += 'npm run build' }
    npm run lint  *> $null; if ($LASTEXITCODE -ne 0) { $fail += 'npm run lint' }
}
if ($fail.Count) {
    [Console]::Error.WriteLine("Gates red: $($fail -join ', '). Fix before finishing.")
    exit 2
}
exit 0