# Internal Audit Packet

> The document an external auditor should read first. Every invariant we
> claim, every trust assumption we make, every known limitation, every
> attack vector we've mitigated (and every one we haven't). Written to
> maximize auditor productivity — the audit engagement should validate,
> falsify, or expand this document.

Last updated: 2026-07-01. Corresponds to git commit at time of packet
freeze — see `git log` for the exact SHA.

## 0 · Scope

**In scope for the audit:**
- All Move contracts under `contracts/sui/sources/` (10 files, ~5,500 LOC)
- The trade-gating stack: `agent-trade-guard.ts`, `position-drift-monitor.ts`, `SafeExecutionGuard.ts`
- ZK-STARK prover interface + on-chain verifier attestation flow
- Deposit/withdraw/hedge lifecycle end-to-end

**Explicitly out of scope:**
- EVM mirrors on Cronos / Hedera / Oasis / Sepolia (testnet only, no funds)
- Frontend UI code (no funds flow through it)
- Python ZK-STARK internal cryptography (separate cryptographic review path)
- Third-party SDK internals (BlueFin, Mysten Sui) — assumed correct with waivers on file

## 1 · Trust boundaries

Every fund-relevant path crosses one of these boundaries. An audit must
assert that trust across each boundary is either verified or documented.

| Boundary | We trust | We do not trust |
|---|---|---|
| SUI RPC → cron | RPC responses (no signature verification) | State returned that isn't cryptographically bound to a block |
| BlueFin API → cron | Orderhash means order accepted | Orderhash means order filled (we re-poll `getPositions`) |
| Polymarket API → PredictionAggregator | Ephemeral 5-min market data | Long-term claims (past accuracy is not tracked cryptographically) |
| User wallet → deposit tx | User signed the deposit | User's balance is spent (Move verifies) |
| Admin key → admin ops | Key holder is authorized (hot key today, MSafe planned) | Key hasn't been compromised (assume compromise possible) |
| Prover ed25519 sig → on-chain verifier | Sig proves the prover accepted the statement | Sig proves the underlying STARK math is correct (verified off-chain) |
| Cron heartbeat → dashboards | Health status is fresh (< 45min) | Cron didn't miss a critical action while down |

## 2 · Move contract invariants

Each invariant below is a CLAIM. The audit's job is to falsify these or
confirm them under all inputs.

### 2.1 · `community_pool_usdc.move`

- **I1: Share supply matches issued shares.** `total_shares` = sum of `members[addr].shares` over all members. Every `deposit` mints exactly `calculate_shares_for_deposit(amount)` new shares to `msg.sender` and increments `total_shares` by the same. Every `withdraw` burns exactly the requested share count.
- **I2: Share price is monotone up modulo drawdown.** `get_nav_per_share()` may decrease only when `total_assets_including_external()` decreases (market drawdown reflected in external NAV attestation). It MUST NOT decrease as a side effect of any `deposit`, `withdraw`, or `admin_*` call.
- **I3: Fees never exceed configured rates.** `management_fee_bps ≤ DEFAULT_MANAGEMENT_FEE_BPS_MAX`; `performance_fee_bps ≤ DEFAULT_PERFORMANCE_FEE_BPS_MAX`. Enforced by `E_FEE_TOO_HIGH`.
- **I4: `admin_set_external_nav` cannot go stale-forever.** In strict mode, deposits/withdraws revert with `E_EXTERNAL_NAV_STALE` if attestation age > 2h. Enforced by unconditional check in `deposit` and `withdraw`.
- **I5: `open_hedge` cannot drain > 50% of pool.** `min(daily_hedge_cap, 50% hedge ratio, 20% reserve)` — enforced at the entrypoint. `E_MAX_HEDGE_EXCEEDED`.
- **I6: `close_hedge` returns funds monotonically.** Any `close_hedge` invocation MUST increase `state.balance` by the amount attested by AgentCap holder. Enforced by `funds-verify` phase 14 fix.
- **I7: TVL cap is enforced.** Deposits above `total_assets + tvl_cap - total_deposits` revert. Currently $10k on mainnet.
- **I8: Withdrawal cap is enforced.** Single withdrawal ≤ `max_single_withdrawal_bps` of NAV, daily ≤ `daily_withdrawal_cap_bps`.
- **I9: Circuit breaker blocks state changes.** `is_paused == true` → every write function reverts. `E_PAUSED`.
- **I10: External NAV attestation is bounded by `E_EXTERNAL_NAV_CHANGE_TOO_LARGE`.** A single attestation cannot swing NAV by more than the configured percentage — prevents oracle-poisoning-drives-instant-drain.

