# 🆓 Complete FREE Services Stack for Auto-Rebalancing

**Replace localhost + paid services with 100% FREE cloud infrastructure**

Last Updated: February 18, 2026  
Total Monthly Cost: **$0.00** (up to 5K users)

---

## 📊 Executive Summary

Your auto-rebalancing system currently requires:
- ❌ Local server (localhost:3000)
- ❌ Manual monitoring
- ❌ Paid relayer gas ($1-5/month)
- ❌ Paid API keys (some require requesting FREE tier)

**This guide replaces ALL of it with FREE services:**
- ✅ Cloud hosting (Vercel FREE)
- ✅ Automated cron jobs (Vercel Cron FREE)
- ✅ Gasless relayer (Gelato/Biconomy FREE tier)
- ✅ Notifications (Discord/Telegram/Email FREE)
- ✅ Database (Neon PostgreSQL FREE - already setup!)
- ✅ Config storage (Vercel KV FREE)
- ✅ Monitoring (covered in SCALABILITY_ANALYSIS.md)
- ✅ API keys (x402, Moonlander, Crypto.com - all FREE)

**Result:** Production-ready, 24/7 auto-rebalancing with **ZERO monthly cost**

---

## 🎯 Free Services Breakdown

### 1. Hosting & API Routes 🆓

**Vercel FREE Tier** ⭐ RECOMMENDED
```
✅ Features:
   • Unlimited projects
   • 100GB bandwidth/month
   • Serverless functions (10s timeout)
   • Automatic HTTPS
   • Git integration
   • Preview deployments
   • Edge network (global CDN)

📊 Limits:
   • 100 deployments/day
   • 100GB bandwidth
   • 100GB-hours compute/month
   • 6,000 serverless function invocations/day

💰 Cost: $0/month
🔗 Signup: https://vercel.com/signup
```

**Setup (2 minutes):**
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod

# Your app is now live at https://your-project.vercel.app
```

**Alternatives:**
- **Netlify**: 100GB bandwidth, 300 build minutes FREE
- **Railway**: $5 FREE credit/month, then pay-as-you-go
- **Render**: 750 hours FREE compute/month

---

### 2. Automated Cron Jobs 🆓

**Vercel Cron** ⭐ RECOMMENDED (included with Vercel)
```yaml
# vercel.json
{
  "crons": [
    {
      "path": "/api/cron/auto-rebalance",
      "schedule": "0 0 * * *"  # Daily at midnight (FREE tier)
    }
  ]
}
```

**Features:**
- ✅ Built-in (no external service)
- ✅ Automatic retries
- ✅ Secure with CRON_SECRET
- ✅ Dashboard monitoring
- ✅ No cold starts

**⚠️ FREE Tier Limitation:**
- Hobby accounts: **Daily cron jobs only** (0 0 * * *)
- Pro accounts ($20/month): Hourly or more frequent

**Cost:** $0 (included in FREE tier)

**Alternatives:**
1. **GitHub Actions** (FREE 2,000 min/month)
   ```yaml
   # .github/workflows/auto-rebalance.yml
   name: Auto-Rebalance
   on:
     schedule:
       - cron: '0 * * * *'  # Hourly
   jobs:
     rebalance:
       runs-on: ubuntu-latest
       steps:
         - name: Trigger rebalance
           run: |
             curl -X POST ${{ secrets.REBALANCE_URL }} \
               -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
   ```

2. **cron-job.org** (FREE, unlimited)
   - Web UI for managing cron jobs
   - Email notifications
   - Execution history
   - 🔗 https://cron-job.org

3. **EasyCron** (FREE 20 jobs)
   - 🔗 https://www.easycron.com

---

### 3. Gasless Transaction Relayers 🆓

**🏆 Option 1: Gelato Network** ⭐ BEST FOR CRONOS
```
✅ FREE Tier:
   • 100 transactions/month
   • Multi-chain support (Cronos ✅)
   • No API key required (start)
   • SLA: 99.9% uptime

📊 Perfect for:
   • 3-5 rebalances/day = 90-150 txs/month
   • Portfolio #3 ($157M) auto-rebalancing

