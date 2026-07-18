# ZK Vanguard - Mainnet Readiness Documentation

> **⚠ Partially historical.** This document was the pre-deploy readiness assessment that gated the 2026-06-12 v0.2.0 mainnet launch. Sections below reference the EVM-era Cronos/CRO framing and pre-launch test suites. For **current mainnet posture**, read the section immediately below.

## Current mainnet status (as of 2026-07-15)

**Live on Sui mainnet since 2026-06-12** — package `0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726`, USDC pool state `0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a`. See [`SUI_DEPLOYMENT.md`](./SUI_DEPLOYMENT.md).

**Cap:** deliberately capped at $10K TVL by contract (`admin_set_tvl_cap`); lifts on external-audit close per [`ROADMAP.md`](./ROADMAP.md).

**Defense posture:** 8-gate autonomy defense system shipped 2026-07-15 (v0.3.0). Verified by `test/integration/pool-drawdown-defense.test.ts` (10/10 green). See [`SECURITY.md`](./SECURITY.md).

**Live metrics** (snapshot 2026-07-15; rerun `scripts/analyze-pool-pnl.ts` for current numbers):
- **46+ days** running since first NAV snapshot (2026-05-29)
- **2,200+ NAV snapshots** recorded (≈48/day, matches 30-min cron cadence)
- **214 hedges** executed lifetime across BTC / ETH / SUI / SOL PERPs
- **13 active crons** with heartbeats — see `/api/health/production`
- **3 members** / **~$38 lifetime deposits** (bounded by $10K TVL cap)
- **ATH share price:** $1.9668 on 2026-06-26 · currently in drawdown (~36% from ATH as of last snapshot; PortfolioDriver + hedgeability clamp actively defend when `PORTFOLIO_DRIVER_EXECUTE=1`)

**Cap-lift criteria** (per Q3 2026 milestone):
- External audit close (SUI Foundation grant Tranche 1 deliverable)
- 30-day incident-free window
- > $50K deposited across ≥ 20 members

**External audit:** pending — grant deliverable. Bug bounty (see [`BUG_BOUNTY.md`](./BUG_BOUNTY.md)) unlocks post-audit.

---

## Scale & Security Hardening — phased plan

Concrete action plan to move from "$10K TVL, 3 members, single-venue, hot-key AdminCap" to "audited, multi-venue, multi-sig, insured, scale-ready". Each item has an **exit criterion** — the check that says the item is done. Effort is dev-days for me solo; external-blocked items are marked.

**Legend:** ✅ done · 🟡 in-flight · ⬜ not started · 🔒 externally blocked

### Phase 0 — This week (no external deps, doc + posture)

| # | Item | Exit criterion | Effort | Status |
|---|---|---|---|---|
| 0.1 | Doc drift on `NAV_SAFETY_CEILING_USDC` (500M → 10B) | DEPLOY_RUNBOOK + ROADMAP consistent with code | 0.1d | ✅ 2026-07-18 |
| 0.2 | `.env.example` completeness — 19 real gaps (52 total; 33 have safe defaults) | Every safety-critical env read has a documented key (v0.3.0 gates, SUI capability IDs, DISCORD_WEBHOOK_URL, TREASURY_PRIVATE_KEY, Aiven notes, internal URLs) | 0.5d | ✅ 2026-07-18 |
| 0.3 | Schedule QStash cron for `alert-response-loop` | `curl $QSTASH_URL/v2/schedules` shows it live, `cron:lastRun:alert-response-loop` heartbeat within 20 min | 0.1d | ⬜ |
| 0.4 | Confirm 24h `[log-only]` observation window is complete on v0.3.0 defense | Discord log-only entries reviewed, no false-positives; incident-free | 1d observation | ⬜ |
| 0.5 | Flip `PORTFOLIO_DRIVER_EXECUTE=1` in Vercel env, redeploy | First execute-mode Discord `TRADE` entry from PortfolioDriver in prod | 0.1d | ⬜ (blocked on 0.4) |
| 0.6 | LLM provider chain drift (CLAUDE.md said Ollama-last, code is Ollama-first) | Recheck `llm-provider.ts` initialization order matches docs | 0.1d | ✅ 2026-07-18 |

### Phase 1 — Weeks 1-4 (single-move leverage)

