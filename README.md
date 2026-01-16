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
| **Cronos** | EVM | ✅ Live | x402 Gasless, VVS DEX, zkEVM |
| **SUI** | Move | ✅ Ready | Sponsored Tx, Native Move, High TPS |

---

## What We Built

ZkVanguard automates institutional crypto portfolio management with **predictive intelligence** instead of reactive monitoring.

### Core Innovation

| Feature | What It Does |
|---------|--------------|
| **Multi-Chain** | Cronos + SUI with unified portfolio view |
| **Prediction Markets** | Polymarket/Delphi data predicts crashes *before* they happen |
| **5 AI Agents** | Lead, Risk, Hedging, Settlement, Reporting - autonomous coordination |
| **Post-Quantum Privacy** | 521-bit ZK-STARK proofs, CUDA-accelerated, no trusted setup |
| **Gasless Transactions** | x402 on Cronos, Sponsored Tx on SUI |
| **VVS Finance DEX** | Native Cronos swaps with best-price routing (V2/V3 pools) |

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

## 5 Specialized Agents

| Agent | Function |
|-------|----------|
| **Lead** | Orchestrates workflow, natural language commands |
| **Risk** | VaR, volatility, Sharpe ratio, liquidation risk |
| **Hedging** | Delphi-driven strategies via Moonlander perpetuals |
| **Settlement** | x402 gasless execution with ZK authentication |
| **Reporting** | Compliance reports, audit trails, analytics |

---

## Quick Start

```bash
git clone https://github.com/mrarejimmyz/Chronos-Vanguard.git && cd Chronos-Vanguard && npm install

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
| Crypto.com Exchange API | Real-time prices (100 req/s) |
| Polymarket + Delphi | Prediction market intelligence |
| VVS Finance SDK | DEX swaps on Cronos |
| Moonlander | Perpetual futures hedging |
| x402 Facilitator | Gasless transactions |

---

## Deployed Contracts (Cronos Testnet)

```
RWAManager:        0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189 (Updated Jan 16, 2026)
ZKVerifier:        0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8
PaymentRouter:     0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b
GaslessZKVerifier: 0x44098d0dE36e157b4C1700B48d615285C76fdE47
```

---

## Tech Stack

- **Frontend:** Next.js 14, TypeScript, TailwindCSS
- **Backend:** Node.js, Python FastAPI, CUDA
- **Blockchain:** Cronos zkEVM (EVM), SUI (Move)
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