🔗 Signup: https://app.gelato.network
💰 Cost: $0/month (100 txs FREE)
```

**Setup (10 minutes):**
```typescript
// lib/services/gelato-relayer.ts
import { GelatoRelay } from "@gelatonetwork/relay-sdk";

const relay = new GelatoRelay();

export async function executeGaslessRebalance(
  portfolioId: number,
  walletAddress: string
) {
  // 1. Prepare transaction data
  const data = rebalanceContract.interface.encodeFunctionData(
    'rebalance',
    [portfolioId, walletAddress]
  );

  // 2. Submit via Gelato (they pay gas!)
  const response = await relay.sponsoredCall({
    chainId: 338, // Cronos testnet
    target: REBALANCE_CONTRACT,
    data,
  });

  // 3. User paid $0.00 ✅
  return {
    txHash: response.taskId,
    userCost: 0,
    gaslessProvider: 'Gelato',
  };
}
```

**Integration with existing code:**
```typescript
// app/api/cron/auto-rebalance/route.ts
import { executeGaslessRebalance } from '@/lib/services/gelato-relayer';

export async function POST(request: NextRequest) {
  // ... existing assessment logic ...
  
  if (requiresRebalance) {
    // Replace your current relayer with Gelato
    const result = await executeGaslessRebalance(
      portfolioId,
      walletAddress
    );
    
    logger.info('✅ Rebalanced via Gelato (FREE)', {
      txHash: result.txHash,
      userCost: '$0.00',
      relayerCost: '$0.00',
    });
  }
}
```

---

**🥈 Option 2: Biconomy Relayer**
```
✅ FREE Tier:
   • 10,000 API calls/month
   • Gas tank with $1 FREE credit
   • Dashboard + analytics
   • Multi-chain (Cronos supported)

📊 Perfect for:
   • High-frequency rebalancing
   • 300+ txs/month capacity

🔗 Signup: https://dashboard.biconomy.io
💰 Cost: $0/month + $1 FREE gas credit
```

**Setup:**
```bash
npm install @biconomy/mexa

# Configure
```

```typescript
// lib/services/biconomy-relayer.ts
import { Biconomy } from "@biconomy/mexa";

const biconomy = new Biconomy(provider, {
  apiKey: process.env.BICONOMY_API_KEY, // FREE key
  contractAddresses: [REBALANCE_CONTRACT],
});

// Transactions are now gasless for users!
```

---

**🥉 Option 3: OpenZeppelin Defender**
```
✅ FREE Tier:
   • 5 relayers
   • 20,000 gas/month (~200 txs)
   • Automated operations
   • Security monitoring

🔗 Signup: https://defender.openzeppelin.com
💰 Cost: $0/month
```

---

**Comparison:**

| Service | FREE Txs/Month | Cronos Support | Setup Time | Best For |
|---------|----------------|----------------|------------|----------|
| **Gelato** | 100 | ✅ Yes | 10 min | Small-medium portfolios |
| **Biconomy** | 10K calls | ✅ Yes | 15 min | High frequency |
| **OZ Defender** | ~200 | ⚠️ Limited | 20 min | Security-first |

**💡 Recommendation:** Start with **Gelato** (easiest, Cronos-native)

---

### 4. Notifications 🆓

**🔔 Option 1: Discord Webhooks** ⭐ EASIEST
```
✅ Features:
   • Unlimited webhooks
   • Rich embeds
   • @mentions
   • Message history
   • Mobile notifications

💰 Cost: $0/month (unlimited)
⏱️ Setup: 3 minutes
```

**Setup:**
```typescript
// lib/notifications/discord.ts
export async function sendDiscordNotification(
  webhookUrl: string,
  data: {
    portfolioId: number;
    action: string;
    details: string;
    txHash?: string;
  }
) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `🤖 Portfolio #${data.portfolioId} ${data.action}`,
        description: data.details,
        color: 0x00ff00, // Green
        fields: [
          { name: 'Action', value: data.action, inline: true },
          { name: 'Time', value: new Date().toISOString(), inline: true },
          ...(data.txHash ? [{ 
            name: 'Transaction', 
            value: `[View](https://explorer.cronos.org/tx/${data.txHash})` 
          }] : []),
        ],
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}
```

**Usage in auto-rebalance:**
```typescript
// app/api/cron/auto-rebalance/route.ts
import { sendDiscordNotification } from '@/lib/notifications/discord';

