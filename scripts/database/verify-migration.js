const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=verify-full',
  ssl: { rejectUnauthorized: false }
});

pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
  .then(r => {
    console.log('Tables:', r.rows.map(r => r.table_name).join(', '));
    return pool.query("SELECT sync_key, last_block FROM sync_metadata");
  })
  .then(r => {
    console.log('Sync metadata:', JSON.stringify(r.rows));
    return pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='hedges' AND column_name IN ('current_price','price_source','price_updated_at')");
  })
  .then(r => {
    console.log('New hedges columns:', r.rows.map(r => r.column_name).join(', '));
    pool.end();
  })
  .catch(e => { console.error('Error:', e.message); pool.end(); });
