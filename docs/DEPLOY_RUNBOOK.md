# Deploy & Secret-Rotation Runbook

> Post-incident production deploy for the SUI Mainnet Community Pool. This runbook
> exists because an obfuscated loader was found in `next.config.js`. It walks the
> operator from "clean repo, exposed secrets" to "verified-clean live deployment."
>
> **Verified ground truth at time of writing (2026-05-24):**
> - `origin/main` is **clean** — fix `01f962f8` and build guard `4846c665` are pushed; its `next.config.js` is 229 lines, longest line 146 chars, zero loader signatures.
> - Local `main` is **4 commits ahead** of origin (the Stage-3 refactors `55ddcf73 5e5906b1 1dc6b841 d6a78ed0`), not yet pushed.
> - `prebuild` runs `scripts/security-scan.cjs`, so an infected tree can no longer be built.
>
> So remote-malware eradication is **already done**. What is NOT done: the secret
> exposure that already happened, pushing the unpushed commits, and confirming the
> *live Vercel bundle* isn't a stale build from the infected window.

---

## 1. Threat model & exposure window

| Fact | Value |
|---|---|
| Payload first introduced | `9b6711ce` |
| Removed, then **re-added** by | `6ea125ea` — **2026-05-08** |
| Removed (current) | `01f962f8` — **2026-05-22 20:12 -0400** |
| Build guard added | `4846c665` — **2026-05-22 20:16 -0400** |
| Exposure window | **~14 days**, 19 commits (2026-05-08 → 2026-05-22) |
| Location | `next.config.js` — runs in the Node **build + server** process |

**Why this means rotate secrets:** `next.config.js` executes inside the Node process
that has full `process.env` access during `next build` and at server runtime. Any
secret present in the Vercel (or local build) environment during the exposure window
must be treated as **compromised**. We do not have proof of exfiltration, so this is
conservative-by-necessity — the correct posture for a confirmed malware incident.

**Why audit the dev machine (not just the repo):** the payload was removed once and
**came back** (`9b6711ce` → removed → re-added at `6ea125ea`). A repo that reinfects
points at a compromised author machine or an automated merge path, not a one-off
commit. Eradicating it from `origin` does not eradicate the source.

---

## 2. Pre-flight verification (read-only — safe to run anytime)

Run from the repo root. None of these change state.

```bash
# 2.1 — confirm the working tree and remote are clean of the loader
bun run security:scan                    # scans all tracked JS/TS; exits non-zero on any hit
git show origin/main:next.config.js | tail -3   # must end at: module.exports = withNextIntl(nextConfig);

# 2.2 — confirm exactly what is unpushed (expect only the 4 Stage-3 commits)
git log --oneline origin/main..main

# 2.3 — typecheck + build gate locally (prebuild guard runs automatically inside build)
bun run typecheck
bun run build                            # if this passes, the guard passed too
```

**Gate:** do not proceed past this section unless 2.1 prints `security scan clean`
and 2.3 builds green.

---

## 3. Push the clean local commits

The 4 unpushed commits are behavior-preserving refactors with 193 passing unit tests;
they do not touch `next.config.js`. Safe to push.

```bash
git push origin main
```

> Note: there are also two untracked files (`week-11-submission.md`,
> `week-18-22-submission.md`). They are docs, not code — commit or ignore per your
> preference; they have no bearing on the deploy.

---

## 4. Force a clean Vercel rebuild and verify the LIVE bundle

`origin` being clean does **not** guarantee the *currently-serving* deployment is
clean — it may still be the last build from the infected window, and Vercel can serve
a cached build.

1. **Trigger a fresh production build** from the clean `main` (push in §3 will do this,
   or "Redeploy" in the Vercel dashboard with **"Use existing build cache" UNCHECKED**).
2. **Confirm the build ran the guard:** in the Vercel build logs, look for
   `✓ security scan clean (<N> tracked source files)` emitted by `prebuild`. If the
   build succeeded, the guard passed (it `exit 1`s otherwise).
3. **Confirm the deployment commit** is at or after `01f962f8` (the removal). Reject any
   deployment whose source commit is in the `6ea125ea..01f962f8` range.
4. **Spot-check the served bundle** (optional but cheap): fetch the deployed site and
   grep the served JS for the signatures — there should be zero hits:
   ```bash
   # replace with the production URL
   curl -s https://<prod-host>/_next/static/ ... | grep -E "global\.i=|_\\\$_[0-9a-f]{4}|=lyR\("
   ```

