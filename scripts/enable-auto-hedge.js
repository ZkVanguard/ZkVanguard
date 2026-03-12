// Enable auto-hedge for community pool
const { Pool } = require('pg');

async function enableAutoHedge() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Check if table exists
    const tables = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'auto_hedge_configs'`
    );
    
    if (tables.rows.length === 0) {
      console.log('Table auto_hedge_configs does not exist. Creating...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_hedge_configs (
          portfolio_id INTEGER PRIMARY KEY,
          wallet_address VARCHAR(42) NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT true,
          risk_threshold INTEGER NOT NULL DEFAULT 5,
          max_leverage INTEGER NOT NULL DEFAULT 3,
          allowed_assets JSONB DEFAULT '[]',
          risk_tolerance INTEGER DEFAULT 50,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Table created.');
    }
    
    // Check existing config for community pool (-1)
    const config = await pool.query('SELECT * FROM auto_hedge_configs WHERE portfolio_id = -1');
    console.log('Community Pool Auto-Hedge Config:', config.rows);
    
    if (config.rows.length === 0) {
      console.log('No config found. Creating...');
      await pool.query(`
        INSERT INTO auto_hedge_configs (portfolio_id, wallet_address, enabled, risk_threshold, max_leverage, allowed_assets)
        VALUES (-1, '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30', true, 4, 3, '["BTC", "ETH"]')
      `);
      console.log('Config created with enabled=true, riskThreshold=4, maxLeverage=3');
    } else if (!config.rows[0].enabled) {
      console.log('Config exists but disabled. Enabling...');
      await pool.query('UPDATE auto_hedge_configs SET enabled = true WHERE portfolio_id = -1');
      console.log('Config enabled.');
    } else {
      console.log('Config already enabled.');
    }
    
    // Show final config
    const final = await pool.query('SELECT * FROM auto_hedge_configs WHERE portfolio_id = -1');
    console.log('Final config:', final.rows[0]);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}

enableAutoHedge();