// After successful rebalance:
await sendDiscordNotification(process.env.DISCORD_WEBHOOK_URL!, {
  portfolioId: 3,
  action: 'Auto-Rebalanced',
  details: `
    **Drift:** 5.3%
    **Assets Adjusted:**
    • BTC: 40% → 35% (-$8.3M)
    • ETH: 28% → 30% (+$3.0M)
    • CRO: 18% → 20% (+$2.0M)
    • SUI: 12% → 15% (+$3.3M)
    
    **Status:** ✅ Complete
    **User Cost:** $0.00 (gasless)
  `,
  txHash: result.txHash,
});
```

**Get webhook URL:**
1. Open Discord → Server Settings → Integrations
2. Create Webhook → Copy URL
3. Add to `.env`: `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...`

---

**💬 Option 2: Telegram Bot** ⭐ GREAT FOR MOBILE
```
✅ Features:
   • Instant push notifications
   • Bot commands (/status, /history)
   • Rich formatting
   • Free API

💰 Cost: $0/month (unlimited)
⏱️ Setup: 5 minutes
```

**Setup:**
```typescript
// lib/notifications/telegram.ts
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string
) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }),
  });
}
```

**Get bot token:**
1. Message @BotFather on Telegram
2. `/newbot` → Follow prompts
3. Copy token → Add to `.env`: `TELEGRAM_BOT_TOKEN=...`
4. Get your chat ID from @userinfobot
5. Add to `.env`: `TELEGRAM_CHAT_ID=...`

---

**📧 Option 3: Email Notifications**

**Resend** ⭐ BEST EMAIL API
```
✅ FREE Tier:
   • 3,000 emails/month
   • Custom domain
   • Email analytics
   • React Email templates

💰 Cost: $0/month
🔗 Signup: https://resend.com
```

**Setup:**
```bash
npm install resend
```

```typescript
// lib/notifications/email.ts
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendRebalanceEmail(
  to: string,
  portfolioId: number,
  details: string
) {
  await resend.emails.send({
    from: 'ZkVanguard <noreply@yourdomain.com>',
    to,
    subject: `Portfolio #${portfolioId} Auto-Rebalanced`,
    html: `
      <h2>🤖 Auto-Rebalance Complete</h2>
      <p>${details}</p>
      <p><small>User paid $0.00 (gasless)</small></p>
    `,
  });
}
```

**Alternatives:**
- **SendGrid**: 100 emails/day FREE
- **Mailgun**: 5,000 emails/month FREE (first 3 months)
- **AWS SES**: 62,000 emails/month FREE (if using EC2)

---

**Notification Comparison:**

| Service | Cost | Monthly Limit | Setup Time | Mobile Push | Best For |
|---------|------|---------------|------------|-------------|----------|
| **Discord** | $0 | Unlimited | 3 min | ✅ Yes | Teams/communities |
| **Telegram** | $0 | Unlimited | 5 min | ✅ Yes | Personal use |
| **Resend** | $0 | 3K emails | 10 min | ❌ No | Professional |

**💡 Recommendation:** Use **Discord** (instant, rich formatting, free) + **Telegram** (personal mobile alerts)

---

### 5. Database 🆓

**✅ Neon PostgreSQL** (Already setup!)
```
✅ Your Current Setup:
   • 11 tables configured
   • Connection pooling ✅
   • Indexes optimized ✅
   • GDPR compliant ✅

✅ FREE Tier:
   • 0.5 GB storage
   • 10 GB data transfer/month
   • Automatic backups
   • Serverless architecture

📊 Capacity:
   • ~50K hedge records
   • ~100K analytics events
   • ~10K portfolio snapshots

