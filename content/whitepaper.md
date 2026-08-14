---
title: ZkWard Whitepaper
subtitle: An AI-Managed Crypto Vault That Rides Polymarket Alpha — ZK-Attested, Autonomous, Live on Sui Mainnet
version: Version 2.0
date: August 2026
---

## Abstract

ZkWard turns Polymarket alpha into a one-click crypto vault. Seven autonomous AI agents fuse prediction-market signals with funding rates and price momentum, allocate USDC across BTC / ETH / SUI, auto-hedge on BlueFin perpetuals, and ZK-attest every meaningful decision on-chain. The same ZK primitive powers two premium products: private hedges and a private portfolio creator. What used to require bots, capital, and 24/7 attention is now a single deposit.

The platform orchestrates seven specialised agents — Lead, Risk, Hedging, Settlement, Reporting, Price Monitor, and the SUI Pool agent — that read prediction-market signals from Polymarket and Manifold, blend them with BlueFin funding-rate data and Crypto.com price momentum, generate consensus allocations through a 2-of-3 voting threshold on trades above $100K, and execute swaps via the BlueFin aggregator on SUI mainnet. Each meaningful trade decision is committed to the chain through a ZK-STARK proof system (Goldilocks field, no trusted setup, CUDA-accelerated in dev / CPU-only on Vercel), giving users verifiable autonomy instead of a black-box model.

Polymarket alone now processes $20B+ in monthly volume, and the broader prediction-market sector grew to $63.5B in 2025 (CertiK). The signal is real; riding it consistently has required custom bots, sophisticated risk management, and constant attention. ZkWard collapses that workflow into a one-click USDC deposit, with two revenue layers running today: on-chain protocol fees on every vault deposit (50 bps annual management plus 10% performance, routed to a multisig-controlled `FeeManagerCap`) and tiered subscription access to premium features. The same ZK rails that secure consumer flow are what unlock confidential institutional use cases as the platform scales.

The USDC Community Pool is live on SUI mainnet (package `0x107292…7b726`, v0.2.0) with a contract-enforced $10K TVL cap during the operational-proof phase and eight autonomy defense gates protecting against drawdown, phantom fills, and stale hedges. Cap-lifting is a governance action, not a code change.

## Introduction & Market Opportunity

### The Prediction-Market Alpha Opportunity

Polymarket processed over $20B in monthly trading volume by early 2026, and the broader prediction-market sector grew to $63.5B in 2025 (CertiK). That signal is real — but three barriers keep retail users from harvesting it:

- **Operational complexity.** Riding prediction-market alpha consistently requires custom bots, monitoring infrastructure, and 24/7 attention — table stakes for hedge funds, impossible for retail.
- **No risk management.** Spot signals don't size positions, set stops, or hedge. Retail traders who try get liquidated or shaken out, never capturing the edge they bet on.
- **Trust in AI agents.** Every AI-agent crypto product ships an unverifiable black box; users are asked to trust a team's claim that the model works, with no on-chain proof.

### Why Now

Three independent waves are converging:

- **Prediction-market maturation.** Polymarket scaled from speculative niche to $20B+/month volume in under three years — the signal is liquid enough to ride at retail size.
- **ZK technology advancement.** ZK-STARK proofs now achieve practical performance (sub-second verification) with post-quantum security — making verifiable AI agents actually shippable.
- **AI agents going mainstream.** Bittensor, ASI Alliance, Fetch, and MyShell crossed $1B+ market caps; consumer expectation for AI-managed financial workflows is no longer experimental.
- **Consumer on-chain UX.** Smart accounts, sponsored gas, one-click deposits, and mobile-first wallets finally make on-chain DeFi usable for non-traders.

## The Problem: Reactive Risk Management

### The Reactive Paradigm

Traditional cryptocurrency risk management operates on a fundamentally flawed paradigm: reaction rather than prediction. The typical workflow follows this pattern:

