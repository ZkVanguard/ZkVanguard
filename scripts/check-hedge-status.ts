#!/usr/bin/env npx tsx
/**
 * Check Community Pool Auto-Hedging Status
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db/postgres';
import { COMMUNITY_POOL_PORTFOLIO_ID } from '../lib/constants';

async function checkHedgeStatus() {
  console.log('📊 Community Pool Auto-Hedging Status\n');
  
  // Check recent hedges
  const hedges = await query(
    'SELECT * FROM hedges WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT 5',
    [COMMUNITY_POOL_PORTFOLIO_ID]
  );
  
  console.log(`Recent Hedges for Community Pool (Portfolio ${COMMUNITY_POOL_PORTFOLIO_ID}):`);
  if (hedges.length === 0) {
    console.log('  ⚠️  NO HEDGES FOUND IN DATABASE');
  } else {
    hedges.forEach((h: any, i: number) => {
      console.log(`  ${i+1}. ${h.side} ${h.asset} | Size: $${h.notional_value} | Leverage: ${h.leverage}x`);
      console.log(`     Created: ${h.created_at} | Status: ${h.status}`);
      if (h.tx_hash) console.log(`     TX: ${h.tx_hash}`);
      if (h.reason) console.log(`     Reason: ${h.reason}`);
    });
  }
  
  // Check cron state
  const cronStates = await query(
    "SELECT * FROM cron_state WHERE key LIKE 'poolNav%' OR key LIKE 'heartbeat%' OR key LIKE 'poolCheck%' ORDER BY updated_at DESC"
  );
  
  console.log('\n🔄 Cron State (DB-backed):');
  if (cronStates.length === 0) {
    console.log('  ⚠️  NO CRON STATE FOUND');
  } else {
    cronStates.forEach((s: any) => {
      const val = s.value;
      const display = typeof val === 'number' ? val.toFixed(2) : 
                     (val instanceof Date || (typeof val === 'string' && val.includes && val.includes('T'))) ? 
                     new Date(val).toLocaleString() : JSON.stringify(val);
      console.log(`  ${s.key}: ${display}`);
      console.log(`    Updated: ${new Date(s.updated_at).toLocaleString()}`);
    });
  }
  
  // Check pool NAV history
  try {
    const navHistory = await query(
      'SELECT * FROM pool_nav_history WHERE pool_id = 0 ORDER BY timestamp DESC LIMIT 10'
    );
    
    console.log('\n📈 Recent NAV History (Last 10 entries):');
    if (navHistory.length === 0) {
      console.log('  ⚠️  NO NAV HISTORY FOUND');
    } else {
      navHistory.forEach((n: any, i: number) => {
        console.log(`  ${i+1}. $${parseFloat(n.nav).toFixed(2)} at ${new Date(n.timestamp).toLocaleString()}`);
      });
      
      const peak = Math.max(...navHistory.map((n: any) => parseFloat(n.nav)));
      const current = parseFloat(navHistory[0].nav);
      const drawdown = ((current - peak) / peak * 100);
      console.log(`\n  📊 Analysis:`);
      console.log(`     Peak NAV: $${peak.toFixed(2)}`);
      console.log(`     Current NAV: $${current.toFixed(2)}`);
      console.log(`     Drawdown: ${drawdown.toFixed(2)}%`);
      console.log(`     Loss: $${(peak - current).toFixed(2)}`);
    }
  } catch {
    console.log('\n📈 Recent NAV History:');
    console.log('  ⚠️  pool_nav_history table does not exist yet');
  }
  
  // Check if auto-hedging is enabled
  console.log('\n⚙️  Auto-Hedge Configuration:');
  try {
    const config = await query(
      'SELECT * FROM auto_hedge_configs WHERE portfolio_id = $1',
      [COMMUNITY_POOL_PORTFOLIO_ID]
    );
    if (config.length > 0) {
      const c = config[0];
      console.log(`  Community Pool: ${c.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
      console.log(`  Risk Threshold: ${c.risk_threshold}%`);
      console.log(`  Max Leverage: ${c.max_leverage}x`);
    } else {
      console.log('  ⚠️  NO CONFIG FOUND (falling back to auto-hedge-configs.json)');
    }
  } catch (e) {
    console.log('  ⚠️  Config table not found (using file fallback)');
  }
  
  process.exit(0);
}

checkHedgeStatus().catch(console.error);
