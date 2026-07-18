# AdminCap → MSafe Migration Runbook

Phase 1.2 of the Scale & Security Hardening plan (see [`MAINNET_READINESS.md`](./MAINNET_READINESS.md)). Moves the `AdminCap` off the hot key onto the MSafe multisig, closing threat F2 (admin key compromise drains fees) and F11 partially (halt-flag griefing).

**Status:** DRAFT — do not execute against mainnet without full testnet rehearsal + external-audit review of the PTB.

**Owner:** operator (Ashish). This is a one-time procedure with a rollback window; do not delegate the mainnet execution step.

---

## 1 · Purpose

`AdminCap` (object gated by `contracts/sui/sources/community_pool_usdc.move:158`) is currently owned by the hot admin address (`SUI_ADMIN_ADDRESS` in `.env.local`). The private key sits in `SUI_POOL_ADMIN_KEY`, loaded at cron cold-start and every rebalance signing. A single-server compromise → single-key exfiltration → adversary owns AdminCap → any admin function in §3 below callable without co-sign.

`FeeManagerCap` migrated to MSafe (`SUI_MSAFE_ADDRESS`) at v0.2.0 deploy (2026-06-12). `AdminCap` was deliberately held back so autonomous cron ops could still function during the log-observe window. That window is closed — the v0.3.0 defense stack + external audit engagement (Phase 1.1) mean the hot-key blast radius is unacceptable.

---

## 2 · Current state (verify before starting)

```bash
# Confirm AdminCap owner is the hot admin address
curl -s -X POST https://fullnode.mainnet.sui.io:443 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":["'"$SUI_ADMIN_CAP_ID"'",{"showOwner":true}]}' \
  | python -m json.tool

# Expected: "owner": { "AddressOwner": "<SUI_ADMIN_ADDRESS>" }
# If already MSafe: MIGRATION ALREADY DONE. Stop.

# Confirm MSafe address is reachable + has activity
curl -s -X POST https://fullnode.mainnet.sui.io:443 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getOwnedObjects","params":["'"$SUI_MSAFE_ADDRESS"'"]}' \
  | python -m json.tool
```

---

## 3 · Blast radius per admin function (moves in order of severity)

Priority for the migration is the whole cap — you cannot split ownership of a single `AdminCap` object. But knowing which functions are dangerous informs how quickly you must complete the migration once started.

**HIGH — potentially fund-affecting:**
- `admin_attest_external_nav` (`:1231`) — oracle write. Bounded by `E_EXTERNAL_NAV_CHANGE_TOO_LARGE` (invariant I10), but repeated attestations across time can compound.
- `admin_set_external_nav_required` (`:1174`) — toggles strict mode. `false` → pool falls back to on-chain math ignoring off-chain NAV, share math regresses to the 2026-06-03 underpayment shape.
- `set_treasury` (`:1329`) — future fee routing. Attacker sets to own address → next `admin_collect_fees` (via MSafe FeeManagerCap) still requires MSafe co-sign, but treasury update itself takes effect immediately.
- `set_fees` (`:1337`) — bounded by `MAX_FEE_BPS` constants; at max still drains ~1%/year against MSafe treasury.

**MEDIUM — griefing:**
- `set_paused` (`:1301`) — freezes deposits/withdraws until unpause.
- `admin_reset_hedge_state` (`:1429`) — deletes external_nav DFs; blocks user flow up to 30 min per CLAUDE.md Sui/Move rules. Bundle with re-attest if legitimate.
- `set_auto_hedge_config` (`:1366`) — could grief hedging cadence.
- `admin_reset_daily_hedge` (`:1489`) — resets daily cap counter.

**LOW — configuration only:**
- `set_allocation` (`:926`) — target BPS.
- `set_withdrawal_limits` (`:1350`), `set_rebalance_cooldown` (`:1391`), `set_min_ai_confidence` (`:1400`), `admin_set_tvl_cap` (`:1587`), `admin_lock_cap_minting` (`:1620`).

