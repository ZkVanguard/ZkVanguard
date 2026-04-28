# End-to-end verification script
$ErrorActionPreference = 'Continue'
$base = 'https://www.zkvanguard.xyz'
$pool = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a'
$qtok = 'eyJVc2VySUQiOiJmMzM2MGFiYi01N2FjLTRkMTAtOTZkYS04N2Q5MGFmYzNmYTUiLCJQYXNzd29yZCI6IjYyYWRmMjk3ZTBhYTQyMTVhODRlOGQwZWFiZTI0NDQ0In0='

function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function OK($t)      { Write-Host "  [OK]  $t" -ForegroundColor Green }
function FAIL($t)    { Write-Host "  [FAIL]$t" -ForegroundColor Red }
function INFO($t)    { Write-Host "        $t" -ForegroundColor Gray }

# 1. ON-CHAIN STATE
Section "1. ON-CHAIN POOL STATE (SUI mainnet)"
try {
  $body = '{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":["' + $pool + '",{"showContent":true}]}'
  $rpc = Invoke-RestMethod -Uri 'https://fullnode.mainnet.sui.io:443' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 15
  $f = $rpc.result.data.content.fields
  $hs = $f.hedge_state.fields
  $cfg = $hs.auto_hedge_config.fields
  $usdcBal = [decimal]$f.usdc_balance / 1000000
  OK "Pool object reachable"
  INFO "USDC balance:        $usdcBal USDC"
  INFO "Total shares:        $($f.total_shares)"
  INFO "Active hedges:       $($hs.active_hedges.Count)"
  INFO "auto_hedge_config:   enabled=$($cfg.enabled) leverage=$($cfg.default_leverage) threshold=$($cfg.risk_threshold_bps)bps maxRatio=$($cfg.max_hedge_ratio_bps)bps"
  $script:onChainCount = $hs.active_hedges.Count
} catch { FAIL "RPC error: $_"; $script:onChainCount = -1 }

# 2. AUTO-HEDGE API (UI source)
Section "2. AUTO-HEDGE API (UI)"
try {
  $h = Invoke-RestMethod -Uri "$base/api/community-pool/auto-hedge?chain=sui" -TimeoutSec 30
  OK "Endpoint 200"
  INFO "enabled (on-chain auth):  $($h.enabled)"
  INFO "config.maxLeverage:       $($h.config.maxLeverage)"
  INFO "config.riskThreshold:     $($h.config.riskThreshold)"
  INFO "activeHedges (deduped):   $($h.activeHedges.Count)"
  INFO "stats.hedgeCount:         $($h.stats.hedgeCount)"
  INFO "stats.totalHedgeValue:    `$$($h.stats.totalHedgeValue)"
  INFO "stats.decisionsToday:     $($h.stats.decisionsToday)"
  INFO "riskAssessment.riskScore: $($h.riskAssessment.riskScore)"
  INFO "riskAssessment.volatility:$($h.riskAssessment.volatility)%"
  if ($h.activeHedges.Count -eq $script:onChainCount) {
    OK "UI hedge count matches on-chain ($($h.activeHedges.Count) = $($script:onChainCount))"
  } else {
    FAIL "Mismatch: UI=$($h.activeHedges.Count) onChain=$($script:onChainCount)"
  }
  if ([string]$h.enabled -eq 'True' -and [string]$cfg.enabled -eq 'True') {
    OK "auto_hedge enabled flag in sync (on-chain authoritative)"
  }
  $script:uiCount = $h.activeHedges.Count
} catch { FAIL "Auto-hedge: $_" }

