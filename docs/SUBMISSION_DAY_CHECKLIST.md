# Grant Submission Day Checklist

Single doc to follow when you sit down to submit. Estimated ~45 min.

---

## T-30 minutes: refresh time-sensitive numbers

Live numbers drift hour to hour. Re-pull just before submitting so the deck
matches what a reviewer will see on Suiscan within the same session.

```powershell
cd C:\Users\mrare\OneDrive\Documents\Zk-Vanguard
bun run scripts/analyze-pool-pnl.ts
```

Note the four numbers you'll need:
- **Total NAV** (e.g. `$56.35`)
- **Share price** (e.g. `$1.8653`)
- **Capital-flow PnL** (e.g. `+$25.55`)
- **ATH distance** (e.g. `0.6%` off peak)

Edit these four locations:

| Doc | Section |
|---|---|
| `docs/GRANT_HONEST_ASSESSMENT.md` | Repo-state table (line ~28) |
| `docs/GRANT_PITCH_DECK.md` | Slide 5 mainnet table (line ~165) |
| `docs/GRANT_PITCH_DECK_v2.md` | Slide 6 mainnet table (line ~170) |
| `docs/PITCH_DECK_ALLIANCE.md` | Slide 4 hero stats + Appendix A + Appendix H |

---

## T-25 minutes: regenerate PDFs

```powershell
cd C:\tmp\pdf-tool

python -c "src=open('C:/Users/mrare/OneDrive/Documents/Zk-Vanguard/docs/PITCH_DECK_ALLIANCE.md','r',encoding='utf-8').read(); i=src.find('END OF DECK · APPENDIX BELOW'); open('PITCH_DECK_ALLIANCE_slides_1-7.md','w',encoding='utf-8').write(src[:i].rstrip()+'\n')"

node convert.mjs "C:/Users/mrare/OneDrive/Documents/Zk-Vanguard/docs/GRANT_PITCH_DECK_v2.md" "out/GRANT_PITCH_DECK_v2.html" "ZkVanguard — SUI Foundation Grant Deck"
node convert.mjs "C:/Users/mrare/OneDrive/Documents/Zk-Vanguard/docs/GRANT_PITCH_DECK.md"    "out/GRANT_PITCH_DECK.html"    "ZkVanguard — Grant Deck v1 (long form)"
node convert.mjs "C:/Users/mrare/OneDrive/Documents/Zk-Vanguard/docs/GRANT_HONEST_ASSESSMENT.md" "out/GRANT_HONEST_ASSESSMENT.html" "ZkVanguard — Grant Honest Assessment"
node convert.mjs PITCH_DECK_ALLIANCE_slides_1-7.md out/PITCH_DECK_ALLIANCE_slides_1-7.html "ZkVanguard — Alliance Deck (Slides 1-7)"
```

Then in your browser:
1. Open `C:\tmp\pdf-tool\out\GRANT_PITCH_DECK_v2.html`
2. Ctrl-P → Save as PDF (use "Background graphics" ON for the colored sections)
3. Confirm under 10MB (Tally form limit). If over, drop to single-page sections.

---

## T-15 minutes: smoke-test every URL in the deck

```powershell
$urls = @(
  "https://www.zkvanguard.xyz",
  "https://www.zkvanguard.xyz/pricing",
  "https://www.zkvanguard.xyz/developers",
  "https://www.zkvanguard.xyz/agents",
  "https://www.zkvanguard.xyz/dashboard",
  "https://www.zkvanguard.xyz/dashboard/overview",
  "https://www.zkvanguard.xyz/dashboard/risk",
  "https://www.zkvanguard.xyz/dashboard/custody-proofs",
  "https://www.zkvanguard.xyz/api/health/production",
  "https://www.zkvanguard.xyz/api/platform/risk-overview",
  "https://www.zkvanguard.xyz/api/predictions/per-asset",
  "https://www.zkvanguard.xyz/api/debug/sui-pool-status",
  "https://github.com/ZkVanguard/ZkVanguard",
  "https://suiscan.xyz/mainnet/object/0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726",
  "https://suiscan.xyz/mainnet/object/0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a"
)
foreach ($u in $urls) {
  try {
    $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 5
    Write-Host "OK $($r.StatusCode)  $u"
  } catch {
    Write-Host "FAIL    $u  — $($_.Exception.Message)"
  }
}
```

Every URL must return 200. If any fails:
- For app routes (HTTP 404): check Vercel build (`gh -R ZkVanguard/ZkVanguard run list --limit 3`)
- For SUI/GitHub: just retry, usually transient

---

## T-10 minutes: GitHub repo description sanity-check

