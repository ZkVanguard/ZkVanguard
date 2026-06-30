# Outstanding Submission Blockers — Requires User Action

> Everything in the codebase is grant-ready. The blockers below need access
> to systems I can't reach from code (Vercel dashboard, etc.).

---

## 🚨 BLOCKER #1: Vercel deployment failing silently

### Symptom
Last 6 production deploys (since commit `d0275ac0` on 2026-06-29) have all
failed at the "Deploying outputs" step on Vercel. Production
(www.zkvanguard.xyz) is stuck at commit `1a58277c` (2026-06-29 05:24 UTC).

Affected routes serving 404 in production:
- `/developers`
- `/dashboard/custody-proofs`
- `/api/custody/list-attestations`
- `/api/custody/build-message`
- `/api/custody/hash-assets`
- `/api/custody/verify`

Working in production (older commits already deployed):
- `/dashboard/overview` (from `374f7c5e`)
- `/dashboard/risk` (from `3f33091e`)
- `/api/platform/risk-overview` (from `3f33091e`)
- `/api/portfolio/unified` (from `374f7c5e`)

### Diagnosis
1. ✅ **TypeScript builds clean** locally (`bunx tsc --noEmit` exit 0)
2. ✅ **Move tests pass** (11/11)
3. ✅ **GitHub Actions CI passes** since commit `d4a4f8ab` (the wdk-wallet-evm fix)
4. ✅ **Vercel build step completes** (all routes correctly enumerated in build output)
5. ❌ **Vercel "Deploying outputs" step fails silently** — no error message in `npx vercel inspect <id> --logs`

### Likely causes (in priority order)
1. **Function size limit exceeded** — Vercel enforces 250MB uncompressed per
   serverless function. Some API routes pull heavy deps (BlueFin SDK,
   Sui SDK, multiple LLM SDKs, ethers, etc.) and may have crossed the line
   after this week's additions.
2. **Vercel free-plan deployment cap hit** (100 deploys/day). We've had 8+
   deploy attempts in 24h.
3. **Environment variable validation failing** at deploy-time (missing
   required var that build-time defaulted but runtime rejects).
4. **Project storage / output limit** exceeded on the Vercel plan.

### Action you need to take (5 min)

1. **Open the Vercel dashboard** for the project:
   https://vercel.com/mrarejimmyzs-projects/zkvanguard/deployments
2. **Click the most recent failed deploy** (currently dpl_7W9Ln2YcK9meDnTKgKBUZsj9QPoz for `314fc959`)
3. **Read the deploy-step error** that the CLI doesn't surface. Look for one of:
   - "Exceeded maximum function size of 250MB"
   - "Deployment limit reached"
   - "Function exceeded maximum size of 50MB" (per-function compressed limit)
   - Missing env-var related to a new module
4. **Fix according to error:**
   - Function size → identify the offending route, split heavy imports into
     dynamic `await import()` calls (already done in some routes but maybe
     not all)
   - Deploy cap → wait 24h or upgrade Vercel plan
   - Env var → add to Vercel project settings
   - Project limit → upgrade plan

### Suspect candidates if it's function size
Most likely offending routes (heaviest deps):
- `/api/sui/community-pool/route.ts` (Sui SDK + BlueFin SDK + Polymarket SDK)
- `/api/cron/sui-community-pool/route.ts` (full agent stack)
- `/api/agents/hedging/execute/route.ts` (BlueFin + Hyperliquid SDKs)

These existed before this week's work, so if they're now over the limit, it's
likely because something in the new commits is pulling them transitively into
a previously-lean route. Worth checking:
- `/api/custody/list-attestations` imports `RwaCustodyAttestService` which
  imports from `@mysten/sui/client` — should be small
- `/api/platform/risk-overview` imports `PredictionAggregatorService` which
  pulls market data libs

### Workaround if Vercel can't be fixed in time

The grant reviewer can still verify everything via:
- `https://github.com/ZkVanguard/ZkVanguard` (latest commits visible)
- `bun run scripts/analyze-pool-pnl.ts` (live numbers via DB)
- `bun run scripts/test-custody-attestor-e2e.ts` (off-chain stack working)
- Move tests: `sui move test rwa_custody` (11/11 PASS)

But that's a degraded experience. **Fix Vercel ASAP** so the grant deck's URL
references all work in one click.

---

## 🟡 OPEN ITEM #2: Custody attestor not yet deployed to mainnet

### Status
- ✅ Move contract written + 11/11 tests passing
- ✅ TS SDK + 4 API routes + frontend page shipped
- ❌ Not yet on mainnet

### Action
Run the deployment per `scripts/deploy-custody-attestor.md`. Requires:
- 0.5+ SUI for gas in operator wallet
- Existing UpgradeCap (you have v3)
- ~30 min total

This is Tranche 2/3 work per the grant deck — not blocking grant submission,
but ship after grant approval so the framing earns itself.

---

## 🟢 EVERYTHING ELSE IS PERFECT

See `docs/SUBMISSION_DAY_CHECKLIST.md` for the actual submission flow.

Last updated: 2026-06-30
