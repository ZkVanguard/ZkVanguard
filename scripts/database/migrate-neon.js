// Run: node scripts/database/migrate-neon.js
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=verify-full';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  console.log('🚀 Connecting to Neon PostgreSQL...');
  
  try {
    // Test connection
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Connected! Server time:', res.rows[0].now);

    // Create hedges table
    console.log('\n📦 Creating hedges table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hedges (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) UNIQUE NOT NULL,
        portfolio_id INTEGER,
        asset VARCHAR(20) NOT NULL,
        market VARCHAR(50) NOT NULL,
        side VARCHAR(10) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
        size DECIMAL(18, 8) NOT NULL,
        notional_value DECIMAL(18, 2) NOT NULL,
        leverage INTEGER NOT NULL,
        entry_price DECIMAL(18, 2),
        liquidation_price DECIMAL(18, 2),
        stop_loss DECIMAL(18, 2),
        take_profit DECIMAL(18, 2),
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'liquidated', 'cancelled')),
        simulation_mode BOOLEAN NOT NULL DEFAULT true,
        reason TEXT,
        prediction_market TEXT,
        current_pnl DECIMAL(18, 2) DEFAULT 0,
        realized_pnl DECIMAL(18, 2) DEFAULT 0,
        funding_paid DECIMAL(18, 2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP WITH TIME ZONE,
        tx_hash VARCHAR(66)
      )
    `);
    console.log('✅ hedges table created');

    // Create indexes
    console.log('\n📇 Creating indexes...');
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hedges_order_id ON hedges(order_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hedges_portfolio ON hedges(portfolio_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hedges_status ON hedges(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hedges_asset ON hedges(asset)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hedges_created ON hedges(created_at)`);
    console.log('✅ Indexes created');

    // Create analytics_events table
    console.log('\n📊 Creating analytics_events table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        session_id VARCHAR(50),
        page VARCHAR(255),
        chain VARCHAR(20),
        feature VARCHAR(100),
        error_type VARCHAR(100),
        metadata JSONB,
        user_agent_type VARCHAR(20),
        screen_width INTEGER,
        referrer VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ analytics_events table created');

    // Create analytics_daily table
    console.log('\n📅 Creating analytics_daily table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_daily (
        date DATE PRIMARY KEY,
        page_views INTEGER DEFAULT 0,
        unique_sessions INTEGER DEFAULT 0,
        wallet_connects INTEGER DEFAULT 0,
        swaps_initiated INTEGER DEFAULT 0,
        swaps_completed INTEGER DEFAULT 0,
        hedges_created INTEGER DEFAULT 0,
        zk_proofs_generated INTEGER DEFAULT 0,
        ai_chat_messages INTEGER DEFAULT 0,
        chain_switches INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        cronos_users INTEGER DEFAULT 0,
        sui_users INTEGER DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ analytics_daily table created');

    // Verify tables
    console.log('\n🔍 Verifying tables...');
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('📋 Tables in database:', tables.rows.map(r => r.table_name).join(', '));

    console.log('\n✨ Migration complete! Database is ready for production.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
