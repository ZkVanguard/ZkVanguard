# 🤖 Automatic Auto-Hedge Configuration

## Overview

The platform now supports **fully automatic configuration** of AI-powered hedging for any portfolio. No hardcoded portfolio IDs, no manual registration on each deployment.

### Key Features

✅ **Database-Driven Configuration** - All settings stored in PostgreSQL (production) or JSON files (local dev)  
✅ **Automatic Service Startup** - Loads all enabled portfolios on service start  
✅ **Persistent Across Deployments** - Survives server restarts and redeployments  
✅ **Dynamic Portfolio Registration** - Enable/disable via API without code changes  
✅ **On-Chain Risk Integration** - Automatically fetches portfolio risk tolerance settings  
✅ **Real-Time Updates** - Changes take effect immediately without restart  

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Auto-Hedge System                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐       ┌──────────────────┐            │
│  │  API Endpoint   │──────>│  Storage Layer   │            │
│  │ /api/agents/    │       │  - PostgreSQL    │            │
│  │   auto-hedge    │       │  - File Fallback │            │
│  └─────────────────┘       └──────────────────┘            │
│           │                          │                      │
│           │                          │                      │
│           v                          v                      │
│  ┌──────────────────────────────────────────────┐          │
│  │       AutoHedgingService                      │          │
│  │  - Loads configs from storage on startup     │          │
│  │  - Monitors risk for all enabled portfolios  │          │
│  │  - Executes hedges when thresholds exceeded  │          │
│  └──────────────────────────────────────────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Service Startup** → Loads all enabled portfolios from storage
2. **User Enables Portfolio** → API saves to storage + registers in runtime service
3. **Risk Monitoring** → Service checks all registered portfolios every 60 seconds
4. **Auto-Hedge Trigger** → When risk score > threshold, executes hedges automatically
5. **Configuration Changes** → Persist to storage immediately

---

## Database Schema

### Table: `auto_hedge_configs`

```sql
CREATE TABLE auto_hedge_configs (
  portfolio_id INTEGER PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  risk_threshold INTEGER NOT NULL DEFAULT 5,      -- 1-10 scale
  max_leverage INTEGER NOT NULL DEFAULT 3,
  allowed_assets JSONB DEFAULT '[]',              -- Empty = all allowed
  risk_tolerance INTEGER DEFAULT 50,              -- 0-100 from on-chain
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Risk Threshold Mapping

| Risk Threshold | Strategy | Description |
|---------------|----------|-------------|
| 1-3 | **Aggressive** | Hedge at slightest downturn |
| 4-5 | **Moderate** | Standard protection (default) |
| 6-7 | **Conservative** | Only hedge significant risks |
| 8-10 | **Very Conservative** | Only hedge catastrophic risks |

---

## API Usage

### Enable Auto-Hedging for a Portfolio

```bash
curl -X POST https://zkvanguard.vercel.app/api/agents/auto-hedge \
  -H "Content-Type: application/json" \
  -d '{
    "action": "enable",
    "portfolioId": 3,
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "config": {
      "riskThreshold": 5,
      "maxLeverage": 3,
      "allowedAssets": ["BTC", "ETH", "CRO", "SUI"]
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Auto-hedging enabled for portfolio 3",
  "config": {
    "portfolioId": 3,
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "enabled": true,
    "riskThreshold": 5,
    "maxLeverage": 3,
    "allowedAssets": ["BTC", "ETH", "CRO", "SUI"],
    "createdAt": 1740470400000,
    "updatedAt": 1740470400000
  },
  "status": {
    "isRunning": true,
    "enabledPortfolios": [0, 3],
    "lastUpdate": 1740470400000
  }
}
```

### Check Status

```bash
curl https://zkvanguard.vercel.app/api/agents/auto-hedge
```

### Disable Auto-Hedging

```bash
curl -X POST https://zkvanguard.vercel.app/api/agents/auto-hedge \
  -H "Content-Type: application/json" \
  -d '{
    "action": "disable",
    "portfolioId": 3
  }'
```

### Delete Configuration (Hard Delete)

```bash
curl -X DELETE "https://zkvanguard.vercel.app/api/agents/auto-hedge?portfolioId=3"
```

---

## Deployment Guide

### Step 1: Run Database Migration

```bash
psql $DATABASE_URL -f scripts/database/auto-hedge-configs.sql
```

This creates:
- `auto_hedge_configs` table
- Indexes for efficient queries
- Default configurations for Portfolio #3 and CommunityPool

### Step 2: Verify Storage Layer

```typescript
// lib/storage/auto-hedge-storage.ts
import { getAutoHedgeConfigs } from '@/lib/storage/auto-hedge-storage';

