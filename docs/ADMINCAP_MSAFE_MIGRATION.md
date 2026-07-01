# AdminCap → MSafe Migration Runbook

> Move `SUI_ADMIN_CAP` from the hot operator wallet to the MSafe multisig
> already holding `FeeManagerCap`. Removes the single-key theft surface
> that becomes existential above ~$1M NAV.
>
> Time: ~45 min. Gas: ~0.05 SUI. One-time. Reversible via MSafe proposal.

## What this closes

Right now `SUI_POOL_ADMIN_KEY` holds:
- `AdminCap` — grants admin-only Move entry points (set fee params, set
  external NAV oracle attestations, set TVL cap, set circuit-breaker, etc.)
- `AgentCap` — used by cron for hedge settle/replenish

If this key is compromised the attacker can:
- Drain accumulated fees (via `admin_withdraw_fees`)
- Disable strict-mode NAV oracle (via `admin_set_external_nav_required(false)`)
- Change fee params to 100% (fee rate breach caught by `E_FEE_TOO_HIGH` but still griefing)
- Ratchet TVL cap up + drain via a coordinated deposit

The **FeeManagerCap** already moved to MSafe (recorded in CLAUDE.md).
AdminCap did NOT. This runbook completes the pattern.

## Prerequisites

- MSafe wallet configured for the pool (same one holding FeeManagerCap)
- Access to the current `SUI_POOL_ADMIN_KEY` wallet (for the transfer tx)
- Vercel env access (to swap `SUI_ADMIN_CAP_ID` → MSafe-relayer flow)
- Sui CLI ≥ 1.32
- 0.1 SUI on the source wallet for gas

## Two-phase migration (recommended)

Doing this atomically would be nice but MSafe co-signing takes minutes.
Phased is safer:

### Phase 1 — Duplicate control (both hot key and MSafe can act)

**This does not require moving AdminCap.** Move contract's `AdminCap`
is a single object; SUI doesn't support cap sharing. So we skip
Phase 1 and go straight to Phase 2 with a canary window.

### Phase 2 — Transfer AdminCap to MSafe

```bash
# 1. Fetch current AdminCap ID
export ADMIN_CAP=$SUI_ADMIN_CAP_ID
echo "AdminCap to transfer: $ADMIN_CAP"
sui client object $ADMIN_CAP

# 2. Verify MSafe address
export MSAFE=$SUI_MSAFE_ADDRESS
echo "Transferring to MSafe: $MSAFE"

# 3. Dry-run first
sui client transfer \
  --to $MSAFE \
  --object-id $ADMIN_CAP \
  --gas-budget 20000000 \
  --dry-run

# 4. If dry-run looks good, execute
sui client transfer \
  --to $MSAFE \
  --object-id $ADMIN_CAP \
  --gas-budget 20000000

# 5. Verify ownership
sui client object $ADMIN_CAP
# Owner field should now be the MSafe address
```

### Phase 3 — Cron flow adaptation

Now cron admin calls (e.g., `admin_reset_daily_hedge_cap`) require an
MSafe co-signature. Two options:

**Option A: Move admin functions off the hot path.**
- Daily hedge cap reset — do it manually via MSafe proposal each day (or
  weekly if you set the cap generously). No cron dependency.
- External NAV attestation — this is the ONE frequent admin operation
  (every cron tick). See Option B.

**Option B: Introduce a delegated `OracleAttestorCap`.**
Split AdminCap into two capabilities in a subsequent Move upgrade:
- `AdminCap` (rarely-used, lives on MSafe): fee params, TVL cap, oracle
  strict-mode toggle, prover pubkey rotation, pause/unpause
- `OracleAttestorCap` (hot-key OK): only `admin_set_external_nav(nav)`
  — the frequent, low-privilege cron op

This gives the cron a low-privilege cap that CAN'T drain fees or drop
oracle strict mode. Compromise is bounded to stale NAV attestation, which
strict-mode already handles (rejects deposits/withdraws when stale).

**Recommended:** Option B. Move upgrade is straightforward — new cap
struct, one new admin entry point that mints it, rewire cron to use it.

## Rollback

MSafe can transfer AdminCap back to the hot wallet via a member proposal.
Requires m-of-n signatures per the MSafe threshold. Typical: 2 hours.

## Verification checklist

- [ ] `SUI_ADMIN_CAP_ID` no longer resolvable via the hot key wallet
- [ ] MSafe governance proposal to invoke `admin_reset_daily_hedge_cap`
      completes successfully within 10 min of proposal
- [ ] Cron tick after the transfer STILL succeeds (verifies Option B
      OracleAttestorCap wiring, or verifies Option A no-op path)
- [ ] Discord fires expected messages (no permission errors)

## Timeline expectations

- Phase 2 execution: 5 min
- Phase 3 Option B Move upgrade: 2-3 days (write + test + audit + deploy)
- Adjustment period + operator learning: 1 week

## Related

- `docs/HEDGE_PRIVACY_MAINNET_DEPLOY.md` — similar pattern for prover pubkey
- CLAUDE.md § Scale-readiness walls (AdminCap on hot key)
