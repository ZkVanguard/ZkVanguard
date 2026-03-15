#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Reset Community Pool stats to match on-chain V3 contract

.DESCRIPTION
    This script calls the full-reset API endpoint to:
    1. Delete all stale user data from database
    2. Sync all active members from on-chain V3 contract
    3. Reset NAV history with current on-chain values
    4. Clear all caches

.PARAMETER Url
    Base URL of the API (default: http://localhost:3000)

.PARAMETER CronSecret
    CRON_SECRET for authentication (reads from .env.local if not provided)

.EXAMPLE
    .\reset-pool-stats.ps1
    .\reset-pool-stats.ps1 -Url "https://your-app.vercel.app"
#>

param(
    [string]$Url = "http://localhost:3000",
    [string]$CronSecret
)

Write-Host "`n🔄 Community Pool V3 Stats Reset" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Load CRON_SECRET from .env.local if not provided
if (-not $CronSecret) {
    $envFile = Join-Path $PSScriptRoot "../.env.local"
    if (Test-Path $envFile) {
        $envContent = Get-Content $envFile
        foreach ($line in $envContent) {
            if ($line -match "^CRON_SECRET=(.+)$") {
                $CronSecret = $matches[1].Trim('"', "'")
                Write-Host "✅ Loaded CRON_SECRET from .env.local" -ForegroundColor Green
                break
            }
        }
    }
    
    if (-not $CronSecret) {
        Write-Host "❌ CRON_SECRET not found. Please provide it as parameter or set in .env.local" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n📡 Calling full-reset API..." -ForegroundColor Yellow
Write-Host "   URL: $Url/api/community-pool?action=full-reset"

try {
    $headers = @{
        "Content-Type" = "application/json"
        "x-cron-secret" = $CronSecret
    }
    
    $body = @{} | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "$Url/api/community-pool?action=full-reset" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -TimeoutSec 120
    
    if ($response.success) {
        Write-Host "`n✅ RESET COMPLETED SUCCESSFULLY!" -ForegroundColor Green
        Write-Host ""
        Write-Host "📊 Summary:" -ForegroundColor Cyan
        Write-Host "   Deleted stale users: $($response.summary.deletedStaleUsers)"
        Write-Host "   Synced active members: $($response.summary.syncedActiveMembers)"
        Write-Host "   NAV history deleted: $($response.summary.navHistoryDeleted)"
        Write-Host ""
        Write-Host "💰 Pool State (from on-chain V3):" -ForegroundColor Cyan
        Write-Host "   Total Value (NAV): `$$($response.summary.poolState.totalValueUSD.ToString('N2'))"
        Write-Host "   Total Shares: $($response.summary.poolState.totalShares.ToString('N4'))"
        Write-Host "   Share Price: `$$($response.summary.poolState.sharePrice.ToString('N4'))"
        Write-Host "   Member Count: $($response.summary.poolState.memberCount)"
        Write-Host ""
        Write-Host "📈 Allocations:" -ForegroundColor Cyan
        Write-Host "   BTC: $($response.summary.poolState.allocations.BTC)%"
        Write-Host "   ETH: $($response.summary.poolState.allocations.ETH)%"
        Write-Host "   SUI: $($response.summary.poolState.allocations.SUI)%"
        Write-Host "   CRO: $($response.summary.poolState.allocations.CRO)%"
        Write-Host ""
        
        if ($response.summary.members.Count -gt 0) {
            Write-Host "👥 Active Members:" -ForegroundColor Cyan
            foreach ($member in $response.summary.members) {
                $shortAddr = $member.address.Substring(0, 6) + "..." + $member.address.Substring($member.address.Length - 4)
                Write-Host "   $shortAddr : $($member.shares.ToString('N4')) shares"
            }
        }
        
        Write-Host ""
        Write-Host "⏰ Timestamp: $($response.timestamp)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "🎉 The dashboard should now show accurate stats!" -ForegroundColor Green
    } else {
        Write-Host "`n❌ Reset failed: $($response.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "`n❌ Error: $_" -ForegroundColor Red
    Write-Host "Details: $($_.Exception.Message)" -ForegroundColor Red
}
