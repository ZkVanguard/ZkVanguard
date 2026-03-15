#!/usr/bin/env node
/**
 * Check QStash auto-hedge execution status
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('═'.repeat(60));
  console.log('  AUTO-HEDGE EXECUTION STATUS');
  console.log('═'.repeat(60));

  // First, list all tables
  console.log('\nDatabase Tables:');
  try {
    const tables = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    console.log('  ', tables.rows.map(r => r.tablename).join(', '));
  } catch (e) {
    console.log('  Error:', e.message);
  }

  // 1. Check hedge_positions table
  console.log('\nHEDGE POSITIONS:\n');
  try {
    const positions = await pool.query(
      'SELECT * FROM hedge_positions ORDER BY created_at DESC LIMIT 10'
    );
    
    if (positions.rows.length > 0) {
      console.log('   Found', positions.rows.length, 'position(s):');
      positions.rows.forEach(p => {
        console.log('   -', p.asset, p.side, '- Size: $' + p.size);
      });
    } else {
      console.log('   No hedge positions recorded yet');
    }
  } catch (e) {
    if (e.message.includes('does not exist')) {
      console.log('   Table hedge_positions does not exist');
    } else {
      console.log('   Error:', e.message.substring(0, 100));
    }
  }

  // 2. Check cron execution logs
  console.log('\n📋 CRON EXECUTION LOG:\n');
  try {
    const logs = await pool.query(`
      SELECT id, cron_name, status, execution_time_ms, created_at, 
             result::text as result_text
      FROM cron_logs 
      WHERE cron_name ILIKE '%hedge%'
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    if (logs.rows.length > 0) {
      console.log(`   Found ${logs.rows.length} hedge-related cron run(s):`);
      logs.rows.forEach(r => {
        const status = r.status === 'success' ? '✅' : '❌';
        console.log(`   ${status} [${r.created_at}] ${r.cron_name}`);
        console.log(`      Duration: ${r.execution_time_ms}ms`);
        if (r.result_text && r.result_text !== '{}') {
          try {
            const result = JSON.parse(r.result_text);
            if (result.actionsExecuted) {
              console.log(`      Actions: ${JSON.stringify(result.actionsExecuted)}`);
            }
          } catch (e) {}
        }
      });
    } else {
      console.log('   ℹ️  No hedge cron runs recorded');
    }
  } catch (e) {
    if (e.message.includes('does not exist')) {
      console.log('   ⚠️  Table cron_logs does not exist');
    } else {
      console.log('   ❌', e.message);
    }
  }

  // 3. Check auto-hedge config
  console.log('\n⚙️  AUTO-HEDGE CONFIG:\n');
  try {
    const config = await pool.query(`SELECT * FROM auto_hedge_configs`);
    
    if (config.rows.length > 0) {
      config.rows.forEach(c => {
        const status = c.enabled ? '🟢 ENABLED' : '🔴 DISABLED';
        console.log(`   ${status} - Portfolio ID: ${c.portfolio_id}`);
        console.log(`      Wallet: ${c.wallet_address || 'not set'}`);
        console.log(`      Risk Threshold: ${c.risk_threshold}/10`);
        console.log(`      Max Leverage: ${c.max_leverage}x`);
        console.log(`      Allowed Assets: ${JSON.stringify(c.allowed_assets)}`);
        console.log(`      Last Updated: ${c.updated_at}`);
      });
    } else {
      console.log('   ⚠️  No auto-hedge config found');
    }
  } catch (e) {
    console.log('   ❌', e.message);
  }

  // 4. Check if any NAV drops would trigger hedge
  console.log('\n📈 NAV RISK ANALYSIS:\n');
  try {
    const nav = await pool.query(`
      SELECT nav_usd, share_price, recorded_at 
      FROM community_pool_nav_history 
      ORDER BY recorded_at DESC 
      LIMIT 10
    `);
    
    if (nav.rows.length >= 2) {
      const latest = parseFloat(nav.rows[0].nav_usd);
      const previous = parseFloat(nav.rows[1].nav_usd);
      const change = ((latest - previous) / previous * 100).toFixed(2);
      
      console.log(`   Latest NAV: $${latest.toFixed(2)}`);
      console.log(`   Previous: $${previous.toFixed(2)}`);
      console.log(`   Change: ${change}%`);
      
      if (parseFloat(change) < -5) {
        console.log(`   ⚠️  ALERT: >5% drawdown would trigger hedge consideration`);
      } else {
        console.log(`   ✅ No significant drawdown (hedge threshold typically -5%+)`);
      }
    } else {
      console.log(`   ⚠️  Need more NAV snapshots (${nav.rows.length}/2 minimum)`);
    }
  } catch (e) {
    console.log('   ❌', e.message);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  📝 SUMMARY');
  console.log('═'.repeat(60));
  console.log(`
   QStash requires QSTASH_TOKEN env var to run locally.
   In production (Vercel), schedules trigger:
     - /api/cron/hedge-monitor every 15 min
     - /api/cron/pool-nav-monitor every 15 min (drawdown detection)
   
   Auto-hedge triggers when:
     1. Pool NAV drops >5% (configurable threshold)
     2. Risk score exceeds configured threshold (3/10)
     3. Market shows strong downward signal

   Current Status: ${process.env.QSTASH_TOKEN ? '🟢 QStash token found' : '🔴 No QStash token locally'}
`);

  await pool.end();
}

main().catch(console.error);