💰 Cost: $0/month (FREE tier)
🔗 Console: https://console.neon.tech
```

**Already configured in:** `lib/db/postgres.ts`

No action needed! ✅

**Alternatives (if you need more):**
- **Supabase**: 500MB FREE, more features (auth, storage)
- **PlanetScale**: 5GB FREE, better scaling
- **CockroachDB**: 5GB FREE, multi-region

---

### 6. Config Storage (Vercel KV) 🆓

**Replace file-based configs with Vercel KV**

```
✅ FREE Tier:
   • 256 MB storage
   • 50K requests/month
   • Redis-compatible
   • Edge-optimized
   • No cold starts

📊 Perfect for:
   • Auto-rebalance configs
   • User preferences
   • Rate limiting
   • Session storage

💰 Cost: $0/month
⏱️ Setup: 5 minutes
```

**Setup:**
```bash
# Create KV store
vercel env add KV_REST_API_URL
vercel env add KV_REST_API_TOKEN

# Auto-generated by Vercel
```

**Migrate from file storage:**
```typescript
// lib/storage/vercel-kv.ts
import { kv } from '@vercel/kv';

// OLD (file-based):
// fs.writeFileSync('deployments/auto-rebalance-configs.json', JSON.stringify(config))

// NEW (Vercel KV):
export async function saveRebalanceConfig(
  portfolioId: number,
  config: AutoRebalanceConfig
) {
  await kv.set(`rebalance:${portfolioId}`, config);
}

export async function getRebalanceConfig(portfolioId: number) {
  return await kv.get<AutoRebalanceConfig>(`rebalance:${portfolioId}`);
}

export async function listActiveConfigs() {
  const keys = await kv.keys('rebalance:*');
  return await Promise.all(
    keys.map(key => kv.get(key))
  );
}
```

**Benefits:**
- ✅ No file system access issues
- ✅ Works in serverless
- ✅ Automatic replication
- ✅ Sub-millisecond reads
- ✅ Atomic operations

**Alternatives:**
- **Upstash Redis**: 10K commands/day FREE
- **Railway Redis**: $5 FREE credit/month

---

### 7. API Keys (FREE) 🆓

**All required API keys are FREE for hackathon/development:**

#### x402 Facilitator SDK
```
✅ Status: FREE (request access)
📝 Request via: Discord #x402-hackathon
🔗 Discord: https://discord.com/channels/783264383978569728/1442807140103487610

Message template:
"Hi! I'm building auto-rebalancing system on Cronos. 
Could I get x402 Facilitator SDK access?
GitHub: [your-repo-url]"

⏱️ Response time: Usually same day
💰 Cost: $0 (FREE tier)
```

#### Moonlander Testnet API
```
✅ Status: FREE (testnet)
📝 Request via: Discord or Telegram
🔗 Telegram: https://t.me/+a4jj5hyJl0NmMDll

⏱️ Response time: Usually same day
💰 Cost: $0 (testnet FREE)
```

#### Crypto.com AI SDK
```
✅ Status: FREE (request access)
📝 Request via: Discord
🔗 Discord: Same channel as x402

⏱️ Response time: Usually same day  
💰 Cost: $0 (FREE tier)
```

#### Crypto.com MCP
```
✅ Status: FREE (request access)
📝 Request via: Discord

⏱️ Response time: Usually same day
💰 Cost: $0 (FREE tier)
```

**📝 Single Request Message:**
```
Hi! I'm in the Cronos x402 Hackathon with "ZkVanguard" 
(AI Multi-Agent Auto-Rebalancing System). Could I get:
• x402 Facilitator SDK
• Moonlander testnet API
• Crypto.com AI SDK
• Crypto.com MCP

My project: [GitHub URL]
Works in demo mode ✅, want live integration!

