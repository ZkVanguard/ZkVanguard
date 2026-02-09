const { Pool } = require('pg');

const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require"
});

async function main() {
  const client = await pool.connect();
  try {
    // Check all recent hedges in DB with their wallet addresses
    const res = await client.query(`
      SELECT 
        hedge_id_onchain,
        commitment_hash, 
        wallet_address, 
        asset, 
        status,
        size,
        created_at
      FROM hedges 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    console.log('=== Recent Hedges in DB ===');
    res.rows.forEach(r => {
      console.log(`${r.asset} | status=${r.status} | wallet=${r.wallet_address?.slice(0,10)} | hedge=${r.hedge_id_onchain?.slice(0,10)}`);
    });
    
    // Check the user's specific hedge
    const hedge = await client.query(`
      SELECT * FROM hedges 
      WHERE hedge_id_onchain LIKE '0x6325054f%' OR commitment_hash LIKE '0xddb0c5e5%'
    `);
    console.log('\n=== User hedge 0x6325054f... ===');
    console.log(hedge.rows);
    
  } finally {
    client.release();
    pool.end();
  }
}

main().catch(console.error);
