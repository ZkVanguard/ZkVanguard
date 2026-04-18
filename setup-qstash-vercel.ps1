# QStash + Vercel Setup for SUI Mainnet
# Run this script in PowerShell from the project root
#
# Prerequisites:
# 1. Get your QSTASH_TOKEN from https://console.upstash.com → QStash → REST API
# 2. Have `npx vercel` authenticated (already done)
#
# This script:
# - Adds QSTASH_TOKEN to Vercel production env
# - Creates QStash schedules for all cron jobs
# - Deploys the updated vercel.json
# - Verifies everything works

param(
    [Parameter(Mandatory=$true)]
    [string]$QStashToken
)

$ErrorActionPreference = "Stop"
$BASE_URL = "https://www.zkvanguard.xyz"

Write-Host "`n=== QStash + Vercel Setup for SUI Mainnet ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Add QSTASH_TOKEN to Vercel ──
Write-Host "[1/5] Adding QSTASH_TOKEN to Vercel production env..." -ForegroundColor Yellow
# Write token to temp file to pipe into vercel env add (avoids interactive prompt)
$tempFile = [System.IO.Path]::GetTempFileName()
Set-Content -Path $tempFile -Value $QStashToken -NoNewline
Get-Content $tempFile | npx vercel env add QSTASH_TOKEN production --force 2>&1 | Out-Null
Remove-Item $tempFile -ErrorAction SilentlyContinue
Write-Host "  ✅ QSTASH_TOKEN added to Vercel production" -ForegroundColor Green

# ── Step 2: Also add to .env.local for local script usage ──
Write-Host "[2/5] Adding QSTASH_TOKEN to .env.local..." -ForegroundColor Yellow
$envContent = Get-Content ".env.local" -Raw
if ($envContent -notmatch "QSTASH_TOKEN") {
    Add-Content -Path ".env.local" -Value "`nQSTASH_TOKEN=$QStashToken"
    Write-Host "  ✅ Added to .env.local" -ForegroundColor Green
} else {
    Write-Host "  ⏭️  Already exists in .env.local" -ForegroundColor DarkGray
}

# ── Step 3: Get CRON_SECRET from .env.local ──
$cronSecret = ""
$cronMatch = [regex]::Match($envContent, "CRON_SECRET=[`"']?([^`"'\r\n]+)")
if ($cronMatch.Success) {
    $cronSecret = $cronMatch.Groups[1].Value.Trim()
}
Write-Host ""

# ── Step 4: Create QStash schedules ──
Write-Host "[3/5] Creating QStash schedules..." -ForegroundColor Yellow
Write-Host ""

$schedules = @(
    @{
        Name = "SUI Community Pool (AI + Swaps + Hedges)"
        Url  = "$BASE_URL/api/cron/sui-community-pool"
        Cron = "*/30 * * * *"  # every 30 min
    },
    @{
        Name = "Pool NAV Monitor"
        Url  = "$BASE_URL/api/cron/pool-nav-monitor"
        Cron = "*/15 * * * *"  # every 15 min
    },
    @{
        Name = "Hedge Monitor (Stop-loss/Take-profit)"
        Url  = "$BASE_URL/api/cron/hedge-monitor"
        Cron = "*/15 * * * *"  # every 15 min
    },
    @{
        Name = "Liquidation Guard"
        Url  = "$BASE_URL/api/cron/liquidation-guard"
        Cron = "*/10 * * * *"  # every 10 min
    }
)

# First delete any existing schedules for our domain
Write-Host "  Cleaning existing schedules..." -ForegroundColor DarkGray
$headers = @{ "Authorization" = "Bearer $QStashToken" }
try {
    $existing = Invoke-RestMethod -Uri "https://qstash.upstash.io/v2/schedules" -Headers $headers -Method Get
    foreach ($s in $existing) {
        if ($s.destination -and $s.destination -match "zkvanguard") {
            Write-Host "    Removing: $($s.scheduleId) → $($s.destination)" -ForegroundColor DarkGray
            Invoke-RestMethod -Uri "https://qstash.upstash.io/v2/schedules/$($s.scheduleId)" -Headers $headers -Method Delete | Out-Null
        }
    }
} catch {
    Write-Host "    No existing schedules or error listing: $_" -ForegroundColor DarkGray
}

# Create new schedules
foreach ($sched in $schedules) {
    Write-Host "  Creating: $($sched.Name)" -ForegroundColor White
    Write-Host "    URL:  $($sched.Url)" -ForegroundColor DarkGray
    Write-Host "    Cron: $($sched.Cron)" -ForegroundColor DarkGray
    
    try {
        $createHeaders = @{
            "Authorization" = "Bearer $QStashToken"
            "Content-Type"  = "application/json"
            "Upstash-Cron"  = $sched.Cron
            "Upstash-Retries" = "2"
        }
        if ($cronSecret) {
            $createHeaders["Upstash-Forward-Authorization"] = "Bearer $cronSecret"
        }
        
        $encodedUrl = [Uri]::EscapeDataString($sched.Url)
        $result = Invoke-RestMethod `
            -Uri "https://qstash.upstash.io/v2/schedules/$encodedUrl" `
            -Headers $createHeaders `
            -Method Post `
            -Body "{}" `
            -ContentType "application/json"
        
        Write-Host "    ✅ Created: $($result.scheduleId)" -ForegroundColor Green
    } catch {
        Write-Host "    ❌ Failed: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# ── Step 5: Deploy updated vercel.json ──
Write-Host "[4/5] Deploying to Vercel with updated cron config..." -ForegroundColor Yellow
npx vercel --prod --yes 2>&1 | Select-Object -Last 5
Write-Host ""

# ── Step 6: Verify ──
Write-Host "[5/5] Verifying QStash schedules..." -ForegroundColor Yellow
try {
    $final = Invoke-RestMethod -Uri "https://qstash.upstash.io/v2/schedules" -Headers $headers -Method Get
    Write-Host "  Active schedules: $($final.Count)" -ForegroundColor Green
    foreach ($s in $final) {
        Write-Host "    ✅ $($s.cron) → $($s.destination)" -ForegroundColor Green
    }
} catch {
    Write-Host "  ⚠️  Could not verify: $_" -ForegroundColor Yellow
}

Write-Host "`n=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "QStash will now trigger these crons automatically:" -ForegroundColor White
Write-Host "  SUI Pool AI+Swaps+Hedges: every 30 min  (48 msgs/day)" -ForegroundColor White
Write-Host "  NAV Monitor:              every 15 min  (96 msgs/day)" -ForegroundColor White
Write-Host "  Hedge Monitor:            every 15 min  (96 msgs/day)" -ForegroundColor White
Write-Host "  Liquidation Guard:        every 10 min  (144 msgs/day)" -ForegroundColor White
Write-Host "  ────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Total:                    384 msgs/day  (free tier: 500)" -ForegroundColor White
Write-Host ""
Write-Host "Vercel cron fallback: Master orchestrator every 6 hours" -ForegroundColor DarkGray
Write-Host ""