| # | Item | Exit criterion | Effort | Status |
|---|---|---|---|---|
| 1.1 | External audit firm engagement (Zellic / OtterSec / MoveBit) | Signed engagement letter + kick-off date | 2d + 🔒 auditor availability | ⬜ |
| 1.2 | **`AdminCap` MSafe migration** — currently on hot key, single-point theft surface | `admin_*` PTB requires MSafe co-sign; verified by rejected direct call | 3d (Move + MSafe policy + rehearsal on testnet) | 🟡 runbook drafted [`MSAFE_ADMINCAP_MIGRATION.md`](./MSAFE_ADMINCAP_MIGRATION.md); execution sequenced AFTER 1.1 (audit clearance for OracleCap split) |
| 1.3 | Aiven Business tier + PgBouncer | Connection limit ≥100; health endpoint no longer needs serialisation | 1d + 🔒 Aiven upgrade cost | ⬜ |
| 1.4 | Flip remaining v0.3.0 execution gates: `STALE_HEDGE_AUTO_CLOSE`, `ALERT_RESPONSE_EXECUTE`, `ALERT_RESPONSE_EXECUTE_HALT` | Each flipped independently with 72h log-observe between flips | 0.5d each + observation | ⬜ (blocked on 0.5) |
| 1.5 | External audit prep bundle — updated `INTERNAL_AUDIT_PACKET.md` with v0.3.0 addendum (T11-T20 invariants, F8-F11 threats, 8 audit-question additions) | Auditor receives single-URL bundle: tag, spec, threat model, prior findings | 2d | ✅ 2026-07-18 |
| 1.6 | Secrets audit + webhook rotation | Grep repo + Vercel env for any leaked webhook URLs; rotate any found | 0.3d | ✅ 2026-07-18 — clean; only Hardhat default test key in `scripts/tests/test-moonlander-local.ts` (public fixture, not a leak); `.gitignore` correctly excludes `.env*`; no rotation needed |
| 1.7 | Bug-bounty spec (`docs/BUG_BOUNTY.md`) finalised — scope, payout tiers, exclusions | Doc merged; ready to activate on audit close | 1d | ✅ 2026-07-18 — v0.3.0 defense modules + halt-flag griefing added to scope |

### Phase 2 — Months 1-3 (contract + scale walls)

| # | Item | Exit criterion | Effort | Status |
|---|---|---|---|---|
| 2.1 | Move u128 redeploy — fee/cap math widened past u64 overflow | New pkg deployed; `admin_upgrade_state_from_v0_2` migrates existing pool without withdraw pause > 30 min | 5-8d + 🔒 audit close (Phase 1.1) | ⬜ |
| 2.2 | Multi-venue perp router — Hyperliquid first (closest to BlueFin V2 semantics) | Hedge open routes through router; per-venue OI + funding cap enforced; verified by `test/integration/multi-venue-hedge.test.ts` | 8-12d | ⬜ |
| 2.3 | Insurance fund design + funding model | Doc: parameter space, funding source (bps skim of perf fee), payout policy; on-chain module skeleton | 4d design, 6d contract | ⬜ |
| 2.4 | Hot wallet cold segregation — spot holdings move to policy-controlled address | Admin wallet holds only "hot working balance" (< 5% NAV); rest on MSafe or hardware-key custody | 5d + 🔒 MSafe policy sign-off | ⬜ |
| 2.5 | Load test — 100 concurrent deposits, 50 concurrent withdrawals, 1000 tick/hr cron cadence | No pool exhaustion; NAV monotonic; no fee accrual drift > 1 cent per $10K TVL | 3d harness + 1d run | ⬜ (blocked on Aiven upgrade 1.3) |
| 2.6 | Rate-limit hardening on public read endpoints (`/api/predictions/*`, `/api/health/production`, `/api/portfolio/unified`) | 429 with `Retry-After` under 10x burst; validated by `k6` script | 2d | ⬜ |
| 2.7 | Monitoring uplift — SLO dashboard fed by `/api/health/production` + Discord ring buffer | Dashboard shows: NAV, drawdown, hedge coverage, cron freshness, phantom rate, cron_state key ages | 3d (Grafana or Vercel Analytics) | ⬜ |

### Phase 3 — Months 3-6 (growth-side, unlock only after Phase 1-2)

