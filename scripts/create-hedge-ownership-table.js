const { neonConfig, Pool } = require('@neondatabase/serverless');
neonConfig.webSocketConstructor = require('ws');

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=verify-full'
  });

  try {
    // Create hedge_ownership table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hedge_ownership (
        id SERIAL PRIMARY KEY,
        commitment_hash VARCHAR(66) UNIQUE NOT NULL,
        wallet_address VARCHAR(42) NOT NULL,
        pair_index INTEGER NOT NULL DEFAULT 0,
        asset VARCHAR(20) NOT NULL,
        side VARCHAR(10) NOT NULL,
        collateral DECIMAL(18,8) NOT NULL,
        leverage INTEGER NOT NULL,
        opened_at TIMESTAMP WITH TIME ZONE NOT NULL,
        tx_hash VARCHAR(66),
        on_chain_hedge_id VARCHAR(66),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Created hedge_ownership table');

    // Create indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_hedge_ownership_commitment ON hedge_ownership(commitment_hash)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_hedge_ownership_wallet ON hedge_ownership(wallet_address)');
    console.log('✅ Created indexes');

    // Show table
    const { rows } = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'hedge_ownership'
    `);
    console.log('\n📋 hedge_ownership columns:');
    rows.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}`));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();