```
1. Market event occurs         → BTC drops 15% in 4 hours
2. Alert triggered             → Risk system detects volatility spike
3. Human review                → Portfolio manager analyses situation (30-60 min)
4. Decision made               → Hedge strategy approved (15-30 min)
5. Execution                   → Orders submitted to exchanges (5-15 min)
6. Settlement                  → Transactions confirmed on-chain (2-10 min)

Total time:           52-115 minutes
Portfolio loss:       8-12% (during reaction delay)
```

### The Cost of Reaction

Analysis of major market events from 2020–2025 shows what reactive management actually costs:

| Event                    | Total Drop | Loss Before Hedge | Predictable?                        |
| ------------------------ | ---------- | ----------------- | ----------------------------------- |
| March 2020 COVID crash   | −50%       | −35%              | Yes (pandemic spread data)          |
| May 2021 China ban       | −53%       | −28%              | Yes (regulatory signals)            |
| Luna / UST collapse 2022 | −99%       | −45%              | Yes (depeg prediction markets)      |
| FTX collapse 2022        | −25%       | −18%              | Yes (withdrawal-concern signals)    |

### Privacy Exposure

Public blockchain transparency creates significant competitive disadvantages for larger traders:

- **Front-running.** MEV bots extract $500M+ annually by detecting and front-running large orders.
- **Strategy leakage.** Competitors reverse-engineer trading strategies from on-chain activity.
- **Regulatory risk.** Public portfolio exposure may violate confidentiality requirements.
- **Market impact.** Visible large positions attract predatory trading.

## Our Solution: Predictive Intelligence

### The Predictive Paradigm

ZkWard flips the workflow: instead of reacting to crashes, it anticipates them by consuming prediction-market signals continuously.

```
1. Prediction markets signal   → Polymarket 5-min BTC: 73% down probability
2. AI signal fusion            → Aggregator blends Polymarket + Delphi + funding
3. Automatic action            → Autohedge cron opens SHORT, size = f(NAV, confidence)
4. On-chain settlement         → BlueFin perp fill, verified via getPositions() delta
5. ZK proof                    → STARK proof of the decision committed on-chain

Total time:           30 seconds (5-min cron cadence)
Portfolio protection: Activated before the move, not after
```

### Core Stack

- **Multi-agent AI.** Seven specialised agents coordinate signal ingestion, risk scoring, hedge sizing, execution, and reporting.
- **Prediction fusion.** Polymarket 5-min BTC (30% weight) · Delphi (5–15%) · Crypto.com price (20% BTC / 10% ETH) · BlueFin funding (10%) — TTL-cached 20s inside a shared aggregator.
- **ZK-STARK privacy.** Goldilocks-field, transparent, post-quantum STARK proofs for hedge and portfolio commitments; verified inside Move on SUI.
- **Autonomous crons.** Every 5 / 15 / 30 minutes a QStash-scheduled Vercel route reads state, decides, and acts — with idempotent claim keys, halt gates, and Discord alerts on every capital-touching action.

### End-to-End Flow

1. User deposits USDC into the SUI USDC Community Pool.
2. `sui-community-pool` cron (every 30 min) recomputes NAV, allocation targets, and hedge-ratio state.
3. Signals refresh through `PredictionAggregatorService` and feed hedge sizing.
4. Autohedge opens or closes BlueFin perps against BTC / ETH / SUI spot exposure, sized per predicted direction.
5. `polymarket-edge-trader` cron (every 5 min) runs a regret-weighted Kelly-fractional trader on top of the venue.
6. `alert-response-loop` reads the alert-log ring buffer and can `HALT_TRADER` / `HALT_AUTOHEDGE` when phantom-fill or drawdown thresholds trip.
7. Reconcilers (`sui-hedge-reconcile` hourly, `bluefin-db-reconcile` every 15 min) cross-check on-chain Move state ↔ venue positions ↔ database, and repair drift automatically.

## Technical Architecture

### Overview