# 3. POSTGRES DB
Section "3. POSTGRES DB (hedges table)"
$dbScript = @'
const { Client } = require('pg');
const fs = require('fs');
const m = fs.readFileSync('.env.local', 'utf8').match(/DB_V2_DATABASE_URL=["']?([^"'\r\n]+)/);
(async () => {
  const c = new Client({ connectionString: m[1] });
  await c.connect();
  const r = await c.query("SELECT id, asset, side, size::text, notional_value::text, entry_price::text, current_price::text, current_pnl::text, hedge_id_onchain FROM hedges WHERE chain='sui' AND status='active' ORDER BY id DESC");
  console.log('COUNT=' + r.rowCount);
  r.rows.forEach(x => {
    const idShort = x.hedge_id_onchain ? x.hedge_id_onchain.substring(0, 18) : 'null';
    console.log(`ROW id=${x.id} ${x.asset} ${x.side} size=${x.size} notional=$${x.notional_value} entry=$${x.entry_price} curr=$${x.current_price} pnl=$${x.current_pnl} onchain=${idShort}...`);
  });
  await c.end();
})();
'@
$dbScript | Out-File -Encoding utf8 verify-db.cjs
$dbOut = node verify-db.cjs 2>&1
Remove-Item verify-db.cjs
$dbCount = ($dbOut | Where-Object { $_ -match '^COUNT=' }) -replace 'COUNT=', ''
$dbCount = [int]$dbCount
$dbOut | Where-Object { $_ -match '^ROW' } | ForEach-Object { INFO $_ }
if ($dbCount -eq $script:onChainCount) {
  OK "DB count matches on-chain ($dbCount = $($script:onChainCount))"
} else {
  FAIL "DB=$dbCount  onChain=$($script:onChainCount)"
}

# 4. QSTASH CRONS
Section "4. QSTASH CRONS"
try {
  $sched = Invoke-RestMethod -Uri 'https://qstash-us-east-1.upstash.io/v2/schedules' -Headers @{ Authorization = "Bearer $qtok" } -TimeoutSec 15
  $active = $sched | Where-Object { -not $_.isPaused }
  OK "Active schedules: $($active.Count)"
  $active | ForEach-Object { INFO "  $($_.cron)  $($_.destination -replace [regex]::Escape($base + '/api/cron/'), '')" }
  $ev = Invoke-RestMethod -Uri 'https://qstash-us-east-1.upstash.io/v2/events?count=10' -Headers @{ Authorization = "Bearer $qtok" } -TimeoutSec 15
  $delivered = ($ev.events | Where-Object { $_.state -eq 'DELIVERED' }).Count
  $failed = ($ev.events | Where-Object { $_.state -eq 'FAILED' -or $_.state -eq 'ERROR' }).Count
  if ($failed -eq 0) { OK "Last 10 deliveries: $delivered DELIVERED, 0 failed" }
  else               { FAIL "Last 10 deliveries: $delivered DELIVERED, $failed failed" }
} catch { FAIL "QStash: $_" }

# 5. CRON ROUTE AUTH
Section "5. CRON ROUTE AUTH"
try {
  $r = try { Invoke-WebRequest -Uri "$base/api/cron/sui-community-pool" -TimeoutSec 15 -SkipHttpErrorCheck } catch { $_.Exception.Response }
  if ($r.StatusCode -eq 401) { OK "sui-community-pool rejects unauth (401)" }
  else { FAIL "Expected 401, got $($r.StatusCode)" }
} catch { FAIL "Cron auth probe: $_" }

# 6. NAV / POOL STATS
Section "6. POOL NAV"
foreach ($path in @('/api/sui/community-pool', '/api/community-pool/stats?chain=sui', '/api/community-pool/nav?chain=sui')) {
  try {
    $r = Invoke-RestMethod -Uri "$base$path" -TimeoutSec 30
    OK "$path responds"
    $nav = if ($r.nav) { $r.nav } elseif ($r.poolStats) { $r.poolStats.totalNAV_USDC } else { $r.totalNAV }
    $sp  = if ($r.sharePrice) { $r.sharePrice } elseif ($r.poolStats) { $r.poolStats.sharePrice } else { $null }
    $mc  = if ($r.memberCount) { $r.memberCount } elseif ($r.poolStats) { $r.poolStats.memberCount } else { $null }
    if ($nav) { INFO "NAV=$nav sharePrice=$sp members=$mc" }
    break
  } catch { INFO "$path -> $($_.Exception.Message.Substring(0, [Math]::Min(60, $_.Exception.Message.Length)))" }
}

# 7. ENV VAR HEALTH (Vercel prod)
Section "7. VERCEL ENV HYGIENE"
& npx vercel env pull .env.audit --environment production --yes 2>$null | Out-Null
$bad = 0
Get-Content .env.audit | ForEach-Object {
  if ($_ -match '^([A-Z_][A-Z0-9_]*)=(.*)$' -and $Matches[2] -match '\\r|\\n') { $bad++ }
}
Remove-Item .env.audit -Force
if ($bad -eq 0) { OK "0 vars with literal \r\n corruption" }
else { FAIL "$bad vars still corrupted" }

# 8. INSTRUMENTATION HOOK
Section "8. RUNTIME ENV HARDENING"
if (Test-Path instrumentation.ts) { OK "instrumentation.ts present" } else { FAIL "missing instrumentation.ts" }
if (Test-Path lib/utils/sanitize-env.ts) { OK "sanitize-env.ts present" } else { FAIL "missing sanitize-env.ts" }
$nc = Get-Content next.config.js -Raw
if ($nc -match 'instrumentationHook: true') { OK "instrumentationHook enabled in next.config.js" }
if ($nc -match 'Sanitized.*env var') { OK "build-time sanitizer in next.config.js" }

# 9. RECONCILIATION
Section "9. RECONCILIATION"
$line = (Select-String -Path .env.production -Pattern '^CRON_SECRET=').Line
$secret = ($line -split '=', 2)[1] -replace '^"','' -replace '"$',''
try {
  $rec = Invoke-RestMethod -Uri "$base/api/admin/reconcile-sui-hedges" -Method POST -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 30
  OK "Reconcile endpoint OK"
  INFO "onChain=$($rec.onChainCount) db=$($rec.dbCount) inserted=$($rec.inserted) closed=$($rec.closed) unchanged=$($rec.unchanged) errors=$($rec.errors.Count)"
  if ($rec.errors.Count -eq 0 -and ($rec.unchanged + $rec.inserted) -eq $rec.onChainCount) {
    OK "Reconciler in steady state (no drift)"
  }
} catch { FAIL "Reconcile: $_" }

Section "VERDICT"
Write-Host "On-chain hedges: $($script:onChainCount)" -ForegroundColor White
Write-Host "DB hedges:       $dbCount" -ForegroundColor White
Write-Host "UI hedges:       $($script:uiCount)" -ForegroundColor White
if ($script:onChainCount -eq $dbCount -and $dbCount -eq $script:uiCount -and $bad -eq 0) {
  Write-Host "`n  *** ALL THREE LAYERS IN SYNC — PIPELINE HEALTHY ***`n" -ForegroundColor Green
} else {
  Write-Host "`n  *** DRIFT DETECTED — see failures above ***`n" -ForegroundColor Red
}
