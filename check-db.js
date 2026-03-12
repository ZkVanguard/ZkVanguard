require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function main() {
  try {
    // Get recent AI decisions
    console.log('=== RECENT AI DECISIONS ===\n');
    const result = await pool.query(
      `SELECT created_at, details FROM community_pool_transactions 
       WHERE type = 'AI_DECISION' 
       ORDER BY created_at DESC LIMIT 5`
    );
    
    for (const row of result.rows) {
      console.log('=== ' + row.created_at.toISOString().slice(0, 19) + ' ===');
      console.log(JSON.stringify(row.details, null, 2));
      console.log();
    }

    // Check all transaction types
    console.log('\n=== TRANSACTION TYPES BREAKDOWN ===\n');
    const typeResult = await pool.query(
      `SELECT type, COUNT(*) as count FROM community_pool_transactions 
       GROUP BY type ORDER BY count DESC`
    );
    for (const row of typeResult.rows) {
      console.log(`${row.type}: ${row.count}`);
    }

    // Check hedges table
    console.log('\n=== HEDGES FOR COMMUNITY POOL ===\n');
    const hedgeResult = await pool.query(
      `SELECT * FROM hedges WHERE portfolio_id = -1 ORDER BY created_at DESC LIMIT 5`
    );
    if (hedgeResult.rows.length === 0) {
      console.log('No hedges found for portfolio_id = -1');
      
      // Check all hedges
      const allHedges = await pool.query(`SELECT COUNT(*) as count FROM hedges`);
      console.log('Total hedges in DB:', allHedges.rows[0].count);
    } else {
      for (const row of hedgeResult.rows) {
        console.log(row);
      }
    }

    await pool.end();
  } catch (e) {
    console.error('DB Error:', e.message);
    process.exit(1);
  }
}

main();
