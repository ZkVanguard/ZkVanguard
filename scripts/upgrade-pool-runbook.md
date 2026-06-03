# Pool underpayment fix — upgrade runbook

**Severity:** active production bug, members withdrawing get ~3% of true share value.

**Branch state:** fix shipped to `main` in commit chain (Move + cron + diagnostic).

## Order of operations

```text
1.  PAUSE the pool (5 min)
2.  Build + upgrade the Move package (15-30 min)
3.  Deploy the cron change so attestation starts firing (5 min via vercel --prod)
4.  Wait 1 cron tick (30 min max) for the first attestation to land
5.  Verify external_nav is being pushed (1 min — call diagnose-pool-underpayment.ts)
6.  Turn ON strict mode (admin_set_external_nav_required(true))
7.  UNPAUSE the pool
8.  Notify members + offer a credit-back to anyone who withdrew during the bug
```

## Step 1 — pause

```bash
bun run scripts/pause-sui-pool.ts                # DRY RUN first
bun run scripts/pause-sui-pool.ts --commit       # actually pauses
```

The script aborts cleanly if AdminCap is on MSafe (no gas burned).

## Step 2 — Move package upgrade

The fix uses dynamic fields, so no `UsdcPoolState` field layout change.
Sui package upgrade is the right tool — function bodies change, new
public functions added, no struct touched.

```bash
cd contracts/sui

# Verify the change compiles
sui move build --skip-fetch-latest-git-deps

# Upgrade (requires UpgradeCap held by the deployer wallet)
sui client upgrade \
  --upgrade-capability $UPGRADE_CAP_ID \
  --gas-budget 100000000
```

If the package was deployed without an UpgradeCap, the fix must ship as
a NEW package + manual state migration (much more involved — see
"Fallback: redeploy + migrate" at the bottom).

After upgrade, the package object now has a new version. Update:

```
Vercel env: NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID
.env.local: same
```

…to the new package id, then `vercel --prod` to push the cron with the
right target package.

## Step 3 — deploy cron with attestation wired

Already on main. Just:

```bash
vercel --prod --yes
```

The cron's sui-community-pool route now calls `attestExternalNav` after
NAV computation each tick.

## Step 4 — wait for the first attestation

QStash will fire the cron within 30 min. Watch Discord for `[SUI Cron]
External NAV oracle updated` log lines (or check Vercel logs directly).

If the attestation tx fails with `E_EXTERNAL_NAV_CHANGE_TOO_LARGE`
on the first try, that's because the first-ever push has no prior — so
the bound check is skipped. Real failure would be unusual.

## Step 5 — verify

```bash
bun run scripts/diagnose-pool-underpayment.ts
```

After the first attestation, expected output:

```
On-chain USDC balance:   $0.41
Off-chain hedged value:  $0.03
External NAV attested:   $44.55   ← NEW
get_total_nav():         $44.99   ← matches cron / app
Contract share px:       $1.49    ← was $0.045
```

If the contract share price now matches the app, the fix is live.

## Step 6 — flip strict mode

Once the cron is reliably pushing every 30 min:

```bash
# Calls admin_set_external_nav_required(true) via AdminCap.
bun run scripts/pool-strict-mode.ts --commit
```

From this point any cron tick that misses attestation → next user
deposit/withdraw reverts with E_EXTERNAL_NAV_STALE (after 2h grace).
That's the safety property: a stalled cron pauses user flow rather
than letting math drift.

## Step 7 — unpause

```bash
bun run scripts/pause-sui-pool.ts --unpause --commit
```

## Step 8 — communicate

For members who withdrew DURING the bug window (any txs between the
auto-hedge cron firing first and the upgrade), they were underpaid by
roughly:

```
underpayment ≈ shares_burned × ( (true_nav / total_shares_at_time) -
                                  (on_chain_balance_at_time / total_shares_at_time) )
```

Check `total_withdrawn` on-chain — currently 0 — to see if anyone is
already affected.

## Fallback: redeploy + migrate

If the package has no UpgradeCap, the fix ships as a new package:

1. Publish the new package: `sui client publish --gas-budget 200000000`
2. The new package gets a fresh `UsdcPoolState` shared object on first
   `create_pool` call — does NOT inherit the existing pool's members or
   shares.
3. Migration requires:
   - Iterate `state.members` table from old pool (read via RPC)
   - For each member, recompute their fair share value at the moment of
     migration (using true NAV)
   - Mint equivalent shares on the new pool
   - Drain the old pool's balance into the new pool's balance
   - Repatriate admin wallet assets → USDC → new pool balance
   - Members re-authorise the new pool address in their apps
4. Old pool stays paused permanently as a tombstone.

This is multi-day work and absolutely needs audit + custodian review
before execution. Avoid if at all possible — the upgrade path is the
only sane one.
