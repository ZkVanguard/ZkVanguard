# Deploy Safety Net — 2026-06-07

Pre-deploy safety analysis: what can go wrong, how to detect it, how
to recover. Built specifically because past deploy incidents have
locked member funds; this doc exists to make that impossible to
repeat without conscious operator override.

## Critical insight: the 3 existing members and their $30

We have:
- 3 members holding 0.030211 shares total
- $30.80 total deposited (historical), $0 withdrawn
- Pool paused right now

**These funds CANNOT be lost during the deploy** because:
1. The pool is paused → no withdrawals possible during upgrade window
2. Move package upgrades are ATOMIC — either the whole new package
   replaces the old or nothing changes
3. Existing state struct fields are unchanged (only new dynamic_field
   keys added, which are absent in existing state → reads return
   defaults like 0 or false)
4. We retain AdminCap + UpgradeCap → any stuck state can be unstuck
   via admin function or further upgrade

What CAN go wrong: funds become temporarily **inaccessible** (pool
locked) due to a process error. Worst case is hours/days of recovery,
not lost money. This document is about minimising that risk.

## Failure modes and recovery for each step

### STEP 2 — `sui client upgrade` (the big one)

**What can fail:**
- (A) Upgrade tx reverts (InsufficientGas, compatibility error, etc.)
- (B) Upgrade succeeds but new code has a runtime bug
- (C) UpgradeCap consumed by wrong tx

**Detection:**
- (A) CLI returns error, no new package id, balance only deducted by failed-tx cost (~0.001 SUI). Pool state unchanged.
- (B) Subsequent admin calls revert with unexpected error. Diagnose script shows weird values.
- (C) UpgradeCap object's `version` field changed but no new package shows.

**Recovery:**
- (A) Pool unaffected. Investigate (check gas, --verify-deps), retry.
- (B) IMMEDIATE: pool is paused, so no member fund risk. Submit ANOTHER upgrade fixing the bug. UpgradeCap is consumed once per success but you can do consecutive successful upgrades.
- (C) Should not happen — Sui CLI prevents double-consumption.

**Pre-flight gate:** before running step 2, verify:
```bash
sui client gas              # ≥ 1 SUI
sui move build              # exit 0
sui client active-env       # mainnet
sui client active-address   # 0x99a3a0fd... (the deployer)
```

---

### STEP 3 — Vercel env update

**What can fail:**
- (D) Forget to update either env var
- (E) Update one but not the other
- (F) Typo in new package id

**Detection:**
- (D)(E)(F) Cron tx submission will fail or call methods on the OLD package, which lack the new admin_attest_external_nav function. Logs show "function not found" or similar.

**Recovery:**
- Fix env values, redeploy Vercel. No on-chain impact while cron is misconfigured (just fails harmlessly each tick).

**Pre-flight gate:**
```bash
# Vercel CLI: after setting envs, verify
vercel env ls production | grep PACKAGE_ID
# Both vars should show the new package id
```

---

### STEP 4 — Cron deploy via Vercel

**What can fail:**
- (G) Vercel build fails
- (H) Build succeeds but cron handler crashes on cold start
- (I) Cron runs but `attestExternalNav` reverts

**Detection:**
- (G) Vercel UI shows build failure.
- (H) First cron invocation in Vercel logs shows error.
- (I) Repeated reverts visible in Vercel logs + on-chain failures from the cron wallet.

**Recovery:**
- (G) Fix the build error locally, push, redeploy. Pool unaffected.
- (H) Fix the runtime error, redeploy. Pool unaffected (still paused).
- (I) Most likely cause: 30% delta cap rejecting a too-large value. Diagnose with diagnose-pool-underpayment.ts. If cron's navUsdTotal is wrong, fix in code. If cap is too tight, can manually attest a smaller value first to ratchet.

**Pre-flight gate:** before unpausing in step 8, verify:
```bash
# Run a few times over ~30 min to see consecutive successes:
bun run scripts/diagnose-pool-underpayment.ts
```

Three consecutive successful attestations with the same approximate
external_nav value = cron is stable.

---

### STEP 5 — Wait for first attestation + verify (CRITICAL GATE)

**What can fail:**
- (J) Cron didn't fire (QStash schedule missing or wrong)
- (K) Cron fired but on-chain external_nav doesn't match expected ~$29.64

