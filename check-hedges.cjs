const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const envPath = path.join(__dirname, '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/DB_V2_DATABASE_URL=["']?([^"'\r\n]+)["']?/);
  if (!match) { console.error('No DB URL'); process.exit(1); }

  const client = new Client({ connectionString: match[1] });
  await client.connect();

  const { rows } = await client.query(`
    SELECT id, order_id, asset, side, size, notional_value, market, status, chain, portfolio_id, simulation_mode, entry_price, created_at
    FROM hedges ORDER BY created_at DESC LIMIT 10
  `);
  
  console.log(`Total hedges found: ${rows.length}`);
  for (const h of rows) {
    console.log(`  #${h.id} | ${h.asset} ${h.side} ${h.size} | status=${h.status} chain=${h.chain} portfolio=${h.portfolio_id} sim=${h.simulation_mode} | order=${h.order_id?.substring(0,16)}...`);
  }

  if (rows.length === 0) {
    console.log('\nNo hedges found - checking if createHedge INSERT is working...');
    // Check if there are any rows at all
    const { rows: allRows } = await client.query('SELECT COUNT(*) as cnt FROM hedges');
    console.log(`Total rows in hedges table: ${allRows[0].cnt}`);
  }

  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
