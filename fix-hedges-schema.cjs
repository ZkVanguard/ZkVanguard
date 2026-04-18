/**
 * Fix hedges table schema in production DB.
 * Production table was created with different column names (direction/amount)
 * and is missing columns the code expects (side, size, notional_value, market, etc.)
 * Since there are 0 rows, we just add the missing columns.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  // Read DB URL from .env.local
  const envPath = path.join(__dirname, '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/DB_V2_DATABASE_URL=["']?([^"'\r\n]+)["']?/);
  if (!match) {
    console.error('DB_V2_DATABASE_URL not found in .env.local');
    process.exit(1);
  }

  const client = new Client({ connectionString: match[1] });
  await client.connect();
  console.log('Connected to production DB');

  try {
    // First, check current columns
    const { rows: cols } = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'hedges' ORDER BY ordinal_position
    `);
    const existingCols = cols.map(c => c.column_name);
    console.log('\nExisting columns:', existingCols.join(', '));

    // Add all missing columns
    const migrations = [
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS side VARCHAR(10)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS size DECIMAL(18, 8)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS notional_value DECIMAL(18, 2)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS market VARCHAR(50)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS simulation_mode BOOLEAN DEFAULT false`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS reason TEXT`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS prediction_market TEXT`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS current_pnl DECIMAL(18, 2) DEFAULT 0`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL(18, 2) DEFAULT 0`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS funding_paid DECIMAL(18, 2) DEFAULT 0`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS stop_loss DECIMAL(18, 2)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS take_profit DECIMAL(18, 2)`,
      // These should already exist but just in case
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS portfolio_id INTEGER`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(255)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS zk_proof_hash VARCHAR(128)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS wallet_binding_hash VARCHAR(128)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS owner_commitment VARCHAR(128)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS hedge_id_onchain VARCHAR(66)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS chain VARCHAR(30) DEFAULT 'cronos-testnet'`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS chain_id INTEGER DEFAULT 338`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS proxy_wallet VARCHAR(42)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS on_chain BOOLEAN DEFAULT false`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS explorer_link VARCHAR(256)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS block_number INTEGER`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS current_price DECIMAL(24, 10)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS price_source VARCHAR(50)`,
      `ALTER TABLE hedges ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMP WITH TIME ZONE`,
    ];

    for (const sql of migrations) {
      const colName = sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)?.[1];
      const alreadyExists = existingCols.includes(colName);
      try {
        await client.query(sql);
        console.log(`${alreadyExists ? '  (exists)' : '  + ADDED '} ${colName}`);
      } catch (err) {
        console.error(`  ! FAILED ${colName}: ${err.message}`);
      }
    }

    // Add indexes
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_hedges_order_id ON hedges(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hedges_portfolio ON hedges(portfolio_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hedges_status ON hedges(status)`,
      `CREATE INDEX IF NOT EXISTS idx_hedges_asset ON hedges(asset)`,
      `CREATE INDEX IF NOT EXISTS idx_hedges_wallet ON hedges(wallet_address)`,
      `CREATE INDEX IF NOT EXISTS idx_hedges_wallet_status ON hedges(wallet_address, status)`,
      `CREATE INDEX IF NOT EXISTS idx_hedges_portfolio_status ON hedges(portfolio_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_hedges_chain ON hedges(chain)`,
    ];

    console.log('\nEnsuring indexes...');
    for (const sql of indexes) {
      try {
        await client.query(sql);
      } catch (err) {
        console.error(`  Index error: ${err.message}`);
      }
    }

    // Verify final schema
    const { rows: finalCols } = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'hedges' ORDER BY ordinal_position
    `);
    console.log(`\nFinal schema (${finalCols.length} columns):`);
    for (const col of finalCols) {
      console.log(`  ${col.column_name} (${col.data_type})`);
    }

    // Verify row count
    const { rows: countRows } = await client.query('SELECT COUNT(*) as cnt FROM hedges');
    console.log(`\nTotal hedges: ${countRows[0].cnt}`);

    console.log('\n✅ Schema migration complete!');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