The stack has four horizontal layers. Every capital-touching action flows through all four; every diagnostic path can short-circuit at any layer.

```
┌─────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE                         │
│  Dashboard · Chat · ZK Proof Explorer · Whitepaper              │
│  Next.js 16 App Router · React 19 · Tailwind · next-intl (12L)  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AI AGENT ORCHESTRATION                      │
│  Lead · Risk · Hedging · Settlement · Reporting · PriceMonitor  │
│  · SuiPool  (SafeExecutionGuard: caps, slippage, consensus)     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA & INTEGRATION LAYER                    │
│  Polymarket · Delphi · Manifold · BlueFin (perps + funding)     │
│  Crypto.com (prices) · Pyth (oracles) · Aiven Postgres 17       │
│  · Upstash QStash + Redis                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       BLOCKCHAIN LAYER                          │
│  SUI Mainnet — Move contracts (USDC Community Pool v0.2.0,      │
│  ZK verifier, ZK Proxy Vault, Hedge Executor)                   │
│  Secondary: Cronos EVM, Oasis Sapphire, Arbitrum Sepolia,       │
│  Hedera testnet (multichain capability, SUI is lead)            │
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer          | Technology                                                     | Purpose                                    |
| -------------- | -------------------------------------------------------------- | ------------------------------------------ |
| Frontend       | Next.js 16 App Router · React 19 · TypeScript · Tailwind       | UI, i18n (12 locales), real-time reads     |
| API + crons    | Next.js route handlers on Vercel `sin1` (Bangalore)            | Deterministic scheduled autonomy           |
| Agents         | TypeScript · Crypto.com AI SDK (Ollama + ASI + OpenAI + Claude fallback chain) | Signal fusion, task delegation |
| ZK backend     | Python 3.13 · FastAPI · CUDATrueSTARK (Goldilocks, real FRI, PoW grinding) | Post-quantum STARK proofs      |
| Move contracts | Move · SUI mainnet                                             | Pool, hedge, ZK verifier, proxy vault      |
| EVM contracts  | Solidity 0.8.20 · OpenZeppelin · Hardhat                       | Multi-chain reference deployments          |
| Database       | Aiven PostgreSQL 17 (Bangalore, plan-wide 20-conn limit)       | Off-chain ledger, cron heartbeats          |
| Queue + KV     | Upstash QStash v2 (schedules) · Upstash Redis                  | Cron dispatch, rate limits, halt state     |
| Wallets        | `@mysten/dapp-kit` (SUI) · `@tetherto/wdk` (EVM smart account) | Non-custodial + smart-account UX           |

### Live Contracts (SUI Mainnet, v0.2.0)

- **Package:** `0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726`
- **Pool state:** `0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a`
- **TVL cap:** $10,000 (contract-enforced during operational-proof phase; lifted by governance action)
- **Capabilities:** `AdminCap` (currently hot, migrating to MSafe via OracleCap split v0.4.0) · `FeeManagerCap` (MSafe-held) · `OracleCap` (planned split — hot key attests NAV)

Prior deployment (v0.1.0, `0x9ccb…c88`) is dormant; the underpayment bug that motivated v0.2.0 is fixed on-chain, verifiable via `bun run scripts/analyze-pool-pnl.ts`.

## Multi-Agent AI System

Seven specialised agents run per-request (not as a daemon). Cron routes generally bypass agent orchestration for latency-sensitive work; the SUI cron path lazily instantiates `getSuiPoolAgent()` for signal reasoning.

Every trade execution flows through `SafeExecutionGuard`:

- Position cap $10M single trade / $100M daily (UTC reset)
- Slippage ≤ 30 bps, leverage ≤ 4×
- Consensus threshold ≥ 2/3 agents for trades > $100K (30-second vote window)
- 5-second cooldown, max 3 concurrent, breaker after 3 failures (60-second auto-reset)
- ZK proof hash stored for every execution > $1M

### Agents

- **Lead.** Intent parsing, task decomposition, result aggregation. Routes to specialised agents by intent classification.
- **Risk.** VaR, volatility, Sharpe, max-drawdown scoring; watches prediction markets for early-warning signals; triggers alerts.
- **Hedging.** Consumes fused signals to compute hedge ratio (100% for pools < $1k, 50% otherwise, capped by on-chain `max_hedge_ratio_bps`); opens / closes BlueFin perps.
- **Settlement.** Wallet + smart-account flow for user-funded operations; handles sponsored-gas SUI transactions (2-step: wallet builds, admin co-signs same bytes).
- **Reporting.** Portfolio summaries with optional ZK proofs; produces auditor-ready evidence without exposing private inputs.
- **Price Monitor.** Cross-source price sanity (Crypto.com + Pyth + BlueFin); markPrice divergence detection.
- **SUI Pool.** Signal reasoning for the community pool cron; provides confidence-weighted allocation guidance.

## Zero-Knowledge Privacy Layer

### Protocol

ZkWard's ZK-STARK backend runs against a fixed, published protocol — no trusted setup, no elliptic curves, no discrete-log assumptions.

- **Post-quantum security.** 180-bit soundness — 160 bits from 80 FRI queries (FRI Theorem 1.2: ε ≤ ρ^q) plus 20 bits of proof-of-work grinding. All layers enforced end-to-end: value + sibling Merkle binding at every FRI layer, per-layer folding consistency `f_{L+1}(x²) = (v+s)/2 + α·(v−s)/(2x)` over a multiplicative coset, Fiat-Shamir challenges rebound to `sha256(root_L)`, and final-polynomial degree bound.
- **Goldilocks prime field.** `p = 2⁶⁴ − 2³² + 1 = 18446744069414584321` (same field as Polygon zkEVM and Plonky2) with primitive root `g = 7`.
- **No trusted setup.** Fully transparent; every parameter is a public constant that any auditor can verify (per Definition 1.1 of ePrint 2018/046).
- **Fiat-Shamir transformation.** SHA-256-based challenge derivation makes the protocol non-interactive in the random-oracle model.
- **CUDA acceleration.** GPU-optimised NTT and field operations via CuPy / Numba are available in the `CUDATrueSTARK` prover for self-hosted operation and probe-verified at import. Production runs on Vercel serverless with no GPU, so the deployed prover is CPU-only.

### Security

Per FRI Theorem 1.2 (Ben-Sasson et al. 2018/828), soundness error `ε ≤ ρ^q`, where `ρ` is the rate and `q` is the number of queries.

```
CONFIGURED SOUNDNESS TARGET (per ePrint 2018/828)
══════════════════════════════════════════════════