---

## 4 · Prep (before touching mainnet)

### 4.1 · MSafe policy configuration
- Verify MSafe threshold on `SUI_MSAFE_ADDRESS`: should be **2-of-3** with `SUI_MSAFE_SIGNER_1` + `SUI_MSAFE_SIGNER_2` + operator hot key as signers. Check via MSafe UI.
- If threshold is 1-of-N or 3-of-3, **stop** — reconfigure first. 2-of-3 is the standard balance of security + operational availability.
- Confirm all signer keys are in accessible custody (hardware or well-secured hot). If any signer key is lost, migration cannot be reversed without deploying a new pool.

### 4.2 · Autonomous ops impact assessment
The cron currently reads `AdminCap` at cold-start for signing certain PTBs. **Post-migration, these cron paths break until refactored:**

```bash
# Find every AdminCap reference in cron code
grep -rn "SUI_ADMIN_CAP_ID\|admin_attest_external_nav\|admin_set_external_nav\|admin_reset_hedge" \
  app/api/cron/ lib/services/sui/
```

Expected hits:
- `sui-community-pool` — external NAV attestation each tick (this WILL break post-migration; needs redesign — see §7 refactor)
- `sui-hedge-reconcile` — potentially calls `admin_reset_hedge_state` on drift
- `sui-collect-fees` — uses `FeeManagerCap` (already MSafe), unaffected

**Blocker:** external NAV attestation runs every 30min via cron. Post-migration it either (a) requires MSafe co-sign per attestation (operationally infeasible), or (b) needs a new `OracleCap` split from AdminCap. **Decision required before proceeding:** which path?

Recommended path: **split `AgentCap`-style `OracleCap`** — deploy a v0.4.0 Move upgrade that mints a new capability specifically for `admin_attest_external_nav`, transfer that to the hot key, then AdminCap can go fully cold on MSafe. This is a Move contract change requiring external audit clearance → sequence AFTER Phase 1.1 (external audit close), BEFORE Phase 1.2 execution.

### 4.3 · Testnet rehearsal
1. Deploy v0.2.0 (or current) to Sui testnet with clean AdminCap on operator address.
2. Run the transfer PTB (§5).
3. Verify MSafe now owns the AdminCap.
4. Attempt a direct `admin_set_paused` from the operator's old address — MUST fail with `E_ACCESS_DENIED` or ownership error.
5. Attempt the same via MSafe — MUST succeed with 2-of-3 co-sign.
6. Attempt an `admin_attest_external_nav` from cron (with `OracleCap` if split, else confirm cron breaks as expected).
7. Rehearse rollback (§8).

**Do not proceed to mainnet unless steps 3-6 pass on testnet.**

---

## 5 · Mainnet execution — transfer PTB

⚠️ **This is a one-way action pending MSafe cooperation to reverse.** Do it during a quiet window (no active user flow, low market volatility) and immediately after a bulletproof drawdown test pass.

Skeleton PTB (fill in exact call after testnet rehearsal proves the pattern):

```typescript
// scripts/migrate-admincap-to-msafe.ts (create this after §4.3 rehearsal)
import { Transaction } from '@mysten/sui/transactions';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
const operatorKeypair = Ed25519Keypair.fromSecretKey(
  process.env.SUI_POOL_ADMIN_KEY!.trim().replace(/^suiprivkey1/, '')
);

const tx = new Transaction();
tx.transferObjects(
  [tx.object(process.env.SUI_ADMIN_CAP_ID!)],
  tx.pure.address(process.env.SUI_MSAFE_ADDRESS!),
);
tx.setGasBudget(50_000_000); // 0.05 SUI

// DRY RUN FIRST
const dryRun = await client.dryRunTransactionBlock({
  transactionBlock: await tx.build({ client }),
});
console.log(JSON.stringify(dryRun, null, 2));
// Verify: dryRun.effects.status.status === 'success'
// Verify: dryRun.balanceChanges shows only gas cost
// Verify: dryRun.objectChanges shows AdminCap object with newOwner = MSafe

// ONLY IF DRY-RUN CLEAN, then execute for real (uncomment):
// const result = await client.signAndExecuteTransaction({
//   signer: operatorKeypair,
//   transaction: tx,
//   options: { showEffects: true, showObjectChanges: true },
// });
// console.log(result.digest);
```

