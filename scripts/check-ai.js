// Quick check for AI decisions
const { Pool } = require('pg');

async function check() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  // AI decisions
  const ai = await pool.query(`
    SELECT transaction_id, details, created_at 
    FROM community_pool_transactions 
    WHERE type = 'AI_DECISION'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log('\n=== AI DECISIONS ===');
  console.log('Total:', ai.rows.length);
  ai.rows.forEach(r => {
    const d = r.details || {};
    console.log(`  ${new Date(r.created_at).toLocaleTimeString()}: action=${d.action}, risk=${d.riskScore}, src=${d.source || 'cron'}`);
  });
  
  // Recent onchain-contract NAV (community-pool cron)
  const nav = await pool.query(`
    SELECT id, timestamp FROM community_pool_nav_history 
    WHERE source = 'onchain-contract'
    ORDER BY timestamp DESC LIMIT 3
  `);
  console.log('\n=== COMMUNITY-POOL CRON RUNS (onchain-contract) ===');
  nav.rows.forEach(r => {
    const age = Math.round((Date.now() - new Date(r.timestamp).getTime()) / 1000);
    console.log(`  ID ${r.id}: ${new Date(r.timestamp).toLocaleTimeString()} (${age}s ago)`);
  });
  
  // Pool state
  const state = await pool.query(`SELECT last_ai_decision FROM community_pool_state LIMIT 1`);
  console.log('\n=== POOL STATE last_ai_decision ===');
  console.log(state.rows[0]?.last_ai_decision ? JSON.stringify(state.rows[0].last_ai_decision).slice(0, 100) : 'null');
  
  pool.end();
}

check();
