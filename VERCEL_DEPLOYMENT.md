# Vercel Deployment Guide

## Environment Variables Setup

To deploy ZkVanguard to Vercel with full AI functionality, you need to configure the following environment variables in your Vercel project settings.

### Required Variables

Go to your Vercel project → Settings → Environment Variables and add:

#### 1. Crypto.com AI API Key (Required for AI features)
```
CRYPTOCOM_DEVELOPER_API_KEY=your_actual_api_key_here
```

**How to get it:**
1. Visit [Crypto.com Developers](https://crypto.com/developers)
2. Sign up / Log in to your developer account
3. Create a new API key
4. Copy the API key

**What it enables:**
- AI-powered portfolio analysis
- Natural language intent parsing
- Risk assessment algorithms
- Hedge strategy generation
- Advanced LLM-based chat

#### 2. Network Configuration
```
NEXT_PUBLIC_CRONOS_RPC_URL=https://evm-t3.cronos.org/
NEXT_PUBLIC_CHAIN_ID=338
```

#### 3. Optional: Other Integration APIs
```
NEXT_PUBLIC_MOONLANDER_API=your_moonlander_api_key
NEXT_PUBLIC_VVS_API=your_vvs_api_key
NEXT_PUBLIC_MCP_API=your_mcp_api_key
NEXT_PUBLIC_X402_API=your_x402_api_key
NEXT_PUBLIC_DELPHI_API=your_delphi_api_key
```

### Vercel Setup Steps

1. **Link your repository:**
   ```bash
   vercel link
   ```

2. **Set environment variables via CLI:**
   ```bash
   vercel env add CRYPTOCOM_DEVELOPER_API_KEY production
   # Paste your API key when prompted
   ```

3. **Or set via Vercel Dashboard:**
   - Navigate to: https://vercel.com/your-username/your-project/settings/environment-variables
   - Add each variable with:
     - **Key**: Variable name (e.g., `CRYPTOCOM_DEVELOPER_API_KEY`)
     - **Value**: Your actual key
     - **Environment**: Select all (Production, Preview, Development)

4. **Redeploy:**
   ```bash
   vercel --prod
   ```

### Verification

After deployment, check the logs:

```bash
vercel logs
```

You should see:
- ✅ `Crypto.com AI Agent SDK initialized successfully`
- ❌ NOT: `No Crypto.com AI API key found, using fallback LLM`

### Troubleshooting

**Problem**: Still seeing "No Crypto.com AI API key found"

**Solutions**:
1. **Check variable name**: Must be exactly `CRYPTOCOM_DEVELOPER_API_KEY` (no typos)
2. **Verify in Vercel Dashboard**: Settings → Environment Variables → Ensure it's set for Production
3. **Redeploy**: Changes to env vars require a new deployment
4. **Check .env.local**: For local testing, create `.env.local` with your key

**Problem**: API key works locally but not in Vercel

**Solution**: Vercel requires explicit environment variable configuration. Even if your `.env` file has the key, you must add it to Vercel's dashboard.

### Security Notes

- ⚠️ **Never commit API keys** to git
- ✅ Keys in Vercel are encrypted and secure
- ✅ Use `.env.local` for local development (already in `.gitignore`)
- ✅ The app gracefully falls back to mock data if keys are missing (for demos)

### Testing Locally Before Deploy

```bash
# Create .env.local file
echo "CRYPTOCOM_DEVELOPER_API_KEY=your_key_here" > .env.local

# Test the app
npm run dev

# Verify in browser console - should NOT see warning
```

### Production Checklist

- [ ] `CRYPTOCOM_DEVELOPER_API_KEY` set in Vercel
- [ ] Network RPCs configured
- [ ] Deployment successful
- [ ] No "fallback LLM" warnings in logs
- [ ] AI chat responds with real analysis
- [ ] Portfolio actions use actual AI intents

### Support

If you continue to have issues:
1. Check Vercel build logs: `vercel logs --follow`
2. Verify API key is valid at crypto.com/developers
3. Ensure key has necessary permissions
4. Contact Crypto.com developer support for API issues

---

**Quick Deploy:**
```bash
# After setting env vars in Vercel dashboard
git push origin main
# Vercel auto-deploys on push
```
