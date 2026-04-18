const fs = require('fs');
const c = fs.readFileSync('.env.local', 'utf8');
for (const l of c.split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.+)/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DB_V2_DATABASE_URL });

async function main() {
  const r = await pool.query(
    "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'hedges' ORDER BY ordinal_position"
  );
  console.log('=== HEDGES TABLE SCHEMA ===');
  for (const row of r.rows) {
    const def = (row.column_default || '').substring(0, 40);
    console.log(row.column_name.padEnd(30), row.data_type.padEnd(25), def);
  }

  // Also check if there are any hedges at all
  const count = await pool.query("SELECT COUNT(*) as cnt FROM hedges");
  console.log('\nTotal hedges:', count.rows[0].cnt);

  // Check if we can just add the missing columns
  const colNames = r.rows.map(x => x.column_name);
  console.log('\nMissing vs code expectations:');
  const expected = ['side', 'size', 'notional_value', 'market', 'simulation_mode', 'reason', 'prediction_market'];
  for (const col of expected) {
    console.log(' ', col, colNames.includes(col) ? 'EXISTS' : 'MISSING');
  }
  
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
