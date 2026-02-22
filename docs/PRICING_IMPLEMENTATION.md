# Pricing Model Implementation

## Overview

This document describes the pricing model implementation for ZkVanguard, based on the PRD specifications.

## Subscription Tiers

| Tier | Price/Month | Price/Year | Target Audience | Portfolio Range |
|------|-------------|------------|-----------------|-----------------|
| **Free** | $0 | $0 | New users | <$10K |
| **Retail** | $99 | $990 | Crypto-native traders | <$100K |
| **Pro** | $499 | $4,990 | Family offices | $100K-$5M |
| **Institutional** | $2,499 | $24,990 | Hedge funds | >$5M |
| **Enterprise** | Custom | Custom | RWA platforms | $100M+ TVL |

### Tier Features

#### Free Trial
- 1 AI agent (Lead only)
- 2 ZK proofs per month
- Basic portfolio monitoring
- 1 hedge position max
- Community support

#### Retail ($99/mo)
- 3 AI agents (Lead, Risk, Hedging)
- 10 ZK proofs per month
- Basic hedging strategies
- 5 hedge positions max
- Email support

#### Pro ($499/mo)
- All 5 AI agents
- Unlimited ZK proofs
- Advanced hedging strategies
- 50 hedge positions max
- Priority support
- Advanced analytics

#### Institutional ($2,499/mo)
- All 5 AI agents
- Unlimited ZK proofs
- Advanced hedging strategies
- Unlimited hedge positions
- API access (1000 req/min)
- Dedicated support
- SLA guarantees

#### Enterprise (Custom)
- Full white-label solution
- Custom API rate limits
- Revenue share model
- Dedicated engineering support
- On-premise deployment optional

## On-Chain Fees

### Performance Fee (20% of Profits) - Industry Standard

**This fee is enforced on-chain via HedgeExecutorV2 smart contract.**

| Parameter | Value | Description |
|-----------|-------|-------------|
| **Fee Rate** | 20% | Industry standard "2 and 20" model |
| **Applied To** | Profits only | Never charged on losses |
| **High-Water Mark** | Yes | Users never pay twice on same gains |
| **Payout** | Contract admin | Deployer/treasury receives fees |

**How it works:**
1. User opens hedge with $1,000 collateral
2. Hedge closes with $200 profit (20% gain)
3. Platform takes 20% of profit: $40
4. User receives: $1,000 + $160 = $1,160 (net 16% gain)

**Smart Contract:** `contracts/core/HedgeExecutorV2.sol`
- `performanceFeeBps`: 2000 (20%)
- `accumulatedPerformanceFees`: Tracks fees for withdrawal
- `withdrawPerformanceFees(address)`: Admin function to claim

### Execution Fee (HedgeExecutor)
- **Fee Rate**: 10 bps (0.1%)
- **Max Fee Rate**: 100 bps (1%)
- **Minimum Collateral**: 1 USDC

### x402 Gasless
- **Fee Per Transaction**: 0.01 USDC
- Note: Fee is paid by the platform, not the user

### Oracle (Moonlander)
- **Fee Per Call**: 0.06 CRO

### SUI Protocol
- **Fee Rate**: 50 bps (0.5%)

## Implementation Files

### Configuration
- `lib/config/pricing.ts` - Centralized pricing configuration
- `lib/config/subscription-types.ts` - TypeScript types for subscriptions
- `lib/config/index.ts` - Module exports

### Utilities
- `lib/utils/fees.ts` - Fee calculation utilities

### API
- `app/api/pricing/route.ts` - Pricing API endpoint
  - `GET /api/pricing` - Get all pricing tiers and fees
  - `POST /api/pricing` - Get recommended tier based on portfolio value

### Components
- `components/PricingSection.tsx` - Pricing cards with billing toggle
- `components/FeeDisplay.tsx` - Fee breakdown display components

### Pages
- `app/pricing/page.tsx` - Public pricing page

## Usage Examples

### Get Pricing Config
```typescript
import { PRICING_TIERS, ON_CHAIN_FEES } from '@/lib/config/pricing';

// Get Pro tier details
const proTier = PRICING_TIERS.pro;
console.log(proTier.priceMonthly); // 499

// Get hedge fee rate
const feeRateBps = ON_CHAIN_FEES.hedgeExecutor.feeRateBps; // 10
```

### Calculate Fees
```typescript
import { calculateHedgeFeeBreakdown, estimateTotalHedgeCost } from '@/lib/utils/fees';

// Calculate hedge fee for $1000 collateral
const feeBreakdown = calculateHedgeFeeBreakdown(1000);
console.log(feeBreakdown.feeUsdc); // 1.0 (0.1% of 1000)

// Get total estimated cost
const totalCost = estimateTotalHedgeCost(1000, true);
console.log(totalCost.summary);
// "$1000.00 collateral - $1.0000 platform fee = $999.00 effective"
```

### Check Tier Limits
```typescript
import { 
  isAgentAvailable, 
  canCreateHedge, 
  getZkProofsRemaining 
} from '@/lib/config/pricing';

// Check if settlement agent is available for retail tier
const hasSettlement = isAgentAvailable('retail', 'settlement'); // false

// Check if user can create more hedges
const canHedge = canCreateHedge('retail', 3); // true (limit is 5)

// Check ZK proofs remaining
const remaining = getZkProofsRemaining('retail', 7); // 3
```

## API Response Examples

### GET /api/pricing
```json
{
  "success": true,
  "data": {
    "tiers": [
      {
        "tier": "pro",
        "name": "Pro",
        "monthlyPrice": "$499",
        "annualPrice": "$4,990",
        "features": ["All 5 AI agents", ...],
        "limits": {
          "agents": "All 5 AI agents",
          "zkProofs": "Unlimited",
          "hedging": "Advanced",
          "support": "Email"
        },
        "isPopular": true
      }
    ],
    "fees": {
      "hedge": {
        "rateBps": 10,
        "ratePercent": 0.1
      }
    }
  }
}
```

### POST /api/pricing
```json
// Request
{ "portfolioValue": 250000 }

// Response
{
  "success": true,
  "data": {
    "recommendedTier": "pro",
    "tierName": "Pro",
    "price": "$499",
    "reason": "Based on your portfolio value of $250,000, we recommend the Pro tier."
  }
}
```

## Integration with Smart Contracts

The on-chain fee values in `lib/config/pricing.ts` match the deployed smart contracts:

| Contract | Parameter | Value |
|----------|-----------|-------|
| HedgeExecutor.sol | `feeRateBps` | 10 (0.1%) |
| X402GaslessZKCommitmentVerifier.sol | `feePerCommitment` | 10000 (0.01 USDC) |
| rwa_manager.move (SUI) | `PROTOCOL_FEE_BPS` | 50 (0.5%) |

**Note**: When deploying to mainnet, ensure contract fee parameters match this configuration.
