const { Pool } = require('pg');

async function checkDB() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Check tables
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE 'community_pool%'
    `);
    console.log('Tables:', tables.rows.map(r => r.table_name));
    
    // Check community_pool_transactions columns
    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'community_pool_transactions' ORDER BY ordinal_position
    `);
    console.log('\ncommunity_pool_transactions columns:', cols.rows.map(r => r.column_name));
    
    // Sample transactions
    const sample = await pool.query(`SELECT * FROM community_pool_transactions ORDER BY created_at DESC LIMIT 5`);
    console.log('\nRecent transactions:', sample.rows.length);
    if (sample.rows.length > 0) {
      sample.rows.forEach((r, i) => {
        console.log(`  ${i+1}. type=${r.type}, amount=${r.amount}, user=${r.user_address?.slice(0,10)}...`);
      });
    }
    
    // Check NAV history
    const navCount = await pool.query(`SELECT COUNT(*) FROM community_pool_nav_history`);
    console.log('\nNAV snapshots:', navCount.rows[0].count);
    
    // Check pool state
    const stateCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'community_pool_state' ORDER BY ordinal_position
    `);
    console.log('\nPool state columns:', stateCheck.rows.map(r => r.column_name));
    
    const state = await pool.query(`SELECT * FROM community_pool_state LIMIT 1`);
    if (state.rows.length > 0) {
      console.log('Pool state:', JSON.stringify(state.rows[0], null, 2));
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}

checkDB();