### 2.2 · `zk_verifier.move`

- **I11: Insecure-mode fallback is only active when no prover pubkey is configured.** Once `admin_set_prover_pubkey` is called, `verify_with_prover` MUST use ed25519 verification against the message = `commitment_hash`.
- **I12: Signature dedup by SIGNATURE, not by `keccak256(proof_data)`.** Prevents proof-data-tail-mutation replay (audit phase 4 finding).
- **I13: `ProofRecord` is transferred to `verifier` (msg.sender), not to a shared account.** Prevents record squatting.

### 2.3 · `zk_proxy_vault.move`

- **I14: `withdraw` requires a valid ZK proof.** `verify_zk_proof` MUST succeed or the entire tx reverts. `E_INVALID_ZK_PROOF`.
- **I15: Time-locked withdrawal > threshold cannot be executed before `unlock_time`.** Enforced by `execute_withdrawal`.
- **I16: `cancel_withdrawal` releases the reserved amount back to `proxy.deposited_amount`.** No lost balance on cancel.

### 2.4 · `zk_hedge_commitment.move`

- **I17: Nullifier is single-use.** `store_commitment` reverts if `state.used_nullifiers[nullifier]` is set.
- **I18: `settle_commitment` cannot re-execute.** Commitment must be in `pending` state.

### 2.5 · `rwa_manager.move`

- **I19: Portfolio owner exclusively controls deposit/withdraw.** `deposit` and `withdraw` require `tx_context::sender() == portfolio.owner`.

## 3 · Off-chain (TS) invariants

### 3.1 · `AgentTradeGuard.checkBeforeTrade`

- **T1: Fail-open at agent layer, fail-closed at hard-limit layer.** If cached directives are stale or missing, the trade proceeds — but SafeExecutionGuard limits still apply.
- **T2: Every trade produces exactly one entry in `agent_decisions`.** Whether approved or rejected. Enforced by `recordAgentDecision` in both paths.
- **T3: `completeTrade` MUST be called for every `approved: true` response.** Otherwise SafeExecutionGuard's `activeExecutions` set leaks and eventually exceeds `maxConcurrentExecutions`.
- **T4: `HEDGE_AGENT_SIDE_BLOCK_CONFIDENCE` (default 70) is a HARD upper bound.** No env can lower this below 50 without a re-audit.
- **T5: The `stage='pass'` path includes SafeGuard validation.** No branch reaches `return { approved: true }` without invoking `safeExecutionGuard.validateExecution`.
- **T6: Multi-agent consensus (`requestConsensus` + votes + `checkConsensus`) is required for notional ≥ `LARGE_TRADE_CONSENSUS_USD`.** Default $100k. The votes are cast automatically from the same cached data, so this is currently a "single-source consensus" — audit should flag whether this is sufficient or should be replaced with independent LLM calls.
- **T7: ZK-STARK attestation is required for notional ≥ `ZK_ATTEST_MIN_NOTIONAL_USD`.** Default $1M. `ZK_ATTEST_STRICT=1` fails closed on prover unreachable.

### 3.2 · `PositionDriftMonitor.checkAndCloseDrifts`

