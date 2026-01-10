# ZkVanguard

**AI-Powered Multi-Agent RWA Risk Management Platform**

[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://zkvanguard.vercel.app)
[![Tests](https://img.shields.io/badge/Tests-10%2F10-brightgreen)](./docs/reports/COMPLETE_SYSTEM_TEST_REPORT.md)
[![Cronos](https://img.shields.io/badge/Network-Cronos%20Testnet-blue)](https://cronos.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)

---

## Overview

ZkVanguard is the first platform to combine **5 autonomous AI agents**, **post-quantum ZK-STARK privacy**, **prediction market intelligence**, and **gasless transactions** for institutional crypto portfolio management.

**Live Demo:** [zkvanguard.vercel.app](https://zkvanguard.vercel.app)

---

## 🔑 Core Differentiators

### 🛡️ Post-Quantum ZK-STARK Privacy

Your portfolio strategy stays completely private while remaining verifiable on-chain.

```
Portfolio Data (Private)          ZK Proof (Public)
├── Positions: $10M BTC/ETH   →   ├── 77KB cryptographic proof
├── Leverage: 2.5x            →   ├── 521-bit NIST P-521 security
├── Entry prices              →   ├── Merkle root commitment
└── Risk parameters           →   └── Verifiable without revealing data
```

- **521-bit security** - NIST P-521 curve, resistant to quantum attacks
- **CUDA acceleration** - Proofs generate in <2 seconds
- **No trusted setup** - Unlike ZK-SNARKs, no ceremony required
- **On-chain verification** - Store proof commitments for $0.01 USDC

---

### 🔮 Prediction Market Intelligence

We don't just react to crashes - we **predict them** using crowd-sourced probability data.

```
Traditional Risk Management          ZkVanguard + Delphi
├── React AFTER volatility       →   ├── Predict BEFORE crashes
├── Historical indicators only   →   ├── Live Polymarket probabilities
├── 50-60% accuracy             →   ├── Crowd-sourced intelligence
└── Manual hedge decisions       →   └── AI-automated hedge triggers
```

**How it works:**
1. **Polymarket API** pulls live prediction data (e.g., "Will BTC hit $100K by March?")
2. **Delphi Service** correlates predictions with your portfolio assets
3. **AI recommends**: `HEDGE` / `MONITOR` / `IGNORE` based on probability + impact
4. **Hedging Agent** adjusts hedge ratios using prediction confidence scores

---

### 🤖 5 Specialized AI Agents

Not one generic bot - **five specialists** that coordinate like a hedge fund team.

```
┌─────────────────────────────────────────────────────────────┐
│                      👔 LEAD AGENT                          │
│         Orchestrates strategy • Processes commands          │
│                Natural language interface                   │
└────────────────────────┬────────────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
┌───▼───┐          ┌─────▼─────┐        ┌─────▼─────┐
│ 📊    │          │    🛡️     │        │    ⚡     │
│ RISK  │          │  HEDGING  │        │ SETTLEMENT│
│ AGENT │          │   AGENT   │        │   AGENT   │
│       │          │           │        │           │
│ VaR   │          │ Delphi    │        │ x402      │
│ Vol   │          │ Moonlander│        │ Gasless   │
│ Sharpe│          │ Perpetuals│        │ ZK Proofs │
└───┬───┘          └─────┬─────┘        └─────┬─────┘
    │                    │                    │
    └────────────────────┼────────────────────┘
                         │
                   ┌─────▼─────┐
                   │    📈     │
                   │ REPORTING │
                   │   AGENT   │
                   │           │
                   │ Analytics │
                   │ Compliance│
                   │ Summaries │
                   └───────────┘
```

| Agent | Role | Key Capability |
|-------|------|----------------|
| **Lead** | Orchestration | Parses commands, delegates tasks, coordinates responses |
| **Risk** | Analysis | Calculates VaR, volatility, Sharpe ratio, liquidation risk |
| **Hedging** | Strategy | Generates hedge recommendations using Delphi + Moonlander |
| **Settlement** | Execution | Executes trades gaslessly with ZK proof authentication |
| **Reporting** | Compliance | Creates audit trails and performance analytics |

---

### ⚡ TRUE Gasless Transactions

Users pay **$0.00 CRO** for all operations. Not subsidized - architecturally gasless via x402.

```
Traditional DeFi                    ZkVanguard x402
├── User pays $5-50 gas         →   ├── User pays $0.00 CRO
├── Failed txs waste gas        →   ├── $0.01 USDC flat fee
├── Gas price volatility        →   ├── Predictable costs
└── UX friction                 →   └── Web2-like experience
```

**ROI for institutions:**
- 500 transactions/month × $5 gas = **$2,500/month traditional**
- 500 transactions/month × $0.01 = **$5/month ZkVanguard**
- **Annual savings: $30,000+**

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/mrarejimmyz/ZkVanguard.git
cd ZkVanguard
npm install

# Start ZK backend (Terminal 1)
cd zkp/api && pip install -r requirements.txt && python server.py

# Start frontend (Terminal 2)
npm run dev

# Run system test (Terminal 3)
npx tsx scripts/complete-system-test.ts
```

---

## Integrations

| Integration | Purpose | Status |
|-------------|---------|--------|
| **Crypto.com Exchange API** | Real-time prices (100 req/s) | ✅ Live |
| **Polymarket API** | Live prediction market data | ✅ Live |
| **Delphi Markets** | Prediction aggregation layer | ✅ Live |
| **VVS Finance SDK** | DEX swaps on Cronos | ✅ Live |
| **Moonlander** | Perpetual futures hedging | ✅ Live |
| **x402 Facilitator** | Gasless transactions | ✅ Live |
| **ZK-STARK Backend** | CUDA-accelerated proofs | ✅ Live |

---

## Smart Contracts (Cronos Testnet)

| Contract | Address |
|----------|---------|
| RWAManager | `0x170E8232E9e18eeB1839dB1d939501994f1e272F` |
| ZKVerifier | `0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8` |
| PaymentRouter | `0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b` |
| GaslessZKVerifier | `0x44098d0dE36e157b4C1700B48d615285C76fdE47` |

---

## Tech Stack

**Frontend:** Next.js 14, TypeScript, TailwindCSS, wagmi/viem  
**Backend:** Node.js, Python FastAPI, CUDA  
**Blockchain:** Cronos zkEVM, Solidity 0.8.20, Hardhat  
**AI:** Crypto.com AI SDK, Custom multi-agent orchestration

---

## Documentation

| Document | Description |
|----------|-------------|
| [Demo Walkthrough](./DEMO_WALKTHROUGH_GUIDE.md) | Complete demo script with speaking points |
| [Investor Pitch](./INVESTOR_PITCH_DECK.md) | Investment thesis and market opportunity |
| [Architecture](./docs/ARCHITECTURE.md) | System design overview |
| [Setup Guide](./docs/SETUP.md) | Installation and configuration |
| [Test Report](./docs/reports/COMPLETE_SYSTEM_TEST_REPORT.md) | Validation results |

---

## Validation

```bash
# Type check
npm run typecheck

# Unit tests
npm test

# Integration test (10/10 tests)
npx tsx scripts/complete-system-test.ts
```

---

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

---

<div align="center">

**[Live Demo](https://zkvanguard.vercel.app)** • **[Documentation](./docs/)** • **[Demo Guide](./DEMO_WALKTHROUGH_GUIDE.md)**

Built for the Cronos x402 Hackathon

</div>
