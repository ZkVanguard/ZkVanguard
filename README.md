# ZkVanguard

**AI-Powered Multi-Chain RWA Risk Management Platform**

[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://zkvanguard.xyz)
[![SUI E2E](https://img.shields.io/badge/SUI%20E2E-72%2F72-brightgreen)](#e2e-test-suite)
[![Cronos](https://img.shields.io/badge/Cronos-Testnet-blue)](https://cronos.org)
[![SUI](https://img.shields.io/badge/SUI-Testnet-cyan)](https://sui.io)
[![Sepolia](https://img.shields.io/badge/Sepolia-WDK%20USDT-purple)](#deployed-contracts)
[![Hedera](https://img.shields.io/badge/Hedera-Testnet-orange)](https://hedera.com)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)

**Live Demo:** [zkvanguard.xyz](https://zkvanguard.xyz)

---

## Multi-Chain Architecture

ZkVanguard is a **multi-chain platform** supporting **Cronos**, **SUI**, **Sepolia (WDK)**, and **Hedera** networks:

| Chain | Type | Status | Pool | Key Features |
|-------|------|--------|------|--------------|
| **Sepolia (WDK)** | EVM | ✅ Primary | USDT Community Pool | Tether WDK self-custodial wallet, Official USDT |
| **SUI** | Move | ✅ Live | USDC 4-Asset AI Pool | Cetus DEX aggregator, DB-backed shares, AI rebalancing |
| **Cronos** | EVM | ✅ Live | — | x402 Gasless, VVS DEX, ZK Proxy Vault |
| **Hedera** | EVM | 🧪 Testing | Community Pool | Pyth Oracle, HashIO RPC |
| **Arbitrum Sepolia** | EVM | 🧪 Testing | Community Pool | L2 deployment |

---

## What We Built

ZkVanguard automates institutional crypto portfolio management with **predictive intelligence** instead of reactive monitoring.

### Core Innovation

| Feature | What It Does |
|---------|--------------|
| **Multi-Chain** | Cronos + SUI + Sepolia + Hedera with unified portfolio view |
| **USDC Community Pool** | AI-managed 4-asset allocation (BTC 30%, ETH 30%, SUI 25%, CRO 15%) |
| **Cetus DEX Aggregator** | Multi-DEX routing across 6 protocols on SUI (Cetus, DeepBook, Turbos, BlueFin, FlowX, Aftermath) |
| **ZK Proxy Vault** | Bulletproof escrow with ZK ownership verification & time-locked withdrawals |
| **Prediction Markets** | Polymarket/Delphi data predicts crashes *before* they happen |
| **7 AI Agents** | Lead, Risk, Hedging, Settlement, Reporting, PriceMonitor, SuiPool - autonomous coordination |
| **Post-Quantum Privacy** | 521-bit ZK-STARK proofs, CUDA-accelerated, no trusted setup |
| **Private Hedges** | Stealth addresses + ZK commitments hide hedge details on-chain |
| **ZK Proof Verification** | Verify hedge ownership by wallet or proof hash |
| **Gasless Transactions** | x402 on Cronos, Sponsored Tx on SUI |

---

## SUI USDC Community Pool

The SUI USDC pool is a database-backed, AI-managed community investment pool:

```
User deposits USDC → AI splits into 4 assets → Cetus DEX swaps → Portfolio rebalances
```

### How It Works

1. **Deposit USDC** — User deposits via the UI (min $10, min first deposit $50)
2. **Mint Shares** — 1 share = 1 USDC, tracked in PostgreSQL
3. **AI Allocation** — BTC 30% / ETH 30% / SUI 25% / CRO 15%
4. **Cetus Swaps** — Atomic multi-DEX swaps via Cetus aggregator
5. **Auto-Rebalance** — Triggers on 5% drift or 75%+ AI confidence
6. **Withdraw** — Burn shares, reverse swaps, receive USDC

### USDC Pool API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sui/community-pool?network=testnet` | Pool summary (shares, NAV, members) |
| `GET` | `?action=user-position&wallet=0x...` | User's shares, value, history |
| `GET` | `?action=allocation` | Current 4-asset allocation |
| `GET` | `?action=swap-quote&asset=BTC&amount=100` | Cetus swap quote |
| `GET` | `?action=members` | Leaderboard (all members) |
| `POST` | `?action=record-deposit` | Record deposit, mint shares |
| `POST` | `?action=record-withdraw` | Record withdrawal, burn shares |

### Database Schema

- `community_pool_state` — Pool NAV, total shares, allocations
- `community_pool_shares` — Per-user shares by chain (UNIQUE on wallet+chain)
- `community_pool_transactions` — Audit trail with SHA256 hashes
- `community_pool_nav_history` — Hourly NAV snapshots for risk analysis

---

## How Prediction Intelligence Works

```
Traditional: React AFTER crash → Lose money → Hedge too late
ZkVanguard:  Polymarket signals → AI correlates → Auto-hedge BEFORE crash
```

1. **Polymarket API** → Live prediction data ("Will BTC crash 20%?")
2. **Delphi Service** → Correlates with your portfolio assets
3. **AI Recommends** → `HEDGE` / `MONITOR` / `IGNORE`
4. **Auto-Execute** → Gasless hedge via Moonlander perpetuals

---

## 7 Specialized Agents

| Agent | Function |
|-------|----------|
| **Lead** | Orchestrates workflow, natural language commands |
| **Risk** | VaR, volatility, Sharpe ratio, liquidation risk |
| **Hedging** | Delphi-driven strategies via Moonlander perpetuals |
| **Settlement** | x402 gasless execution with ZK authentication |
| **Reporting** | Compliance reports, audit trails, analytics |
| **PriceMonitor** | Autonomous price alerts, triggers hedges on thresholds |
| **SuiPool** | SUI-specific pool management, rebalancing, NAV monitoring |

```
agents/
├── core/
│   ├── BaseAgent.ts          # Abstract agent base class
│   ├── LeadAgent.ts          # Master orchestrator
│   ├── AgentRegistry.ts      # Service locator pattern
│   └── SafeExecutionGuard.ts # Error containment
├── specialized/
│   ├── HedgingAgent.ts       # Portfolio hedging strategies
│   ├── PriceMonitorAgent.ts  # Price feed aggregation
│   ├── RiskAgent.ts          # Risk assessment & thresholds
│   ├── ReportingAgent.ts     # Metrics & reporting
│   ├── SettlementAgent.ts    # Transaction finalization
│   └── SuiPoolAgent.ts       # SUI pool management
└── communication/
    └── MessageBus.ts         # Inter-agent message routing
```

---

## Private Hedge Architecture

Institutional traders need **privacy** — competitors shouldn't see your hedge positions.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PRIVACY-PRESERVING HEDGING                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   PUBLIC (On-Chain)           PRIVATE (ZK-Protected)                │
│   ─────────────────           ──────────────────────                │
│   • Commitment hash           • Portfolio composition               │
│   • Stealth address           • Exact hedge sizes                   │
│   • Aggregate settlements     • Asset being hedged                  │
│   • Nullifier (anti-replay)   • Entry/exit prices                   │
│                               • PnL calculations                    │
│                                                                     │
│   FLOW: User → Stealth Address → Commitment Hash → ZK Proof         │
│         (unlinkable)  (hides details)   (verifiable)                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
git clone https://github.com/ZkVanguard/ZkVanguard.git && cd ZkVanguard && npm install

# Terminal 1: ZK Backend
cd zkp/api && pip install -r requirements.txt && python server.py

# Terminal 2: Frontend
npm run dev

# Terminal 3: Run E2E tests
npx tsx scripts/test-sui-services-e2e.ts   # 9 test suites, 72/72 checks
```

---

## E2E Test Suite

**9 test suites, 72/72 checks passing** on SUI Testnet:

| # | Test Suite | What It Validates |
|---|------------|-------------------|
| 1 | **Deployed Contract Verification** | Package + shared object IDs on SUI testnet |
| 2 | **CetusSwapService** | Token resolution, swap quotes, pool info, prices |
| 3 | **SuiExplorerService** | On-chain reads (balances, transactions, objects) |
| 4 | **SuiOnChainHedgeService** | Contract reads, commitment generation, tx builders |
| 5 | **SuiCommunityPoolService** | Pool stats, deposit/withdraw builders, payment routing |
| 6 | **SuiPrivateHedgeService** | Commitment scheme, ZK proofs, stealth deposits |
| 7 | **SuiAutoHedgingAdapter** | Lifecycle, config, risk assessment |
| 8 | **SuiPortfolioManager** | Init, positions, risk metrics, hedging |
| 9 | **USDC Pool API** | user-position, record-deposit, record-withdraw, allocation, swap-quote |

---

## Integrations

| Service | Purpose |
|---------|---------|
| Crypto.com AI SDK | AI-powered portfolio analysis & natural language |
| Crypto.com Exchange API | Real-time prices (100 req/s) |
| Polymarket + Delphi | Prediction market intelligence |
| VVS Finance SDK | DEX swaps on Cronos |
| Cetus Aggregator | Multi-DEX routing on SUI (6 protocols) |
| Moonlander | Perpetual futures hedging |
| WDK (Tether) | Self-custodial EVM wallet, seed phrase stored locally |
| x402 Facilitator | Gasless transactions on Cronos |
| SUI Sponsored Tx | Gasless transactions on SUI |
| QStash | Cron job scheduling (5–15 min intervals) |
| Pyth Oracle | Price feeds on Hedera |

---

## Deployed Contracts

### Sepolia Testnet — Primary EVM (WDK)

| Contract | Address |
|----------|---------|
| CommunityPool (Proxy) | `0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086` |
| CommunityPool (Impl) | `0x04eD217b6a4d34af45abfE1357F3861C45b34596` |
| USDT (Official WDK) | `0xd077a400968890eacc75cdc901f0356c943e4fdb` |

### Cronos Testnet (EVM)

| Contract | Address |
|----------|---------|
| RWAManager | `0x170E8232E9e18eeB1839dB1d939501994f1e272F` |
| ZKVerifier | `0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8` |
| PaymentRouter | `0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b` |
| GaslessZKVerifier | `0x44098d0dE36e157b4C1700B48d615285C76fdE47` |

### SUI Testnet — RWA Package (Move v2)

| Module | Shared Object ID |
|--------|------------------|
| **Package** | `0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a` |
| rwa_manager | `0x65638c3c5a5af66c33bf06f57230f8d9972d3a5507138974dce11b1e46e85c97` |
| zk_verifier | `0x6c75de60a47a9704625ecfb29c7bb05b49df215729133349345d0a15bec84be8` |
| zk_proxy_vault | `0x5a0c81e3c95abe2b802e65d69439923ba786cdb87c528737e1680a0c791378a4` |
| zk_hedge_commitment | `0x9c33f0df3d6a2e9a0f137581912aefb6aafcf0423d933fea298d44e222787b02` |
| hedge_executor | `0xb6432f1ecc1f55a1f3f3c8c09d110c4bda9ed6536bd9ea4c9cb5e739c41cb41e` |
| payment_router | `0x1fba1a6a0be32f5d678da2910b99900f74af680531563fd7274d5059e1420678` |

### SUI Testnet — Community Pool Package

| Module | Shared Object ID |
|--------|------------------|
| **Package** | `0xcb37e4ea0109e5c91096c0733821e4b603a5ef8faa995cfcf6c47aa2e325b70c` |
| community_pool | `0xb9b9c58c8c023723f631455c95c21ad3d3b00ba0fef91e42a90c9f648fa68f56` |
| AdminCap | `0xef6d5702f58c020ff4b04e081ddb13c6e493715156ddb1d8123d502655d0e6e6` |
| FeeManagerCap | `0x705d008ef94b9efdb6ed5a5c1e02e93a4e638fffe6714c1924537ac653c97af6` |

### Hedera Testnet (EVM)

| Contract | Address |
|----------|---------|
| CommunityPool | `0xCF434F24eBA5ECeD1ffd0e69F1b1F4cDed1AB2a6` |
| Pyth Oracle | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |

---

## Cron Jobs (QStash + Vercel)

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/master` | Daily 00:00 UTC | Master orchestration |
| `/api/cron/hedge-monitor` | Daily 06:00 UTC | Hedge position monitoring |
| `/api/cron/pool-nav-monitor` | Daily 08:00 UTC | NAV snapshot & risk |
| `/api/cron/auto-rebalance` | Daily 12:00 UTC | AI rebalance trigger |
| `/api/cron/community-pool` | Daily 18:00 UTC | Pool health check |

---

## Tech Stack

- **Frontend:** Next.js 14, TypeScript, TailwindCSS
- **Backend:** Node.js, Python FastAPI, CUDA
- **Blockchain:** Cronos (EVM/Solidity), SUI (Move), Sepolia (EVM), Hedera (EVM)
- **ZK:** ZK-STARK proofs, Post-quantum 521-bit curves
- **AI:** Crypto.com AI SDK, Multi-agent orchestration (7 agents)
- **DEX:** Cetus Aggregator (SUI), VVS Finance (Cronos)
- **Database:** PostgreSQL (Neon) — pool shares, NAV history, audit trails
- **Wallets:**
  - **EVM:** WDK (Tether self-custodial wallet, seed phrase stored locally)
  - **SUI:** @mysten/dapp-kit (Sui Wallet, Suiet, Ethos)
- **Infra:** Vercel (hosting), QStash (cron), Neon (DB)

---

## WDK Migration

> **2026-03:** All EVM wallet interactions now use [WDK](https://github.com/tetherto/wdk) (Tether self-custodial wallet). See `/lib/wdk/` for context and `/components/MultiChainConnectButton.tsx` for usage.

---

## Scripts

```bash
npm run dev                   # Start dev server (port 3099)
npm test                      # Full test suite
npm run test:contracts        # Solidity contract tests
npm run agents:start          # Launch agent system
npm run deploy:testnet        # Deploy to testnet
npm run typecheck             # TypeScript validation
npm run format:check          # Code format check

# E2E Tests
npx tsx scripts/test-sui-services-e2e.ts          # 9 suites, 72/72 checks
npx tsx scripts/test-usdc-deposit.ts              # USDC deposit/withdraw flow
npx tsx scripts/complete-system-test.ts           # Full system validation
```

---

## License

Apache 2.0 — See [LICENSE](LICENSE)

---

<div align="center">

**[Live Demo](https://zkvanguard.xyz)** · **[Docs](./docs/)** · **[Demo Guide](./DEMO_WALKTHROUGH_GUIDE.md)**

</div>
