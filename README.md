# ZkVanguard

**AI-Powered Multi-Chain RWA Risk Management Platform**

[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://zkvanguard.vercel.app)
[![Tests](https://img.shields.io/badge/Tests-10%2F10-brightgreen)](./docs/reports/COMPLETE_SYSTEM_TEST_REPORT.md)
[![Cronos](https://img.shields.io/badge/Cronos-Testnet-blue)](https://cronos.org)
[![SUI](https://img.shields.io/badge/SUI-Testnet-cyan)](https://sui.io)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)

**Live Demo:** [zkvanguard.vercel.app](https://zkvanguard.vercel.app)

---

## 🌐 Multi-Chain Architecture

ZkVanguard is a **multi-chain platform** supporting both **Cronos** and **SUI** networks:

| Chain | Type | Status | Features |
|-------|------|--------|----------|
| **Cronos** | EVM | ✅ Live | x402 Gasless, VVS DEX, ZK Proxy Vault |
| **SUI** | Move | ✅ Live | Sponsored Tx, Native Move, ZK Proxy Vault |

---

## What We Built

ZkVanguard automates institutional crypto portfolio management with **predictive intelligence** instead of reactive monitoring.

### Core Innovation

| Feature | What It Does |
|---------|--------------|
| **Multi-Chain** | Cronos + SUI with unified portfolio view |
| **ZK Proxy Vault** | Bulletproof escrow with ZK ownership verification & time-locked withdrawals |
| **Prediction Markets** | Polymarket/Delphi data predicts crashes *before* they happen |
| **6 AI Agents** | Lead, Risk, Hedging, Settlement, Reporting, PriceMonitor - autonomous coordination |
| **Post-Quantum Privacy** | 521-bit ZK-STARK proofs, CUDA-accelerated, no trusted setup |
| **Private Hedges** | Stealth addresses + ZK commitments hide hedge details on-chain |
| **ZK Proof Verification** | Verify hedge ownership by wallet or proof hash |
| **Gasless Transactions** | x402 on Cronos, Sponsored Tx on SUI |

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

## 6 Specialized Agents

| Agent | Function |
|-------|----------|
| **Lead** | Orchestrates workflow, natural language commands |
| **Risk** | VaR, volatility, Sharpe ratio, liquidation risk |
| **Hedging** | Delphi-driven strategies via Moonlander perpetuals |
| **Settlement** | x402 gasless execution with ZK authentication |
| **Reporting** | Compliance reports, audit trails, analytics |
| **PriceMonitor** | Autonomous price alerts, triggers hedges on thresholds |

---

## Private Hedge Architecture

Institutional traders need **privacy** - competitors shouldn't see your hedge positions.

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
git clone https://github.com/mrarejimmyz/ZkVanguard.git && cd ZkVanguard && npm install

# Terminal 1: ZK Backend
cd zkp/api && pip install -r requirements.txt && python server.py

# Terminal 2: Frontend
npm run dev

# Terminal 3: Validate
npx tsx scripts/complete-system-test.ts  # 10/10 tests
```

---

## Integrations

| Service | Purpose |
|---------|---------|
| Crypto.com AI SDK | AI-powered portfolio analysis & natural language |
| Crypto.com Exchange API | Real-time prices (100 req/s) |
| Polymarket + Delphi | Prediction market intelligence |
| VVS Finance SDK | DEX swaps on Cronos |
| Moonlander | Perpetual futures hedging |
| ZK Proof Verification | Verify hedge ownership by wallet or proof hash |
| x402 Facilitator | Gasless transactions on Cronos |
| SUI Sponsored Tx | Gasless transactions on SUI |

---

## Deployed Contracts

### Cronos Testnet (EVM)

| Contract | Address |
|----------|---------|
| RWAManager | `0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189` |
| ZKVerifier | `0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8` |
| ZKProxyVault | `0xE8c3Eba5A5eC3311965DA4E8d4F33F5D0a5E4F9a` |
| PaymentRouter | `0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b` |
| GaslessZKVerifier | `0x44098d0dE36e157b4C1700B48d615285C76fdE47` |

### SUI Testnet (Move)

| Module | Package ID |
|--------|------------|
| **Package** | `0x142e6c41391f0d27e2b5a2dbf35029809efbf78e340369ac6f1ce8fb8aa080b6` |
| rwa_manager | Shared: `0x65638c3c5a5af66c33bf06f57230f8d9972d3a5507138974dce11b1e46e85c97` |
| zk_verifier | Shared: `0x6c75de60a47a9704625ecfb29c7bb05b49df215729133349345d0a15bec84be8` |
| zk_proxy_vault | Shared: `0x5a0c81e3c95abe2b802e65d69439923ba786cdb87c528737e1680a0c791378a4` |
| zk_hedge_commitment | Shared: `0x9c33f0df3d6a2e9a0f137581912aefb6aafcf0423d933fea298d44e222787b02` |
| payment_router | Shared: `0x1fba1a6a0be32f5d678da2910b99900f74af680531563fd7274d5059e1420678` |

---

## Tech Stack

- **Frontend:** Next.js 14, TypeScript, TailwindCSS
- **Backend:** Node.js, Python FastAPI, CUDA
- **Blockchain:** Cronos (EVM/Solidity), SUI (Move)
- **ZK:** ZK-STARK proofs, Post-quantum 521-bit curves
- **AI:** Crypto.com AI SDK, Multi-agent orchestration
- **Wallets:** RainbowKit (EVM), @mysten/dapp-kit (SUI)

---

## Documentation

- [Demo Walkthrough](./DEMO_WALKTHROUGH_GUIDE.md) - Complete demo script
- [Investor Pitch](./INVESTOR_PITCH_DECK.md) - Market opportunity
- [Architecture](./docs/ARCHITECTURE.md) - System design
- [Setup Guide](./docs/SETUP.md) - Installation

---

## License

Apache 2.0 - See [LICENSE](LICENSE)

---

<div align="center">

**[Live Demo](https://zkvanguard.vercel.app)** • **[Docs](./docs/)** • **[Demo Guide](./DEMO_WALKTHROUGH_GUIDE.md)**

</div>
