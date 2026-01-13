-- ZkVanguard Analytics Database Schema
-- Platform: Neon PostgreSQL (free tier: 512MB, 3GB transfer/month)
-- GDPR Compliant: No PII stored, 90-day auto-deletion
--
-- Setup Instructions:
-- 1. Create account at https://neon.tech
-- 2. Create new project "zkvanguard"
-- 3. Create database "zkvanguard_analytics"
-- 4. Run this schema
-- 5. Copy connection string to Vercel: DATABASE_URL=postgresql://...

-- ============================================
-- ANALYTICS EVENTS TABLE
-- Stores individual events (page views, actions)
-- ============================================

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
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_chain ON analytics_events(chain);
CREATE INDEX IF NOT EXISTS idx_events_session ON analytics_events(session_id);

-- ============================================
-- DAILY AGGREGATES TABLE
-- Pre-computed daily stats for dashboards
-- ============================================

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
);

-- ============================================
-- USER PREFERENCES TABLE (Optional)
-- For storing user-consented preferences
-- ============================================

CREATE TABLE IF NOT EXISTS user_preferences (
  wallet_hash VARCHAR(64) PRIMARY KEY,  -- SHA-256 hash of wallet address (not the actual address)
  theme VARCHAR(20) DEFAULT 'light',
  default_chain VARCHAR(20) DEFAULT 'cronos',
  notifications_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DATA RETENTION FUNCTIONS
-- Auto-delete data older than 90 days (GDPR compliance)
-- ============================================

-- Function to cleanup old events
CREATE OR REPLACE FUNCTION cleanup_old_analytics()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM analytics_events 
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Deleted % old analytics events', deleted_count;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to aggregate daily stats (run daily via cron)
CREATE OR REPLACE FUNCTION aggregate_daily_stats()
RETURNS void AS $$
DECLARE
  yesterday DATE := CURRENT_DATE - INTERVAL '1 day';
BEGIN
  INSERT INTO analytics_daily (
    date,
    page_views,
    unique_sessions,
    wallet_connects,
    swaps_initiated,
    swaps_completed,
    hedges_created,
    zk_proofs_generated,
    ai_chat_messages,
    chain_switches,
    errors,
    cronos_users,
    sui_users
  )
  SELECT
    yesterday,
    COUNT(*) FILTER (WHERE event_type = 'page_view'),
    COUNT(DISTINCT session_id),
    COUNT(*) FILTER (WHERE event_type = 'wallet_connect'),
    COUNT(*) FILTER (WHERE event_type = 'swap_initiated'),
    COUNT(*) FILTER (WHERE event_type = 'swap_completed'),
    COUNT(*) FILTER (WHERE event_type = 'hedge_created'),
    COUNT(*) FILTER (WHERE event_type = 'zk_proof_generated'),
    COUNT(*) FILTER (WHERE event_type = 'ai_chat_message'),
    COUNT(*) FILTER (WHERE event_type = 'chain_switched'),
    COUNT(*) FILTER (WHERE event_type = 'error'),
    COUNT(DISTINCT session_id) FILTER (WHERE chain = 'cronos'),
    COUNT(DISTINCT session_id) FILTER (WHERE chain = 'sui')
  FROM analytics_events
  WHERE DATE(created_at) = yesterday
  ON CONFLICT (date) DO UPDATE SET
    page_views = EXCLUDED.page_views,
    unique_sessions = EXCLUDED.unique_sessions,
    wallet_connects = EXCLUDED.wallet_connects,
    swaps_initiated = EXCLUDED.swaps_initiated,
    swaps_completed = EXCLUDED.swaps_completed,
    hedges_created = EXCLUDED.hedges_created,
    zk_proofs_generated = EXCLUDED.zk_proofs_generated,
    ai_chat_messages = EXCLUDED.ai_chat_messages,
    chain_switches = EXCLUDED.chain_switches,
    errors = EXCLUDED.errors,
    cronos_users = EXCLUDED.cronos_users,
    sui_users = EXCLUDED.sui_users,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEWS FOR ANALYTICS DASHBOARD
-- ============================================

-- Last 7 days overview
CREATE OR REPLACE VIEW analytics_week_overview AS
SELECT
  date,
  page_views,
  unique_sessions,
  wallet_connects,
  swaps_completed,
  hedges_created,
  zk_proofs_generated
FROM analytics_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC;

-- Chain distribution
CREATE OR REPLACE VIEW analytics_chain_distribution AS
SELECT
  chain,
  COUNT(*) as event_count,
  COUNT(DISTINCT session_id) as unique_sessions
FROM analytics_events
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY chain;

-- Popular features
CREATE OR REPLACE VIEW analytics_popular_features AS
SELECT
  feature,
  COUNT(*) as usage_count
FROM analytics_events
WHERE feature IS NOT NULL
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY feature
ORDER BY usage_count DESC
LIMIT 10;

-- ============================================
-- GDPR DATA EXPORT FUNCTION
-- For user data requests
-- ============================================

CREATE OR REPLACE FUNCTION export_user_data(wallet_hash_input VARCHAR(64))
RETURNS TABLE (
  data_type VARCHAR(50),
  data_content JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 'preferences'::VARCHAR(50), 
         to_jsonb(p.*) 
  FROM user_preferences p 
  WHERE p.wallet_hash = wallet_hash_input;
  
  -- Note: analytics_events don't contain wallet info, so nothing to export
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- GDPR DATA DELETION FUNCTION
-- For right to erasure requests
-- ============================================

CREATE OR REPLACE FUNCTION delete_user_data(wallet_hash_input VARCHAR(64))
RETURNS void AS $$
BEGIN
  DELETE FROM user_preferences WHERE wallet_hash = wallet_hash_input;
  RAISE NOTICE 'Deleted all data for wallet hash: %', wallet_hash_input;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- GRANT PERMISSIONS (adjust for your Neon user)
-- ============================================

-- Example: GRANT SELECT, INSERT ON analytics_events TO your_app_user;
-- Example: GRANT SELECT, INSERT, UPDATE ON analytics_daily TO your_app_user;
-- Example: GRANT ALL ON user_preferences TO your_app_user;

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE analytics_events IS 'GDPR compliant event tracking - no PII, 90-day retention';
COMMENT ON TABLE analytics_daily IS 'Pre-aggregated daily stats for dashboard performance';
COMMENT ON TABLE user_preferences IS 'User-consented preferences, linked by hashed wallet address';
COMMENT ON FUNCTION cleanup_old_analytics IS 'Run daily to enforce 90-day data retention';
COMMENT ON FUNCTION delete_user_data IS 'GDPR right to erasure - call with SHA-256 hash of wallet address';