Immediately after execution, capture the tx digest and verify §6.

---

## 6 · Verification (do NOT skip)

```bash
# 1. AdminCap owner is now MSafe
curl -s -X POST https://fullnode.mainnet.sui.io:443 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject","params":["'"$SUI_ADMIN_CAP_ID"'",{"showOwner":true}]}' \
  | python -m json.tool
# Expected: "owner": { "AddressOwner": "<SUI_MSAFE_ADDRESS>" }

# 2. Direct admin call from hot key MUST fail
bun run scripts/test-admin-call-should-fail.ts
# Expected: transaction reverts with ownership error

# 3. Pool still operational for USER flow (deposits, withdraws)
bun run scripts/analyze-pool-pnl.ts
# Expected: green NAV report, no errors from strict mode

# 4. Discord health-monitor confirms all crons green in next 30min window
curl -s https://www.zkvanguard.xyz/api/health/production | python -m json.tool
# Expected: all cron heartbeats fresh; bluefin component operational
```

---

## 7 · Post-migration cron refactor

If §4.2 confirmed that cron paths depend on AdminCap for external NAV attestation, one of these paths must ship BEFORE cutting over:

**Option A — split `OracleCap` (SHIPPED as v0.4.0 patch 2026-07-18, awaiting mainnet upgrade):**
- ✅ Move contract change: new `OracleCap has key, store {}` struct in `community_pool_usdc.move`; body of `admin_attest_external_nav` extracted into `attest_external_nav_internal`; new `oracle_attest_external_nav` entry fn gated by `&OracleCap`; `admin_mint_oracle_cap` AdminCap-gated one-shot minter.
- ✅ Off-chain: `sui-community-pool` cron reads `SUI_ORACLE_CAP_ID` and calls `oracle_attest_external_nav` when set; falls back to `SUI_ADMIN_CAP_ID` + `admin_attest_external_nav` when unset (pre-upgrade / pre-migration compatibility).
- ⬜ Mainnet: v0.4.0 upgrade PTB + `admin_mint_oracle_cap` → hot key + Vercel env `SUI_ORACLE_CAP_ID=<new-id>` — sequenced BEFORE §5 AdminCap transfer.
- ⬜ AdminCap fully cold on MSafe: §5.
- **Signature invariant:** `admin_attest_external_nav<T>` signature unchanged (compatible upgrade); body now delegates to internal helper. `admin_reset_hedge_state` still AdminCap-gated (rare; MSafe co-sign acceptable).
- **Known unfixed:** `sui-hedge-reconcile` and `admin/sui-reset-hedges` bundle `admin_reset_hedge_state` + re-attest in one PTB. Post-migration, cron cannot sign the reset half; both routes already detect "AdminCap on MSafe" and gracefully no-op (alert-only). Operator resolves drift via MSafe co-sign, per §3 MEDIUM operations.

**Option B — MSafe co-sign per attestation (rejected):**
- Operationally infeasible; attestation runs every 30min.

**Option C — sponsored-attest via a Move-native oracle module:**
- Longer-term; requires a new pattern for delegated attestation. Out of scope for this phase.

**Blocker (updated 2026-07-18):** Option A code shipped locally; mainnet upgrade sequenced AFTER Phase 1.1 (audit close on the v0.4.0 diff) and BEFORE §5 mainnet execution of this runbook. Zero pre-existing Move unit tests on `community_pool_usdc.move` — refactor coverage relies on `sui move build` static checks + auditor review; adding a full test module is deliberately out of scope for this patch.

### 7.1 · v0.4.0 rollout order (Option A)