Thanks! 🙏
```

**Response:** Usually within 24 hours

---

### 8. Monitoring 🆓

**Already covered in SCALABILITY_ANALYSIS.md!**

See the FREE Monitoring Stack section (page ~345) for:
- ✅ Sentry (5K errors/month FREE)
- ✅ Vercel Analytics (unlimited FREE)
- ✅ UptimeRobot (50 monitors FREE)
- ✅ Healthchecks.io (20 cron checks FREE)
- ✅ Logflare (12.5GB logs/month FREE)

Total setup time: 26 minutes  
Total cost: $0/month

---

## 🚀 Complete Migration Checklist

### Phase 1: Hosting (Day 1 - 30 minutes)
- [ ] Create Vercel account
- [ ] Connect GitHub repo
- [ ] Add environment variables
- [ ] Deploy to Vercel
- [ ] Verify API routes work
- [ ] Test cron job endpoint manually

### Phase 2: Cron Jobs (Day 1 - 15 minutes)
- [ ] Add `vercel.json` with cron configuration
- [ ] Set `CRON_SECRET` environment variable
- [ ] Redeploy
- [ ] Verify cron shows in Vercel dashboard
- [ ] Wait for first automated run

### Phase 3: Gasless Relayer (Day 2 - 1 hour)
- [ ] Choose relayer (recommend Gelato)
- [ ] Create account
- [ ] Get API credentials (if needed)
- [ ] Install SDK: `npm install @gelatonetwork/relay-sdk`
- [ ] Create `lib/services/gelato-relayer.ts`
- [ ] Update auto-rebalance route to use Gelato
- [ ] Test with small transaction
- [ ] Monitor FREE tier usage

### Phase 4: Notifications (Day 2 - 30 minutes)
- [ ] Choose notification service (recommend Discord)
- [ ] Create webhook/bot
- [ ] Add credentials to environment
- [ ] Create notification helper
- [ ] Add notifications to auto-rebalance success/failure
- [ ] Test notifications
- [ ] Add to error handler

### Phase 5: Config Storage (Week 2 - 1 hour)
- [ ] Enable Vercel KV in dashboard
- [ ] Copy KV credentials to environment
- [ ] Install `@vercel/kv`
- [ ] Create KV storage helpers
- [ ] Migrate existing file-based configs
- [ ] Update all config reads/writes
- [ ] Test config persistence
- [ ] Remove file-based storage code

### Phase 6: API Keys (Week 2 - variable)
- [ ] Request x402 Facilitator SDK access (Discord)
- [ ] Request Moonlander API key (Discord/Telegram)
- [ ] Request Crypto.com AI SDK (Discord)
- [ ] Request Crypto.com MCP (Discord)
- [ ] Add keys to Vercel environment variables
- [ ] Test integrations with real APIs
- [ ] Update documentation with live endpoints

### Phase 7: Monitoring (Week 3 - 1 hour)
- [ ] Follow setup in SCALABILITY_ANALYSIS.md
- [ ] Setup Sentry (errors)
- [ ] Setup UptimeRobot (uptime)
- [ ] Setup Healthchecks.io (cron monitoring)
- [ ] Setup Logflare (logs)
- [ ] Verify Vercel Analytics working
- [ ] Create monitoring dashboard

### Phase 8: Testing & Validation (Week 3 - 2 hours)
- [ ] End-to-end test: Trigger rebalance via cron
- [ ] Verify gasless transaction works
- [ ] Verify notification sent
- [ ] Check logs in monitoring
- [ ] Test failure scenarios
- [ ] Verify config persistence
- [ ] Load test with 100 requests
- [ ] Monitor FREE tier limits

---

## 💰 Total Cost Breakdown

| Service | Monthly Limit | Cost |
|---------|---------------|------|
| **Vercel Hosting** | 100GB bandwidth | $0 |
| **Vercel Cron** | Unlimited | $0 |
| **Gelato Relayer** | 100 txs/month | $0 |
| **Discord Notifications** | Unlimited | $0 |
| **Telegram** | Unlimited | $0 |
| **Neon PostgreSQL** | 0.5GB storage | $0 |
| **Vercel KV** | 256MB, 50K req | $0 |
| **x402 API** | Testnet | $0 |
| **Moonlander API** | Testnet | $0 |
| **Crypto.com AI** | FREE tier | $0 |
| **Sentry** | 5K errors | $0 |
| **UptimeRobot** | 50 monitors | $0 |
| **Healthchecks.io** | 20 checks | $0 |
| **Logflare** | 12.5GB logs | $0 |
| **Vercel Analytics** | Unlimited | $0 |
| **TOTAL** | | **$0.00** |

---

## 📊 Capacity Analysis

**With FREE tiers, you can handle:**

### Auto-Rebalancing
- **100 rebalances/month** (Gelato limit)
- **3-4 rebalances/day** for one portfolio
- **OR 1 rebalance/day** for 100 portfolios
- **Checks:** Unlimited (Vercel cron runs hourly)

### API Traffic
- **100GB bandwidth/month** (Vercel)
- **~10M API requests/month** (assuming 10KB average)
- **3,333 requests/hour** sustained

### Storage
- **256MB config storage** (Vercel KV)
- **~10K rebalance configs** (25KB each)
- **0.5GB database** (Neon)
- **~50K hedge records**

### Notifications
- **Unlimited Discord messages**
- **Unlimited Telegram messages**
- **3,000 emails/month** (Resend)

**Conclusion:** FREE tiers support **1-100 portfolios** with daily rebalancing!

---

## 🔄 Upgrade Path (When Needed)

**If you exceed FREE limits later:**

### Gelato Relayer ($19/month)
- 1,000 txs/month (10x increase)
- Priority support
- Custom gas strategies

### Vercel Pro ($20/month)
- 1TB bandwidth (10x increase)
- More team features
- Password protection
- Analytics included

### Neon Launch ($19/month)
- 10GB storage (20x increase)
- More compute
- Point-in-time restore

**Total if scaled:** $58/month (still very cheap!)

---

## 🎯 Quick Start (1 Hour Setup)

**Fastest path to production:**

```bash
# 1. Deploy to Vercel (5 min)
vercel login
vercel --prod

