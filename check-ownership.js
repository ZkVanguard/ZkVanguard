const { Pool } = require('pg');

const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=verify-full"
});

async function main() {
  const client = await pool.connect();
  try {
    // Fix the existing hedge entry_price
    const res = await client.query(`
      UPDATE hedges 
      SET entry_price = 2112.91 
      WHERE hedge_id_onchain LIKE '0x6325054f%' AND entry_price IS NULL
      RETURNING hedge_id_onchain, entry_price, current_price
    `);
    console.log('Fixed hedges:', res.rows);
    
    // Verify
    const verify = await client.query(`
      SELECT hedge_id_onchain, entry_price, current_price, asset 
      FROM hedges 
      WHERE status = 'active'
    `);
    console.log('Active hedges after fix:', verify.rows);
    
  } finally {
    client.release();
    pool.end();
  }
}

main().catch(console.error);
