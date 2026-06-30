# Hedge-Privacy Mainnet Deploy Runbook

> Privacy contracts (`zk_hedge_commitment.move`, `zk_verifier.move`,
> `zk_proxy_vault.move`) → SUI mainnet, as a NEW package separate from the
> community-pool v0.2.0 package.
>
> Time: ~30 min. Gas: ~0.6 SUI. One-time.

## Prerequisites

| Check | Command |
|---|---|
| sui CLI ≥ 1.32 | `sui --version` |
| Move audit passes | `sui move test --path contracts/sui` (11/11 + 14 audit phases ok) |
| Operator wallet has ≥ 0.7 SUI | `sui client gas` |
| Mainnet RPC reachable | `sui client envs` shows `mainnet active` |
| Python prover key generated | see step 2 below |

## Step 1 — Build the privacy-only package

The privacy contracts live in the same source tree as the community pool but
deploy as a separate package so the pool's UpgradeCap stays untouched. Create
a slim `Move.toml` if one doesn't already exist for the privacy package, or
deploy the whole `contracts/sui` tree (all modules go up together — cheaper
than splitting).

```bash
cd contracts/sui
sui move build --skip-fetch-latest-git-deps
# Note: `sui move build` strips the [env] block from Move.lock — re-append:
git checkout Move.lock
```

## Step 2 — Generate the ed25519 prover signing key

This is the key the Python prover uses to sign `commitment_hash` so the
on-chain `zk_verifier::verify_proof` accepts the proof bundle. Keep it
**server-side only**. Anyone with this key can mint valid attestations.

```bash
python -c "
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
priv = Ed25519PrivateKey.generate()
pub = priv.public_key().public_bytes(
  encoding=serialization.Encoding.Raw,
  format=serialization.PublicFormat.Raw)
priv_b = priv.private_bytes(
  encoding=serialization.Encoding.Raw,
  format=serialization.PrivateFormat.Raw,
  encryption_algorithm=serialization.NoEncryption())
print('ZKV_PROVER_PRIV_KEY_HEX=' + priv_b.hex())
print('PROVER_PUBKEY_HEX_FOR_ON_CHAIN=' + pub.hex())
"
```

Save the `ZKV_PROVER_PRIV_KEY_HEX` value in Vercel env (server-side only,
NOT `NEXT_PUBLIC_`). Keep the pubkey for step 5.

## Step 3 — Publish

```bash
sui client publish --gas-budget 700000000 --skip-fetch-latest-git-deps contracts/sui
```

From the publish response, capture:

| Want | Where to find it |
|---|---|
| `PackageID` | `Object Changes ▸ Published Objects ▸ PackageID` |
| `ZKHedgeCommitmentState` | shared object with type `…::zk_hedge_commitment::ZKHedgeCommitmentState` |
| `ZKVerifierState` | shared object with type `…::zk_verifier::ZKVerifierState` |
| `ZKProxyVaultState` | shared object with type `…::zk_proxy_vault::ZKProxyVaultState` |
| `AdminCap` | object with type `…::*::AdminCap` (whichever module exposes it) |

Save IDs in a doc — they're public, so commit them to a deploy log.

## Step 4 — Pin the addresses

Add to Vercel **production environment** (and `.env.local` for parity):

```
NEXT_PUBLIC_SUI_MAINNET_ZK_PRIVACY_PACKAGE_ID=0x<PackageID from step 3>
NEXT_PUBLIC_SUI_MAINNET_ZK_HEDGE_COMMITMENT_STATE=0x<ZKHedgeCommitmentState>
NEXT_PUBLIC_SUI_MAINNET_ZK_VERIFIER_STATE=0x<ZKVerifierState>
NEXT_PUBLIC_SUI_MAINNET_ZK_PROXY_VAULT_STATE=0x<ZKProxyVaultState>
SUI_MAINNET_ZK_ADMIN_CAP=0x<AdminCap>
```

Trigger a Vercel redeploy so the new env is picked up.

## Step 5 — Bind the prover pubkey on-chain

Without this step the Move verifier falls back to "INSECURE MODE" (length
check only — see `zk_verifier.move:236`). Anyone could forge a payload.