---

## 5. Rotate secrets — the part that actually matters

Order matters: rotate **infra/API secrets first** (low risk, no fund movement), then
the **signing keys** (fund-moving, do during a maintenance window). Set the kill switch
before touching signer keys.

### 5a. Engage the kill switch first (maintenance window)

In Vercel env, set and redeploy (or hot-set if your infra allows):

```
SUI_AUTO_HEDGE_DISABLE=1     # fully disables auto-hedging
```

This stops the `sui-community-pool` cron from opening new hedges while keys are in flux.
Leave the autonomous trader (`polymarket-edge-trader`) off too if it shares the key —
easiest is to pause those QStash schedules in the QStash console for the window.

### 5b. Rotate infra / API secrets (no fund movement — do immediately)

For each, generate a new value at the provider, update it in Vercel env, redeploy:

| Secret | Provider action |
|---|---|
| `DB_V2_DATABASE_URL` (Neon) | Rotate the Neon role password / connection string |
| QStash signing keys + `CRON_SECRET` | Rotate in Upstash QStash console; update both current+next signing keys |
| Redis / Upstash token | Rotate in Upstash |
| `CRYPTOCOM_DEVELOPER_API_KEY` | Regenerate in Crypto.com developer console |
| `ASI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Regenerate at each provider (only the ones actually set) |
| `DISCORD_WEBHOOK_URL` | Delete + recreate the webhook in Discord channel settings |

### 5c. Rotate the SUI signing keys (FUND-MOVING — operator executes, confirm each step)

> **STOP.** These keys control real funds and on-chain authority. This is a coordinated
> migration, not a find-and-replace. Do it in the maintenance window with §5a engaged,
> and confirm each on-chain transfer before the next.

The exposed signers:
- `SUI_POOL_ADMIN_KEY` — operator key. Also the fallback is `BLUEFIN_PRIVATE_KEY`.
- `BLUEFIN_PRIVATE_KEY` — SUI keypair that authenticates the Bluefin perp account (its
  collateral lives in the Bluefin margin account keyed to this address).

These keys do **not** themselves hold the pool's authority — the on-chain **caps** do
(`SUI_ADMIN_CAP_ID`, `SUI_AGENT_CAP_ID`, `SUI_FEE_MANAGER_CAP_ID`, the last currently
held by the MSafe per CLAUDE.md). Rotation = move the caps + gas + collateral to a new
address, then swap the env value.

Migration steps:
1. **Repatriate Bluefin collateral first.** Close/reduce-only any open perp positions and
   withdraw USDC collateral back to the operator wallet (so nothing is stranded under the
   old key's margin account). Verify on Bluefin that free + locked collateral is 0.
2. **Generate a new keypair** (offline / hardware-backed if possible). Record the new
   address. Never log or paste the private key into chat, CI, or a ticket.
3. **Transfer owned objects to the new address:** the `AdminCap` and `AgentCap` objects
   (the IDs in `SUI_ADMIN_CAP_ID` / `SUI_AGENT_CAP_ID`), plus enough SUI for gas. The
   `FeeManagerCap` is held by MSafe — coordinate that move through the MSafe multisig
   separately if its controlling signer was also exposed.
4. **Move residual assets** (idle USDC/SUI) from the old operator address to the new one.
5. **Update env:** set `SUI_POOL_ADMIN_KEY`, `BLUEFIN_PRIVATE_KEY` (and
   `SUI_ADMIN_ADDRESS` / `BLUEFIN_WALLET_ADDRESS` if the address changed) to the new key.
   The cap **ID** env vars stay the same — the objects moved, their IDs didn't.
6. **Redeploy** and verify §7 before re-enabling hedging.
7. **Abandon the old key.** Once verified, the old address should hold nothing of value.

> If a full signer migration can't be done immediately, the defensible interim is:
> rotate all of §5b now, keep §5a (kill switch) engaged, and schedule §5c for the
> next maintenance window — but treat the signer as compromised until then (no large
> idle balances under it).

---

## 6. Restore Neon compute

Neon was over monthly compute quota, which is why DB-dependent diagnostics report
INDETERMINATE rather than real numbers.

1. In the Neon console, raise the plan/quota or wait for the monthly reset; confirm the
   compute endpoint is active (not suspended).
2. Confirm the **rotated** `DB_V2_DATABASE_URL` (from §5b) is what's live in Vercel.
3. Smoke test connectivity (read-only):
   ```bash
   bun run scripts/analyze-pool-pnl.ts            # ~5s; full NAV/PnL picture
   bun run scripts/check-hedge-signal-alignment.ts # ~3s; hedges vs live Polymarket signal
   ```
   These now return real figures instead of INDETERMINATE once Neon is back.

---

## 7. Post-deploy verification

Run after §3–§6. Then re-enable hedging.

```bash
# on-chain + DB truth (read-only)
bun run scripts/analyze-pool-pnl.ts                 # NAV decomposition, share-price return, ATH
bun run scripts/check-hedge-signal-alignment.ts     # open hedges still match the signal?
```

Manual checks:
- **Crons firing:** QStash console shows `sui-community-pool`, `bluefin-health`,
  `polymarket-edge-trader`, fee-collect etc. succeeding (200s), not auth-failing on the
  rotated `CRON_SECRET` / QStash keys.
- **Discord:** a trade/rebalance/health event posts to the **new** webhook.
- **NAV sane:** `analyze-pool-pnl.ts` verdict line is profit/flat, not a garbage value
  (sanity ceiling `NAV_SAFETY_CEILING_USDC` not breached).
- **Re-enable hedging:** remove `SUI_AUTO_HEDGE_DISABLE`, un-pause QStash schedules,
  redeploy. Watch the first `sui-community-pool` and `polymarket-edge-trader` ticks.

> Do **not** trust `scripts/check-sui-mainnet-readiness.ts` as the gate — per CLAUDE.md
> it checks legacy env names and doesn't load `.env.local`, so it reports false
> "blockers" for an already-deployed mainnet. Trust on-chain state + the two scripts above.

---

## 8. Rollback

- **Bad build:** in Vercel, promote the last known-good deployment (must be a commit
  `>= 01f962f8` AND `< any` infected commit — i.e. on clean `main`). Never roll back into
  the `6ea125ea..01f962f8` window.
- **Bad key migration:** if a cap/asset transfer half-completed, do **not** redeploy with
  mismatched env. Re-engage `SUI_AUTO_HEDGE_DISABLE=1`, reconcile object ownership
  on-chain (`sui client objects <address>`), then retry §5c from the failed step.
- **DB issues:** point `DB_V2_DATABASE_URL` back at a healthy endpoint; diagnostics
  degrade gracefully to INDETERMINATE rather than reporting false losses.

---

## Appendix Z — profit-tuning config (Sharpe-oriented preset)

Pool target: **stability + Sharpe**, not absolute return. Depositor trust is the moat.
Set these in Vercel production env. None are secrets — safe to commit a snapshot to
this runbook. Trader code reads them on every cron tick, no redeploy needed for env
changes (Vercel injects fresh env per invocation).

### Trader (`polymarket-edge-trader`)

```
POLYMARKET_EDGE_MIN_CONFIDENCE         = 70      # was 60 — only high-conviction
POLYMARKET_EDGE_MIN_CONSENSUS          = 70      # was 60 — require alignment
POLYMARKET_EDGE_LEVERAGE               = 2       # was 3  — smaller PnL swings
POLYMARKET_EDGE_STAKE_PCT              = 0.05    # was 0.10 — Kelly half
POLYMARKET_EDGE_MAX_STAKE_USD          = 100     # was 500 — bound single-trade loss
POLYMARKET_EDGE_MAX_CONSECUTIVE_LOSSES = 3       # was 5  — earlier kill
POLYMARKET_EDGE_MAX_DRAWDOWN_PCT       = 0.20    # was 0.30 — earlier kill
```

Raise `MAX_STAKE_USD` to 500 once pool NAV > $5k (Kelly stops binding the cap).

### Auto-hedge (`sui-community-pool` cron)

```
HEDGE_MIN_NAV_USD             = 100   # was 20  — don't hedge dust
HEDGE_RISK_THRESHOLD_DEFAULT  = 5     # was 0   — only hedge when risk elevated
HEDGE_DAILY_MAX_RESETS        = 2     # was 4   — preserve daily-cap teeth
HEDGE_RESET_MIN_CONFIDENCE    = 85    # was 75  — higher bar to override the cap
```

**`HEDGE_MIN_NAV_USD` must track current NAV.** Setting the floor above the
current pool NAV freezes the auto-hedge step entirely — every tick logs
"skipping Step 8". A target of roughly **60% of current NAV** keeps the pool
active while protecting against hedging dust:

| Pool NAV | `HEDGE_MIN_NAV_USD` |
|---|---|
| $0 - $50    | `30`  |
| $50 - $200  | `100` (recommended preset) |
| $200 - $500 | `150` |
| > $500      | `300` |

Why `30` is still safe at sub-$50 NAV: the `tiny` leverage tier (5x) and
100% hedge ratio combined with `HEDGE_RISK_THRESHOLD_DEFAULT=5` mean
auto-hedge only fires when risk is genuinely elevated, and at sub-$50
notional only SUI-PERP can clear BlueFin's minQty — BTC and ETH minQty
floors block accidental dust trades on those venues automatically.

### `SafeExecutionGuard` defaults (read at boot, hardcoded in
`agents/core/SafeExecutionGuard.ts`)

Bring slippage and leverage caps in line with the trader's tighter knobs:

```ts
maxSlippageBps: 30,     // was 50 — match POLYMARKET_EDGE_MAX_SLIPPAGE_BPS
maxLeverage:     4,     // was  5 — defense in depth above per-route LEVERAGE
```

(These two require a small code change; the other four `SafeExecutionGuard` caps —
`maxPositionUsd $10M`, `maxDailyVolumeUSD $100M`, `cooldownMs 5s`,
`consensusThreshold 0.67` — stay as is until pool NAV approaches them.)

### NAV-tiered leverage (`lib/services/sui/cron/hedge-sizing.ts`)

```ts
case 'tiny':   return 5;   // was 10 — still clears BlueFin minQty in most cases
case 'small':  return 3;   // was  5
```

(`medium=3`, `large=2` unchanged.)

### What this preset is NOT

- It is **not max EV.** It biases toward Sharpe and depositor-trust signals
  (low drawdown, fewer kill events) over absolute daily PnL.
- It is **not blind.** Each knob's tradeoff is documented inline above.
- It is **not permanent.** After the pool has logged ~50 real trades in Aiven,
  re-tune from the actual PnL distribution and win-rate-by-confidence histogram.

### Roll-out order

1. Land the env-var refactor commit (makes `MAX_CONSECUTIVE_LOSSES` and
   `MAX_DRAWDOWN_PCT` overrideable).
2. Set the trader + auto-hedge env vars in Vercel production. No redeploy needed.
3. Land the `SafeExecutionGuard` + `hedge-sizing` code changes in a follow-up
   PR. These DO require redeploy.
4. Watch one week of trader output via Discord `TRADE` and `KILL` alerts. If
   trade frequency drops below 1/day, lower `MIN_CONFIDENCE` to 65 and reassess.

## Appendix A — secret inventory (what lives where)

Fund-moving / highest priority: `SUI_POOL_ADMIN_KEY`, `BLUEFIN_PRIVATE_KEY`.
Infra/API: `DB_V2_DATABASE_URL`, QStash keys, `CRON_SECRET`, Upstash/Redis token,
`CRYPTOCOM_DEVELOPER_API_KEY`, `ASI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`DISCORD_WEBHOOK_URL`.
Not secret (on-chain object IDs — authority, not credentials; migrate objects, keep IDs):
`SUI_ADMIN_CAP_ID`, `SUI_AGENT_CAP_ID`, `SUI_FEE_MANAGER_CAP_ID`, the
`NEXT_PUBLIC_SUI_MAINNET_*` package/state IDs.

Reminder (CLAUDE.md): every SUI env read must `.trim()` — Vercel values carry trailing
`\r\n`. Never log or hardcode a private key.

## Appendix B — audit the dev machine (because it reinfected once)

The payload was removed and **came back**, so the source is upstream of the repo.

```bash
# who/what authored the (re-)introduction
git show --stat 6ea125ea
git log --format='%an <%ae>  %ci' -1 6ea125ea
git show 9b6711ce --stat        # the first introduction

# did it arrive via the fork remote?
git remote -v                   # note the 'fork' remote (kyu36003-source/ZkVanguard)
```

Checklist:
- Identify the machine that authored `6ea125ea` / `9b6711ce`; scan it for malware and a
  compromised git hook / editor extension / `postinstall` script that rewrites
  `next.config.js`.
- Audit `package.json` lifecycle scripts and any local git hooks for re-injection.
- Confirm the build guard (`prebuild` → `scripts/security-scan.cjs`) is present on every
  branch that can deploy, not just `main`.
- Rotate any developer credentials (GitHub tokens, SSH keys) on the affected machine.
