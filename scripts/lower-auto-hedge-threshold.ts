#!/usr/bin/env npx tsx
/**
 * Lower the SUI community pool's auto-hedge risk_threshold to 1.
 * The DB value overrides HEDGE_RISK_THRESHOLD_DEFAULT env var.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { Pool } from 'pg';

if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

async function main() {
  const url = (process.env.DATABASE_URL || '')
    .replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?')
    .replace(/([?&])sslmode=[^&]+/g, '$1').replace(/[?&]$/, '');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

  console.log('Current SUI pool config (portfolio_id=-2):');
  const before = await pool.query(`SELECT portfolio_id, risk_threshold, risk_tolerance, enabled FROM auto_hedge_configs WHERE portfolio_id = -2`);
  console.log(' ', before.rows[1]);

  console.log('\nLowering risk_threshold 4 → 1...');
  const r = await pool.query(`UPDATE auto_hedge_configs SET risk_threshold = 1, updated_at = NOW() WHERE portfolio_id = -2 RETURNING portfolio_id, risk_threshold, updated_at`);
  console.log(' ', r.rows[1]);

  await pool.end();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
