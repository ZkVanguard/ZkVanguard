# AdminCap → MSafe Migration Runbook

> **Purpose:** Transfer `AdminCap` from the hot operator wallet to MSafe multisig.
> One of the explicit Tranche 2 milestones of the SUI Foundation grant.
> `FeeManagerCap` already lives on MSafe; this closes the AdminCap loop.

## Why this matters

- `AdminCap` controls: pause/unpause pool, set TVL cap, set strict-mode flag,
  set external NAV (during the oracle window), grant/revoke `AgentCap`,
  reset daily hedge caps, change fee bps.
- Today it lives on `SUI_ADMIN_ADDRESS` (the operator hot wallet).
- Hot-wallet compromise → full admin power → drain via reset + max TVL cap.
- MSafe-held AdminCap requires N-of-M signatures for any privileged op,
  reducing single-point-of-compromise risk dramatically.
- `MAINNET_READINESS.md` and `GRANT_HONEST_ASSESSMENT.md` both flag this as
  the #1 outstanding custody risk.

## Pre-migration checklist

- [ ] **MSafe wallet exists on SUI mainnet** with the right signer set
  (verify: `sui client object <msafe_address>` shows valid Multisig object)
- [ ] **Signer set documented** — minimum 3 signers, recommended threshold 2-of-3
- [ ] **Cold-storage signers** — at least 2 of the signers should be hardware-wallet-backed
- [ ] **Backup AdminCap holder identified** — in case MSafe needs to be rotated;
  optional initial second-AdminCap mint to a recovery multisig
- [ ] **Operational impact assessed:**
  - `sui-community-pool` cron uses `SUI_AGENT_CAP_ID` for hedge-related ops
    (NOT `AdminCap`) — confirm via grep
  - Daily hedge cap reset (`admin_set_daily_cap`) uses `AdminCap` — this will
    need MSafe signature flow OR be migrated to `AgentCap`
  - External NAV oracle post (`admin_set_external_nav`) uses `AdminCap` —
    same constraint
- [ ] **Test the MSafe flow on testnet first** with a throwaway AdminCap mint
- [ ] **Discord operator alert configured** for any AdminCap-using transaction
  (already exists via `notifyDiscord`)

## Migration steps (mainnet)

```bash
# 1. Identify current AdminCap object ID
sui client objects --owner $SUI_ADMIN_ADDRESS --json \
  | jq '.[] | select(.data.type | test("AdminCap"))'

# 2. Build the transfer transaction (TXBYTES) — do NOT submit yet
sui client ptb \
  --transfer-objects "[<admin_cap_object_id>]" "@<msafe_address>" \
  --serialize-unsigned-transaction \
  > admincap_transfer_tx.b64

# 3. Sign with operator wallet (current holder)
sui keytool sign-and-execute-transaction --tx-bytes "$(cat admincap_transfer_tx.b64)"

# 4. Verify transfer on-chain
sui client object <admin_cap_object_id> --json \
  | jq '.data.owner'
# Expected: { "Shared": ... } if shared, or { "AddressOwner": "<msafe_address>" }
```

## Operational changes after migration

### Crons that use AdminCap

Audit + update each:

| Code path | Current behavior | Post-migration |
|---|---|---|
| `app/api/cron/sui-community-pool/route.ts` daily-cap reset | Direct AdminCap call | Build TX, route to MSafe API for signing |
| `app/api/cron/sui-community-pool/route.ts` external NAV oracle write | Direct AdminCap call | Same — MSafe signature required |
| `scripts/upgrade-sui-contract.ts` package upgrade | Direct AdminCap call (uses UpgradeCap actually — verify) | UpgradeCap is separate — likely unaffected |
| `scripts/pause-sui-pool.ts` emergency pause | Direct AdminCap call | MSafe signature flow (acceptable for emergency since 2 signers can sign quickly) |
| `scripts/admin_set_*.ts` config updates | Direct AdminCap call | MSafe signature flow |

### MSafe API integration

ZkVanguard's MSafe partnership (from `FeeManagerCap` migration) should already
have:
- MSafe API endpoint configured
- Signer keys distributed
- Off-chain signature relay set up

**New code needed:**
- `lib/services/sui/MSafeAdminCapService.ts` — wraps TX construction +
  MSafe API call + status polling
- `app/api/admin/admincap-tx/route.ts` — admin endpoint to build a TX
  bytes for MSafe signing (so the cron doesn't try to sign directly)

## Rollback plan

If MSafe migration breaks operational crons:

1. Quickest path: have one MSafe signer pre-sign a "transfer AdminCap back to
   operator address" TX. Store it offline. Co-sign + submit if needed.
2. Slower path: emergency MSafe vote to mint a new AdminCap to operator
   (requires Move-level capability creation, may not be supported by
   community_pool_usdc.move — verify before relying on this path)

## Acceptance criteria (Tranche 2 milestone)

- [ ] AdminCap object owner = MSafe address (verified via Suiscan)
- [ ] One operational test: external NAV oracle write succeeds via MSafe
  signature flow within 10 minutes (acceptable cron tolerance)
- [ ] Discord alert fires on next AdminCap-using TX
- [ ] `MAINNET_READINESS.md` updated to remove "AdminCap on hot wallet" risk
- [ ] Grant Tranche 2 submission packet updated with migration TX hash

## Estimated time

- Testnet rehearsal: 1 day
- Code updates (MSafeAdminCapService + cron migrations): 2-3 days
- Mainnet migration window + verification: 1 day
- Total: ~4-5 working days

Schedule after Tranche 1 audit kickoff so the migration happens in parallel
with the auditor's review (they may want to review the MSafe signature flow
as part of the audit scope).

Last updated: 2026-06-29