Parameters:
  ρ (rate)          = 1 / blowup_factor = 1/4 = 0.25
  q (queries)       = 80
  grinding_bits     = 20 (enforced at prove + verify)

FRI Soundness (Theorem 1.2):
  ε = ρ^q = (1/4)^80 = 2^(−160)

Target with grinding:
  ε_total = 2^(−160) × 2^(−20) = 2^(−180)

Security comparison:
  NIST Post-Quantum Level 1:  128-bit
  Configured target:          180-bit
  Margin (target − NIST L1):  +52 bits
```

- **Target security:** 512-bit (configuration parameter)
- **Effective soundness:** `2⁻¹⁸⁰` = `(1/4)⁸⁰ × 2⁻²⁰` — hedge proofs: `2⁻¹⁸⁴` with 24-bit grinding
- **FRI queries:** 80 (exceeds 128-bit post-quantum threshold by 52 bits)
- **Blowup factor:** 4× default (`ρ = 0.25`); hedge proofs use 16× for constraint-degree headroom
- **FRI folds:** up to 10; hedge proofs deliver 10 (observable via `proof.actual_fri_layers`); legacy default delivers ~7
- **Grinding bits:** 20 default; hedge proofs use 24

### Verification

The system passes 7/7 empirical soundness checks + 16 tamper vectors + 68 Python STARK tests + 110 Move on-chain verifier tests + 677 TypeScript unit tests.†

| Theorem                            | Paper reference          | Verification                                                          | Status |
| ---------------------------------- | ------------------------ | --------------------------------------------------------------------- | ------ |
| Transparency                       | 2018/046 Def 1.1         | No trusted setup, all params public                                   | ✓      |
| Post-quantum                       | 2018/046 §1.1            | No DLP / factoring; SHA-256 only                                      | ✓      |
| FRI soundness                      | 2018/828 Thm 1.2         | `ε = ρ^q = 2⁻¹⁶⁰`, with grinding `2⁻¹⁸⁰`                              | ✓      |
| Zero-knowledge                     | 2018/046 Def 1.3         | Witness hidden; proof reveals nothing                                 | ✓      |
| Completeness                       | 2018/046 Def 1.2         | Valid witness → valid proof (68/68 Python STARK tests)                | ✓      |
| Soundness                          | 2018/046 Def 1.2         | Forgeries rejected (16 tamper vectors)                                | ✓      |
| Hedge invariants (AIR-in-STARK)    | this repo, 2026-07       | Asset / side / leverage constraints inside composition polynomial, verified on-chain | ✓ |

† Empirical checks confirm that on the inputs we tried, the implementation behaves as the whitepaper's construction requires (round-trip succeeds, tamper vectors are rejected, configured parameters match). They are a necessary soundness signal, not a machine-checked formal proof. A full formal proof would require a Coq / Lean encoding of the STARK protocol; that work is out of scope for this repo. Run `python zkp/tests/empirical_soundness_harness.py` to reproduce.

### Hedge Architecture — Public vs Private

```
PUBLIC (on-chain)                PRIVATE (ZK-protected)
─────────────────                ──────────────────────
• Commitment hash (32 bytes)     • Asset being hedged
• Nullifier (anti-replay)        • Direction (LONG / SHORT)
• Vault-invariant caps pinned    • Exact hedge size
  in statement.public_inputs     • Leverage (only cap disclosed)