- **T8: Only closes on agent-directive/risk-gate rejections.** SafeGuard cooldown/position-cap rejections are transient and MUST NOT trigger close.
- **T9: Filters positions below `HEDGE_DRIFT_MIN_NOTIONAL_USD` (default $10).** Below this, round-trip fees exceed misalignment loss.
- **T10: Rate limits at `HEDGE_DRIFT_MAX_CLOSES_PER_TICK` (default 3).** Prevents cascade close on any single tick.

### 3.3 · Cron

- **C1: Every cron route calls `verifyCronRequest`.** Returns 401 on failure. Regression tested in `test/api/cron/*.test.ts`.
- **C2: Every cron uses `tryClaimCronRun` for state-changing operations.** Prevents double-fire on QStash retries.
- **C3: Every cron writes `cron:lastRun:<route>` heartbeat.** `/api/health/production` reads these keys.

## 4 · Threat model (STRIDE analysis)

Each threat below is CLASSIFIED (S = Spoofing, T = Tampering, R = Repudiation, I = Info disclosure, D = DoS, E = Elevation of privilege) and has (a) a mitigation status and (b) residual risk assessment.

### 4.1 · Financial threats

| # | Threat | Class | Mitigation | Residual |
|---|---|---|---|---|
| F1 | Attacker deposits + withdraws in same block to steal share dilution | I/E | Deposit → share mint is atomic; withdraw uses `calculate_assets_for_shares`. Same-block manipulation requires MEV, not economically feasible at current TVL. | LOW at <$1M NAV, MEDIUM at $10M+ (needs private mempool or delay window) |
| F2 | Admin key compromise drains fees | E | AdminCap on hot key currently. Runbook 4 covers response. TA5 documents MSafe migration. | HIGH until MSafe migration complete |
| F3 | Prover key compromise mints unlimited attestations | E | Prover key server-side only, in env var. HSM planned (Tranche B). | HIGH until HSM in place; MEDIUM after strict-mode + rotation policy |
| F4 | Oracle poisoning (`admin_set_external_nav` with false value) | T | I10 caps single-attestation change; strict-mode requires < 2h freshness. AdminCap holder can toggle strict-mode → residual E. | MEDIUM (bounded by change cap, but non-strict-mode is a footgun) |
| F5 | BlueFin API returns stale positions → cron opens duplicate hedge | T | Cron re-polls `getPositions()` post-open with 2.5s delay; skips if position already exists. `bluefin-db-reconcile` cron every 15min. | LOW |
| F6 | Front-running cron rebalance | I/T | Cron uses market orders on BlueFin (no signed intents on public mempool). SUI rebalance swaps go through 7k aggregator with slippage cap. | LOW |
| F7 | Reentrancy on Move `withdraw` → `deposit` → `withdraw` cycle | E | Move's ownership model + linear resource management prevents reentrancy structurally. Not applicable. | ZERO (language-level guarantee) |

### 4.2 · Agent-manipulation threats

| # | Threat | Class | Mitigation | Residual |
|---|---|---|---|---|
| A1 | Polymarket signal manipulation (attacker distorts 5-min market) | T | Signal is only one weight (30%) in `PredictionAggregator`. Multi-source (Delphi, Crypto.com tickers, funding rates) requires broad manipulation. | MEDIUM (small pools with volume < $500 could distort) |
| A2 | Directive cache poisoning via `cron_state` DB compromise | T/E | DB write requires DATABASE_URL creds (server-only). Aiven multi-region + PgBouncer planned. | MEDIUM until multi-region |
| A3 | Signal-flip DoS via QStash cron flooding | D | `tryClaimCronRun` debounces every 90s. QStash upstream has its own rate limits. | LOW |
| A4 | Agent-guard bypass via env var manipulation | E | Env vars set in Vercel dashboard (2FA + audit log). `HEDGE_AGENT_SIDE_BLOCK_CONFIDENCE` cannot be set below 50 per T4 invariant (audit should verify this claim in code). | LOW |
| A5 | Consensus vote manipulation via time-race on `submitVote` | T | Auto-votes fire deterministically in the same request. External vote injection would require attacker to hit `/api/agents/*` with valid CRON_SECRET (server-side only). | LOW |

