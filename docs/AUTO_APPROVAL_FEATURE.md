# 🤖 Auto-Approval Feature for AI Hedging

## Overview
The Auto-Approval feature enables the AI to autonomously execute hedge positions below a configurable threshold without requiring manual signature approval from the portfolio manager.

## How It Works

### 1. Portfolio Configuration
When creating a portfolio in `AdvancedPortfolioCreator`, users can enable auto-approval:

```typescript
{
  autoApprovalEnabled: true,
  autoApprovalThreshold: 10000, // $10K default
}
```

### 2. Hedge Execution Flow

#### **WITH Auto-Approval** (Hedge ≤ Threshold)
```
1. AI detects risk (RiskAgent monitoring)
2. HedgingAgent generates hedge recommendation
3. Notional value: $8,000 (below $10K threshold)
4. ✅ Hedge executes INSTANTLY via x402
5. No signature required
6. Logged to dashboard for transparency
```

#### **WITHOUT Auto-Approval** (Hedge > Threshold)
```
1. AI detects risk (RiskAgent monitoring)
2. HedgingAgent generates hedge recommendation
3. Notional value: $15,000 (above $10K threshold)
4. ActionApprovalModal opens
5. ⏸️ Manager reviews and signs ($0.00 gas)
6. Hedge executes after approval
```

### 3. Security Features

- **Threshold-Based**: Only hedges below threshold are auto-approved
- **Per-Portfolio Settings**: Each portfolio has independent auto-approval configuration
- **Full Transparency**: All auto-approved hedges logged with timestamp
- **On-Chain Verification**: Uses x402 gasless protocol with cryptographic verification
- **Emergency Override**: Auto-margin addition for CRITICAL risk (independent of approval)

## Configuration Options

### Preset Thresholds by Strategy

| Strategy      | Auto-Approval Threshold | Rationale                        |
|--------------|-------------------------|----------------------------------|
| Conservative | $5,000                  | Tight control, lower risk        |
| Balanced     | $10,000                 | Standard threshold (recommended) |
| Aggressive   | $25,000                 | Maximum autonomy for active management |

### Custom Threshold Range
- **Minimum**: $1,000
- **Maximum**: $50,000
- **Increments**: $1,000

## API Integration

### Request Format
```typescript
POST /api/agents/hedging/execute

{
  portfolioId: 123,
  asset: "BTC",
  side: "SHORT",
  notionalValue: 8000,
  leverage: 5,
  autoApprovalEnabled: true,
  autoApprovalThreshold: 10000,
  signature?: "0x..." // Optional if auto-approved
}
```

### Response Format
```typescript
{
  success: true,
  orderId: "hedge-1234567890",
  market: "BTC-USD-PERP",
  side: "SHORT",
  size: "0.1234",
  entryPrice: "65000",
  leverage: 5,
  txHash: "0xabc...",
  autoApproved: true, // ✅ Indicates auto-approval was used
  message: "✅ ON-CHAIN: Hedge executed successfully (auto-approved)"
}
```

## Implementation Details

### Files Modified

1. **`components/dashboard/AdvancedPortfolioCreator.tsx`**
   - Added `autoApprovalEnabled` and `autoApprovalThreshold` to `StrategyConfig`
   - UI controls with slider and info tooltips
   - Preset values for each strategy type

2. **`lib/services/portfolio-actions.ts`**
   - Added `portfolioSettings` to `PortfolioAction` interface
   - Created `checkAutoApproval()` helper function
   - Updated `execute-hedge` action logic

3. **`app/api/agents/hedging/execute/route.ts`**
   - Added auto-approval parameters to `HedgeExecutionRequest`
   - Signature validation logic with threshold check
   - Auto-approval flag in response

### Helper Function
```typescript
export function checkAutoApproval(
  action: PortfolioAction,
  portfolioSettings?: { 
    autoApprovalEnabled?: boolean; 
    autoApprovalThreshold?: number 
  }
): boolean {
  // Only hedge/rebalance actions support auto-approval
  if (!['execute-hedge', 'rebalance'].includes(action.type)) {
    return false;
  }

  // Check if enabled
  if (!portfolioSettings?.autoApprovalEnabled) {
    return false;
  }

  // Check value against threshold
  const hedgeValue = action.params?.notionalValue || 0;
  const threshold = portfolioSettings.autoApprovalThreshold || 10000;

  return hedgeValue > 0 && hedgeValue <= threshold;
}
```

## UI Components

### Auto-Approval Toggle
- Appears only when "Enable AI Hedging" is checked
- Green color scheme (#34C759) to indicate automation
- Info tooltips explain functionality
- Slider control for threshold adjustment

### Status Indicator
When auto-approval is enabled, shows:
```
✅ Auto-Approval Active
Hedges ≤ $10K execute instantly.
Hedges > $10K require signature.
```

## Testing

### Manual Test Scenarios

**Scenario 1: Below Threshold (Auto-Approved)**
```bash
curl -X POST http://localhost:3000/api/agents/hedging/execute \
  -H "Content-Type: application/json" \
  -d '{
    "portfolioId": 1,
    "asset": "BTC",
    "side": "SHORT",
    "notionalValue": 5000,
    "leverage": 5,
    "autoApprovalEnabled": true,
    "autoApprovalThreshold": 10000
  }'

# Expected: Executes instantly without signature
```

**Scenario 2: Above Threshold (Requires Signature)**
```bash
curl -X POST http://localhost:3000/api/agents/hedging/execute \
  -H "Content-Type: application/json" \
  -d '{
    "portfolioId": 1,
    "asset": "BTC",
    "side": "SHORT",
    "notionalValue": 15000,
    "leverage": 5,
    "autoApprovalEnabled": true,
    "autoApprovalThreshold": 10000
  }'

# Expected: Returns 403 error requiring signature
```

## Benefits

### For Users
- ⚡ **Instant Protection**: Critical hedges execute immediately during volatile markets
- 🎯 **Hands-Off Management**: AI manages small hedges autonomously
- 🔐 **Maintained Control**: Large hedges still require approval
- 📊 **Full Visibility**: All actions logged and reviewable

### For Performance
- 🚀 **Faster Response**: No waiting for manual approval on small hedges
- 📈 **Better Risk Management**: AI can react to market conditions in real-time
- 💰 **Optimized Execution**: Capture optimal entry prices without delay

## Future Enhancements

1. **Time-Based Rules**: Auto-approve only during market hours
2. **Velocity Limits**: Max hedges per hour/day
3. **Machine Learning**: Dynamic threshold adjustment based on market conditions
4. **Multi-Sig Support**: Require multiple approvals for large hedges
5. **Notification System**: Push notifications for all auto-approved actions

## Security Considerations

- ✅ Threshold limits prevent runaway execution
- ✅ Per-portfolio configuration prevents cross-contamination
- ✅ All transactions logged on-chain via x402
- ✅ ZK proofs generated for privacy-preserving mode
- ✅ Emergency shutdown via portfolio settings
- ✅ Audit trail for compliance

## Compliance

This feature maintains full compliance with:
- On-chain transaction verification
- Cryptographic proof generation
- Immutable audit logs
- Privacy protection (ZK-STARK optional)
- x402 gasless protocol standards

---

**Implementation Date**: January 18, 2026  
**Status**: ✅ LIVE - Ready for testing  
**Hackathon**: Cronos x402 Paytech (Deadline: Jan 23, 2026)
