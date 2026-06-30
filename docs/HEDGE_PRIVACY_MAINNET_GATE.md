# Hedge-Privacy Mainnet Gate

> Last updated: 2026-06-30. Status: **CODE-COMPLETE — pending mainnet deploy of privacy package.**
> Four of five blockers resolved in commit 6583da33+. Last blocker is operational:
> publish + `admin_set_prover_pubkey` per `docs/HEDGE_PRIVACY_MAINNET_DEPLOY.md`.

## What works today (verified 2026-06-30)

- **Python ZK-STARK prover (CUDA-accelerated):**
  - Health probe: `curl http://127.0.0.1:8000/health` → `cuda_enabled: true`, RTX 3070 (compute 8.6, 8 GB)
  - End-to-end gen → verify → tamper-reject: `bun run scripts/test-zk-stark-e2e.ts` → 4/4 pass
  - Default config: 1024 trace, 8× blowup, NIST P-521 (521-bit security), proof size ~100 KB JSON / ~50 KB binary
  - Real proof gen: 2-4 ms wall (CUDA + 1024 trace is too light for GPU to beat CPU; CUDA wins at trace ≥ 8192)
- **Authenticity tests:** `python test/zk-proofs/test_real_world_zk.py` → all 9 critical checks pass (hidden amounts, hidden addresses, statement-binding, no proof reuse, etc.). Note `test_zk_system.py` is bit-rotted (imports a renamed module); the working tests are `test_real_world_zk.py` + `test_production_ready.py` (partial).
- **TS service round-trips:** `bun run scripts/test-private-hedge-e2e.ts` → 8/9 pass
  - SHA-256 commitment deterministic + binding ✓
  - Nullifier derivation deterministic ✓
  - AES-256-GCM encrypt/decrypt recovers hedge exactly ✓
  - Real STARK proof generates + verifies via prover ✓
  - Tampered proof rejected ✓
  - **Statement-binding to `public_inputs` FAILS** ← gate #1 below

## Status snapshot (post-fix)

| Gate | Status | Verified by |
|---|---|---|
| #1 Soundness — public_inputs binding | ✅ FIXED | `test-private-hedge-e2e.ts` check #8 |
| #2 Dead `stealth_*` Move calls | ✅ FIXED | Service rewritten to call live `deposit`/`withdraw`/`store_commitment` |
| #3 Mainnet contracts not deployed | ⏳ DEPLOY PENDING | Runbook: `docs/HEDGE_PRIVACY_MAINNET_DEPLOY.md` |
| #4 Mock STARK proofs | ✅ FIXED | `test-private-hedge-e2e.ts` checks #5-#10 prove real STARK + ed25519 + on-chain wire format |
| #5 Cron not emitting commitments | ✅ FIXED | `lib/services/sui/cron/private-hedge-emit.ts` wired into `sui-community-pool` after `openHedge` fill |

## Original five mainnet blockers (kept for context)

### Gate #1 — Soundness: `public_inputs` not bound to proof

**Found by:** `scripts/test-private-hedge-e2e.ts` 9th check.

A proof generated with public_inputs=[200] verifies successfully when the verifier asks for public_inputs=[1_000_000]. The Python verifier reconstructs the statement from `claim + public_inputs` provided by the caller, but the `statement_hash` inside the proof is bound only to the `claim` string, not to the public_inputs array.

**Impact:** an attacker who proved "my collateral covers a $1 margin" can replay the same proof to claim "my collateral covers a $1M margin." For a private hedge that's a fatal soundness break — the whole point is the prover commits to a specific public threshold.

**Fix path:**
- `zkp/core/cuda_true_stark.py` — change statement-hash computation to fold `public_inputs` into the same hash as `claim`. Then any verifier-supplied public_inputs that don't match the prover-supplied ones produce a different statement_hash → verification fails at the hash check.
- Add a regression test that re-runs the 9th check above and asserts `wrongClaimValid === false`.

**Effort:** ~2 hours code + tests.

### Gate #2 — Move source: `stealth_deposit` / `stealth_withdraw` don't exist

**Found by:** `grep "stealth_" contracts/sui/sources/zk_proxy_vault.move` → 0 matches.

`SuiPrivateHedgeService.buildStealthDepositTransaction` and `buildStealthWithdrawTransaction` (lines 212, 238) call `zk_proxy_vault::stealth_deposit` and `zk_proxy_vault::stealth_withdraw`. Neither exists in `zk_proxy_vault.move`. Only `deposit` (line 373) + `withdraw` (line 404) — with time-lock semantics — are present.

**Impact:** any TS attempt to build a stealth-deposit tx will produce a payload that reverts at PTB build time on mainnet (function not found).

**Two fix paths (pick one):**

(a) **Drop the stealth path** — current `deposit`/`withdraw` is already privacy-preserving via the `ProxyBinding` object (owner address is derived, not revealed). Update the TS service to call `deposit`/`withdraw` and remove the dead `stealth_*` builders. Simpler. Recommended for v1.

(b) **Add `stealth_deposit` to Move** — extend `zk_proxy_vault.move` with stealth-tag-only entry points (no `tx_context::sender()` call, stealth tag goes in as `vector<u8>`). Requires Move audit + redeploy.

**Effort:** (a) ~1 day. (b) ~1 week + audit.

### Gate #3 — Mainnet deployment addresses are empty

**Found by:** `lib/services/sui/SuiPrivateHedgeService.ts:37-45`.

```ts
mainnet: {
  packageId: '',                  // ← empty
  zkHedgeCommitmentState: '',     // ← empty
  zkVerifierState: '',            // ← empty
  zkProxyVaultState: '',          // ← empty
  ...
}
```