const configs = await getAutoHedgeConfigs();
console.log('Loaded configs:', configs);
```

### Step 3: Deploy Application

```bash
npm run build
npx vercel --prod --yes
```

### Step 4: Verify Service Startup

Check logs after deployment:

```
[AutoHedging] Starting service...
[AutoHedging] Loading configurations from storage
[AutoHedging] Loaded configs from database: {count: 2, portfolios: [0, 3]}
[AutoHedging] Portfolio enabled with settings: {portfolioId: 0, riskThreshold: 4}
[AutoHedging] Portfolio enabled with settings: {portfolioId: 3, riskThreshold: 5}
[AutoHedging] All stored portfolios loaded: {activeCount: 2}
[AutoHedging] Service started
```

---

## Adding New Portfolios

### Option 1: Via API (Recommended)

```javascript
const response = await fetch('/api/agents/auto-hedge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'enable',
    portfolioId: 4,
    walletAddress: '0x...',
    config: {
      riskThreshold: 5,
      maxLeverage: 3,
      allowedAssets: ['BTC', 'ETH']
    }
  })
});
```

### Option 2: Direct Database Insert

```sql
INSERT INTO auto_hedge_configs (
  portfolio_id, wallet_address, enabled, 
  risk_threshold, max_leverage, allowed_assets
) VALUES (
  4, 
  '0x...', 
  true, 
  5, 
  3, 
  '["BTC", "ETH"]'::jsonb
);
```

**No code changes required!** Service will pick up new portfolio on next risk check cycle (60 seconds).

---

## Local Development

### File-Based Storage

When running locally without DATABASE_URL:

```bash
npm run dev
```

Configurations stored in: `deployments/auto-hedge-configs.json`

```json
[
  {
    "portfolioId": 3,
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "enabled": true,
    "riskThreshold": 5,
    "maxLeverage": 3,
    "allowedAssets": ["BTC", "ETH", "CRO", "SUI"],
    "createdAt": 1740470400000,
    "updatedAt": 1740470400000
  }
]
```

---

## Risk Tolerance Integration

The system automatically fetches `riskTolerance` (0-100) from on-chain portfolio settings and maps it to `riskThreshold` (1-10):

```typescript
// Lower tolerance = more aggressive hedging
const calculatedThreshold = Math.max(2, Math.min(10, 
  Math.floor((riskTolerance / 10) * 0.8 + 2)
));
```

**Example Mappings:**
- Risk Tolerance 0 → Threshold 2 (Very Aggressive)
- Risk Tolerance 50 → Threshold 5 (Moderate)
- Risk Tolerance 100 → Threshold 10 (Very Conservative)

---

## Monitoring & Diagnostics

### Check Current Configurations

```bash
curl https://zkvanguard.vercel.app/api/agents/auto-hedge
```

### View Database Configurations

```sql
SELECT * FROM active_auto_hedges;
```

Returns view with strategy classification:

```
portfolio_id | wallet_address | risk_threshold | hedge_strategy
-------------+----------------+----------------+----------------
     0       | 0x97F77f8...   |       4        | MODERATE
     3       | 0x742d35...    |       5        | MODERATE
```

### Trigger Manual Risk Assessment

```bash
curl -X POST https://zkvanguard.vercel.app/api/agents/auto-hedge \
  -H "Content-Type: application/json" \
  -d '{
    "action": "trigger_assessment",
    "portfolioId": 3,
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
  }'
```

---

## Migration from Hardcoded System

### Before (Hardcoded)

```typescript
// ❌ Old: Hardcoded in AutoHedgingService.ts
private enableDefaultPortfolios(): void {
  this.enableForPortfolio({
    portfolioId: 3,  // ← Hardcoded!
    walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    // ...
  });
}
```

### After (Dynamic)

```typescript
// ✅ New: Loaded from storage
private async loadPortfoliosFromStorage(): Promise<void> {
  const storedConfigs = await getAutoHedgeConfigs();
  for (const config of storedConfigs) {
    this.enableForPortfolio(config);
  }
}
```

### Migration Steps

1. **Run database migration** → Creates `auto_hedge_configs` table with initial data
2. **Deploy updated code** → Service loads from storage instead of hardcoded values
3. **Verify existing portfolios** → Portfolio #3 and CommunityPool automatically configured
4. **Add new portfolios via API** → No code changes needed

---

## Benefits

1. **Zero Hardcoding** - All configurations in database/storage
2. **Production-Ready** - Survives deployments and restarts
3. **Self-Service** - Users can enable hedging via API/UI
4. **Auditable** - All changes logged with timestamps
5. **Flexible** - Different risk settings per portfolio
6. **Scalable** - No code changes to add portfolios

---

## Troubleshooting

### Service Not Loading Portfolios

**Check:**
1. Database connection: `echo $DATABASE_URL`
2. Table exists: `\dt auto_hedge_configs`
3. Enabled portfolios: `SELECT * FROM auto_hedge_configs WHERE enabled = true`

### Portfolio Not Hedging

**Verify:**
1. Portfolio enabled: `GET /api/agents/auto-hedge?portfolioId=3`
2. Risk threshold: Lower threshold = more aggressive
3. Current risk score: `POST /api/agents/auto-hedge` with `action=trigger_assessment`

### Configuration Not Persisting

**Check:**
- Production: DATABASE_URL configured in Vercel
- Local: `deployments/auto-hedge-configs.json` exists and writable

---

## Related Files

- **Storage:** `lib/storage/auto-hedge-storage.ts`
- **Service:** `lib/services/AutoHedgingService.ts`
- **API:** `app/api/agents/auto-hedge/route.ts`
- **Schema:** `scripts/database/auto-hedge-configs.sql`

---

## Summary

The auto-hedge system is now **fully automatic and production-ready**:

✅ Any portfolio can be configured for AI hedging via API  
✅ No hardcoded values - all settings in database  
✅ Survives deployments and restarts  
✅ Integrates with on-chain risk tolerance  
✅ Real-time monitoring and execution  
✅ Self-service configuration for users  

**Next Steps:**
1. Run database migration
2. Deploy to production
3. Enable auto-hedging for portfolios via API
4. Monitor risk assessments and hedge execution
