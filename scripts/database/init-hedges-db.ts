/**
 * Initialize Hedges Database Schema
 * Run this script to create the hedges table and indexes
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getPool } from '../../lib/db/postgres';

async function initializeDatabase() {
  console.log('🗄️  Initializing hedges database schema...\n');

  try {
    const pool = getPool();

    // Read SQL schema file
    const schemaPath = join(__dirname, 'hedges-schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    console.log('📜 Executing schema SQL...');
    
    // Execute the entire schema as one statement (PostgreSQL can handle this)
    await pool.query(schema);
    console.log('✅ Schema executed successfully');

    console.log('\n✅ Database schema initialized successfully!');
    console.log('\nVerifying tables...');

    // Verify tables exist
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('hedges')
    `);

    if (result.rows.length === 0) {
      throw new Error('Tables not found after creation');
    }

    console.log('📊 Tables created:', result.rows.map(r => r.table_name).join(', '));

    // Get row counts
    const countResult = await pool.query('SELECT COUNT(*) as count FROM hedges');
    console.log(`📈 Current hedge count: ${countResult.rows[0].count}`);

    await pool.end();
    console.log('\n🎉 Database setup complete!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

initializeDatabase();
