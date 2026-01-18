/**
 * Test PostgreSQL Connection
 * Quick script to verify database connectivity
 */

import { getPool, query } from '../../lib/db/postgres';

async function testConnection() {
  console.log('🔌 Testing PostgreSQL connection...\n');

  try {
    // Test basic query
    console.log('📡 Executing test query...');
    const result = await query('SELECT NOW() as current_time, version() as pg_version');
    
    console.log('✅ Connection successful!\n');
    console.log('📊 Database info:');
    console.log('  Time:', result[0].current_time);
    console.log('  Version:', result[0].pg_version.split(',')[0]);

    // Check if hedges table exists
    console.log('\n🔍 Checking for hedges table...');
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'hedges'
      ) as exists
    `);

    if (tableCheck[0].exists) {
      console.log('✅ Hedges table exists');
      
      const count = await query('SELECT COUNT(*) as count FROM hedges');
      console.log(`📈 Total hedges in database: ${count[0].count}`);
    } else {
      console.log('⚠️  Hedges table not found');
      console.log('   Run: bun run scripts/database/init-hedges-db.ts');
    }

    // Close pool
    const pool = getPool();
    await pool.end();
    
    console.log('\n✅ Test complete!');

  } catch (error) {
    console.error('❌ Connection failed:', error);
    console.error('\n💡 Make sure:');
    console.error('   1. PostgreSQL is running (docker ps or check services)');
    console.error('   2. DATABASE_URL is set in .env.local');
    console.error('   3. Credentials are correct\n');
    process.exit(1);
  }
}

testConnection();
