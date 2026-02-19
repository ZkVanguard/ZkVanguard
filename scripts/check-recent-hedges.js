const { neonConfig, Pool } = require('@neondatabase/serverless');
neonConfig.webSocketConstructor = require('ws');

async function main() {
  const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=verify-full'
  });

  try {
    // Get recent ETH hedges
    const { rows } = await pool.query(
      `SELECT tx_hash, asset, side, leverage, created_at 
       FROM hedges 
       WHERE asset = 'ETH' 
       ORDER BY created_at DESC 
       LIMIT 5`
    );
    
    console.log('Recent ETH hedges in DB:');
    rows.forEach(h => {
      console.log(`  ${h.tx_hash || 'NO_TX'} | ${h.asset} ${h.side} x${h.leverage} | ${h.created_at}`);
    });

    // Also check hedge_ownership table
    const ownership = await pool.query(
      `SELECT tx_hash, asset, side, leverage, opened_at 
       FROM hedge_ownership 
       WHERE asset = 'ETH' 
       ORDER BY created_at DESC 
       LIMIT 5`
    );
    
    console.log('\nRecent ETH in hedge_ownership:');
    ownership.rows.forEach(h => {
      console.log(`  ${h.tx_hash || 'NO_TX'} | ${h.asset} ${h.side} x${h.leverage} | ${h.opened_at}`);
    });

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