**Detection:**
- (J) `diagnose` script shows external_nav = 0 (df doesn't exist)
- (K) `diagnose` shows external_nav value, but not the expected ~$29.64

**Recovery:**
- (J) Check QStash dashboard, verify schedule exists for `/api/cron/sui-community-pool` every 30 min, fire a manual test.
- (K) The on-chain value is what the cron pushed. Check cron's navUsdTotal calculation. May need to update cron logic and redeploy.

**HARD STOP:** do NOT proceed past step 5 until:
- external_nav on-chain ≈ navUsdTotal - balance (~$29.64 today)
- `get_total_nav` on-chain ≈ cron's navUsdTotal (~$30.06 today)
- diagnose script shows share price ≈ $0.99

If ANY of these don't match: investigate before flipping strict mode.

---

### STEP 6 — Enable strict mode

**What can fail:**
- (L) Cron has been failing silently; enabling strict mode locks the pool
- (M) Strict mode enabled but cron breaks an hour later → 2h grace expires → pool locks

**Detection:**
- (L) Already detectable in step 5; should never be enabled if step 5 didn't verify cleanly.
- (M) Vercel logs show cron failures; on-chain `is_external_nav_fresh` returns false after 2h.

**Recovery:**
- (L) Disable strict mode immediately:
  ```bash
  bun run scripts/pool-strict-mode.ts --off --commit
  ```
- (M) Same — disable strict mode. Investigate cron. Fix. Re-enable when stable.

**This is REVERSIBLE.** Strict mode can be toggled off at any time
via AdminCap. Members are temporarily exposed to stale-oracle math
during the off-window (same as today, pre-upgrade).

---

### STEP 7 — `admin_lock_cap_minting` (IRREVERSIBLE)

**What can fail:**
- (N) Called before the agent set is finalised → can't add new agents later without further upgrade
- (O) Called accidentally during testing

**Detection:**
- (N)(O) Subsequent add_agent calls revert with E_NOT_AUTHORIZED.

**Recovery:**
- **NONE.** This is one-way by design. Mitigation: only call this
  when you're 100% certain the agent set is final.

**Pre-flight gate:** confirm the agent set is correct:
```bash
# List AgentCaps in deployer wallet
sui client objects 0x99a3a0fd... --json | python -c "
import json, sys
for o in json.load(sys.stdin):
    t = o.get('data', {}).get('type_', '')
    if 'AgentCap' in str(t):
        print(o['data']['objectId'])
"
```
Expected: ONE AgentCap (the cron operator's). If more or different,
investigate before locking.

**This step is OPTIONAL for the initial deploy.** You can skip it on
day 1 and call it later once you've confirmed the cron is stable for
a week. Recommended: SKIP STEP 7 in the initial deploy.

---

### STEP 8 — Unpause

**What can fail:**
- (P) Unpause but cron has stopped attesting (within last 2h)
- (Q) Unpause but strict mode rejects all txs
- (R) Unpause but circuit breaker trips immediately

**Detection:**
- (P) Members attempting deposit/withdraw see E_EXTERNAL_NAV_STALE
- (Q) Same as P essentially
- (R) circuit_breaker_tripped becomes true on first big withdrawal

**Recovery:**
- (P)(Q) Re-pause:
  ```bash
  bun run scripts/pause-sui-pool.ts --commit
  ```
  Investigate, fix, unpause again.
- (R) `reset_circuit_breaker` via admin call.

**Pre-flight gate:** before unpausing:
```bash
# Verify on-chain freshness
curl ...  # check external_nav_ts_ms is within last 30 min
# Verify diagnose shows expected values
bun run scripts/diagnose-pool-underpayment.ts
```

---

## Recovery scenarios for "stuck pool"

### Scenario A — pool reverts all txs after upgrade

Most likely cause: strict mode on + cron not attesting.

```bash
# 1. Disable strict mode
bun run scripts/pool-strict-mode.ts --off --commit

# 2. If still reverting, pause and unpause to reset state
bun run scripts/pause-sui-pool.ts --commit
# investigate
bun run scripts/pause-sui-pool.ts --unpause --commit
```

### Scenario B — new code has a bug that breaks an admin function

Most likely cause: typo or logic error I missed in 9 audit phases.

```bash
# 1. Pool stays paused (we never unpaused in this case)
# 2. Investigate exact error
# 3. Fix bytecode locally
# 4. Submit ANOTHER upgrade (UpgradeCap is reusable across upgrades)
sui client upgrade --upgrade-capability ... --gas-budget 700000000
```

Sui package upgrade has **no limit on number of upgrades** — only
that each must pass the policy=0 compatibility check.

### Scenario C — cron is permanently broken

```bash
# 1. Disable strict mode (so pool works with stale external_nav)
bun run scripts/pool-strict-mode.ts --off --commit

# 2. Operator manually attests via direct sui client call
sui client call \
  --package $NEW_PKG \
  --module community_pool_usdc \
  --function admin_attest_external_nav \
  --args $ADMIN_CAP $POOL_STATE $EXTERNAL_NAV_RAW 0x6 \
  --type-args $USDC_TYPE \
  --gas-budget 10000000

# 3. Members can withdraw at correct share price while cron is fixed
```

### Scenario D — operator key is compromised mid-deploy

```bash
# Immediate:
# 1. PAUSE the pool (any AdminCap holder, including attacker, but
#    pausing is what attacker WANTS to do to your funds, so they
#    might not — but you should pause first to be safe)
# 2. Move all SUI from deployer wallet to safe wallet
# 3. Cannot recover AdminCap once attacker has it — must redeploy

# Long-term recovery: this is exactly the T4-A multi-sig scenario.
```

## Deploy day pre-flight checklist (one final review)

Print this. Tick each box BEFORE proceeding to the next.

### Pre-step 0 (before touching anything)

- [ ] Gas balance ≥ 1 SUI (`sui client gas`)
- [ ] Pool currently paused (`curl ... | grep paused` shows true)
- [ ] sui CLI version 1.72.5 (`sui --version`)
- [ ] Build clean (`cd contracts/sui && sui move build`)
- [ ] Git working tree clean (`git status`)
- [ ] Operator confirms no active member withdrawals expected today
- [ ] 30-60 min uninterrupted time available

### Step 2 (upgrade) — go/no-go

- [ ] Upgrade tx returned status=success
- [ ] New package id captured: $NEW_PKG
- [ ] UpgradeCap version incremented (was 2, now 3)
- [ ] Deployer SUI balance dropped by ~0.5 SUI (real cost)

### Step 4 (cron deploy) — go/no-go

- [ ] Vercel build green
- [ ] First cron invocation in Vercel logs successful (or pending in next 30 min)
- [ ] Vercel env vars updated to $NEW_PKG (verified via `vercel env ls`)

### Step 5 (verify attestation) — HARD GATE

- [ ] Cron fired at least ONCE since step 4
- [ ] `diagnose-pool-underpayment.ts` shows:
  - [ ] On-chain balance unchanged from pre-deploy (~$0.42)
  - [ ] External NAV attested ≈ $29.64 (±10%)
  - [ ] get_total_nav() ≈ $30.06
  - [ ] Contract share price ≈ $0.99 (NOT $1.19 which is the buggy value)
- [ ] WAIT 30+ min and verify a SECOND attestation lands cleanly
- [ ] Both attestations within ±2% of each other

**If any of the above fails → STOP. Do not enable strict mode. Do
not unpause. Investigate and fix first.**

### Step 6 (strict mode) — recoverable

- [ ] `admin_set_external_nav_required(true)` succeeded
- [ ] Verify: `is_external_nav_required` returns true on-chain
- [ ] WAIT 30 min. Verify cron continues to attest. Verify pool still
      not stuck (test by trying a small admin call).

### Step 7 (cap lockdown) — IRREVERSIBLE, RECOMMEND SKIP DAY 1

- [ ] Have you operated the new pool for at least 1 WEEK without issues?
  - [ ] If NO: SKIP this step. Come back to it later.
- [ ] Is the AgentCap set correct? (verify by listing objects)
- [ ] Is multi-sig migration plan finalised?
- [ ] If you're sure → call `admin_lock_cap_minting`
- [ ] Otherwise → defer.

### Step 8 (unpause) — recoverable

- [ ] All above steps verified
- [ ] You are mentally ready to monitor for the first few hours
- [ ] You have notification setup for Discord/cron alerts
- [ ] Members are NOT expecting to do big actions in the next 1-2h
- [ ] Run the unpause tx
- [ ] Verify on-chain `paused = false`
- [ ] Monitor diagnose for 2-3 hours

## TL;DR — funds-safe rules

1. **Funds are never lost** — only temporarily inaccessible during recovery
2. **Pool stays paused throughout the deploy** until step 8
3. **Strict mode is reversible** — can be toggled off any time via AdminCap
4. **Cap lockdown is irreversible** — defer to day 7+ when stable
5. **AdminCap + UpgradeCap retention = full recovery from any stuck state**
6. **Diagnose script is the source of truth** — run it between every major step

If at any point during the deploy you feel uncertain, the SAFE
action is to PAUSE and call it a day. Members are safe behind the
pause. We can resume tomorrow.

Past incidents were caused by rushing past the verification gates.
This document exists to make that impossible without a conscious
override.
