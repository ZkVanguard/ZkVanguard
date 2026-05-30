# Cutover Vercel production DB env from Neon → Aiven.
# Run interactively. Confirms before each destructive step.
#
# Pre-req: .env.local has the Aiven URLs (DATABASE_URL, DATABASE_POOL_URL, DB_V2_DATABASE_URL).
# Pre-req: vercel CLI logged in (vercel whoami).
#
# After this script: run `vercel --prod` to redeploy, then `bun run scripts/verify-aiven-cutover.ts`.

$ErrorActionPreference = "Stop"

$envFile = ".env.local"
if (-not (Test-Path $envFile)) { Write-Host "Missing $envFile" -ForegroundColor Red; exit 1 }

# Parse the 3 target vars from .env.local
$vars = @("DATABASE_URL", "DATABASE_POOL_URL", "DB_V2_DATABASE_URL")
$values = @{}
foreach ($line in Get-Content $envFile) {
    foreach ($name in $vars) {
        if ($line -match "^$name=(.+)$") {
            $v = $Matches[1].Trim('"').Trim()
            $values[$name] = $v
        }
    }
}

# Sanity check: all 3 present + point at Aiven
foreach ($name in $vars) {
    if (-not $values.ContainsKey($name)) { Write-Host "Missing $name in $envFile" -ForegroundColor Red; exit 1 }
    if ($values[$name] -notmatch "aivencloud\.com") {
        Write-Host "$name in $envFile is not an Aiven URL — aborting." -ForegroundColor Red
        Write-Host "  Got: $($values[$name] -replace ':[^:@]+@', ':***@')"
        exit 1
    }
}

Write-Host ""
Write-Host "About to cut over Vercel PRODUCTION env to Aiven:" -ForegroundColor Yellow
foreach ($name in $vars) {
    $masked = $values[$name] -replace ':[^:@]+@', ':***@'
    Write-Host "  $name = $masked"
}
Write-Host ""
$confirm = Read-Host "Proceed? (type YES to continue)"
if ($confirm -ne "YES") { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }

# Loop: rm + add for each var
foreach ($name in $vars) {
    Write-Host ""
    Write-Host "── $name ──" -ForegroundColor Cyan
    Write-Host "  removing old value..."
    & vercel env rm $name production --yes 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Host "  rm failed for $name — aborting." -ForegroundColor Red; exit 1 }

    Write-Host "  adding new value..."
    # Pipe value via stdin so it doesn't appear in process listing
    $values[$name] | & vercel env add $name production 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Host "  add failed for $name — aborting." -ForegroundColor Red; exit 1 }

    Write-Host "  ✓ $name updated" -ForegroundColor Green
}

Write-Host ""
Write-Host "All 3 vars updated in Vercel production." -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. Redeploy:        vercel --prod"
Write-Host "  2. Wait ~2 minutes for deployment + first cron tick."
Write-Host "  3. Verify:          bun run scripts/verify-aiven-cutover.ts"