| # | Item | Exit criterion | Effort | Status |
|---|---|---|---|---|
| 3.1 | OTC desk relationships (Wintermute / Amber / GSR) | At least 2 counterparty relationships; RFQ hook wired for swaps > $100K notional | 5d + 🔒 relationship-building | ⬜ (unlock: $1M+ AUM credible size) |
| 3.2 | KYC/AML legal review + institutional-tier onboarding flow | Legal opinion on retail-permissionless + institutional-KYC bifurcation; onboarding surface behind auth gate | 3d + 🔒 legal counsel | ⬜ |
| 3.3 | Regulatory posture doc + geo-block extension review | Doc: jurisdiction handling, ToS updates, MiCA / SEC posture note | 2d + 🔒 legal review | ⬜ |
| 3.4 | TVL cap ratchets (per ROADMAP): $10K → $100K → $1M → $10M | Each ratchet gated by ROADMAP success criteria; `admin_set_tvl_cap` PTB via MSafe | 0.1d each PTB + gated by criteria | ⬜ |
| 3.5 | Second EVM chain deployment (per ROADMAP Q4) | Live pool on non-Sui chain; NAV oracle + defense gates ported | 10-15d (mostly config + testing) | ⬜ |
| 3.6 | Chaos-day rehearsal — full incident replay: BlueFin outage, Aiven outage, QStash outage, RPC outage | Runbook 1-7 (SLO_AND_RUNBOOKS.md) walked through; recovery time < SLO | 2d rehearsal + report | ⬜ |

### Ongoing (every phase)

- Green-only bulletproof drawdown test — `bun jest test/integration/pool-drawdown-defense.test.ts` MUST stay 10/10 at all times.
- Weekly `scripts/analyze-pool-pnl.ts` + `scripts/check-hedge-signal-alignment.ts` review; Discord any anomalies.
- Update `docs/CHANGELOG.md` on every version bump — never rewrite historical entries.
- CLAUDE.md kept accurate to code (last drift-audit: 2026-07-18 — see git log).

### Critical dependency chain

```
0.4 (log-observe) → 0.5 (flip PortfolioDriver EXECUTE) → 1.4 (flip other gates)
1.1 (external audit) → 1.5 (audit bundle) → 1.7 (bounty)
1.1 (external audit) → 2.1 (u128 redeploy)  ← the biggest gate
1.2 (AdminCap MSafe) → 2.4 (cold segregation)
1.3 (Aiven upgrade) → 2.5 (load test)
2.2 (multi-venue) → 3.1 (OTC) → 3.4 (higher TVL caps)
```

**Ordering rule:** never flip a destructive env gate without 72h log-observe on the prior flip. Never ratchet TVL cap without hitting the specific success criteria in `ROADMAP.md`. Never redeploy the pool contract without external audit clearance on the diff.

---

## Historical: Pre-deploy readiness assessment

The remainder of this document was the pre-launch readiness snapshot. Retained for provenance. Numeric configurations and asset lists (e.g. CRO, USDT-via-WDK) reflect the EVM-era and are superseded by the current mainnet architecture in [ARCHITECTURE.md](./ARCHITECTURE.md) and [SUI_DEPLOYMENT.md](./SUI_DEPLOYMENT.md).

## Executive Summary

This document outlines the mainnet deployment readiness status for the ZK Vanguard Community Pool system. The smart contracts and infrastructure have passed all 50 critical mainnet readiness tests and are ready for production deployment pending operational setup tasks.

---

## ✅ Test Results Summary

| Test Suite | Status | Tests |
|------------|--------|-------|
| ProductionGuard Enforcement | ✅ PASS | 10/10 |
| Financial Amount Validation | ✅ PASS | 6/6 |
| Address & Transaction Validation | ✅ PASS | 4/4 |
| Leverage & Percentage Validation | ✅ PASS | 5/5 |
| Share Validation | ✅ PASS | 3/3 |
| Live Price Fetching | ✅ PASS | 3/3 |
| Circuit Breaker Functionality | ✅ PASS | 3/3 |
| Audit Logging | ✅ PASS | 2/2 |
| Production Mode Flag | ✅ PASS | 2/2 |
| Financial Calculations | ✅ PASS | 5/5 |
| Agent Orchestrator | ✅ PASS | 2/2 |
| Hedge Manager Validation | ✅ PASS | 1/1 |
| Security Tests | ✅ PASS | 4/4 |
| **TOTAL** | **✅ PASS** | **50/50** |

---

## Smart Contract Security Features

### OpenZeppelin Upgradeable Contracts
- `AccessControlUpgradeable` - Role-based permissions
- `ReentrancyGuardUpgradeable` - Reentrancy attack protection
- `PausableUpgradeable` - Emergency pause capability
- `UUPSUpgradeable` - Secure upgrade pattern