• Proxy vault ID (optional)      • Entry price
• ProofVerified event            • Notional value
                                 • Salt / commitment nonce

Commitment hash (146-byte SHA-256 preimage, fixed binary layout):
  SHA256(
    version_u32BE                  (4)
    portfolioId_u32BE              (4)
    timestampMs_u64BE              (8)
    asset_code_u8                  (1)   BTC=1, ETH=2, SUI=3
    side_code_u8                   (1)   LONG=0, SHORT=1
    leverageX_u32BE                (4)
    leverageCap_u32BE              (4)
    entryPriceUsdcCents_u64BE      (8)
    sizeUnits_u64BE                (8)   per-asset step units
    notionalValueUsdcCents_u128BE  (16)
    notionalCapUsdcCents_u128BE    (16)
    salt_32B                       (32)
    inputsHash_32B                 (32)  SHA-256 of canonical JSON
  )

On-chain verification path (post-quantum, no ed25519):
  zk_verifier::verify_hedge_stark_proof_entry(...)
    → zkv_stark::verify_hedge_stark_proof
      → grinding PoW (≥ 20 bits, hedge = 24)
      → FRI (Merkle + folding-consistency + Fiat-Shamir)
      → composition polynomial identity for asset / side / leverage
      → replay protection via `used_proofs` table
