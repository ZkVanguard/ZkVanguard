# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for active vulnerabilities.**

Email `ashishregmi2017@gmail.com` with the details, or use GitHub's private [security advisory](https://github.com/ZkVanguard/ZkVanguard/security/advisories/new). PGP available on request.

Include:
- Type of vulnerability
- Affected file paths + commit hash
- Repro steps
- Proof-of-concept or exploit code if possible
- Impact analysis

### Response timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 7 days
- **Status updates**: every 7 days until resolution
- **Fix release**: severity-dependent — critical Move contract issues get emergency deploy within 24h

## Supported versions

| Version | Supported | Notes |
|---|---|---|
| v0.2.0 | ✅ | Live on Sui mainnet since 2026-06-12. Current. |
| v0.1.0 | ❌ | Dormant package `0x9ccb…cd83e598c88`, pool state preserved through upgrade |

## Current defense posture

**Pre-external-audit.** TVL is deliberately capped at $10K by the Move contract (`admin_set_tvl_cap`) — cap lifts only after external audit closes.

### Structural guards (always-on)

- **Strict NAV-oracle mode** — deposits/withdrawals revert if cron oracle attestation is > 2h stale
- **2-of-3 agent consensus** on trades > $100K (SafeExecutionGuard)
- **10% peak-NAV drawdown halt** — auto-halts new hedges until UTC midnight
- **Circuit breaker** — trips after 3 consecutive execution failures, auto-resets after 60s
- **3-way reconciliation** — on-chain Move ↔ BlueFin ↔ Postgres, sweeps every 15 min / 1h
- **OFAC geo-block** — KP, IR, SY, CU, RU, BY at middleware layer
- **AgentCap funds-verify** — `close_hedge` prevents drain scenarios
- **Non-custodial withdrawals** — Move contract computes payouts against on-chain state
- **Fee routing to MSafe multisig** — `FeeManagerCap` off hot wallet

### 8-gate autonomy defense system (shipped July 2026)

| Gate | Defends against |
|---|---|
| PortfolioDriver | Existing spot never unwound when profit-lock fires — actively reshapes balance sheet |
| Fill verifier | BlueFin silent-reject — orders returning orderHash but never landing on exchange |
| Hedgeability spot-cap | At small NAV, perp minQty makes hedging impossible — spot cap forced to 0 |
| Symmetric sell trigger | Rebalance one-sided — now sells on ≥65% opposing signal |
| Stale-hedge detector | Positions > 7d old with ≥ 2 signal flips force-close |
| Signal-flip drift-close | Both perp AND spot legs unwind on direction flip |
| AI regret weighting | Position size shrinks after losing streaks |
| Alert response loop | 3 KILL alerts/hr auto-shrinks spot; 24h profit-lock auto-unwinds; phantom rate > 1% halts trader |

Verified by `bun jest test/integration/pool-drawdown-defense.test.ts` (10/10 green).

### Move contract security

- 15 internal audit phases completed pre-mainnet (see [`AUDIT_2026-06-04.md`](./AUDIT_2026-06-04.md), [`AUDIT_2026-06-12_phase15_offchain.md`](./AUDIT_2026-06-12_phase15_offchain.md))
- External audit: SUI Foundation grant Tranche 1 deliverable (pending)
- `zk_proxy_vault` cross-proxy + 4 ZK contracts with ed25519 prover attestation
- `admin_set_external_nav_required(true)` — strict oracle mode ON

### BlueFin invariants (silent-reject prevention)

Every open/close must follow — see [`DEPLOY_RUNBOOK.md`](./DEPLOY_RUNBOOK.md) Appendix Y:
1. Snap quantity to per-symbol step size before signing
2. Close at position's leverage (not 1×)
3. Never `reduceOnly: true` (deprecated, API rejects)
4. Verify fill via `getPositions()` size delta before declaring success
5. `isIsolated: true` always — BlueFin Pro currently supports ISOLATED margin only

## Practical guidelines

### For operators
- `.env.local` never committed — DB + QStash + Crypto.com only; no BlueFin/SUI signing keys locally
- `SUI_POOL_ADMIN_KEY` server-only, `.trim()` every read (CRLF trap on Vercel)
- Never log private keys anywhere
- Rotate keys quarterly

### For contributors
- All API routes must call `verifyCronRequest` or auth middleware
- All new crons must claim `cron_state` slot before capital actions
- No new top-level `test-*.ts` files — use `scripts/` or `test/integration/`

## Bug bounty

See [BUG_BOUNTY.md](./BUG_BOUNTY.md) for scope and tiers. Live once external audit completes.

---

**Last updated:** 2026-07-15