### Circuit Breakers (Configured)
| Parameter | Value | Description |
|-----------|-------|-------------|
| Max Single Deposit | $100,000 | Prevents whale manipulation |
| Max Single Withdrawal | 25% of pool | Prevents bank run |
| Daily Withdrawal Cap | 50% of pool | Limits daily outflow |
| Whale Threshold | 10% ownership | Triggers extra checks |

### Price Validation Ranges
| Asset | Min Price | Max Price |
|-------|-----------|-----------|
| BTC | $1,000 | $1,000,000 |
| ETH | $100 | $100,000 |
| USDC/USDT | $0.95 | $1.05 |
| CRO | $0.001 | $10 |

---

## Token Configuration

### Tether WDK Integration (USDT)

Mainnet uses official Tether USDT via WDK integration:

| Chain | Address | Verified |
|-------|---------|----------|
| Cronos Mainnet | `0x66e428c3f67a68878562e79A0234c1F83c208770` | ✅ |
| Hedera Mainnet | `0x0000000000000000000000000000000000000000` | ❌ (not yet deployed) |

### Testnet Tokens (Testnet USDC)

| Chain | Address | Purpose |
|-------|---------|---------|
| Cronos Testnet | `0x28217DAddC55e3C4831b4A48A00Ce04880786967` | Testing |
| Hedera Testnet | `0x0000000000000000000000000000000000000000` | Testing |

---

## Oracle Configuration

### Pyth Network Price Feeds

| Network | Oracle Address |
|---------|----------------|
| Cronos Mainnet | `0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B` |
| Cronos Testnet | `0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320` |
| Hedera Mainnet | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |
| Hedera Testnet | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |

### Price Feed IDs
```
BTC: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
ETH: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
SUI: 0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744
CRO: 0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe
```

---

## x402 Gasless Payment System

### Overview
Users pay $0.00 in native gas - all transactions are sponsored via x402 protocol.

### How It Works
1. User approves USDT via x402 (gasless EIP-3009)
2. x402 Facilitator verifies payment signature
3. Smart contract receives USDT, executes operation
4. Contract pays CRO/ETH gas from its sponsored pool

### Cost Per Operation
| Operation | Gas Units | Cronos Cost | Hedera Cost |
|-----------|-----------|-------------|---------------|
| Deposit | ~132,500 | ~$0.00007 | ~$0.05 |
| Withdraw | ~150,000 | ~$0.00008 | ~$0.05 |
| ZK Commitment | ~65,000 | ~$0.00003 | ~$0.02 |

### Recommended Gas Sponsorship Fund
| Chain | Amount | Supports |
|-------|--------|----------|
| Cronos | 50 CRO (~$5) | ~75,000 txs |
| Hedera | 100 HBAR (~$10) | ~10,000 txs |
| x402 Pool | $100 USDC | Payment flow |
| **Total** | **~$455** | MVP launch |

---

## Deployment Checklist

### ❌ Pre-Deployment Tasks (Must Complete)

| Task | Status | Notes |
|------|--------|-------|
| Create Gnosis Safe Multisig | ❌ | https://safe.cronos.org |
| Set Treasury Address | ❌ | Multisig-controlled |
| Obtain Moonlander Router | ❌ | Contact Moonlander team |
| Fund Deployer Wallet | ❌ | Need ~10 CRO |
| Deploy Timelock (48h) | ❌ | Security requirement |
| Deploy CommunityPool Proxy | ❌ | Via Hardhat |
| Transfer Admin to Timelock | ❌ | Critical security step |
| Verify on Explorer | ❌ | Cronoscan verification |
| Test Deposit on Mainnet | ❌ | Small amount test |

### ✅ Completed Tasks

| Task | Status |
|------|--------|
| Smart Contract Development | ✅ |
| Security Features (ReentrancyGuard, Pausable) | ✅ |
| Circuit Breaker Implementation | ✅ |
| Pyth Oracle Integration | ✅ |
| WDK USDT Configuration | ✅ |
| x402 Gasless Integration | ✅ |
| ProductionGuard Implementation | ✅ |
| Mainnet Readiness Tests (50/50) | ✅ |
| Testnet Deployment & Testing | ✅ |

---

## Deployment Commands

### 1. Deploy Timelock
```bash
npx hardhat run scripts/deploy/deploy-timelock.js --network cronos-mainnet
```

### 2. Deploy CommunityPool
```bash
npx hardhat run scripts/deploy/deploy-community-pool.js --network cronos-mainnet
```

