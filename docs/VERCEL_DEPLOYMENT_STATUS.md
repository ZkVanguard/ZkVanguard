# 🚀 Vercel Deployment Guide - Complete Setup

## ✅ Prerequisites Completed

- [x] Vercel CLI installed
- [x] Logged into Vercel
- [x] Project linked to GitHub
- [x] Cron schedule updated to daily (FREE tier compatible)

---

## 🔧 Current Status

**Cron Schedule:** Daily at midnight (0 0 * * *)  
**Reason:** Vercel FREE (Hobby) tier only supports daily cron jobs  
**Trade-off:** Auto-rebalancing runs once per day instead of hourly

**For hourly checks:** Upgrade to Vercel Pro ($20/month) or use:
- GitHub Actions (FREE 2,000 min/month)
- cron-job.org (FREE unlimited)
- Railway with cron (FREE $5 credit/month)

---

## 📦 Deployment Options

### Option 1: GitHub Integration (RECOMMENDED for OneDrive folder)

**Best for:** Projects in OneDrive/synced folders (avoids file lock issues)

1. **Push code to GitHub:**
   ```bash
   git add .
   git commit -m "feat: configure daily cron for FREE tier"
   git push origin main
   ```

2. **Connect to Vercel Dashboard:**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository
   - Configure environment variables (see below)
   - Deploy

3. **Result:** Auto-deploys on every push to `main` ✅

---

### Option 2: Vercel CLI (Direct Deploy)

**Issue:** OneDrive file sync causes build permission errors

**Workaround:**
```bash
# Disable OneDrive sync temporarily
# Or move project outside OneDrive folder

# Clean build directory
Remove-Item -Path .next -Recurse -Force -ErrorAction SilentlyContinue

# Deploy
npx vercel --prod
```

---

## 🔐 Required Environment Variables

Add these in Vercel Dashboard → Settings → Environment Variables:

### Critical (Required)
```bash
CRON_SECRET=t6S3TiI72kNjcOpxGFwsP9XBRhZVlYJg
DATABASE_URL=postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
PRIVATE_KEY=0x7af57dd2889cb16393ff945b87a8ce670aea2950179c425a572059017636b18d
SERVER_PRIVATE_KEY=0x7af57dd2889cb16393ff945b87a8ce670aea2950179c425a572059017636b18d
```

### Optional (Enhanced Features)
```bash
# API Keys (all FREE - request via Discord)
CRYPTOCOM_DEVELOPER_API_KEY=your_key_here
NEXT_PUBLIC_VVS_QUOTE_API_CLIENT_ID=aa61e2fabe044fe0ade417e6dfded51a
ASI_API_KEY=sk_73f324e50d4b4543867fb53d482c8917a14df40abbe14fcf9f5800e3b892b197

# Ollama AI (local only - not needed on Vercel)
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=qwen2.5:7b

# Moonlander (simulation mode works without this)
# MOONLANDER_PRIVATE_KEY=0x7af57dd2889cb16393ff945b87a8ce670aea2950179c425a572059017636b18d

# RPCs
NEXT_PUBLIC_CRONOS_TESTNET_RPC=https://evm-t3.cronos.org
```

---

## ✅ Quick Setup via Vercel CLI

```bash
# Add environment variables
npx vercel env add CRON_SECRET production
# Paste: t6S3TiI72kNjcOpxGFwsP9XBRhZVlYJg

npx vercel env add DATABASE_URL production
# Paste your Neon PostgreSQL URL

npx vercel env add PRIVATE_KEY production
# Paste your wallet private key

npx vercel env add SERVER_PRIVATE_KEY production
# Paste same as PRIVATE_KEY
```

---

## 🎯 Verification Steps

### 1. Check Deployment
- Visit: https://vercel.com/dashboard
- Find your project
- Check latest deployment status

### 2. Test Cron Endpoint Manually
```bash
curl -X POST https://your-app.vercel.app/api/cron/auto-rebalance \
  -H "Authorization: Bearer t6S3TiI72kNjcOpxGFwsP9XBRhZVlYJg"
```

Expected response:
```json
{
  "success": true,
  "summary": {
    "checked": 1,
    "rebalanced": 0,
    "total": 1
  }
}
```

### 3. Verify Cron Job in Dashboard
- Settings → Cron Jobs
- Should show: `/api/cron/auto-rebalance` running daily at 00:00 UTC

### 4. Check Logs
- Deployments → Latest → Functions
- Look for cron execution logs

---

## 🚨 Troubleshooting

### Build Failed: EPERM Error
**Cause:** OneDrive file sync locking .next directory

**Solutions:**
1. Deploy via GitHub integration (RECOMMENDED)
2. Move project outside OneDrive folder
3. Temporarily disable OneDrive sync

### Cron Error: "Hobby accounts limited to daily"
**Cause:** Hourly cron schedule (0 * * * *)

**Solution:** Already fixed! Updated to daily (0 0 * * *)

### Environment Variables Not Working
**Check:**
1. Added to all environments (production, preview, development)
2. Redeployed after adding variables
3. No typos in variable names

---

## 💰 Cost Summary

| Service | FREE Tier | Cost |
|---------|-----------|------|
| Vercel Hosting | 100GB bandwidth | $0 |
| Vercel Cron | Daily | $0 |
| Neon PostgreSQL | 0.5GB | $0 |
| On-chain gas | ~0.1 CRO/tx | ~$0.01-0.50/month |
| **TOTAL** | | **$0-2/month** |

**To enable hourly cron:**
- Vercel Pro: $20/month
- OR use FREE alternatives (GitHub Actions, cron-job.org)

---

## 📈 Next Steps

1. ✅ Deploy via GitHub integration
2. ✅ Add environment variables in Vercel dashboard
3. ✅ Enable Portfolio #3 auto-rebalancing (see QUICK_SETUP_AUTO_REBALANCE.md)
4. ✅ Monitor in Vercel dashboard
5. ⚠️ Optional: Setup FREE monitoring (Sentry, UptimeRobot) - see FREE_SERVICES_GUIDE.md

---

## 🔗 Useful Links

- [Vercel Dashboard](https://vercel.com/dashboard)
- [Vercel Cron Docs](https://vercel.com/docs/cron-jobs)
- [GitHub Integration Guide](https://vercel.com/docs/git/vercel-for-github)
- [Environment Variables](https://vercel.com/docs/projects/environment-variables)

---

**Status:** Ready for production deployment! 🚀  
**Cost:** $0-2/month  
**Uptime:** 24/7 automated