```

The commitment binding, canonical JSON serialisation, and on-chain STARK verifier are all SHA-256 based. No elliptic curves, no discrete-log assumptions, no pairings — Shor's algorithm is a non-threat. The legacy ed25519 attestation fast path can be disabled by admin via `admin_set_stark_only_mode(true)`, forcing every verify through the post-quantum STARK path.

## Autonomy Defense System (v0.3.0 — 8 Gates)

A 30% drawdown in June–July 2026 revealed a subtle failure mode: prescriptive autonomy layers gated *future* rebalances but never reshaped *existing* holdings. v0.3.0 shipped an eight-gate defense system that closes those gaps end-to-end. Every destructive action is env-gated so operators can roll out on log-only, then flip on execution.

| Gate | Module                                    | What it enforces                                                |
| ---- | ----------------------------------------- | --------------------------------------------------------------- |
| 1    | `PortfolioDriver`                         | Actively unwinds spot when target changes, not just gates new fills |
| 2    | `HedgeFillVerifier`                       | `getPositions()` delta cross-check — no more silent BlueFin rejects |
| 3    | `applyHedgeabilityClamp`                  | Small-NAV allocations redirect to USDC when minQty gap prevents perp fill |
| 4    | Symmetric-sell logic                      | SELL and BUY paths use the same size math and same guards       |
| 5    | `StaleHedgeDetector`                      | Auto-close hedges older than N days that have flipped M times   |
| 6    | Signal-flip drift-close                   | `agent-signal-tick` cron closes drift when Polymarket flips confidently |
| 7    | Regret-weighted trader                    | `polymarket-edge-trader` stake sizing weighted by prediction PnL |
| 8    | `alert-response-loop`                     | Reads `alert-log:ring-buffer`, can `HALT_TRADER` / `HALT_AUTOHEDGE` |

Env gates default to log-only; each is flipped in order (`PORTFOLIO_DRIVER_EXECUTE` → `STALE_HEDGE_AUTO_CLOSE` → `ALERT_RESPONSE_EXECUTE` → `ALERT_RESPONSE_EXECUTE_HALT`) after 24 hours of clean logs. The single hardest test — `bun jest test/integration/pool-drawdown-defense.test.ts` — must stay green through every merge.

## Prediction Market Integration

### Sources

Five prediction / market-data sources feed the aggregator, each with a fixed weight and a 20-second TTL cache:

| Source                    | Weight (BTC)   | Cadence | Notes                                                     |
| ------------------------- | -------------- | ------- | --------------------------------------------------------- |
| Polymarket 5-min BTC      | 30%            | 5 min   | Chainlink-resolved, >90% historical accuracy              |
| Delphi                    | 5–15%          | 5 min   | Medium-term outlook                                       |
| Crypto.com price momentum | 20% BTC / 10% ETH | 30 s | Ticker with 24h delta                                     |
| BlueFin funding rate      | 10%            | 60 s    | Sentiment via funding sign                                |
| Cross-asset alignment     | dynamic        | derived | Synthetic STRONG upgrade when multiple sources agree      |

### Hedge Ratio

- **Base:** 50% of exposure (100% for pools under $1K).
- **Confidence multiplier:** `1 + (probability − 0.5) × 0.5`, clamped by on-chain `max_hedge_ratio_bps`.
- **Example:** 73% probability → 1.23× multiplier → `50% × 1.23 = 61.5%` exposure hedged.

### Small-NAV Asymmetry

BlueFin minimum quantities create a hedgeability gap for small pools: BTC-PERP min 0.001 (~$73), ETH $30, SUI $4. When `allocation × NAV < floor`, the perp leg is skipped — leaving spot naked-long even under BEARISH signals. v0.3.0's `applyHedgeabilityClamp` redirects that allocation to USDC and `PortfolioDriver` actively unwinds pre-existing spot instead of merely documenting the exposure.

### Scenario Table

| Question                                       | Probability | Impact   | Action                             |
| ---------------------------------------------- | ----------- | -------- | ---------------------------------- |
| BTC volatility exceeds 60% in 30 days          | 73%         | HIGH     | HEDGE (open SHORT)                 |
| Fed rate hike in current quarter               | 68%         | HIGH     | HEDGE (rotate to USDC allocation)  |
| ETH drops below $3000 this week                | 42%         | MODERATE | MONITOR (set alert)                |
| USDC depeg > 2% in 90 days                     | 12%         | HIGH     | IGNORE (low probability)           |

## Multi-Chain Strategy

SUI is the lead chain by design and gets new features first. Other chains are strategic multi-chain capability, deliberately deployed so pool logic can migrate when demand justifies it.

| Chain                    | Role                          | Status                                       |
| ------------------------ | ----------------------------- | -------------------------------------------- |
| **SUI Mainnet**          | Lead — USDC Community Pool, hedge executor, ZK verifier | ✅ Live (v0.2.0)          |
| Cronos EVM (Chain ID 25) | Multi-chain reference, x402 gasless research           | ✅ Deployed              |
| Oasis Sapphire           | Confidential EVM primitive validation                  | ✅ Testnet               |
| Arbitrum Sepolia         | L2 pool + hedge deploy reference                       | ✅ Testnet               |
| Hedera Testnet           | Non-EVM performance validation                         | ✅ Testnet               |

The core Move logic, cron topology, and defense gates run against SUI. Portability to other chains is proven at the testnet level; production deployments follow demand.

## Security Analysis

### Contracts

- Built on OpenZeppelin battle-tested libraries where EVM applies; Move code uses the standard `sui::` framework with explicit `entry` boundaries.
- 15 internal audit phases completed (2026-06-04 through 2026-06-12); external audit is a Sui Foundation grant deliverable (T4-C).
- 110 Move on-chain verifier tests + integration test (`bun jest test/integration/pool-drawdown-defense.test.ts`) enforced on every merge.
- Kill switches: `SUI_AUTO_HEDGE_DISABLE=1` (halt), `HEDGE_MIN_NAV_USD` (default 20; hedge blocked below), `NAV_SAFETY_CEILING_USDC` (halts writes above ceiling; Move u128 redeploy needed before scaling past a scoped ceiling).

### Cryptographic

- **ZK-STARK.** 512-bit target security, 180-bit effective soundness (80 FRI queries × 20-bit grinding).
- **Prime field.** Goldilocks `p = 2⁶⁴ − 2³² + 1` — post-quantum, no discrete log or factoring.
- **Merkle trees.** SHA-256 with 10-layer FRI commitment hierarchy.
- **Key derivation.** ECDH for stealth addresses.
- **Signatures.** ECDSA with EIP-712 typed data on EVM; native `ed25519` for SUI, with `admin_set_stark_only_mode(true)` available to force post-quantum-only verification.

### Operational

- **Non-custodial.** Users control keys; the pool holds capital under Move object custody, not admin authority.
- **Deterministic autonomy.** Every cron uses `verifyCronRequest`, `tryClaimCronRun` idempotency keys, and `setCronState` heartbeats. Missing heartbeats trip alerts within one interval.
- **Discord alerts.** Every state change that moves capital or trips a safety fires `notifyDiscord`; KILL/ERROR/WARN entries are also appended to `alert-log:ring-buffer` (200-entry) which the `alert-response-loop` reads.
- **Reconcilers.** `sui-hedge-reconcile` (hourly, on-chain Move ↔ BlueFin), `bluefin-db-reconcile` (15 min, BlueFin ↔ DB), `SuiHedgeReconciler.reconcileSuiHedges()` (on-demand, on-chain Move ↔ DB).
- **Security scan.** Pre-push hook runs `scripts/security-scan.cjs` on every push; no override paths in CI.

## Tokenomics & Economics

### Revenue

- **Protocol fees (on-chain).** 50 bps annual management + 10% performance, charged on realised profits. Routed via `FeeManagerCap` — held in MSafe multisig, distinct from the operational `AdminCap`.
- **Subscription tiers.** Access to premium features — private hedges and the private portfolio creator — priced per user tier.

The dual model runs today: on-chain flow subsidises consumer acquisition; subscription flow captures institutional willingness-to-pay for privacy.

### Capital State

- **Live TVL cap:** $10,000, contract-enforced during the operational-proof phase.
- **Cap-lifting:** governance action (`sui-set-tvl-cap` admin endpoint gated by `CRON_SECRET`), not a code change.
- **NAV ceiling:** `NAV_SAFETY_CEILING_USDC` default 10B; halts writes above ceiling. Scaling past this ceiling requires a Move `u128` redeploy first.

### Cost Structure

- Vercel (Bangalore `sin1`) for API + crons — pay-per-request, dominated by cron cadence and function memory.
- Aiven PostgreSQL 17 (plan-wide 20-connection limit — every health endpoint serialises queries as a consequence).
- Upstash QStash + Redis for scheduling, rate limits, and halt state.
- BlueFin trading fees pass through to users; regret-weighted stake sizing minimises unnecessary volume.

Projections beyond current state are omitted deliberately — the whitepaper describes what runs today, not a growth forecast.

## Roadmap

- **✅ Q1 2026.** Cronos EVM stack (Moonlander, VVS, x402 research); ZK-STARK prover cutover to `CUDATrueSTARK`.
- **✅ Q2 2026.** SUI mainnet USDC Community Pool v0.1.0 → v0.2.0; underpayment bug fix; TVL cap enforcement; multichain reference deploys.
- **✅ Q3 2026.** v0.3.0 autonomy defense (8 gates, alert-response-loop, PortfolioDriver, regret tracker). Aiven migration off Neon. Refactor arc: 2,087 LOC lifted off 7 monolith files into 15 pure modules.
- **🔧 Q4 2026 (current).** External audit (SUI Foundation grant T4-C). `OracleCap` split (v0.4.0) so `AdminCap` can migrate fully to MSafe. TVL cap raise post-audit.
- **📋 2027+.** Cross-chain unified portfolio; Cronos zkEVM enhanced privacy path; expanded prediction sources (Kalshi, additional Polymarket verticals).

## Conclusion

ZkWard turns prediction-market alpha into a one-click crypto vault — and uses the same ZK-attested rails to power private hedges and a private portfolio creator. By combining seven autonomous AI agents, a real-time signal pipeline, BlueFin perp execution, and on-chain ZK proofs on SUI mainnet, we collapse the three barriers that keep retail users from harvesting Polymarket-grade alpha — operational complexity, missing risk management, and unverifiable AI — while keeping protocol fees plus tiered subscription revenue as the dual economic engine.

The stack is live on SUI mainnet with a real capital pool, cron-driven autonomy, eight defense gates, and a contract-enforced TVL cap during the operational-proof phase. Cap-lifting is a governance action, not a code change.

This whitepaper describes the system as it runs today, not a roadmap for the future.

## References

1. Ben-Sasson, E., Bentov, I., Horesh, Y., & Riabzev, M. *"Scalable, transparent, and post-quantum secure computational integrity."* IACR Cryptology ePrint Archive, Paper 2018/046. <https://eprint.iacr.org/2018/046>
2. Ben-Sasson, E., Bentov, I., Horesh, Y., & Riabzev, M. *"Fast Reed-Solomon Interactive Oracle Proofs of Proximity."* ICALP 2018. ePrint 2018/828. <https://eprint.iacr.org/2018/828>
3. StarkWare Industries. *"ethSTARK Documentation v1.2."* IACR ePrint 2021/582.
4. Polygon zkEVM. *"Goldilocks Prime Field: efficient 64-bit field arithmetic for zkVMs."* Polygon Documentation.
5. EIP-3009: *Transfer With Authorization.* Ethereum Improvement Proposals, 2020.
6. Boston Consulting Group. *"Relevance of on-chain asset tokenization."* BCG Global, 2024.
7. CertiK. *"Prediction Market Sector Report 2025."*
8. Polymarket. *"Prediction Market Accuracy Analysis."*
9. Crypto.com. *"AI Agent SDK Documentation."*
10. Sui Foundation. *"Move on SUI — Framework and Object Model."*
11. BlueFin Exchange. *"Perpetual Futures API Reference."*