```powershell
gh repo view ZkVanguard/ZkVanguard --json description --jq .description
```

Should read: *"AI-managed crypto vault that lets anyone ride Polymarket alpha. 7-agent autonomous risk engine on Sui mainnet, prediction-market signals + ZK-attested decisions."*

If it's drifted, update via:
```powershell
gh repo edit ZkVanguard/ZkVanguard --description "AI-managed crypto vault that lets anyone ride Polymarket alpha. 7-agent autonomous risk engine on Sui mainnet, prediction-market signals + ZK-attested decisions."
```

---

## T-5 minutes: revise Slide 9 of GRANT_PITCH_DECK_v2 before submission

DeFi Moonshots doesn't use the "$50K / 3 tranches" structure — they pick the
support format. The deck's current Slide 9 reads as if you're requesting a
specific tranche schedule. Replace with an open ask:

> "Open to: liquidity incentives (up to $500K per Moonshots spec), audit
> credits, DeFi-engineering collaboration on multi-pool architecture.
> Ready to discuss the right shape for ZkVanguard's stage."

Re-generate the PDF (re-run T-25 step) before uploading.

See `docs/GRANT_SUBMISSION_PLAYBOOK.md` for the full rationale.

---

## SUBMIT — primary: DeFi Moonshots

1. Open https://tally.so/r/MeRKJX
2. Fill form (~15 min). Critical fields:
   - **Project deck file upload** → `GRANT_PITCH_DECK_v2.pdf` (revised Slide 9)
   - **Project name**: ZkVanguard
   - **GitHub**: https://github.com/ZkVanguard/ZkVanguard
   - **X / Twitter**: @HarveReg
   - **Telegram**: @anstemple
   - **DeFi category**: Autonomous asset management / AI-managed vault
   - **Project stage**: Live on mainnet (since 2026-06-12)
   - **Other-chain deployment**: Multi-chain ready, SUI-first (EVM testnet
     deploys on Arbitrum/Hedera/Oasis/Sepolia)
   - **Team structure**: Solo founder + lead engineer (Mrare Jimmy);
     specify "1 dev" honestly, list founder background
   - **Technical architecture**: Three live products on shared privacy stack
     (1,713 LOC zk_* contracts) + 7-agent orchestrator + custody attestation
     primitive (audit-ready); reference docs/VISION.md
   - **Business model + fees**: 50 bps mgmt + 10% perf on pool TVL (live)
     · per-use product fees · subscription tiers
   - **Funding to date**: $0 grants, self-funded
   - **Referral**: leave blank unless someone referred you
3. Click Submit. Save the confirmation email.

---

## SUBMIT — parallel: Alliance DAO ALL18

1. Open https://alliance.xyz/apply
2. Upload `PITCH_DECK_ALLIANCE_slides_1-7.pdf` (10MB limit)
3. The Appendix in `docs/PITCH_DECK_ALLIANCE.md` is your Q&A binder — don't
   upload, keep for interview prep
4. Click Submit. Save confirmation.

---

## T+0: post-submission monitoring

Set up these polls (you'll respond to incoming reviewer questions):

```powershell
# Check pool health every 30 min during reviewer-active hours
bun run scripts/analyze-pool-pnl.ts

# Watch for any cron staleness
bun -e "
import dotenv from 'dotenv'; dotenv.config({path:'.env.local'});
import { query } from './lib/db/postgres';
(async()=>{
  const rows = await query(\"SELECT key, value FROM cron_state WHERE key LIKE 'cron:lastRun:%' ORDER BY value::bigint DESC LIMIT 10\");
  const now = Date.now();
  for (const r of rows) console.log(((now-Number(r.value))/60000).toFixed(0).padStart(6)+' min  '+r.key.replace('cron:lastRun:',''));
})();
"
```

---

## If a reviewer requests a live demo

Have these tabs queued in order:
1. https://www.zkvanguard.xyz (the live SUI pool landing)
2. https://www.zkvanguard.xyz/dashboard/risk (live Aladdin-style overview)
3. https://www.zkvanguard.xyz/dashboard/overview (your own wallet's unified view)
4. https://www.zkvanguard.xyz/developers (API surface)
5. https://suiscan.xyz/mainnet/object/0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726 (on-chain proof)
6. Terminal: `bun run scripts/analyze-pool-pnl.ts` (real numbers)

---

## Outcomes log (fill in as you go)

| Program | Submitted at | Confirmation # | First response |
|---|---|---|---|
| DeFi Moonshots | | | |
| Alliance DAO ALL18 | | | |
| (other) | | | |

Last updated: 2026-06-30