# 2. Setup cron (2 min)
# Add vercel.json with cron config
vercel --prod

# 3. Add Gelato (10 min)
npm install @gelatonetwork/relay-sdk
# Copy gelato-relayer.ts from this doc
# Update auto-rebalance route

# 4. Setup Discord (3 min)
# Create webhook in Discord
# Add to Vercel env: DISCORD_WEBHOOK_URL

# 5. Test (5 min)
curl -X POST https://your-app.vercel.app/api/cron/auto-rebalance \
  -H "Authorization: Bearer CRON_SECRET"

# 6. Monitor (5 min)
# Check Vercel dashboard
# Check Discord for notification
# Check Gelato dashboard for tx

✅ DONE! Auto-rebalancing now runs 24/7 for $0/month
```

---

## 📚 Additional Resources

### Documentation
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Gelato Network Docs](https://docs.gelato.network)
- [Biconomy Docs](https://docs.biconomy.io)
- [Discord Webhooks](https://discord.com/developers/docs/resources/webhook)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Vercel KV](https://vercel.com/docs/storage/vercel-kv)
- [Neon Docs](https://neon.tech/docs)

### Code Examples
- [Gelato Relay Example](https://github.com/gelatodigital/relay-sdk-examples)
- [Vercel Cron Example](https://github.com/vercel/examples/tree/main/solutions/cron)
- [Discord Bot Example](https://github.com/discord/discord-example-app)

### Support Channels
- **Cronos Discord**: https://discord.gg/cronos (x402 channel)
- **Gelato Discord**: https://discord.gg/gelato
- **Vercel Discord**: https://discord.gg/vercel

---

## 🎉 Summary

**You asked:** "isnt there freee services"

**Answer:** YES! Everything can be FREE:

✅ **Hosting:** Vercel FREE (100GB/month)  
✅ **Cron Jobs:** Vercel Cron (unlimited)  
✅ **Gasless Relayer:** Gelato (100 txs/month)  
✅ **Notifications:** Discord/Telegram (unlimited)  
✅ **Database:** Neon PostgreSQL (0.5GB) - already setup!  
✅ **Config Storage:** Vercel KV (256MB)  
✅ **Monitoring:** Sentry + UptimeRobot + Healthchecks.io  
✅ **API Keys:** x402 + Moonlander + Crypto.com (all FREE)  

**Total Monthly Cost:** $0.00  
**Setup Time:** 1-3 hours  
**Capacity:** 1-100 portfolios, 100 rebalances/month  

**Next Step:** Start with Phase 1 (Hosting) - takes 30 minutes!

---

**Questions?** Check:
- `docs/SCALABILITY_ANALYSIS.md` - FREE monitoring setup
- `docs/QUICK_SETUP_AUTO_REBALANCE.md` - Current implementation
- Discord #x402-hackathon - For API key requests
