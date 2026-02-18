# 🚀 Quick Setup: Enable Auto-Management for Portfolio #3

## Current Status

**Portfolio #3:** $157,367,742.94 • FUNDED
**Last Rebalanced:** Feb 11, 2026, 11:39 AM
**Days Since Last Rebalance:** 7 days
**Auto-Management Status:** ❌ DISABLED

---

## ✅ Enable in 3 Steps (2 minutes)

### Step 1: Open Portfolio Settings (30 seconds)

1. Go to Dashboard: http://localhost:3000/dashboard
2. Find **Portfolio #3** in your list
3. Click on it to open details
4. Click the **"Settings"** tab at the top

### Step 2: Configure Auto-Rebalancing (30 seconds)

You'll see:
```
┌─────────────────────────────────────┐
│ Auto-Rebalance                  [ ] │ ← Toggle this ON
│ Automatically maintain target       │
│ allocations                         │
└─────────────────────────────────────┘

When enabled, shows:
┌─────────────────────────────────────┐
│ Rebalance Threshold: 5%             │
│ ────────●─────────────────────      │ ← Slide to adjust
│ Rebalance when allocation drifts    │
│ by 5%                               │
└─────────────────────────────────────┘
```

**Recommended Settings:**
- **Auto-Rebalance:** ON ✅
- **Threshold:** 5% (balanced) or 10% (conservative)

### Step 3: Save Changes (30 seconds)

Click **"Save Changes"** button

Expected response:
```
✅ Settings saved! Auto-rebalancing enabled for this portfolio.
```

### Step 4: Increase Auto-Approval Limit (1 minute, optional but recommended)

**Why?** Your portfolio is $157M, but default auto-approval limit is $50K. This means every rebalance will require manual approval.

**To enable full automation:**

```bash
# Copy this command and run in terminal
curl -X POST http://localhost:3000/api/agents/auto-rebalance?action=enable \
  -H "Content-Type: application/json" \
  -d '{
    "portfolioId": 3,
    "walletAddress": "YOUR_WALLET_ADDRESS_HERE",
    "config": {
      "threshold": 5,
      "frequency": "DAILY",
      "autoApprovalEnabled": true,
      "autoApprovalThreshold": 200000000
    }
  }'
```

Replace `YOUR_WALLET_ADDRESS_HERE` with your actual wallet address.

Expected response:
```json
{
  "success": true,
  "message": "Auto-rebalancing enabled for portfolio 3",
  "config": { ... },
  "status": {
    "running": true,
    "activePortfolios": 1
  }
}
```

---

## ✅ Verify It's Working

### Check 1: Service Status

```bash
curl http://localhost:3000/api/agents/auto-rebalance?action=status
```

Expected:
```json
{
  "success": true,
  "status": {
    "running": true,      ← Should be true
    "activePortfolios": 1  ← Should be 1 (Portfolio #3)
  }
}
```

### Check 2: Current Assessment

```bash
curl "http://localhost:3000/api/agents/auto-rebalance?action=assessment&portfolioId=3"
```

This shows current allocation drifts:
```json
{
  "success": true,
  "assessment": {
    "portfolioId": 3,
    "totalValue": 157367742.94,
    "requiresRebalance": false,  ← Will be true if drift > threshold
    "drifts": [
      {
        "asset": "BTC",
        "target": 35,
        "current": 34.5,
        "drift": -0.5,
        "driftPercent": 0.5,
        "shouldRebalance": false  ← Will be true when drift > 5%
      }
    ]
  }
}
```

### Check 3: Dashboard Indicator

Look for **"🤖 Auto-Managed"** badge on Portfolio #3 card in dashboard.

---

## 🎯 What Happens Next?

### Hour 1: First Check
```
Service checks Portfolio #3
Current allocations:
  BTC: 34.5% (target: 35%)  ← Drift: 0.5% ✅ OK
  ETH: 30.2% (target: 30%)  ← Drift: 0.2% ✅ OK
  CRO: 20.1% (target: 20%)  ← Drift: 0.1% ✅ OK
  SUI: 15.2% (target: 15%)  ← Drift: 0.2% ✅ OK

Result: No action needed (all drifts < 5%)
```

### Day 3: Market Moves BTC Up
```
Service checks Portfolio #3
Current allocations:
  BTC: 40.3% (target: 35%)  ← Drift: 5.3% 🎯 TRIGGER!
  ETH: 28.1% (target: 30%)  ← Drift: 1.9% ✅ OK
  CRO: 18.7% (target: 20%)  ← Drift: 1.3% ✅ OK
  SUI: 12.9% (target: 15%)  ← Drift: 2.1% ✅ OK

Result: Rebalance triggered!
Actions:
  - SELL $8.3M of BTC (reduce to 35%)
  - BUY $3.0M of ETH (increase to 30%)
  - BUY $2.0M of CRO (increase to 20%)
  - BUY $3.3M of SUI (increase to 15%)

Auto-approved: YES (portfolio value within threshold)
Executing...
```

