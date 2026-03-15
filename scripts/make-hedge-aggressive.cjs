#!/usr/bin/env node
/**
 * Make auto-hedge more aggressive
 * Lowers risk threshold so AI hedges earlier
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.vercel.temp' });
require('dotenv').config({ path: '.env.local' });

async function main() {
  let dbUrl = process.env.DATABASE_URL || '';
  dbUrl = dbUrl.replace(/\\r\\n/g, '').replace(/\r\n/g, '').trim();
  if (dbUrl.startsWith('"')) dbUrl = dbUrl.slice(1);
  if (dbUrl.endsWith('"')) dbUrl = dbUrl.slice(0, -1);

  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  console.log('\n=== MAKING AUTO-HEDGE MORE AGGRESSIVE ===\n');

  // Lower risk threshold from 3 to 2 (more sensitive to losses)
  const result = await pool.query(`
    UPDATE auto_hedge_configs 
    SET risk_threshold = 2, 
        max_leverage = 3, 
        updated_at = NOW() 
    WHERE portfolio_id = -1 
    RETURNING *
  `);

  if (result.rows.length > 0) {
    const cfg = result.rows[0];
    console.log('✅ Config updated:');
    console.log('  Portfolio ID:', cfg.portfolio_id);
    console.log('  Risk Threshold:', cfg.risk_threshold, '(triggers hedge when score >= 2)');
    console.log('  Max Leverage:', cfg.max_leverage + 'x');
    console.log('  Enabled:', cfg.enabled);
    console.log('  Wallet:', cfg.wallet_address);
    console.log('');
    console.log('With share price at $0.9694 (3% below $1.00):');
    console.log('  -> Risk score will be 4+ (3% below par adds +3)');
    console.log('  -> Threshold is 2, so HEDGING WILL TRIGGER');
  } else {
    console.log('❌ No config found');
  }

  await pool.end();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
