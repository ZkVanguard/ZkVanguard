require('dotenv').config({ path: '.env.vercel.temp' });
const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  
  console.log('=== ALL ACTIVE HEDGES BY PORTFOLIO ===\n');
  
  const all = await sql`SELECT portfolio_id, COUNT(*) as count FROM hedges WHERE status = 'active' GROUP BY portfolio_id ORDER BY portfolio_id`;
  console.log('Active hedges by portfolio_id:');
  all.forEach(r => console.log(`  portfolio_id ${r.portfolio_id}: ${r.count} hedges`));
  
  console.log('\n=== COMMUNITY POOL HEDGES (portfolio_id = -1) ===');
  const cpHedges = await sql`SELECT id, asset, side, status, portfolio_id FROM hedges WHERE portfolio_id = -1 ORDER BY id DESC`;
  console.log(`Total with portfolio_id = -1: ${cpHedges.length}`);
  cpHedges.forEach(h => console.log(`  ID: ${h.id} | ${h.asset} ${h.side} | status: ${h.status}`));
}

main().catch(console.error);