### Day 3: Rebalance Complete
```
Transaction: 0x4a7f...2e19
Status: Success ✅
Gas paid by: Relayer (gasless for you)
ZK Proof: Generated and verified
New allocations:
  BTC: 35.0% ✅
  ETH: 30.0% ✅
  CRO: 20.0% ✅
  SUI: 15.0% ✅

Next check: 24 hours (cooldown period)
```

---

## 🔔 Notifications

You'll see rebalancing events in:

1. **Transaction History** tab
   ```
   rebalance (auto) • Feb 21, 2026, 3:45 PM
   $157,367,742.94 • Drift: 5.3%
   BTC: 40% → 35% • ETH: 28% → 30%
   View on Explorer →
   ```

2. **Dashboard** 
   ```
   Portfolio #3
   $157,367,742.94 • FUNDED
   🤖 Auto-Managed • Last rebalanced: 2 hours ago
   ```

3. **AI Chat** (if enabled)
   ```
   🤖 Portfolio #3 auto-rebalanced
   Allocation drift exceeded 5% threshold
   BTC reduced from 40% to 35%
   Transaction: 0x4a7f...2e19
   ```

---

## ⚙️ Advanced Configuration

### Change Rebalance Frequency

**Options:** HOURLY, DAILY (default), WEEKLY, MONTHLY

```bash
curl -X POST http://localhost:3000/api/agents/auto-rebalance?action=enable \
  -H "Content-Type: application/json" \
  -d '{
    "portfolioId": 3,
    "walletAddress": "0x...",
    "config": {
      "threshold": 5,
      "frequency": "WEEKLY",
      "autoApprovalEnabled": true,
      "autoApprovalThreshold": 200000000
    }
  }'
```

### Set Custom Target Allocations

```bash
curl -X POST http://localhost:3000/api/agents/auto-rebalance?action=enable \
  -H "Content-Type: application/json" \
  -d '{
    "portfolioId": 3,
    "walletAddress": "0x...",
    "config": {
      "threshold": 5,
      "frequency": "DAILY",
      "autoApprovalEnabled": true,
      "autoApprovalThreshold": 200000000,
      "targetAllocations": {
        "BTC": 40,
        "ETH": 30,
        "CRO": 20,
        "SUI": 10
      }
    }
  }'
```

### Disable Auto-Rebalancing

```bash
curl -X POST http://localhost:3000/api/agents/auto-rebalance?action=disable \
  -H "Content-Type: application/json" \
  -d '{"portfolioId": 3}'
```

---

## 🛡️ Safety Features

### 1. Cooldown Period
- **24 hours minimum** between rebalances
- Prevents over-trading
- Reduces transaction costs

### 2. Drift Threshold
- Only rebalances when drift > threshold (e.g., 5%)
- Avoids unnecessary small adjustments
- Configurable per portfolio

### 3. Cost Estimation
- Calculates gas + slippage before executing
- Cancels if cost > 1% of rebalance amount
- Logs all cost estimates

### 4. Auto-Approval Limit
- Only auto-approves if portfolio value < threshold
- Large portfolios require manual approval
- Configurable per portfolio

### 5. Manual Override
- Can disable anytime via dashboard
- Can manually trigger assessment
- Full transaction history

---

## 📊 Comparison: Before vs After

### Before (Manual Only)

```
Feb 11: You manually rebalanced
Feb 12: ...nothing...
Feb 13: ...nothing...
Feb 14: BTC drifts to 40% ⚠️ (you don't notice)
Feb 15: Still 40% ⚠️ (risk increasing)
Feb 16: Still 40% ⚠️
Feb 17: Still 40% ⚠️
Feb 18: YOU ASK: "Why isn't it auto-managed?"
```

**Result:** 7 days of unmanaged drift, increased risk

### After (Auto-Managed)

```
Feb 11: You manually rebalanced
Feb 12: Service monitors (drift < 5%, OK)
Feb 13: Service monitors (drift < 5%, OK)
Feb 14: Service monitors BTC: 40% → DRIFT 5% 🎯
Feb 14: Auto-rebalance triggered
Feb 14: Transaction executed (gasless)
Feb 14: Portfolio back to targets ✅
Feb 15: Service monitors (drift < 5%, cooldown)
Feb 16: Service monitors (drift < 5%, cooldown)
Feb 17: Service monitors (drift < 5%, cooldown)
Feb 18: Service monitors (ready for next rebalance if needed)
```

**Result:** Always maintained within 5% of target allocations

---

## 🎉 You're Done!

Your Portfolio #3 is now **fully auto-managed**! 

**What you enabled:**
- ✅ 24/7 monitoring
- ✅ Automatic drift detection
- ✅ Risk-aware rebalancing
- ✅ ZK-proven execution
- ✅ Gasless transactions
- ✅ Cost optimization
- ✅ Safety features

**No more manual management needed!** 🚀

---

## 📞 Support

**Check logs:**
```bash
tail -f logs/auto-rebalance.log
```

**Test immediately:**
```bash
curl -X POST http://localhost:3000/api/agents/auto-rebalance?action=trigger_assessment \
  -H "Content-Type: application/json" \
  -d '{"portfolioId": 3, "walletAddress": "0x..."}'
```

**Read full guide:**
[docs/AUTO_REBALANCE_GUIDE.md](AUTO_REBALANCE_GUIDE.md)