### 4.3 · Systemic threats

| # | Threat | Class | Mitigation | Residual |
|---|---|---|---|---|
| S1 | Aiven regional outage → all writes fail | D | Multi-region failover planned (Tranche B). Read-only degradation mode planned (1 hr eng). | HIGH until multi-region |
| S2 | Python prover crash → ZK-STARK gate fails-open | D | `ZK_ATTEST_STRICT=1` toggles to fail-closed. Health probe part of Runbook 1. | LOW when strict mode active |
| S3 | Vercel platform outage | D | No mitigation. Aligns with all other L7 platform risk. | ACCEPTED |
| S4 | Full-code-path DoS via API rate limit exhaustion | D | `readLimiter.check(request)` on every public route (120 req/min free tier). | LOW |
| S5 | Supply chain compromise (typosquat, dep hijack) | T/E | `verify-supply-chain.cjs` on prebuild; allowlist with 90-day expiry; overrides for known-safe transitives. | MEDIUM (external audit should re-verify allowlist) |

## 5 · Known limitations (things audit should VALIDATE we've documented, not fix)

- **NAV oracle single-source.** The `admin_set_external_nav` attestation is fed by the cron polling Crypto.com prices + BlueFin position values. There's no Pyth or Chainlink cross-check today. Documented as Tranche B work.
- **BlueFin as sole perp venue.** Multi-venue router (TA2) has adapter stubs for Hyperliquid + dYdX but no keys yet. Real hedging still 100% BlueFin.
- **Hot-key AdminCap.** Documented in TA5 runbook. Not yet executed.
- **Privacy contracts on testnet only.** `zk_hedge_commitment`, `zk_proxy_vault`, `zk_verifier` are deployed on testnet at `0xb1442796...`. Mainnet deploy pending — audit should verify the mainnet package IDs in `docs/SUI_DEPLOYMENT.md` do not yet include the privacy contract types.
- **`SettlementAgent` is x402-only.** Correctly excluded on SUI cycles. On Cronos it runs but x402 flows are not live in production either.
- **Custody attestor Move contract not deployed.** Code + tests + off-chain SDK are shipped. Deploy pending per `scripts/deploy-custody-attestor.md`.

## 6 · Test coverage summary

### 6.1 · Move (`sui move test`)

- 11/11 unit tests passing (as of 2026-06-30)
- Coverage includes: `community_pool_usdc` fee accrual + share math + circuit breaker; `zk_verifier` sig verify + dedup; `rwa_custody_attestor` all 11 attestation paths
- Gaps (audit should extend): fuzz-testing on `calculate_assets_for_shares` with adversarial share/asset ratios; property tests on external NAV strict-mode edge cases

### 6.2 · Off-chain E2E

- `scripts/test-agent-pipeline-e2e.ts` — 17/17 (agent gate, drift, consensus, ZK, router)
- `scripts/test-zk-stark-e2e.ts` — 4/4 (prover + verifier + tamper)
- `scripts/test-private-hedge-e2e.ts` — 12/12 (commit, encrypt, STARK, ed25519 bundle)
- `scripts/test-custody-attestor-e2e.ts` — off-chain path (Move contract not deployed)
- `scripts/audit-reconcile.ts` — cross-source state check
- `scripts/post-deploy-smoke-test.ts` — 9/9 against live prod URL (2026-07-01)
- `scripts/analyze-pool-pnl.ts` — read-only PnL diagnostic
- `scripts/check-hedge-signal-alignment.ts` — read-only signal check

### 6.3 · Jest (`bun test`)

- 70% coverage floor enforced in `jest.config.js`
- Full run requires Python ZK prover live (`ZK_PYTHON_ENABLED=true`)

## 7 · Deployment provenance

