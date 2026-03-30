#!/usr/bin/env npx tsx
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('\n═══ DATABASE TABLES ═══\n');
  
  // List tables
  const tables = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  
  console.log('Existing tables:');
  for (const row of tables.rows) {
    console.log(`  - ${row.table_name}`);
  }
  
  // Check if user_positions exists
  const userPosExists = tables.rows.some(r => r.table_name === 'user_positions');
  console.log('\nuser_positions table:', userPosExists ? '✅ EXISTS' : '❌ NOT FOUND');
  
  // Create user_positions if not exists
  if (!userPosExists) {
    console.log('\nCreating user_positions table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_positions (
        id SERIAL PRIMARY KEY,
        user_address VARCHAR(128) NOT NULL,
        chain_id INTEGER NOT NULL,
        pool_address VARCHAR(128),
        shares DECIMAL(36, 18) NOT NULL DEFAULT 0,
        deposited_amount DECIMAL(36, 18) NOT NULL DEFAULT 0,
        current_value DECIMAL(36, 18),
        pnl DECIMAL(36, 18),
        pnl_percent DECIMAL(10, 4),
        last_deposit_at TIMESTAMP,
        last_withdraw_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_address, chain_id, pool_address)
      )
    `);
    
    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_positions_user ON user_positions(user_address);
      CREATE INDEX IF NOT EXISTS idx_user_positions_chain ON user_positions(chain_id);
    `);
    
    console.log('✅ user_positions table created!');
  }
  
  await pool.end();
}

run().catch(console.error);
