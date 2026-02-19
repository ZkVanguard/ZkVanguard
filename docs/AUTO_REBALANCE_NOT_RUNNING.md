# Auto-Rebalance Not Running - Diagnostic Guide

## Issue
Portfolio #3 has auto-rebalance enabled but no automatic rebalancing has occurred since Feb 12, 2026 (7 days ago).

## Root Cause Analysis

### 1. Vercel Cron Configuration ✅
- **File**: `vercel.json` 
- **Schedule**: `0 0 * * *` (Daily at midnight UTC)
- **Endpoint**: `/api/cron/auto-rebalance`
- **Status**: Configured correctly

### 2. Auto-Rebalance Config ✅
- **File**: `deployments/auto-rebalance-configs.json`
- **Portfolio ID**: 3
- **Enabled**: `true`
- **Threshold**: 5% drift
- **Auto-Approval**: Enabled (up to $200M)
- **Status**: Configured correctly

### 3. Actual Problem ⚠️
**The Vercel cron job is NOT registered/running**

Evidence:
- No `deployments/rebalance-history.json` file exists
- Manually testing the endpoint requires Vercel authentication
- No execution logs in Vercel dashboard

### 4. Why This Happens
Vercel cron jobs are only registered when:
1. The `vercel.json` cron config is deployed to **PRODUCTION**
2. The deployment is assigned to your production domain
3. Vercel's cron scheduler picks up the configuration

## Solution Steps

### Step 1: Verify Cron Registration in Vercel

1. Go to: https://vercel.com/mrarejimmyzs-projects/zkvanguard/settings/crons
2. Check if you see `/api/cron/auto-rebalance` listed
3. If NOT listed → Cron is not registered (proceed to Step 2)
4. If listed → Check execution logs (Step 3)

### Step 2: Register the Cron Job

The cron should automatically register when deploying vercel.json, but if it's not showing:

**Option A: Re-deploy to Production**
```bash
git add vercel.json
git commit -m "trigger: re-register cron job"
git push origin main
```

**Option B: Use Vercel CLI**
```bash
vercel --prod
```

### Step 3: Check Cron Execution Logs

1. Go to: https://vercel.com/mrarejimmyzs-projects/zkvanguard/logs
2. Filter by: `/api/cron/auto-rebalance`
3. Look for executions around midnight UTC
4. Check for errors

### Step 4: Manual Test (After Fixing Protection)

```bash
npx tsx scripts/test-auto-rebalance-cron.ts --production
```

Note: This will fail with 401 if deployment protection is enabled (expected). Vercel's internal cron bypasses this.

### Step 5: Verify Auto-Rebalance Works

After cron is registered, wait for next execution (midnight UTC) or manually trigger:

```bash
# From Vercel Dashboard
Deployments → [Latest deployment] → More → Trigger Cron Job
```

## Expected Behavior

Once working:
1. Cron runs daily at midnight UTC (00:00)
2. Checks Portfolio #3 for drift > 5%
3. If drift detected:
   - Creates rebalance proposal
   - If value < $200M → Auto-executes
   - If value > $200M → Requires manual approval
4. Logs saved to `deployments/rebalance-history.json`

## Current Configuration Summary

```json
{
  "portfolioId": 3,
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "enabled": true,
  "threshold": 5,                    // Trigger on 5% drift
  "frequency": "DAILY",              // Check daily
  "autoApprovalEnabled": true,        // Auto-execute
 "autoApprovalThreshold": 200000000 // Up to $200M
}
```

## Checking Cron Status

### From Vercel Dashboard:
1. **Crons Page**: https://vercel.com/mrarejimmyzs-projects/zkvanguard/settings/crons
2. **Logs Page**: https://vercel.com/mrarejimmyzs-projects/zkvanguard/logs
3. **Filter logs**: `path: /api/cron/auto-rebalance`

### Expected Log Pattern:
```
[AutoRebalance Cron] Starting scheduled portfolio check
[AutoRebalance Cron] Processing 1 portfolios
[AutoRebalance Cron] Assessing portfolio 3
[AutoRebalance Cron] Portfolio 3 within threshold (drift: 2.45%)
```

## Next Steps

1. ✅ Check Vercel Dashboard → Settings → Crons
2. If not listed → Push latest code to production
3. Wait for next midnight UTC execution
4. Check `deployments/rebalance-history.json` file appears
5. Monitor logs for successful executions

## Troubleshooting

### If cron still doesn't appear:
- Verify you're on a paid Vercel plan (Hobby plan may have limitations)
- Check Project Settings → General → Framework Preset is "Next.js"
- Ensure `vercel.json` is in the root directory

### If cron appears but fails:
- Check logs for errors
- Verify CRON_SECRET environment variable is set
- Test endpoint manually with correct auth header

### If rebalancing doesn't execute:
- Portfolio might be within 5% threshold (no action needed)
- Check cooldown period (24 hours between rebalances)
- Verify wallet has sufficient gas

## Monitoring

Create a simple monitoring script:

```bash
# Check if cron has executed
ls -la deployments/rebalance-history.json

# View last execution
cat deployments/rebalance-history.json | jq '.["3"]'
```

## Contact Support

If issue persists after following these steps:
- Vercel Support: https://vercel.com/support
- Include: Project name, cron path, last deployment ID