### 3. Verify Contracts
```bash
npx hardhat verify --network cronos-mainnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### 4. Fund Gas Sponsorship
```javascript
// Send CRO to contract for gas sponsorship
const fundAmount = ethers.parseEther("50"); // 50 CRO
await deployer.sendTransaction({
  to: poolAddress,
  value: fundAmount,
});
```

---

## Environment Variables (.env)

```bash
# PRODUCTION MODE - SET TO true FOR MAINNET
PRODUCTION_MODE=true
ENFORCE_PRODUCTION_SAFETY=true

# Network
NETWORK=cronos-mainnet
CRONOS_MAINNET_RPC=https://evm.cronos.org

# Addresses (Fill after deployment)
NEXT_PUBLIC_COMMUNITY_POOL_ADDRESS=<DEPLOYED_ADDRESS>
NEXT_PUBLIC_TIMELOCK_ADDRESS=<TIMELOCK_ADDRESS>

# Multisig
ADMIN_MULTISIG=<GNOSIS_SAFE_ADDRESS>
TREASURY_ADDRESS=<TREASURY_SAFE_ADDRESS>

# Oracle
PYTH_ORACLE_ADDRESS=0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B

# Token (USDT on mainnet)
DEPOSIT_TOKEN_ADDRESS=0x66e428c3f67a68878562e79A0234c1F83c208770

# x402 Facilitator
X402_FACILITATOR_URL=https://facilitator.x402.network
```

---

## Risk Assessment

### Mitigated Risks
| Risk | Mitigation |
|------|------------|
| Reentrancy Attack | OpenZeppelin ReentrancyGuard |
| Price Manipulation | Pyth Oracle + sanity checks |
| Whale Domination | 10% whale threshold + limits |
| Bank Run | Daily withdrawal cap (50%) |
| Admin Key Compromise | Timelock (48h) + Multisig |
| Contract Upgrade Attack | UUPS + Timelock delay |
| Stale Price Data | 60-second freshness check |

### Residual Risks
| Risk | Severity | Notes |
|------|----------|-------|
| Smart Contract Bug | Medium | Mitigated by testing, auditable code |
| Oracle Failure | Low | Multiple price sources available |
| Network Congestion | Low | x402 handles gas spikes |
| Regulatory | Unknown | Legal review recommended |

---

## Monitoring & Alerts

### Recommended Monitoring
- [ ] Contract balance below threshold
- [ ] Large deposits (>$50K)
- [ ] Large withdrawals (>10% of pool)
- [ ] Circuit breaker triggered
- [ ] Failed transactions
- [ ] Oracle price deviations >5%

### Alert Channels
- Telegram bot for critical alerts
- Email for daily summaries
- Dashboard for real-time monitoring

---

## Emergency Procedures

### Circuit Breaker Triggered
1. Investigate cause immediately
2. Check for malicious activity
3. If false positive: Admin can reset via multisig
4. If attack: Keep circuit breaker active

### Pause Contract
```javascript
// Requires PAUSER_ROLE
await communityPool.pause();
```

### Emergency Withdrawal
```javascript
// Enable emergency withdrawals (bypasses circuit breaker)
await communityPool.setEmergencyWithdraw(true);
```

### Contract Upgrade
1. Develop fix
2. Deploy new implementation
3. Submit upgrade proposal to Timelock
4. Wait 48 hours
5. Execute upgrade

---

## Testnet Verification Results

### Cronos Testnet
- Contract: `0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30`
- Status: ✅ Live and operational
- Total Value: ~$15,000 (test funds)
- Deposits: ✅ Working
- Withdrawals: ✅ Working

### Hedera Testnet
- Contract: `0xCF434F24eBA5ECeD1ffd0e69F1b1F4cDed1AB2a6`
- Status: ✅ Live and operational
- Total Value: ~$210 (test funds)
- Deposits: ✅ Working
- Withdrawals: ✅ Working

---

## Approval & Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Lead Developer | | | |
| Security Reviewer | | | |
| Operations Lead | | | |
| Project Owner | | | |

---

## Appendix A: Contract ABIs

See `contracts/abi/CommunityPool.json` for full ABI.

## Appendix B: Test Execution

```bash
# Run all mainnet readiness tests
npx jest test/mainnet-readiness.test.ts --no-coverage

# Expected: 50/50 tests passing
```

## Appendix C: Related Documentation

- [WDK Integration Guide](./integrations/tether-wdk.md)
- [x402 Gasless Setup](./integrations/x402-gasless.md)
- [Security Architecture](./SECURITY.md)
- [API Documentation](./API.md)

---

*Document Version: 1.0*  
*Last Updated: March 18, 2026*  
*Status: Ready for Mainnet Deployment (Pending Operational Tasks)*