Every prod deploy has:
- Commit SHA in Vercel deploy metadata → `/api/health/production` returns SHA + build timestamp
- Signed commits: recommended but not yet enforced on `main`. Audit should verify branch-protection settings on GitHub.
- Lockfile-first policy enforced by `scripts/verify-supply-chain.cjs`
- `.audit-allowlist.json` review date visible

## 8 · What we want from the external audit

Prioritized list of questions we cannot answer ourselves:

1. **Move contract soundness:** Is `calculate_assets_for_shares` monotonic under adversarial member `high_water_mark` gaming? Are there input ranges where `share_price` can decrease without underlying asset loss?
2. **STARK attestation binding:** Given the current statement_hash construction (`hash(claim, 0x1f, public_inputs)`), can an attacker construct two different public_inputs that hash to the same statement_hash under any realistic collision-search budget?
3. **Consensus semantics:** Is our automated-vote consensus (all 3 agent votes derived from the same directive cache) actually a meaningful safety layer, or is it security theater? Recommend real independent-LLM-vote pattern if the latter.
4. **AdminCap blast radius:** Which specific admin functions, if invoked by a compromised key, are (a) instantly draining, (b) griefing-only, (c) recoverable-by-MSafe? Prioritizes which move to MSafe first.
5. **Oracle staleness edge cases:** Under what sequence of `admin_set_external_nav` + `deposit` + `withdraw` can a strict-mode pool return incorrect share prices? Concrete scenarios needed.

## 9 · Bounty pre-scope

If external audit surfaces findings that we cannot fix in-band, we intend
to launch an Immunefi bug bounty at the tier appropriate for actual TVL
(likely tier-2, up to $100k top payout for critical severity). Audit
findings should map cleanly to bounty scope.

## 10 · Access for auditor

**Repos:** Full git access on `main` branch. Feature branches on request.
**Live production:** Read-only Vercel dashboard access. Read-only Aiven DB access. Read-only Sui explorer links + package IDs.
**Test net:** Full deploy + destructive access. Test keys will be provided in encrypted brief.
**Communication:** Discord private channel + weekly async status.
**Duration:** Target 4-8 weeks. Weekly checkpoints. Interim findings published as they land, not held to end-of-engagement.

## 11 · What we already know is broken (self-disclosed)

Any audit engagement starts with a disclosure of known issues. Ours:

1. **Directive cache is derived from PredictionAggregator, not HedgingAgent's own reasoning** — the LeadAgent cycle runs the specialist agents but their `hedgingStrategy.recommendations` output feeds only into the Discord notification, not into the guard cache. Functionally equivalent (same data source underneath), semantically less rigorous.
2. **7 HIGH-severity npm audit findings remain** after triaging 8 to `.audit-allowlist.json`. Actionable ones (`lodash`, `next`, `path-to-regexp`) are transitives of currently-required Sui SDK versions.
3. **`test_zk_system.py` is bit-rotted.** References a renamed module (`zkp.core.true_stark` → `cuda_true_stark`). Doesn't affect the shipping `test_real_world_zk.py` or E2E suites.
4. **Multi-agent consensus is deterministic single-source** — see §8.3.

## Related documents

- `docs/ARCHITECTURE.md` — full system architecture
- `docs/CHANGELOG.md` — v0.1.0 / v0.2.0 / v0.3.0 release history with post-ship follow-ups
- `docs/DEPLOY_RUNBOOK.md` — incident response, env preset, BlueFin invariants (Appendix Y), reconcile topology
- `docs/SECURITY.md` — threat model + reporting policy
- `docs/SLO_AND_RUNBOOKS.md` — SLO + incident runbooks (Runbook 6: phantom rate, Runbook 7: alert-response-loop misfires)
- `docs/SUI_DEPLOYMENT.md` — mainnet deploy state + object IDs
- [SCALABILITY_ANALYSIS.md](./SCALABILITY_ANALYSIS.md) — scale-readiness walls (future work)