```bash
# 1. Build + verify locally
cd contracts/sui && sui move build          # must succeed
bun jest test/integration/pool-drawdown-defense.test.ts  # must stay 10/10

# 2. Testnet upgrade + rehearsal (dry-run pattern from §4.3)
sui client upgrade --upgrade-capability $SUI_UPGRADE_CAP_ID \
  --gas-budget 700000000                    # 0.7 SUI per audit note

# 3. Mint OracleCap → hot key
sui client call --package $NEW_PACKAGE_ID \
  --module community_pool_usdc \
  --function admin_mint_oracle_cap \
  --args $SUI_ADMIN_CAP_ID $SUI_ADMIN_ADDRESS \
  --gas-budget 50000000                     # capture the new OracleCap object id

# 4. Set SUI_ORACLE_CAP_ID in Vercel env → redeploy
# 5. Confirm sui-community-pool cron: log entry shows capKind="oracle", attestFn="oracle_attest_external_nav"
# 6. Confirm cron_state heartbeat cron:lastRun:sui-community-pool fresh (< 30 min)
# 7. 72h log-observe (per Phase 0 rollout order)
# 8. Only then: §5 AdminCap → MSafe
```

---

## 8 · Rollback

Rollback requires MSafe co-sign (2-of-3), so it is **fast if signers are reachable, slow if not**.

```typescript
// scripts/rollback-admincap-to-hot.ts (draft)
// Build a MSafe transaction bundle that transfers AdminCap back to SUI_ADMIN_ADDRESS.
// Route via MSafe UI or programmatic MSafe SDK.
// tx.transferObjects([SUI_ADMIN_CAP_ID], SUI_ADMIN_ADDRESS)
// 2-of-3 signer collection → execute.
```

**Rollback triggers:**
- MSafe signer key loss makes future admin ops impossible → rollback WHILE possible.
- Post-migration cron pathology surfaces that Option A didn't cover → rollback + fix.
- External audit finds a critical Move contract issue requiring `admin_*` intervention faster than MSafe cadence allows.

---

## 9 · Post-migration monitoring (first 30 days)

- **Every day:** verify `/api/health/production` all green; verify `SUI_ADMIN_CAP_ID` owner is still MSafe (no unauthorised transfer).
- **Every week:** dry-run one admin call via MSafe to prove the co-sign path stays warm.
- **On any admin call:** record in `docs/CHANGELOG.md` — this is a monitored operation now, not routine.
- **Threat model update:** F2 severity drops from HIGH to LOW post-migration. Update `INTERNAL_AUDIT_PACKET.md § 4.1`.

---

## 10 · Sequence within Phase 1

```
Phase 1.1 (external audit engaged)
  → audit reviews the OracleCap split (§7 Option A) as part of scope
  → auditor signs off on the Move upgrade
Phase 1.2 (this runbook)
  → v0.4.0 Move upgrade with OracleCap ships to mainnet
  → §4.3 testnet rehearsal of AdminCap transfer
  → §5 mainnet AdminCap transfer to MSafe
  → §6 verification
  → §9 monitoring window begins
Phase 2 (contract + scale walls)
  → dependent on stable §9 monitoring window
```

---

## Related documents

- [`MAINNET_READINESS.md`](./MAINNET_READINESS.md) — Scale & Security Hardening plan (Phase 1.2)
- [`INTERNAL_AUDIT_PACKET.md`](./INTERNAL_AUDIT_PACKET.md) § 4.1 F2 — threat this closes
- [`SLO_AND_RUNBOOKS.md`](./SLO_AND_RUNBOOKS.md) — Runbook 4 (admin-key compromise response) will change post-migration
- [`SECURITY.md`](./SECURITY.md) — public-facing security posture; update after §5 completes
- [`CHANGELOG.md`](./CHANGELOG.md) — bump v0.4.0 entry when Option A upgrade + AdminCap migration ship

---

Last updated: 2026-07-18 (draft — §7 Option A shipped as code; mainnet upgrade pending audit close)
