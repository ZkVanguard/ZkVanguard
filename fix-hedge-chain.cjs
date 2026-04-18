// Fix existing SUI pool hedges to have chain='sui'
const { Pool } = require('pg');
const fs = require('fs');

async function main() {
  // Load env
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.+)/);
      if (match) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
    }
  } catch {}

  const pool = new Pool({ connectionString: process.env.DB_V2_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL });
  
  // Check current state
  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'hedges' ORDER BY ordinal_position"
  );
  console.log('Hedges table columns:', cols.rows.map(r => r.column_name).join(', '));

  // Check if chain column exists
  const hasChain = cols.rows.some(r => r.column_name === 'chain');
  if (!hasChain) {
    console.log('Adding chain column...');
    await pool.query("ALTER TABLE hedges ADD COLUMN IF NOT EXISTS chain VARCHAR(30) DEFAULT 'cronos-testnet'");
  }

  const before = await pool.query(
    "SELECT id, order_id, asset, chain, status FROM hedges WHERE portfolio_id = -2"
  );
  console.log('SUI pool hedges (before fix):');
  for (const h of before.rows) {
    console.log(' ', h.id, h.asset, 'chain=' + h.chain, 'status=' + h.status, (h.order_id || '').substring(0, 20) + '...');
  }
  
  // Fix chain to 'sui' for all SUI pool hedges
  const result = await pool.query(
    "UPDATE hedges SET chain = 'sui' WHERE portfolio_id = -2 AND (chain IS NULL OR chain != 'sui')"
  );
  console.log('\nUpdated', result.rowCount, 'hedges to chain=sui');
  
  // Verify
  const after = await pool.query(
    "SELECT id, order_id, asset, chain, status FROM hedges WHERE portfolio_id = -2"
  );
  console.log('\nSUI pool hedges (after fix):');
  for (const h of after.rows) {
    console.log(' ', h.id, h.asset, 'chain=' + h.chain, 'status=' + h.status);
  }
  
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