```bash
sui client call \
  --package $NEXT_PUBLIC_SUI_MAINNET_ZK_PRIVACY_PACKAGE_ID \
  --module zk_verifier \
  --function admin_set_prover_pubkey \
  --args $NEXT_PUBLIC_SUI_MAINNET_ZK_VERIFIER_STATE \
         $SUI_MAINNET_ZK_ADMIN_CAP \
         "[$(echo $PROVER_PUBKEY_HEX_FOR_ON_CHAIN | sed 's/../&,/g; s/,$//' | tr -d '\n')]" \
  --gas-budget 20000000
```

Repeat for `zk_hedge_commitment` and `zk_proxy_vault` if their state objects
also store a prover pubkey (check with `sui move show ::admin_set_prover_pubkey`).

## Step 6 — Smoke test

From the project root:

```bash
# Make sure the Python prover is running with ZKV_PROVER_PRIV_KEY_HEX set
ZKV_PROVER_PRIV_KEY_HEX=<key> python zkp/api/server.py

# The off-chain attestation E2E should pass 12/12
bun run scripts/test-private-hedge-e2e.ts
```

Then trigger ONE auto-hedge cycle and watch:
- BlueFin openHedge fills
- Cron logs `[PrivateHedgeEmit] store_commitment OK` with a `txDigest`
- Suiscan shows the new `ZKHedgeCommitmentState` table entry
- Discord receives the `ZK commitment stored for X-PERP hedge` message

## Step 7 — Lock the loop

Phase the rollout:

| Phase | Days | Action |
|---|---|---|
| 0 | 0-1 | Deploy + smoke test. Commit emission stays best-effort; openHedge never blocks. |
| 1 | 1-7 | Watch one week of emissions. Verify nullifiers don't collide; commitments line up 1:1 with `hedges.order_id` rows. |
| 2 | 7-14 | Wire `verify_proof_for_portfolio` for proxy-vault withdrawal flow; require a fresh STARK + ed25519 bundle per withdrawal. |
| 3 | 14-30 | Move `SUI_MAINNET_ZK_ADMIN_CAP` to MSafe (matches `FeeManagerCap` policy). |

## Rollback

If anything goes wrong:

1. **Stop emissions** — set `HEDGE_PRIVATE_EMIT_DISABLE=1` in Vercel env (the
   cron wrapper checks this before importing the emit module — currently
   not implemented; add as a 1-line guard if you anticipate needing it).
2. **Pause the verifier** — `sui_client call --module zk_verifier --function
   set_paused --args $STATE $ADMIN_CAP true`. Pool is unaffected; only ZK
   proof verification is gated.
3. **Hard rotate** — if the prover key is compromised: generate a fresh key,
   restart the Python server with new `ZKV_PROVER_PRIV_KEY_HEX`, call
   `admin_set_prover_pubkey` with new pubkey. Old key-signed proofs reject
   immediately.

## Open items deferred to grant tranche 2/3

- `aggregate_batch` (commitment batching) — `zk_hedge_commitment.move:391` —
  unused today; useful for stealth UX where many users emit at once.
- Move-side STARK verification — currently all soundness lives in the
  off-chain prover + the ed25519 attestation. Native Move STARK verification
  would remove the need to trust the prover key holder.
- MSafe-gated `AdminCap` — sale of the rollout phase 3.
- Stealth tag routing in `zk_proxy_vault` (rather than open `owner` field).
  Out of scope for v1.

## Reference

- **Gate doc:** `docs/HEDGE_PRIVACY_MAINNET_GATE.md` — the blockers each step closes
- **TS service:** `lib/services/sui/SuiPrivateHedgeService.ts`
- **Cron wiring:** `lib/services/sui/cron/private-hedge-emit.ts` + call site at `app/api/cron/sui-community-pool/route.ts:2532`
- **Python prover:** `zkp/api/server.py` — `/api/zk/generate`, `/api/zk/verify`, `/api/zk/attest`, `/api/zk/prover-pubkey`
- **E2E tests:** `scripts/test-zk-stark-e2e.ts` (4 checks), `scripts/test-private-hedge-e2e.ts` (12 checks)
