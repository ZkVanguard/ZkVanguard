#!/usr/bin/env node
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.vercel.temp' });
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

async function main() {
  console.log('\n=== AUTO-HEDGE STATUS CHECK ===\n');
  
  // Clean up any \r\n that might be in the URL
  let dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    dbUrl = dbUrl.replace(/\\r\\n/g, '').replace(/\r\n/g, '').trim();
    if (dbUrl.startsWith('"')) dbUrl = dbUrl.slice(1);
    if (dbUrl.endsWith('"')) dbUrl = dbUrl.slice(0, -1);
  }
  
  console.log('DATABASE_URL:', dbUrl ? 'SET (' + dbUrl.substring(0, 40) + '...)' : 'NOT SET');
  
  if (!dbUrl || dbUrl === '""') {
    console.log('ERROR: DATABASE_URL not found');
    return;
  }

  const pool = new Pool({ 
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  // List tables
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  console.log('Available tables:', tables.rows.map(r => r.tablename).join(', '));

  // Check auto_hedge_configs
  console.log('\n--- AUTO-HEDGE CONFIG ---');
  const config = await pool.query('SELECT * FROM auto_hedge_configs');
  console.log('Configs found:', config.rows.length);
  config.rows.forEach(c => {
    console.log('  Portfolio:', c.portfolio_id, '| Enabled:', c.enabled);
    console.log('  Wallet:', c.wallet_address);
    console.log('  Threshold:', c.risk_threshold, '| Leverage:', c.max_leverage + 'x');
    console.log('  Assets:', JSON.stringify(c.allowed_assets));
  });

  // Check NAV history
  console.log('\n--- NAV HISTORY ---');
  try {
    // First get column names
    const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'community_pool_nav_history'");
    console.log('Columns:', cols.rows.map(r => r.column_name).join(', '));
    
    const nav = await pool.query('SELECT * FROM community_pool_nav_history ORDER BY id DESC LIMIT 5');
    console.log('NAV snapshots:', nav.rows.length);
    nav.rows.forEach(n => {
      console.log('  ID:', n.id, '| NAV: $' + n.nav_usd, '| Share: $' + n.share_price);
    });
  } catch (e) {
    console.log('NAV history error:', e.message.substring(0, 80));
  }

  // Check for hedges table
  console.log('\n--- HEDGES TABLE ---');
  try {
    // First get column names
    const hedgeCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'hedges'");
    console.log('Columns:', hedgeCols.rows.map(r => r.column_name).join(', '));
    
    const pos = await pool.query('SELECT * FROM hedges ORDER BY id DESC LIMIT 10');
    console.log('Hedges found:', pos.rows.length);
    pos.rows.forEach(h => {
      console.log('  ID:', h.id, '| Asset:', h.asset, h.side, '| Status:', h.status);
      console.log('    Size:', h.size, '| Entry:', h.entry_price, '| Current:', h.current_price);
      console.log('    Created:', h.created_at);
      if (h.pnl) console.log('    P&L:', h.pnl);
    });
  } catch (e) {
    console.log('Hedges error:', e.message.substring(0, 60));
  }

  // Check cron_state
  console.log('\n--- CRON STATE ---');
  try {
    const cronState = await pool.query('SELECT * FROM cron_state ORDER BY last_run DESC LIMIT 10');
    console.log('Cron states:', cronState.rows.length);
    cronState.rows.forEach(c => {
      console.log('  ', c.cron_name, '|', c.last_run, '|', c.status);
    });
  } catch (e) {
    console.log('Cron state error:', e.message.substring(0, 60));
  }

  console.log('\n=== QSTASH STATUS ===');
  console.log('QSTASH_TOKEN:', process.env.QSTASH_TOKEN ? 'SET' : 'NOT SET');
  console.log('\nNote: Auto-hedge via QStash runs in production (Vercel).');
  console.log('Schedules: hedge-monitor (15min), pool-nav-monitor (15min)');

  await pool.end();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
