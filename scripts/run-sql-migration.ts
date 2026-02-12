/**
 * Simple SQL migration runner
 * Usage: npx ts-node scripts/run-sql-migration.ts scripts/database/portfolio-snapshots.sql
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function runMigration(sqlFilePath: string) {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }
  
  // Resolve absolute path
  const absolutePath = path.isAbsolute(sqlFilePath) 
    ? sqlFilePath 
    : path.join(process.cwd(), sqlFilePath);
  
  if (!fs.existsSync(absolutePath)) {
    console.error(`ERROR: SQL file not found: ${absolutePath}`);
    process.exit(1);
  }
  
  const sql = fs.readFileSync(absolutePath, 'utf-8');
  console.log(`Running migration: ${sqlFilePath}`);
  console.log(`SQL length: ${sql.length} characters`);
  
  // Clean connection string
  const cleanConnectionString = connectionString
    .replace(/&?channel_binding=[^&]*/g, '')
    .replace('?&', '?');
  
  const isNeon = cleanConnectionString.includes('neon.tech');
  
  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: isNeon ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  
  try {
    // Execute the migration
    await pool.query(sql);
    console.log('Migration completed successfully!');
    
    // Verify tables exist
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('portfolio_snapshots', 'portfolio_metrics', 'hedge_pnl_history')
    `);
    
    console.log('Tables verified:', tables.rows.map(r => r.table_name).join(', '));
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
const sqlFile = process.argv[2];
if (!sqlFile) {
  console.log('Usage: npx ts-node scripts/run-sql-migration.ts <sql-file-path>');
  console.log('Example: npx ts-node scripts/run-sql-migration.ts scripts/database/portfolio-snapshots.sql');
  process.exit(1);
}

runMigration(sqlFile).catch(console.error);
