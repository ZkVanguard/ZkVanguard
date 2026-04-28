# One-shot script: strip literal \r\n from Vercel production env vars
# Usage: pwsh ./scripts/clean-vercel-env.ps1
$ErrorActionPreference = 'Continue'

# 1. Pull current production env
& npx vercel env pull .env.audit --environment production --yes 2>$null | Out-Null
if (-not (Test-Path .env.audit)) { throw "Failed to pull env" }

# 2. Identify corrupted vars
$badVars = @{}
foreach ($line in Get-Content .env.audit) {
  if ($line -match '^([A-Z_][A-Z0-9_]*)=(.*)$') {
    $name = $Matches[1]
    $val = $Matches[2] -replace '^"', '' -replace '"$', ''
    if ($val -match '\\r|\\n') {
      $cleaned = $val -replace '\\r', '' -replace '\\n', ''
      $badVars[$name] = $cleaned
    }
  }
}
Remove-Item .env.audit -Force

Write-Host "Found $($badVars.Count) corrupted vars"

# 3. For each: rm + re-add clean (using cmd stdin redirect — only reliable way to avoid CRLF)
function Set-VercelEnv {
  param([string]$Name, [string]$Value)
  & npx vercel env rm $Name production --yes 2>&1 | Out-Null
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllBytes($tmp, [System.Text.Encoding]::ASCII.GetBytes($Value))
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = "/c npx vercel env add $Name production < `"$tmp`""
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  Remove-Item $tmp -Force
  if ($out -match 'Added Environment Variable') { return $true }
  Write-Warning "Failed for ${Name}: $out"
  return $false
}

$ok = 0
$fail = 0
foreach ($name in $badVars.Keys) {
  Write-Host "  Cleaning $name (was '...$($badVars[$name].Substring([Math]::Max(0,$badVars[$name].Length-12)))')..." -NoNewline
  if (Set-VercelEnv -Name $name -Value $badVars[$name]) {
    Write-Host " OK"
    $ok++
  } else {
    Write-Host " FAILED"
    $fail++
  }
}

Write-Host "`nResult: $ok cleaned, $fail failed"

# 4. Re-pull and re-audit
& npx vercel env pull .env.audit --environment production --yes 2>$null | Out-Null
$remaining = @()
foreach ($line in Get-Content .env.audit) {
  if ($line -match '^([A-Z_][A-Z0-9_]*)=(.*)$' -and $Matches[2] -match '\\r|\\n') {
    $remaining += $Matches[1]
  }
}
Remove-Item .env.audit -Force
if ($remaining.Count -eq 0) {
  Write-Host "Verification: all clean!" -ForegroundColor Green
} else {
  Write-Host "Verification: $($remaining.Count) vars STILL corrupted: $($remaining -join ', ')" -ForegroundColor Red
}