Privacy contracts (`zk_hedge_commitment.move`, `zk_verifier.move`, `zk_proxy_vault.move`) are deployed to **testnet only** at `0xb1442796...283a`. The mainnet pool package (`0x107292...7b726`) does **not** include them. CLAUDE.md's contract list shows them in `contracts/sui/sources/` but no mainnet deploy doc exists.

**Fix path:**
- Build + publish to mainnet as a separate package (independent UpgradeCap).
- Capture state object IDs into `.env.local` and a deployment doc.
- Update `SuiPrivateHedgeService.SUI_ZK_DEPLOYMENTS.mainnet` to read from env (not hardcoded), so testnet/mainnet swap is config-only.
- Gas: ~0.4-0.6 SUI (similar to v0.2.0 community pool deploy).

**Effort:** ~1 day, gated by Gate #2 fix landing first.

### Gate #4 — Proof generation is mocked, not wired to the Python prover

**Found by:** `lib/services/sui/SuiPrivateHedgeService.ts:311-339`.

`generateExistenceProof` and `generateSolvencyProof` produce Groth16-shaped fake proofs from SHA-256 hashes:

```ts
const proofHash = this.sha256(commitmentHash + random + Date.now());
return {
  proof: { a: [...], b: [...], c: [...] },  // ← decorative, not a real proof
  publicSignals: [...]
};
```

`verifyProof` returns `true` unconditionally without calling the prover.

The real Python ZK-STARK system **does** work (verified above). It just isn't wired into the hedge service.

**Fix path:**
- Replace both `generateExistenceProof` and `generateSolvencyProof` bodies with HTTP calls to `${ZK_PYTHON_API_URL}/api/zk/generate` + poll `/api/zk/proof/{job_id}`. The pattern is already in `scripts/test-zk-stark-e2e.ts`.
- Replace `verifyProof` with an HTTP call to `/api/zk/verify`.
- Convert the STARK proof structure (merkle_root, challenge, response, query_responses) to a format `zk_verifier.move::verify_proof_for_portfolio` expects (the Move verifier already understands ed25519-signed prover attestations — see `admin_set_prover_pubkey` flow).
- Add an env var `ZK_PYTHON_API_URL` (already used by the test scripts).

**Effort:** ~2 days. Depends on Gate #1 landing (otherwise we wire a broken verifier into production).

### Gate #5 — Cron has no path to use the private stack

**Found by:** `grep "SuiPrivateHedge|stealth" app/api/cron/sui-community-pool/route.ts lib/services/sui/cron/*.ts` → 0 matches.

The auto-hedge cron calls `BluefinService.openHedge()` directly. None of the privacy primitives — commitment, nullifier, encryption, proof — are invoked. Hedges are fully public on BlueFin (positions visible via their public API).

**Fix path (smallest useful step):**
- In `lib/services/sui/cron/hedge-treasury.ts`, after a successful `openHedge()`, generate a SHA-256 commitment of the hedge details + nullifier + encrypted payload, then submit `zk_hedge_commitment::store_commitment` as a follow-up tx. This adds an on-chain **proof that the cron opened a hedge with specific (hidden) parameters** without revealing them — useful for grant-day demos and reporting.
- Note: this does NOT hide the underlying BlueFin perp from the public BlueFin API. True hedge privacy at the venue layer requires running the perp behind a stealth-vault-owned account, which is Gate #2 (b) territory.

**Effort:** ~1 day after Gates #2-#4 land.

## Recommended sequence

1. **Gate #1 first** (soundness — 2 hours). Without this, every other gate ships a broken verifier.
2. **Gate #2 (a)** (drop the stealth path, use existing deposit/withdraw — 1 day). Cheapest unlock.
3. **Gate #4** (wire real prover — 2 days). Now `SuiPrivateHedgeService` is actually doing ZK.
4. **Gate #3** (mainnet deploy — 1 day). Privacy contracts go live.
5. **Gate #5** (cron emits commitments — 1 day). Production hedges produce on-chain ZK attestations.

**Total: ~5.5 days of focused work.** Each step is independently testable. Stop at any point and the system is still consistent.

## What stays at testnet

Even after all five gates clear, the following remain **testnet-only** until separate audits:

- Stealth vault path (Gate #2 (b)) — requires Move audit + UX flow design (how do users prove ownership of a stealth address?)
- Proof aggregation across batches — `zk_hedge_commitment::aggregate_batch` exists but is unused
- Cross-chain hedge privacy — Move ↔ EVM bridge for private hedges is unspecified

## Verification scripts

| Script | What it proves | Runtime |
|---|---|---|
| `bun run scripts/test-zk-stark-e2e.ts` | Prover up + CUDA + gen + verify + tamper-reject | 5s |
| `bun run scripts/test-private-hedge-e2e.ts` | Commitment + nullifier + encryption + real STARK + statement-binding | 10s |
| `python test/zk-proofs/test_real_world_zk.py` | Original 9-check authenticity suite | 20s |

All require `python zkp/api/server.py` running first.

## Open question for grant scope

The grant deck claims "private hedges" as a shipped feature backed by `zk_proxy_vault.move`. Today that claim is **partially true**:
- ✅ Move contracts exist and are tested (zk_hedge_commitment 502 LOC, zk_proxy_vault 727 LOC, zk_verifier 484 LOC)
- ✅ Move contracts compile + 11/11 unit tests pass
- ✅ Move contracts are deployed to testnet
- ❌ Move contracts are NOT deployed to mainnet
- ❌ TS service calls non-existent Move functions
- ❌ Proof generation is mocked
- ❌ Cron does not use the privacy stack at all

For grant honesty, either:
- (a) Update the deck to "private hedges primitive complete, mainnet wiring tranche 2/3"
- (b) Land the 5.5-day sequence above and update the deck to "private hedges live on mainnet"

(a) is the honest position today. (b) is the grant-positioning win.
